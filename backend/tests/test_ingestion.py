import json
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from ehr.ingestion import clean_files, clean_record


def test_normalizes_dates_demographics_and_logs_changes(raw_record: dict[str, Any]) -> None:
    record = clean_record(raw_record, "input.json")
    assert record.patient.mrn == "MRN00042"
    assert record.patient.dob.isoformat() == "1985-03-14"
    assert record.patient.name == "Synthetic Hana"
    assert record.patient.gender == "female"
    assert {item.field for item in record.changes} >= {"mrn", "dob", "gender", "name"}
    assert record.text == raw_record["text"]


def test_missing_optional_fields_are_not_invented(raw_record: dict[str, Any]) -> None:
    raw_record.update(dob=None, gender=None, record_date=None)
    record = clean_record(raw_record, "input.json")
    assert record.patient.dob is None
    assert record.patient.gender == "unknown"
    assert record.record_date is None
    assert any("Missing clinical date" in change.reason for change in record.changes)


@pytest.mark.parametrize(
    "change",
    [
        {"mrn": ""},
        {"dob": "1985-02-30"},
        {"dob": "2999-01-01"},
        {"record_date": "1980-01-01"},
        {"labs": [{"name": "Test", "value": 1, "reference_low": 10, "reference_high": 5}]},
    ],
)
def test_rejects_invalid_input(raw_record: dict[str, Any], change: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        clean_record({**raw_record, **change}, "input.json")


def test_duplicates_reported_and_bad_rows_do_not_discard_good_rows(
    tmp_path: Path,
    raw_record: dict[str, Any],
) -> None:
    path = tmp_path / "input.json"
    path.write_text(json.dumps([raw_record, raw_record, {**raw_record, "mrn": ""}]))
    result = clean_files([path])
    assert len(result.records) == 1
    assert len(result.issues) == 2
    assert {issue.severity for issue in result.issues} == {"warning", "error"}


@given(st.text(alphabet="0123456789", min_size=1, max_size=12))
def test_mrn_normalization_preserves_every_digit(digits: str) -> None:
    record = clean_record(
        {
            "record_id": "r",
            "mrn": "mrn-" + digits,
            "name": "Synthetic",
            "kind": "note",
            "title": "Note",
            "text": "Synthetic note",
        },
        "test",
    )
    assert record.patient.mrn == "MRN" + digits


def test_normalization_is_idempotent(raw_record: dict[str, Any]) -> None:
    first = clean_record(raw_record, "input.json")
    raw_record.update(
        mrn=first.patient.mrn,
        dob=first.patient.dob.isoformat(),
        gender=first.patient.gender,
        name=first.patient.name,
    )
    second = clean_record(raw_record, "another.json")
    assert first.id == second.id
    assert first.clinical_hash() == second.clinical_hash()
