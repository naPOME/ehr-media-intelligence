from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ehr.api import create_app
from ehr.config import Settings
from ehr.fixtures import seed
from ehr.pipeline import ingest
from ehr.search import SearchIndex, SentenceEncoder
from ehr.storage import Store


@pytest.mark.integration
def test_real_embeddings_retrieve_clinical_topics_over_fifty_records(tmp_path: Path) -> None:
    settings = Settings()
    encoder = SentenceEncoder(settings)
    settings = settings.model_copy(update={"data_dir": tmp_path / "data"})
    store = Store(settings.data_dir)
    report = ingest(store, seed(tmp_path / "input"))
    assert report["inserted"] == 50
    index = SearchIndex(settings.data_dir, store, encoder)
    index.rebuild()
    with TestClient(create_app(settings, encoder)) as client:
        for query, expected in [
            ("abnormal kidney function", "Renal"),
            ("chest X-ray opacity", "Chest"),
            ("low hemoglobin", "Anemia"),
            ("diabetes and high glucose", "Diabetes"),
        ]:
            response = client.post("/search?resource_type=DiagnosticReport", json={"query": query})
            assert response.status_code == 200
            matches = response.json()["matches"]
            assert len(matches) == 5
            assert expected in matches[0]["title"]
            assert response.json()["elapsed_ms"] < 2000
