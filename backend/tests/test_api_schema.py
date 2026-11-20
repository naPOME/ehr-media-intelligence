import json
from pathlib import Path

from ehr.api import create_app


def test_frontend_api_schema_matches_backend_contract() -> None:
    snapshot = Path(__file__).resolve().parents[2] / "frontend" / "openapi.json"
    assert json.loads(snapshot.read_text(encoding="utf-8")) == create_app().openapi()
