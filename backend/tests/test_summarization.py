from typing import Any

import pytest

from ehr.ingestion import clean_record
from ehr.models import ClinicalSummary, SummaryItem
from ehr.pipeline import ingest
from ehr.storage import Store
from ehr.summarization import DISCLAIMER, summarize_patient, validate_summary


class RecordingProvider:
    name = "test"
    model = "deterministic-test-provider"

    def __init__(self) -> None:
        self.calls = 0

    def generate(self, history: dict[str, Any]) -> ClinicalSummary:
        self.calls += 1
        document = history["documents"][0]
        return ClinicalSummary(
            chief_concern=SummaryItem(text="Not documented.", source_record_ids=[]),
            key_diagnoses=[],
            recent_media_records=[
                SummaryItem(text=document["text"], source_record_ids=[document["id"]])
            ],
            flagged_anomalies=[],
            limitations="Synthetic source only.",
            disclaimer=DISCLAIMER,
        )


def test_summary_cache_reused_and_invalidated_by_changed_records(
    store: Store,
    tmp_path: Any,
    raw_record: dict[str, Any],
) -> None:
    import json

    path = tmp_path / "input.json"
    path.write_text(json.dumps([raw_record]))
    ingest(store, [path])
    patient_id = clean_record(raw_record, "input.json").patient.id
    provider = RecordingProvider()
    assert summarize_patient(store, patient_id, provider) == "generated"
    assert summarize_patient(store, patient_id, provider) == "cached"
    assert provider.calls == 1
    raw_record["text"] = "Updated report: creatinine 1.0 mg/dL. Previous result corrected."
    path.write_text(json.dumps([raw_record]))
    ingest(store, [path])
    assert store.summary(patient_id)["status"] == "stale"
    assert summarize_patient(store, patient_id, provider) == "generated"
    assert provider.calls == 2
    provider.model = "new-model-version"
    assert summarize_patient(store, patient_id, provider) == "generated"
    assert provider.calls == 3


def test_rejects_uncited_and_overlong_summaries() -> None:
    summary = ClinicalSummary(
        chief_concern=SummaryItem(text="Not documented.", source_record_ids=[]),
        key_diagnoses=[],
        recent_media_records=[],
        flagged_anomalies=[],
        limitations="Incomplete history",
        disclaimer=DISCLAIMER,
    )
    summary.key_diagnoses = [SummaryItem(text="An invented diagnosis", source_record_ids=[])]
    with pytest.raises(ValueError, match="no supporting"):
        validate_summary(summary, {"doc-1"})
    summary.key_diagnoses[0].source_record_ids = ["unknown-doc"]
    with pytest.raises(ValueError, match="unknown source"):
        validate_summary(summary, {"doc-1"})
    summary.key_diagnoses[0] = SummaryItem(text="word " * 200, source_record_ids=["doc-1"])
    with pytest.raises(ValueError, match="under 200"):
        validate_summary(summary, {"doc-1"})


def test_provider_failure_is_stored_without_fake_summary(
    store: Store,
    tmp_path: Any,
    raw_record: dict[str, Any],
) -> None:
    import json

    class FailingProvider(RecordingProvider):
        def generate(self, history: dict[str, Any]) -> ClinicalSummary:
            raise TimeoutError("provider unavailable")

    path = tmp_path / "input.json"
    path.write_text(json.dumps([raw_record]))
    ingest(store, [path])
    patient_id = store.patients()[0].id
    with pytest.raises(TimeoutError):
        summarize_patient(store, patient_id, FailingProvider())
    cached = store.summary(patient_id)
    assert cached["status"] == "failed"
    assert cached["data"] is None
    assert "TimeoutError" in cached["error"]
