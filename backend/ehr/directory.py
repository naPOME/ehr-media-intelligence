from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import date
from typing import Literal

from pydantic import Field, model_validator

from ehr.models import Gender, Model, Patient
from ehr.storage import Store

SummaryStatus = Literal["unavailable", "ready", "stale", "failed"]
PatientSort = Literal[
    "name", "mrn", "dob", "gender", "record_count", "latest_record_date", "summary_status"
]


class DirectoryQuery(Model):
    query: str = Field(default="", max_length=200)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=100)
    sort_by: PatientSort = "name"
    order: Literal["asc", "desc"] = "asc"
    gender: Gender | None = None
    summary_status: SummaryStatus | None = None
    date_from: date | None = None
    date_to: date | None = None
    patient_ids: list[str] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def valid_dates(self) -> DirectoryQuery:
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from must not be after date_to")
        return self


class PatientListItem(Model):
    patient: Patient
    record_count: int
    latest_record_date: date | None
    summary_status: SummaryStatus


class PatientListResponse(Model):
    items: list[PatientListItem]
    total: int


class LibraryOverview(Model):
    patients: int
    records: int
    lab_reports: int
    imaging_reports: int
    summaries_ready: int
    latest_record_date: date | None


def directory_rows(store: Store, filters: DirectoryQuery) -> list[PatientListItem]:
    # Build once per request rather than querying records separately for every patient.
    records = store.records()
    counts = Counter(record.patient.id for record in records)
    dates: dict[str, date] = {}
    for record in records:
        if record.record_date:
            dates[record.patient.id] = max(
                dates.get(record.patient.id, date.min), record.record_date
            )
    term = filters.query.casefold()
    selected = set(filters.patient_ids)
    rows = []
    for patient in store.patients():
        if term and term not in patient.name.casefold() and term not in patient.mrn.casefold():
            continue
        if selected and patient.id not in selected:
            continue
        if filters.gender and patient.gender != filters.gender:
            continue
        cached = store.summary(patient.id)
        item = PatientListItem(
            patient=patient,
            record_count=counts[patient.id],
            latest_record_date=dates.get(patient.id),
            summary_status=cached["status"] if cached else "unavailable",
        )
        if filters.summary_status and item.summary_status != filters.summary_status:
            continue
        if filters.date_from and (
            not item.latest_record_date or item.latest_record_date < filters.date_from
        ):
            continue
        if filters.date_to and (
            not item.latest_record_date or item.latest_record_date > filters.date_to
        ):
            continue
        rows.append(item)

    # Stable tie-breaker and missing dates last in either direction.
    rows.sort(key=lambda row: row.patient.id)
    if filters.sort_by == "record_count":
        return sorted(rows, key=lambda row: row.record_count, reverse=filters.order == "desc")

    def value(row: PatientListItem) -> str:
        match filters.sort_by:
            case "name":
                return row.patient.name.casefold()
            case "mrn":
                return row.patient.mrn.casefold()
            case "gender":
                return row.patient.gender
            case "dob":
                return row.patient.dob.isoformat() if row.patient.dob else ""
            case "latest_record_date":
                return row.latest_record_date.isoformat() if row.latest_record_date else ""
            case "summary_status":
                return row.summary_status
            case _:
                return ""

    present = [row for row in rows if value(row)]
    missing = [row for row in rows if not value(row)]
    present.sort(key=value, reverse=filters.order == "desc")
    return present + missing


def patient_csv(rows: list[PatientListItem]) -> str:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(
        ["Patient", "MRN", "Date of birth", "Gender", "Documents", "Latest record", "Summary"]
    )

    def safe(value: object) -> str:
        text = "" if value is None else str(value)
        # Quoting alone does not stop spreadsheet formula execution.
        return (
            "'" + text
            if text.lstrip().startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r", "\n"))
            else text
        )

    for item in rows:
        writer.writerow(
            safe(value)
            for value in (
                item.patient.name,
                item.patient.mrn,
                item.patient.dob,
                item.patient.gender,
                item.record_count,
                item.latest_record_date,
                item.summary_status,
            )
        )
    return stream.getvalue()
