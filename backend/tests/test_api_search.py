import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ehr.api import create_app
from ehr.config import Settings
from ehr.pipeline import ingest
from ehr.search import IndexUnavailable, SearchIndex
from ehr.storage import Store


class TestEncoder:
    __test__ = False
    name = "deterministic-test-encoder"

    def chunks(self, text: str) -> list[str]:
        words = text.split()
        return [" ".join(words[i : i + 100]) for i in range(0, len(words), 100)]

    def encode(self, texts: list[str], *, query: bool = False) -> list[list[float]]:
        return [
            [
                float("kidney" in text.lower() or "renal" in text.lower()),
                float("chest" in text.lower()),
                0.1,
            ]
            for text in texts
        ]


def test_search_deduplicates_chunks_and_resource_representations_filters_and_persists(
    store: Store,
    tmp_path: Path,
    raw_record: dict[str, Any],
) -> None:
    path = tmp_path / "input.json"
    records = [
        {**raw_record, "record_id": f"r-{i}", "record_date": f"2026-03-{10 + i:02}"}
        for i in range(7)
    ]
    records.append({**raw_record, "record_id": "undated", "record_date": None})
    path.write_text(json.dumps(records))
    ingest(store, [path])
    index = SearchIndex(store.path.parent, store, TestEncoder())
    index.rebuild()
    results = index.search("kidney")
    assert len(results.matches) == 5
    assert len({match.record_id or match.patient_id for match in results.matches}) == 5
    results = index.search("kidney", "DiagnosticReport", date(2026, 3, 10), date(2026, 3, 11))
    assert len(results.matches) == 2
    assert {match.record_date for match in results.matches} == {
        date(2026, 3, 10),
        date(2026, 3, 11),
    }
    assert {match.resource_type for match in results.matches} == {"DiagnosticReport"}
    assert index.search("kidney", date_from=date(2030, 1, 1)).matches == []
    reopened = SearchIndex(store.path.parent, Store(store.path.parent), TestEncoder())
    assert len(reopened.search("kidney", "DiagnosticReport").matches) == 5
    records[0]["text"] = "Corrected result"
    path.write_text(json.dumps(records))
    ingest(store, [path])
    with pytest.raises(IndexUnavailable, match="stale"):
        reopened.search("kidney")


def test_http_contract_details_validation_not_found_and_stale_index(
    store: Store,
    tmp_path: Path,
    raw_record: dict[str, Any],
) -> None:
    path = tmp_path / "input.json"
    path.write_text(json.dumps([raw_record]))
    report = ingest(store, [path])
    index = SearchIndex(store.path.parent, store, TestEncoder())
    index.rebuild()
    settings = Settings(data_dir=store.path.parent)
    with TestClient(create_app(settings, TestEncoder())) as client:
        assert client.get("/health").json()["search_ready"] is True
        response = client.post("/search?resource_type=DiagnosticReport", json={"query": "kidney"})
        assert response.status_code == 200
        match = response.json()["matches"][0]
        patient = client.get("/patients/" + match["patient_id"])
        assert patient.status_code == 200
        assert patient.json()["summary"]["status"] == "unavailable"
        record = client.get("/records/" + match["record_id"])
        assert record.status_code == 200
        assert len(record.json()["fhir_resources"]) == 3
        assert client.get("/patients/" + match["patient_id"] + "/bundle").status_code == 200
        assert client.get("/ingestion-runs/" + report["id"]).json()["inserted"] == 1
        assert client.get("/patients/missing").status_code == 404
        assert client.get("/records/missing").status_code == 404
        assert client.post("/search", json={"query": "   "}).status_code == 422
        assert (
            client.post("/search?resource_type=Invalid", json={"query": "kidney"}).status_code
            == 422
        )
        assert (
            client.post(
                "/search?date_from=2026-04-01&date_to=2026-03-01", json={"query": "kidney"}
            ).status_code
            == 422
        )
        raw_record["text"] = "Corrected source"
        path.write_text(json.dumps([raw_record]))
        ingest(store, [path])
        assert client.get("/health").json()["search_ready"] is False
        assert client.post("/search", json={"query": "kidney"}).status_code == 503


def test_fresh_backend_does_not_download_a_model_and_explains_missing_index(tmp_path: Path) -> None:
    with TestClient(create_app(Settings(data_dir=tmp_path / "fresh"))) as client:
        assert client.get("/health").json()["search_ready"] is False
        assert client.post("/search", json={"query": "kidney"}).status_code == 503
