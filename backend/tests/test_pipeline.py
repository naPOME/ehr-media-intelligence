import csv
import json
from pathlib import Path
from typing import Any

from ehr.ingestion import clean_files
from ehr.pipeline import ingest
from ehr.storage import Store


def test_csv_bad_lab_row_does_not_discard_valid_rows(
    tmp_path: Path,
    raw_record: dict[str, Any],
) -> None:
    path = tmp_path / "input.csv"
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(raw_record))
        writer.writeheader()
        writer.writerow({**raw_record, "labs": json.dumps(raw_record["labs"])})
        writer.writerow({**raw_record, "record_id": "broken", "labs": "invalid-json"})
    result = clean_files([path])
    assert len(result.records) == 1
    assert len(result.issues) == 1
    assert result.records[0].original["mrn"] == "mrn-00042"


def test_conflicting_source_copies_are_both_quarantined(
    store: Store,
    tmp_path: Path,
    raw_record: dict[str, Any],
) -> None:
    path = tmp_path / "conflicts.json"
    path.write_text(json.dumps([raw_record, {**raw_record, "text": "Different content"}]))
    report = ingest(store, [path])
    assert report["status"] == "completed_with_errors"
    assert report["inserted"] == 0
    assert store.records() == []


def test_partial_import_report_is_retrievable_and_duplicates_are_audited(
    store: Store,
    tmp_path: Path,
    raw_record: dict[str, Any],
) -> None:
    path = tmp_path / "partial.json"
    path.write_text(
        json.dumps(
            [
                raw_record,
                {**raw_record, "record_id": "duplicate-document"},
                {**raw_record, "record_id": "bad-patient", "name": "Other person"},
            ]
        )
    )
    report = ingest(store, [path])
    assert report["inserted"] == 1
    assert report["duplicates"] == 1
    assert report["status"] == "completed_with_errors"
    assert store.run(report["id"]) == report
    assert len(store.records()) == 1
