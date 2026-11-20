from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import Field

from ehr.fhir import build_bundle
from ehr.ingestion import clean_content
from ehr.models import Change, Model, Record
from ehr.storage import DuplicateRecord, IdentityConflict, Store

IntakeStatus = Literal["ready", "update", "duplicate", "rejected"]


class IntakePreviewRequest(Model):
    filename: str = Field(min_length=1, max_length=255)
    content: str = Field(max_length=10_000_000)


class IntakeItem(Model):
    id: str
    source_record_id: str
    status: IntakeStatus
    patient_name: str
    mrn: str
    title: str
    kind: str
    record_date: date | None
    changes: list[Change]
    issues: list[str]
    fhir_resources: list[str]
    original: dict[str, Any]
    normalized: dict[str, Any]


class IntakeCounts(Model):
    total: int
    ready: int
    updates: int
    duplicates: int
    rejected: int


class IntakePreview(Model):
    id: str
    filename: str
    created_at: datetime
    status: Literal["review", "published", "published_with_errors"]
    counts: IntakeCounts
    items: list[IntakeItem]
    file_issues: list[str]


class IntakeDraftSummary(Model):
    id: str
    filename: str
    created_at: datetime
    status: str
    counts: IntakeCounts


class IntakePublishResult(Model):
    draft_id: str
    status: str
    inserted: int
    updated: int
    unchanged: int
    failed: int
    errors: list[str]
    search_index_rebuilt: bool = False


def _resources(record: Record) -> list[str]:
    return (
        ["Patient", "DocumentReference", "DiagnosticReport"]
        if record.kind
        in (
            "lab",
            "imaging",
        )
        else ["Patient", "DocumentReference"]
    )


def _assess(
    store: Store, record: Record, fingerprints: dict[str, str]
) -> tuple[IntakeStatus, list[str]]:
    issues: list[str] = []
    existing_patient = store.patient(record.patient.id)
    if existing_patient:
        if existing_patient.name.casefold() != record.patient.name.casefold():
            issues.append("Same MRN has a different patient name in the library")
        if (
            existing_patient.dob
            and record.patient.dob
            and existing_patient.dob != record.patient.dob
        ):
            issues.append("Same MRN has a different date of birth in the library")
        if existing_patient.gender != "unknown" and record.patient.gender not in (
            existing_patient.gender,
            "unknown",
        ):
            issues.append("Same MRN has a different gender in the library")
    prior = store.record(record.id)
    if prior and prior.patient.id != record.patient.id:
        issues.append("This source record already belongs to another patient")
    if issues:
        return "rejected", issues
    duplicate_id = fingerprints.get(record.document_fingerprint())
    if duplicate_id and duplicate_id != record.id:
        return "duplicate", [f"Identical clinical document already exists as {duplicate_id}"]
    if prior:
        if prior.clinical_hash() == record.clinical_hash():
            return "duplicate", ["This source record is already up to date"]
        return "update", []
    return "ready", []


def create_preview(store: Store, request: IntakePreviewRequest) -> IntakePreview:
    cleaned = clean_content(request.filename, request.content)
    fingerprints = {record.document_fingerprint(): record.id for record in store.records()}
    items: list[IntakeItem] = []
    accepted: list[Record] = []
    for record in cleaned.records:
        status, issues = _assess(store, record, fingerprints)
        try:
            build_bundle(record.patient, [record])
        except ValueError as exc:
            status = "rejected"
            issues.append(f"FHIR R4 validation failed: {exc}")
        if status in ("ready", "update"):
            accepted.append(record)
        items.append(
            IntakeItem(
                id=record.id,
                source_record_id=record.external_id,
                status=status,
                patient_name=record.patient.name,
                mrn=record.patient.mrn,
                title=record.title,
                kind=record.kind,
                record_date=record.record_date,
                changes=record.changes,
                issues=issues,
                fhir_resources=_resources(record),
                original=record.original,
                normalized=record.model_dump(mode="json", exclude={"original"}),
            )
        )
    file_issues = [f"{issue.record_id}: {issue.message}" for issue in cleaned.issues]
    warnings = sum(issue.severity == "warning" for issue in cleaned.issues)
    errors = sum(issue.severity == "error" for issue in cleaned.issues)
    counts = IntakeCounts(
        total=len(items) + len(cleaned.issues),
        ready=sum(item.status == "ready" for item in items),
        updates=sum(item.status == "update" for item in items),
        duplicates=sum(item.status == "duplicate" for item in items) + warnings,
        rejected=sum(item.status == "rejected" for item in items) + errors,
    )
    preview = IntakePreview(
        id=str(uuid4()),
        filename=request.filename,
        created_at=datetime.now(UTC),
        status="review",
        counts=counts,
        items=items,
        file_issues=file_issues,
    )
    store.save_intake_draft(
        preview.id,
        request.filename,
        preview.status,
        {
            "preview": preview.model_dump(mode="json"),
            "records": [r.model_dump(mode="json") for r in accepted],
        },
    )
    return preview


def publish_preview(store: Store, draft_id: str) -> IntakePublishResult | None:
    draft = store.intake_draft(draft_id)
    if draft is None:
        return None
    records = [Record.model_validate(item) for item in draft["data"].get("records", [])]
    totals = {"inserted": 0, "updated": 0, "unchanged": 0}
    errors: list[str] = []
    for record in records:
        try:
            totals[store.save_record(record)] += 1
        except (IdentityConflict, DuplicateRecord, ValueError) as exc:
            errors.append(f"{record.external_id}: {exc}")
    status = "published_with_errors" if errors else "published"
    payload = draft["data"]
    payload["preview"]["status"] = status
    store.save_intake_draft(draft_id, draft["filename"], status, payload)
    return IntakePublishResult(
        draft_id=draft_id,
        status=status,
        inserted=totals["inserted"],
        updated=totals["updated"],
        unchanged=totals["unchanged"],
        failed=len(errors),
        errors=errors,
    )
