from pathlib import Path
from typing import Any

import pytest

from ehr.storage import Store


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--run-model-tests", action="store_true", help="Use the real embedding model")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if config.getoption("--run-model-tests"):
        return
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(pytest.mark.skip(reason="Use --run-model-tests for real model checks"))


@pytest.fixture
def raw_record() -> dict[str, Any]:
    return {
        "record_id": "lab-1",
        "mrn": "mrn-00042",
        "patient_id": "source-patient-42",
        "name": "Patient   42",
        "dob": "14/03/1985",
        "gender": "F",
        "kind": "lab",
        "title": "Renal panel",
        "record_date": "2026-03-15",
        "encounter_id": "visit-1",
        "text": (
            "Creatinine 2.1 mg/dL, flagged high. Kidney disease is not diagnosed in this report."
        ),
        "labs": [
            {
                "name": "Creatinine",
                "value": 2.1,
                "unit": "mg/dL",
                "reference_low": 0.6,
                "reference_high": 1.2,
                "flag": "high",
            }
        ],
    }


@pytest.fixture
def store(tmp_path: Path) -> Store:
    return Store(tmp_path / "data")
