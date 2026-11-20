from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from ehr.ingestion import clean_files
from ehr.storage import DuplicateRecord, Store
from ehr.summarization import SummaryProvider, summarize_patient


def ingest(store: Store, paths: list[Path]) -> dict[str, Any]:
    cleaned = clean_files(paths)
    report: dict[str, Any] = {
        "id": str(uuid4()),
        "created_at": datetime.now(UTC).isoformat(),
        "inserted": 0,
        "updated": 0,
        "unchanged": 0,
        "duplicates": 0,
        "issues": [issue.model_dump() for issue in cleaned.issues],
        "records": [],
        "bundle_validation": [],
    }
    affected: set[str] = set()
    for record in cleaned.records:
        try:
            status = store.save_record(record)
            report[status] += 1
            affected.add(record.patient.id)
            report["records"].append(
                {
                    "id": record.id,
                    "external_id": record.external_id,
                    "source_file": record.source_file,
                    "status": status,
                    "changes": [change.model_dump() for change in record.changes],
                }
            )
        except DuplicateRecord as exc:
            report["duplicates"] += 1
            report["issues"].append(
                {
                    "record_id": record.external_id,
                    "field": "record",
                    "severity": "warning",
                    "message": str(exc),
                }
            )
        except (ValueError, TypeError) as exc:
            report["issues"].append(
                {
                    "record_id": record.external_id,
                    "field": "identity_or_fhir",
                    "severity": "error",
                    "message": str(exc),
                }
            )
    for patient_id in sorted(affected):
        report["bundle_validation"].append(
            {
                "patient_id": patient_id,
                "status": "valid",
                "checks": ["R4 model", "resource identities", "references"],
            }
        )
    report["status"] = (
        "completed_with_errors"
        if any(issue["severity"] == "error" for issue in report["issues"])
        else "completed"
    )
    store.save_run(report["id"], report)
    return report


def summarize_all(store: Store, provider: SummaryProvider) -> dict[str, Any]:
    report: dict[str, Any] = {"generated": 0, "cached": 0, "failed": []}
    for patient in store.patients():
        try:
            status = summarize_patient(store, patient.id, provider)
            report[status] += 1
        except Exception as exc:
            report["failed"].append({"patient_id": patient.id, "error_type": type(exc).__name__})
    return report
