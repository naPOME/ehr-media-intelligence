from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ehr.fhir import build_bundle
from ehr.models import ClinicalSummary, Patient, Record, content_hash


class IdentityConflict(ValueError):
    pass


class DuplicateRecord(ValueError):
    pass


class Store:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "ehr.sqlite3"
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS aliases(
                    namespace TEXT, alias TEXT, patient_id TEXT NOT NULL REFERENCES patients(id),
                    PRIMARY KEY(namespace, alias));
                CREATE TABLE IF NOT EXISTS records(
                    id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id),
                    hash TEXT NOT NULL, data TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS records_patient ON records(patient_id);
                CREATE TABLE IF NOT EXISTS record_fingerprints(
                    fingerprint TEXT PRIMARY KEY,
                    record_id TEXT UNIQUE NOT NULL REFERENCES records(id));
                CREATE TABLE IF NOT EXISTS bundles(
                    patient_id TEXT PRIMARY KEY REFERENCES patients(id), hash TEXT NOT NULL,
                    data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS summaries(
                    patient_id TEXT PRIMARY KEY REFERENCES patients(id), cache_key TEXT NOT NULL,
                    data TEXT, status TEXT NOT NULL, error TEXT, generated_at TEXT,
                    provider TEXT NOT NULL, model TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS ingestion_runs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            """)
            for row in db.execute("SELECT id, data FROM records"):
                record = Record.model_validate_json(row["data"])
                db.execute(
                    "INSERT OR IGNORE INTO record_fingerprints VALUES (?,?)",
                    (record.document_fingerprint(), record.id),
                )

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def save_record(self, record: Record) -> str:
        patient = record.patient
        with self.connection() as db:
            old = db.execute("SELECT data FROM patients WHERE id=?", (patient.id,)).fetchone()
            if old:
                existing = Patient.model_validate_json(old["data"])
                if existing.name.casefold() != patient.name.casefold():
                    raise IdentityConflict("Same MRN has conflicting patient names")
                if existing.dob and patient.dob and existing.dob != patient.dob:
                    raise IdentityConflict("Same MRN has conflicting dates of birth")
                if existing.gender != "unknown" and patient.gender not in (
                    existing.gender,
                    "unknown",
                ):
                    raise IdentityConflict("Same MRN has conflicting genders")
                patient = existing.model_copy(
                    update={
                        "dob": existing.dob or patient.dob,
                        "gender": patient.gender
                        if existing.gender == "unknown"
                        else existing.gender,
                    }
                )
            prior_record = db.execute(
                "SELECT patient_id, hash FROM records WHERE id=?", (record.id,)
            ).fetchone()
            if prior_record and prior_record["patient_id"] != patient.id:
                raise IdentityConflict("A source record cannot move to a different patient")
            if record.encounter_id and record.encounter_class:
                for row in db.execute(
                    "SELECT data FROM records WHERE patient_id=? AND id<>?", (patient.id, record.id)
                ):
                    related = Record.model_validate_json(row["data"])
                    if (
                        related.encounter_id == record.encounter_id
                        and related.encounter_class
                        and related.encounter_class != record.encounter_class
                    ):
                        raise IdentityConflict(
                            "Same encounter ID has conflicting encounter classes"
                        )
            if record.patient_alias:
                alias = db.execute(
                    "SELECT patient_id FROM aliases WHERE namespace=? AND alias=?",
                    (patient.source_system, record.patient_alias),
                ).fetchone()
                if alias and alias["patient_id"] != patient.id:
                    raise IdentityConflict("Source patient ID maps to a different MRN")
            duplicate = db.execute(
                "SELECT record_id FROM record_fingerprints WHERE fingerprint=?",
                (record.document_fingerprint(),),
            ).fetchone()
            if duplicate and duplicate["record_id"] != record.id:
                raise DuplicateRecord(
                    f"Identical clinical document already stored as {duplicate['record_id']}"
                )
            db.execute(
                "INSERT INTO patients VALUES (?,?) ON CONFLICT(id) "
                "DO UPDATE SET data=excluded.data",
                (patient.id, patient.model_dump_json()),
            )
            if record.patient_alias:
                db.execute(
                    "INSERT OR IGNORE INTO aliases VALUES (?,?,?)",
                    (patient.source_system, record.patient_alias, patient.id),
                )
            record = record.model_copy(update={"patient": patient})
            digest = record.clinical_hash()
            if prior_record and prior_record["hash"] == digest:
                db.execute(
                    "UPDATE records SET data=? WHERE id=?", (record.model_dump_json(), record.id)
                )
                status = "unchanged"
            else:
                db.execute(
                    "INSERT INTO records VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                    "hash=excluded.hash,data=excluded.data",
                    (record.id, patient.id, digest, record.model_dump_json()),
                )
                db.execute("DELETE FROM record_fingerprints WHERE record_id=?", (record.id,))
                db.execute(
                    "INSERT INTO record_fingerprints VALUES (?,?)",
                    (record.document_fingerprint(), record.id),
                )
                status = "updated" if prior_record else "inserted"
            records = [
                Record.model_validate_json(row[0])
                for row in db.execute(
                    "SELECT data FROM records WHERE patient_id=? ORDER BY id", (patient.id,)
                )
            ]
            bundle = build_bundle(patient, records)
            bundle_hash = content_hash(bundle)
            previous = db.execute(
                "SELECT hash FROM bundles WHERE patient_id=?", (patient.id,)
            ).fetchone()
            if not previous or previous["hash"] != bundle_hash:
                db.execute("UPDATE summaries SET status='stale' WHERE patient_id=?", (patient.id,))
            db.execute(
                "INSERT INTO bundles VALUES (?,?,?) ON CONFLICT(patient_id) DO UPDATE SET "
                "hash=excluded.hash,data=excluded.data",
                (patient.id, bundle_hash, json.dumps(bundle)),
            )
            return status

    def patients(self) -> list[Patient]:
        with self.connection() as db:
            return [
                Patient.model_validate_json(row[0])
                for row in db.execute("SELECT data FROM patients ORDER BY id")
            ]

    def patient(self, patient_id: str) -> Patient | None:
        with self.connection() as db:
            row = db.execute("SELECT data FROM patients WHERE id=?", (patient_id,)).fetchone()
            return Patient.model_validate_json(row[0]) if row else None

    def records(self, patient_id: str | None = None) -> list[Record]:
        with self.connection() as db:
            sql, args = "SELECT data FROM records", () if patient_id is None else (patient_id,)
            if patient_id is not None:
                sql += " WHERE patient_id=?"
            return [
                Record.model_validate_json(row[0]) for row in db.execute(sql + " ORDER BY id", args)
            ]

    def record(self, record_id: str) -> Record | None:
        with self.connection() as db:
            row = db.execute("SELECT data FROM records WHERE id=?", (record_id,)).fetchone()
            return Record.model_validate_json(row[0]) if row else None

    def bundle(self, patient_id: str) -> dict[str, Any] | None:
        with self.connection() as db:
            row = db.execute(
                "SELECT data FROM bundles WHERE patient_id=?", (patient_id,)
            ).fetchone()
            return json.loads(row[0]) if row else None

    def summary(self, patient_id: str) -> dict[str, Any] | None:
        with self.connection() as db:
            row = db.execute("SELECT * FROM summaries WHERE patient_id=?", (patient_id,)).fetchone()
            if not row:
                return None
            value = dict(row)
            value["data"] = json.loads(value["data"]) if value["data"] else None
            return value

    def save_summary(
        self,
        patient_id: str,
        cache_key: str,
        provider: str,
        model: str,
        summary: ClinicalSummary | None,
        error: str | None = None,
    ) -> None:
        with self.connection() as db:
            db.execute(
                "INSERT INTO summaries VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(patient_id) "
                "DO UPDATE SET cache_key=excluded.cache_key,data=excluded.data,"
                "status=excluded.status,error=excluded.error,generated_at=excluded.generated_at,"
                "provider=excluded.provider,model=excluded.model",
                (
                    patient_id,
                    cache_key,
                    summary.model_dump_json() if summary else None,
                    "ready" if summary else "failed",
                    error,
                    datetime.now(UTC).isoformat() if summary else None,
                    provider,
                    model,
                ),
            )

    def save_run(self, run_id: str, report: dict[str, Any]) -> None:
        with self.connection() as db:
            db.execute(
                "INSERT INTO ingestion_runs VALUES (?,?) ON CONFLICT(id) "
                "DO UPDATE SET data=excluded.data",
                (run_id, json.dumps(report)),
            )

    def run(self, run_id: str) -> dict[str, Any] | None:
        with self.connection() as db:
            row = db.execute("SELECT data FROM ingestion_runs WHERE id=?", (run_id,)).fetchone()
            return json.loads(row[0]) if row else None
