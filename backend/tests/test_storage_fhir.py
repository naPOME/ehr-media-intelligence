import base64
import copy
from typing import Any

import pytest

from ehr.fhir import build_bundle, validate_bundle
from ehr.ingestion import clean_record
from ehr.storage import DuplicateRecord, IdentityConflict, Store


def test_bundle_preserves_patient_report_text_results_and_references(
    raw_record: dict[str, Any],
) -> None:
    record = clean_record(raw_record, "input.json")
    bundle = build_bundle(record.patient, [record])
    resources = {entry["resource"]["resourceType"]: entry["resource"] for entry in bundle["entry"]}
    assert set(resources) == {
        "Patient",
        "Encounter",
        "Observation",
        "DiagnosticReport",
        "DocumentReference",
    }
    assert resources["Patient"]["birthDate"] == "1985-03-14"
    assert resources["DiagnosticReport"]["subject"]["reference"] == "Patient/" + record.patient.id
    assert resources["DiagnosticReport"]["status"] == "unknown"
    assert resources["Observation"]["valueQuantity"] == {"value": 2.1, "unit": "mg/dL"}
    attachment = resources["DocumentReference"]["content"][0]["attachment"]
    assert base64.b64decode(attachment["data"]).decode() == raw_record["text"]
    broken = copy.deepcopy(bundle)
    broken["entry"][-1]["resource"]["subject"]["reference"] = "Patient/missing"
    with pytest.raises(ValueError, match="Unresolved"):
        validate_bundle(broken)


def test_reimport_is_unchanged_and_survives_reopening(
    store: Store,
    raw_record: dict[str, Any],
) -> None:
    record = clean_record(raw_record, "input.json")
    assert store.save_record(record) == "inserted"
    assert store.save_record(record) == "unchanged"
    reopened = Store(store.path.parent)
    assert len(reopened.records()) == 1
    assert reopened.patient(record.patient.id).mrn == "MRN00042"


@pytest.mark.parametrize(
    "change",
    [
        {"dob": "1980-01-01"},
        {"name": "Different Person"},
        {"gender": "M"},
        {"mrn": "OTHER-MRN"},
    ],
)
def test_conflicting_identity_is_quarantined_without_modifying_existing_patient(
    store: Store,
    raw_record: dict[str, Any],
    change: dict[str, Any],
) -> None:
    first = clean_record(raw_record, "input.json")
    store.save_record(first)
    second = clean_record({**raw_record, "record_id": "lab-2", **change}, "input.json")
    with pytest.raises(IdentityConflict):
        store.save_record(second)
    assert store.patient(first.patient.id) == first.patient
    assert len(store.records()) == 1


def test_source_record_cannot_be_reassigned_to_another_patient(
    store: Store,
    raw_record: dict[str, Any],
) -> None:
    store.save_record(clean_record(raw_record, "a.json"))
    with pytest.raises(IdentityConflict, match="cannot move"):
        store.save_record(clean_record({**raw_record, "mrn": "NEW", "patient_id": None}, "b.json"))


def test_identical_document_with_another_source_id_is_detected(
    store: Store,
    raw_record: dict[str, Any],
) -> None:
    store.save_record(clean_record(raw_record, "a.json"))
    with pytest.raises(DuplicateRecord):
        store.save_record(clean_record({**raw_record, "record_id": "different-id"}, "b.json"))
    assert len(store.records()) == 1


def test_bundle_builder_refuses_another_patients_records(raw_record: dict[str, Any]) -> None:
    first = clean_record(raw_record, "a.json")
    other = clean_record({**raw_record, "mrn": "OTHER"}, "b.json")
    with pytest.raises(ValueError, match="another patient's"):
        build_bundle(first.patient, [other])


def test_schema_errors_are_readable_validation_errors(raw_record: dict[str, Any]) -> None:
    record = clean_record(raw_record, "a.json")
    bundle = build_bundle(record.patient, [record])
    bundle["entry"][0]["resource"]["birthDate"] = "invalid-date"
    with pytest.raises(ValueError, match="FHIR R4 schema validation failed"):
        validate_bundle(bundle)


def test_saved_record_and_bundle_always_agree(store: Store, raw_record: dict[str, Any]) -> None:
    first = clean_record(raw_record, "a.json")
    store.save_record(first)
    updated = clean_record(
        {**raw_record, "text": "Corrected result: creatinine 1.0 mg/dL."}, "a.json"
    )
    store.save_record(updated)
    bundle = store.bundle(first.patient.id)
    report = next(
        entry["resource"]
        for entry in bundle["entry"]
        if entry["resource"]["resourceType"] == "DiagnosticReport"
    )
    assert report["conclusion"] == "Corrected result: creatinine 1.0 mg/dL."
    assert store.record(first.id).text == report["conclusion"]
