import csv
import json
from pathlib import Path
from typing import Any


def seed(directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    themes = [
        (
            "renal",
            "Renal follow-up",
            "Fatigue and reduced urine output. Creatinine is flagged high. "
            "No established kidney diagnosis is documented.",
            "Creatinine",
            2.1,
            "mg/dL",
            0.6,
            1.2,
        ),
        (
            "respiratory",
            "Chest follow-up",
            "Persistent cough. Chest X-ray report describes a right "
            "lower lobe opacity. Pneumonia is documented in the discharge note.",
            "WBC",
            14.0,
            "10^9/L",
            4,
            11,
        ),
        (
            "diabetes",
            "Diabetes follow-up",
            "Type 2 diabetes is documented. Follow-up for thirst "
            "and increased urination. Glucose is flagged high.",
            "Glucose",
            180.0,
            "mg/dL",
            70,
            100,
        ),
        (
            "anemia",
            "Anemia follow-up",
            "Anemia is documented. Patient reports fatigue. "
            "Hemoglobin is flagged low. No active bleeding is documented.",
            "Hemoglobin",
            9.0,
            "g/dL",
            12,
            16,
        ),
        (
            "routine",
            "Routine follow-up",
            "Routine health review. No acute concern is documented. "
            "Ultrasound report states no focal liver lesion.",
            "Sodium",
            140.0,
            "mmol/L",
            135,
            145,
        ),
    ]
    imaging_findings = {
        "renal": "Renal ultrasound: no urinary tract obstruction is documented.",
        "respiratory": "Chest X-ray: right lower lobe opacity is described.",
        "diabetes": "Abdominal ultrasound: no focal liver lesion is described.",
        "anemia": "Abdominal ultrasound: no splenomegaly is described.",
        "routine": "Liver ultrasound: no focal liver lesion is described.",
    }
    records: list[dict[str, Any]] = []
    for patient_number in range(10):
        theme, title, text, analyte, value, unit, low, high = themes[patient_number % len(themes)]
        for record_number, kind in enumerate(("note", "lab", "imaging", "discharge", "note")):
            flag = "high" if value > high else "low" if value < low else "normal"
            clinical_text = text
            if kind == "imaging":
                clinical_text = imaging_findings[theme]
            elif kind == "lab":
                clinical_text = (
                    f"{analyte}: {value} {unit}. Reference interval: {low}-{high} {unit}. "
                    f"Source flag: {flag}."
                )
            record: dict[str, Any] = {
                "record_id": f"synthetic-{patient_number:02}-{record_number}",
                "source_system": "synthetic",
                "mrn": f"mrn-{patient_number + 1:05}",
                "patient_id": f"synthetic-person-{patient_number}",
                "name": f"Synthetic Patient {patient_number + 1:02}",
                "dob": f"{patient_number + 1:02}/03/1985",
                "gender": "F" if patient_number % 2 else "M",
                "kind": kind,
                "title": f"{title}: {kind}",
                "record_date": f"2026-03-{record_number + 10:02}",
                "encounter_id": f"synthetic-visit-{patient_number}",
                "encounter_class": "AMB",
                "text": f"Synthetic {kind} record for {theme}. {clinical_text}",
                "labs": [],
            }
            if kind == "lab":
                record["labs"] = [
                    {
                        "name": analyte,
                        "value": value,
                        "unit": unit,
                        "reference_low": low,
                        "reference_high": high,
                        "flag": flag,
                    }
                ]
            records.append(record)
    json_path, csv_path = directory / "patients.json", directory / "reports.csv"
    json_path.write_text(json.dumps(records[:25], indent=2), encoding="utf-8")
    with csv_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows({**record, "labs": json.dumps(record["labs"])} for record in records[25:])
    return [json_path, csv_path]
