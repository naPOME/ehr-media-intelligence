import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from test_api_search import TestEncoder

from ehr.api import create_app
from ehr.config import Settings
from ehr.pipeline import ingest
from ehr.search import SearchIndex
from ehr.storage import Store


def test_patient_directory_filters_identity_and_paginates(
    store: Store, tmp_path: Path, raw_record: dict[str, Any]
) -> None:
    path = tmp_path / "patients.json"
    path.write_text(
        json.dumps(
            [
                raw_record,
                {
                    **raw_record,
                    "record_id": "second",
                    "mrn": "MRN0099",
                    "patient_id": "other-source",
                    "name": "Patient 99",
                },
            ]
        )
    )
    ingest(store, [path])
    with TestClient(create_app(Settings(data_dir=store.path.parent))) as client:
        data = client.get("/patients?limit=1").json()
        assert data["total"] == 2
        assert len(data["items"]) == 1
        filtered = client.get("/patients?query=mrn00042").json()
        assert filtered["total"] == 1
        assert filtered["items"][0]["patient"]["name"] == "Patient 42"
        assert filtered["items"][0]["record_count"] == 1
        assert filtered["items"][0]["latest_record_date"] == "2026-03-15"
        assert filtered["items"][0]["summary_status"] == "unavailable"
        assert client.get("/patients?query=nobody").json()["total"] == 0
        assert client.get("/patients?limit=101").status_code == 422


def test_patient_scope_is_applied_before_vector_ranking(
    store: Store, tmp_path: Path, raw_record: dict[str, Any]
) -> None:
    path = tmp_path / "patients.json"
    other = [
        {
            **raw_record,
            "record_id": f"other-{i}",
            "record_date": f"2026-03-{10 + i:02}",
            "text": "Kidney renal results.",
        }
        for i in range(6)
    ]
    selected = {
        **raw_record,
        "record_id": "selected",
        "mrn": "MRN0099",
        "patient_id": "selected-source",
        "name": "Patient 99",
        "text": "Chest findings.",
    }
    path.write_text(json.dumps([*other, selected]))
    ingest(store, [path])
    patient = next(p for p in store.patients() if p.mrn == "MRN0099")
    index = SearchIndex(store.path.parent, store, TestEncoder())
    index.rebuild()
    with TestClient(create_app(Settings(data_dir=store.path.parent), TestEncoder())) as client:
        global_matches = client.post(
            "/search?resource_type=DiagnosticReport", json={"query": "renal kidney"}
        ).json()["matches"]
        assert len(global_matches) == 5
        assert all(match["patient_id"] != patient.id for match in global_matches)
        scoped = client.post(
            f"/search?resource_type=DiagnosticReport&patient_id={patient.id}",
            json={"query": "renal kidney"},
        )
        assert scoped.status_code == 200
        assert len(scoped.json()["matches"]) == 1
        assert scoped.json()["matches"][0]["patient_id"] == patient.id
        assert client.post("/search?patient_id=missing", json={"query": "renal"}).status_code == 404


def test_directory_sorting_filters_export_and_validation(
    store: Store, tmp_path: Path, raw_record: dict[str, Any]
) -> None:
    import csv
    import io

    path = tmp_path / "directory.json"
    path.write_text(
        json.dumps(
            [
                {
                    **raw_record,
                    "record_id": str(i),
                    "mrn": f"MRN{i:05}",
                    "patient_id": f"person-{i}",
                    "name": name,
                    "gender": "F" if i % 2 else "M",
                    "dob": f"198{i}-03-14",
                    "record_date": f"2026-03-{10 + i:02}",
                }
                for i, name in enumerate(
                    ["Patient 05", "Patient 01", "=HYPERLINK(1)", "Patient 03", "Patient 04"]
                )
            ]
        )
    )
    assert ingest(store, [path])["status"] == "completed"
    with TestClient(create_app(Settings(data_dir=store.path.parent))) as client:
        # Sort the entire result, then page it. Page two must not repeat page one.
        first = client.get("/patients?sort_by=name&order=desc&limit=2").json()
        second = client.get("/patients?sort_by=name&order=desc&offset=2&limit=2").json()
        assert [r["patient"]["name"] for r in first["items"]] == ["Patient 05", "Patient 04"]
        assert [r["patient"]["name"] for r in second["items"]] == ["Patient 03", "Patient 01"]
        filtered = client.get(
            "/patients?gender=female&date_from=2026-03-12&summary_status=unavailable"
        ).json()
        assert filtered["total"] == 1
        assert filtered["items"][0]["patient"]["name"] == "Patient 03"
        dates = client.get("/patients?sort_by=latest_record_date&order=desc").json()
        assert dates["items"][0]["patient"]["name"] == "Patient 04"
        # Export ignores display pagination and protects cells from formula execution.
        exported = client.get("/patients/export?limit=1")
        assert exported.status_code == 200
        rows = list(csv.reader(io.StringIO(exported.text.lstrip("\ufeff"))))
        assert len(rows) == 6
        assert rows[1][0] == "'=HYPERLINK(1)"
        selected = client.get(
            "/patients/export", params={"patient_ids": filtered["items"][0]["patient"]["id"]}
        )
        assert len(list(csv.reader(io.StringIO(selected.text.lstrip("\ufeff"))))) == 2
        assert "Patient 03" in selected.text
        assert client.get("/patients?sort_by=not_a_column").status_code == 422
        assert client.get("/patients?date_from=2026-04-01&date_to=2026-03-01").status_code == 422
        assert client.get("/patients?offset=-1").status_code == 422
        overview = client.get("/library").json()
        assert overview["patients"] == 5
        assert overview["records"] == 5
        assert overview["latest_record_date"] == "2026-03-14"


def test_overview_links_recent_records_and_hides_stale_summaries(
    store: Store, tmp_path: Path, raw_record: dict[str, Any]
) -> None:
    from test_summarization import RecordingProvider

    from ehr.summarization import summarize_patient

    path = tmp_path / "overview.json"
    path.write_text(json.dumps([raw_record]))
    ingest(store, [path])
    patient = store.patients()[0]
    record = store.records()[0]
    with TestClient(create_app(Settings(data_dir=store.path.parent))) as client:
        empty = client.get("/overview").json()
        assert empty["metrics"]["patients"] == 1
        assert empty["summaries"] == []
        assert empty["recent_patients"][0]["latest_record_id"] == record.id
        assert empty["recent_patients"][0]["patient"]["id"] == patient.id
        summarize_patient(store, patient.id, RecordingProvider())
        ready = client.get("/overview").json()
        assert ready["metrics"]["summaries_ready"] == 1
        assert ready["summaries"][0]["patient"]["id"] == patient.id
        assert ready["summaries"][0]["summary"]["data"]["recent_media_records"][0][
            "source_record_ids"
        ] == [record.id]
        raw_record["text"] = "Corrected laboratory report: creatinine 1.0 mg/dL."
        path.write_text(json.dumps([raw_record]))
        ingest(store, [path])
        stale = client.get("/overview").json()
        assert stale["metrics"]["summaries_ready"] == 0
        assert stale["summaries"] == []
