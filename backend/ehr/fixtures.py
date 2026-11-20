import csv
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

Profile = tuple[str, str, str, str, str, str, float, str, float, float, str]


def seed(directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    profiles: list[Profile] = [
        (
            "Renal",
            "Fatigue and reduced urine output are documented. "
            "No established kidney diagnosis is documented.",
            "Renal ultrasound shows mild cortical echogenicity with no urinary tract obstruction.",
            "Hydration and repeat renal function testing were advised after elevated creatinine.",
            "Urine output improved, but renal function requires continued follow-up.",
            "Creatinine",
            2.1,
            "mg/dL",
            0.6,
            1.2,
            "AMB",
        ),
        (
            "Chest",
            "Persistent cough, fever, and shortness of breath are documented.",
            "Chest X-ray describes a right lower lobe opacity without pleural effusion.",
            "Pneumonia is documented and outpatient treatment with return precautions "
            "was provided.",
            "Cough and fever improved; mild exertional breathlessness remains.",
            "WBC",
            14.0,
            "10^9/L",
            4,
            11,
            "EMER",
        ),
        (
            "Diabetes",
            "Type 2 diabetes, thirst, and increased urination are documented.",
            "Abdominal ultrasound describes mild fatty liver change and no focal lesion.",
            "Glucose monitoring, medication review, and primary care follow-up were advised.",
            "Home glucose readings remain above target, without documented hypoglycemia.",
            "Glucose",
            180.0,
            "mg/dL",
            70,
            100,
            "AMB",
        ),
        (
            "Anemia",
            "Anemia and fatigue are documented. No active bleeding is reported.",
            "Abdominal ultrasound describes a normal spleen without splenomegaly.",
            "Iron studies and outpatient evaluation of anemia were recommended.",
            "Fatigue persists; no dizziness, syncope, or new bleeding is documented.",
            "Hemoglobin",
            9.0,
            "g/dL",
            12,
            16,
            "AMB",
        ),
        (
            "Preventive care",
            "Routine health review documents no acute concern and stable vital signs.",
            "Screening liver ultrasound describes no focal lesion or biliary dilation.",
            "Preventive screening and annual primary care follow-up were recommended.",
            "Screening results were reviewed with no new symptoms documented.",
            "Sodium",
            140.0,
            "mmol/L",
            135,
            145,
            "AMB",
        ),
        (
            "Thyroid",
            "Cold intolerance, weight gain, and fatigue are documented.",
            "Thyroid ultrasound describes diffuse heterogeneity without a dominant nodule.",
            "Endocrinology follow-up was requested for abnormal thyroid function.",
            "Fatigue continues and medication options are pending specialist review.",
            "TSH",
            8.4,
            "mIU/L",
            0.4,
            4.0,
            "AMB",
        ),
        (
            "Cardiac",
            "Intermittent chest pressure and nausea prompted emergency assessment.",
            "Chest X-ray describes no acute cardiopulmonary abnormality.",
            "Cardiology review was arranged after an elevated troponin result.",
            "No recurrent chest pressure is documented since discharge.",
            "Troponin I",
            0.12,
            "ng/mL",
            0.0,
            0.04,
            "EMER",
        ),
        (
            "Liver",
            "Right upper quadrant discomfort and reduced appetite are documented.",
            "Abdominal ultrasound describes hepatic steatosis without focal liver lesion.",
            "Medication review and repeat liver enzymes were recommended.",
            "Abdominal discomfort improved; repeat liver testing remains planned.",
            "ALT",
            96.0,
            "U/L",
            7.0,
            56.0,
            "AMB",
        ),
        (
            "Urinary infection",
            "Dysuria, urinary frequency, and suprapubic discomfort are documented.",
            "Renal ultrasound describes no hydronephrosis or renal calculus.",
            "A urinary infection is documented with treatment and return precautions.",
            "Urinary symptoms resolved and no flank pain is documented.",
            "CRP",
            24.0,
            "mg/L",
            0.0,
            5.0,
            "AMB",
        ),
        (
            "Ankle injury",
            "Ankle pain and swelling after a fall are documented.",
            "Ankle X-ray describes a nondisplaced distal fibular fracture.",
            "The ankle was immobilized and orthopedic follow-up was arranged.",
            "Pain and swelling improved while using the prescribed walking boot.",
            "Calcium",
            9.4,
            "mg/dL",
            8.6,
            10.2,
            "EMER",
        ),
    ]
    records: list[dict[str, Any]] = []
    for patient_index, profile in enumerate(profiles):
        patient_number = patient_index + 1
        title, note, imaging, discharge, follow_up, analyte, value, unit, low, high, visit_class = (
            profile
        )
        start = date(2026, 1, 8) + timedelta(days=patient_index * 6)
        dates = [
            start,
            start + timedelta(days=1),
            start + timedelta(days=2),
            start + timedelta(days=4),
            start + timedelta(days=18),
        ]
        dob = date(1978 + patient_index, patient_index % 9 + 1, patient_index * 2 % 25 + 1)
        raw_dob = (
            dob.isoformat()
            if patient_index % 3 == 0
            else dob.strftime("%d/%m/%Y")
            if patient_index % 3 == 1
            else dob.strftime("%d-%m-%Y")
        )
        raw_mrn = (
            f"mrn-{patient_number:05}" if patient_index % 2 == 0 else f"MRN {patient_number:05}"
        )
        if value > high:
            follow_up_value = max(high * 1.05, value * 0.75)
        elif value < low:
            follow_up_value = min(low * 0.95, value * 1.15)
        else:
            follow_up_value = value + (patient_index % 3 - 1) * 0.4
        kinds = ("note", "lab", "imaging", "discharge", "lab")
        values = (None, value, None, None, round(follow_up_value, 2))
        texts = (
            note,
            f"{analyte}: {value:g} {unit}. Reference interval: {low:g}-{high:g} {unit}. ",
            imaging,
            discharge,
            f"{follow_up} {analyte}: {follow_up_value:g} {unit}. "
            f"Reference interval: {low:g}-{high:g} {unit}. ",
        )
        titles = (
            f"{title} initial assessment",
            f"{title} laboratory results",
            f"{title} imaging report",
            f"{title} discharge summary",
            f"{title} follow-up laboratory results",
        )
        for record_number, kind in enumerate(kinds):
            result_value = values[record_number]
            flag = (
                "high"
                if result_value is not None and result_value > high
                else "low"
                if result_value is not None and result_value < low
                else "normal"
            )
            clinical_text = texts[record_number]
            if kind == "lab":
                clinical_text += f"Source flag: {flag}."
            is_follow_up = record_number == 4
            record: dict[str, Any] = {
                "record_id": f"synthetic-{patient_index:02}-{record_number}",
                "source_system": "synthetic",
                "mrn": raw_mrn,
                "patient_id": f"synthetic-person-{patient_index}",
                "name": f"Patient {patient_number:02}",
                "dob": raw_dob,
                "gender": ("M", "F", "F", "M", "U")[patient_index % 5],
                "kind": kind,
                "title": titles[record_number],
                "record_date": dates[record_number].isoformat(),
                "encounter_id": (
                    f"synthetic-follow-up-{patient_index}"
                    if is_follow_up
                    else f"synthetic-visit-{patient_index}"
                ),
                "encounter_class": "AMB" if is_follow_up else visit_class,
                "text": clinical_text,
                "labs": [],
            }
            if kind == "lab":
                record["labs"] = [
                    {
                        "name": analyte,
                        "value": result_value,
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
