from __future__ import annotations

import csv
import io
import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import NAMESPACE_URL, uuid5

from pydantic import Field, ValidationError, model_validator

from ehr.models import Change, CleaningResult, Gender, Issue, LabValue, Model, Patient, Record


class IncomingRecord(Model):
    record_id: str = Field(min_length=1)
    source_system: str = Field(default="synthetic", pattern=r"^[A-Za-z0-9._-]+$")
    mrn: str = Field(min_length=1)
    patient_id: str | None = None
    name: str = Field(min_length=1)
    dob: str | None = None
    gender: str | None = None
    kind: Literal["note", "discharge", "lab", "imaging"]
    title: str = Field(min_length=1)
    record_date: str | None = None
    encounter_id: str | None = None
    encounter_class: Literal["AMB", "IMP", "EMER"] | None = None
    text: str = Field(min_length=1, max_length=200_000)
    labs: list[LabValue] = Field(default_factory=list)

    @model_validator(mode="after")
    def consistent_record_kind(self) -> IncomingRecord:
        if self.labs and self.kind != "lab":
            raise ValueError("Structured lab values require kind='lab'")
        if self.encounter_class and not self.encounter_id:
            raise ValueError("Encounter class requires a source encounter ID")
        return self


def stable_id(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, "ehr-media:" + value))


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError as exc:
        raise ValueError(f"Unsupported date {value!r}; use ISO or DD/MM/YYYY") from exc


def clean_record(raw: dict[str, Any], source_file: str) -> Record:
    original = raw.copy() if isinstance(raw, dict) else {}
    if isinstance(raw, dict) and isinstance(raw.get("labs"), str):
        raw = {**raw, "labs": json.loads(raw["labs"]) if raw["labs"] else []}
    incoming = IncomingRecord.model_validate(raw)
    changes: list[Change] = []

    def changed(field: str, before: str | None, after: str | None, reason: str) -> None:
        if before != after:
            changes.append(Change(field=field, before=before, after=after, reason=reason))

    mrn = re.sub(r"[\s-]", "", incoming.mrn).upper()
    if not mrn or not re.fullmatch(r"[A-Z0-9]+", mrn):
        raise ValueError("MRN must contain letters and digits, with optional spaces/hyphens")
    changed("mrn", incoming.mrn, mrn, "Canonical MRN; leading zeros preserved")
    name = " ".join(incoming.name.split())
    changed("name", incoming.name, name, "Collapsed repeated whitespace")
    mapping: dict[str, Gender] = {
        "f": "female",
        "female": "female",
        "m": "male",
        "male": "male",
        "o": "other",
        "other": "other",
        "u": "unknown",
        "unknown": "unknown",
    }
    gender = mapping.get((incoming.gender or "").casefold(), "unknown")
    changed("gender", incoming.gender, gender, "Mapped gender code; unsupported values are unknown")
    dob = parse_date(incoming.dob)
    if dob and dob > date.today():
        raise ValueError("DOB cannot be in the future")
    record_date = parse_date(incoming.record_date)
    if dob and record_date and record_date < dob:
        raise ValueError("Record date cannot precede patient DOB")
    changed("dob", incoming.dob, dob.isoformat() if dob else None, "Canonical date")
    changed(
        "record_date",
        incoming.record_date,
        record_date.isoformat() if record_date else None,
        "Canonical clinical date",
    )
    if not record_date:
        changes.append(
            Change(
                field="record_date",
                before=None,
                after=None,
                reason="Missing clinical date preserved; excluded from date filters",
            )
        )
    patient = Patient(
        id=stable_id(f"patient:{incoming.source_system}:{mrn}"),
        source_system=incoming.source_system,
        mrn=mrn,
        name=name,
        dob=dob,
        gender=gender,
    )
    return Record(
        id=stable_id(f"record:{incoming.source_system}:{incoming.record_id}"),
        external_id=incoming.record_id,
        source_file=source_file,
        patient=patient,
        patient_alias=incoming.patient_id,
        kind=incoming.kind,
        title=incoming.title,
        record_date=record_date,
        encounter_id=incoming.encounter_id,
        encounter_class=incoming.encounter_class,
        text=incoming.text,
        labs=incoming.labs,
        changes=changes,
        original=original,
    )


def _normalise_csv_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for row in rows:
        for key in (
            "dob",
            "gender",
            "record_date",
            "encounter_id",
            "encounter_class",
            "patient_id",
        ):
            if not row.get(key):
                row[key] = None
    return rows


def _read_text_records(content: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for block_number, block in enumerate(re.split(r"(?m)^\s*---\s*$", content), start=1):
        if not block.strip():
            continue
        headers, separator, body = block.strip().partition("\n\n")
        if not separator:
            raise ValueError(
                f"Text record {block_number} must separate metadata and clinical text "
                "with a blank line"
            )
        row: dict[str, Any] = {}
        for line in headers.splitlines():
            key, separator, value = line.partition(":")
            if not separator or not key.strip():
                raise ValueError(
                    f"Text record {block_number} has an invalid metadata line: {line!r}"
                )
            row[key.strip()] = value.strip() or None
        row["text"] = body.strip()
        if row.get("labs"):
            row["labs"] = json.loads(str(row["labs"]))
        records.append(row)
    if not records:
        raise ValueError("Text input contains no records")
    return records


def read_records_content(filename: str, content: str) -> list[Any]:
    if len(content.encode("utf-8")) > 10_000_000:
        raise ValueError("Input file exceeds 10 MB")
    content = content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    suffix = Path(filename).suffix.lower()
    if suffix == ".json":
        data = json.loads(content)
        if not isinstance(data, list):
            raise ValueError("JSON input must be an array of records")
        return data
    if suffix == ".csv":
        return _normalise_csv_rows(list(csv.DictReader(io.StringIO(content))))
    if suffix == ".txt":
        return _read_text_records(content)
    raise ValueError("Supported input formats: .json, .csv and .txt")


def read_records(path: Path) -> list[Any]:
    if path.stat().st_size > 10_000_000:
        raise ValueError("Input file exceeds 10 MB")
    return read_records_content(path.name, path.read_text(encoding="utf-8-sig"))


def clean_rows(rows: list[Any], source_file: str) -> CleaningResult:
    result = CleaningResult()
    seen: dict[str, str] = {}
    for position, raw in enumerate(rows, start=1):
        label = (
            str(raw.get("record_id", f"row-{position}")) if isinstance(raw, dict) else str(position)
        )
        try:
            record = clean_record(raw, source_file)
            digest = record.clinical_hash()
            if record.id in seen:
                if seen[record.id] != digest:
                    result.records = [item for item in result.records if item.id != record.id]
                    seen[record.id] = "conflicting"
                    raise ValueError("Conflicting copies of the same source record in this import")
                result.issues.append(
                    Issue(
                        record_id=label,
                        field="record_id",
                        severity="warning",
                        message="Duplicate source record skipped",
                    )
                )
                continue
            seen[record.id] = digest
            result.records.append(record)
        except (ValueError, TypeError, ValidationError) as exc:
            result.issues.append(Issue(record_id=label, field="record", message=str(exc)))
    return result


def clean_content(filename: str, content: str) -> CleaningResult:
    try:
        return clean_rows(read_records_content(filename, content), filename)
    except (ValueError, csv.Error, json.JSONDecodeError) as exc:
        return CleaningResult(issues=[Issue(record_id=filename, field="file", message=str(exc))])


def clean_files(paths: list[Path]) -> CleaningResult:
    result = CleaningResult()
    for path in paths:
        try:
            rows = read_records(path)
        except (OSError, ValueError, csv.Error) as exc:
            result.issues.append(Issue(record_id=path.name, field="file", message=str(exc)))
            continue
        cleaned = clean_rows(rows, path.name)
        result.records.extend(cleaned.records)
        result.issues.extend(cleaned.issues)
    return result
