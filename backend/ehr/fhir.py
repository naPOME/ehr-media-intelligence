from __future__ import annotations

import base64
import json
import subprocess
from html import escape
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from fhirclient.models.bundle import Bundle
from fhirclient.models.fhirabstractbase import FHIRValidationError

from ehr.ingestion import stable_id
from ehr.models import Patient, Record

FHIR_BASE = "https://synthetic.example/fhir"


def narrative(text: str) -> dict[str, str]:
    return {
        "status": "generated",
        "div": f'<div xmlns="http://www.w3.org/1999/xhtml"><p>{escape(text)}</p></div>',
    }


def patient_resource(patient: Patient) -> dict[str, Any]:
    resource: dict[str, Any] = {
        "resourceType": "Patient",
        "id": patient.id,
        "identifier": [
            {
                "system": f"https://synthetic.example/mrn/{patient.source_system}",
                "value": patient.mrn,
            }
        ],
        "name": [{"text": patient.name}],
        "gender": patient.gender,
        "text": narrative(
            f"{patient.name}; MRN {patient.mrn}; gender {patient.gender}; "
            f"DOB {patient.dob or 'not documented'}"
        ),
    }
    if patient.dob:
        resource["birthDate"] = patient.dob.isoformat()
    return resource


def build_bundle(patient: Patient, records: list[Record]) -> dict[str, Any]:
    if any(record.patient.id != patient.id for record in records):
        raise ValueError("Cannot put another patient's records in this Bundle")
    resources = [patient_resource(patient)]
    encounters: set[str] = set()
    encounter_classes: dict[str, str] = {}
    for record in records:
        if record.encounter_id and record.encounter_class:
            previous = encounter_classes.get(record.encounter_id)
            if previous and previous != record.encounter_class:
                raise ValueError("Same encounter has conflicting classes")
            encounter_classes[record.encounter_id] = record.encounter_class
    for record in records:
        subject = {"reference": f"Patient/{patient.id}"}
        encounter = None
        if record.encounter_id:
            encounter_id = stable_id(f"encounter:{patient.id}:{record.encounter_id}")
            encounter = {"reference": f"Encounter/{encounter_id}"}
            if encounter_id not in encounters:
                resources.append(
                    {
                        "resourceType": "Encounter",
                        "id": encounter_id,
                        "status": "unknown",
                        "class": {
                            "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                            "code": encounter_classes[record.encounter_id],
                        }
                        if record.encounter_id in encounter_classes
                        else {
                            "system": "http://terminology.hl7.org/CodeSystem/v3-NullFlavor",
                            "code": "UNK",
                        },
                        "subject": subject,
                        "text": narrative(
                            f"Source encounter {record.encounter_id}; status not supplied."
                        ),
                    }
                )
                encounters.add(encounter_id)
        document: dict[str, Any] = {
            "resourceType": "DocumentReference",
            "id": record.id,
            "status": "current",
            "subject": subject,
            "description": record.title,
            "type": {"text": record.kind},
            "text": narrative(f"{record.title}. {record.text}"),
            "content": [
                {
                    "attachment": {
                        "contentType": "text/plain; charset=utf-8",
                        "title": record.title,
                        "data": base64.b64encode(record.text.encode()).decode(),
                    }
                }
            ],
        }
        context: dict[str, Any] = {}
        if record.record_date:
            context["period"] = {"start": record.record_date.isoformat()}
        if encounter:
            context["encounter"] = [encounter]
        if context:
            document["context"] = context
        resources.append(document)
        if record.kind not in ("lab", "imaging"):
            continue
        report: dict[str, Any] = {
            "resourceType": "DiagnosticReport",
            "id": record.id,
            "status": "unknown",
            "code": {"text": record.title},
            "subject": subject,
            "conclusion": record.text,
            "text": narrative(f"{record.title}. {record.text}"),
            "presentedForm": [document["content"][0]["attachment"]],
        }
        if record.record_date:
            report["effectiveDateTime"] = record.record_date.isoformat()
        if encounter:
            report["encounter"] = encounter
        results = []
        for index, lab in enumerate(record.labs):
            observation_id = stable_id(f"observation:{record.id}:{index}")
            observation: dict[str, Any] = {
                "resourceType": "Observation",
                "id": observation_id,
                "status": "unknown",
                "code": {"text": lab.name},
                "subject": subject,
                "valueQuantity": {"value": lab.value},
                "text": narrative(
                    f"{lab.name}: {lab.value} {lab.unit or ''}; "
                    f"source flag {lab.flag}; reference interval "
                    f"{lab.reference_low} to {lab.reference_high}."
                ),
            }
            if lab.unit:
                observation["valueQuantity"]["unit"] = lab.unit
            if record.record_date:
                observation["effectiveDateTime"] = record.record_date.isoformat()
            if encounter:
                observation["encounter"] = encounter
            reference_range: dict[str, Any] = {}
            for key, value in (("low", lab.reference_low), ("high", lab.reference_high)):
                if value is not None:
                    reference_range[key] = {"value": value}
                    if lab.unit:
                        reference_range[key]["unit"] = lab.unit
            if reference_range:
                observation["referenceRange"] = [reference_range]
            if lab.flag != "unknown":
                observation["interpretation"] = [
                    {
                        "coding": [
                            {
                                "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                                "code": {"high": "H", "low": "L", "normal": "N"}[lab.flag],
                            }
                        ]
                    }
                ]
            resources.append(observation)
            results.append({"reference": f"Observation/{observation_id}"})
        if results:
            report["result"] = results
        resources.append(report)
    bundle = {
        "resourceType": "Bundle",
        "id": patient.id,
        "type": "collection",
        "entry": [
            {"fullUrl": f"{FHIR_BASE}/{r['resourceType']}/{r['id']}", "resource": r}
            for r in resources
        ],
    }
    validate_bundle(bundle)
    return bundle


def validate_bundle(bundle: dict[str, Any]) -> None:
    try:
        Bundle(bundle, strict=True)
    except FHIRValidationError as exc:
        raise ValueError(f"FHIR R4 schema validation failed: {exc}") from exc
    entries = bundle.get("entry", [])
    keys = [f"{e['resource']['resourceType']}/{e['resource']['id']}" for e in entries]
    if len(keys) != len(set(keys)):
        raise ValueError("Bundle contains duplicate resource identities")
    patients = [key for key in keys if key.startswith("Patient/")]
    if len(patients) != 1:
        raise ValueError("A patient Bundle must contain exactly one Patient")
    known = set(keys) | {entry["fullUrl"] for entry in entries}

    def check(value: Any) -> None:
        if isinstance(value, dict):
            if "reference" in value and value["reference"] not in known:
                raise ValueError(f"Unresolved FHIR reference: {value['reference']}")
            for item in value.values():
                check(item)
        elif isinstance(value, list):
            for item in value:
                check(item)

    check(bundle)
    for entry in entries:
        subject = entry["resource"].get("subject")
        if subject and subject["reference"] != patients[0]:
            raise ValueError("Resource subject does not match the Bundle patient")


def validate_official(bundle_path: Path, jar: Path, report_path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [
            "java",
            "-jar",
            str(jar.resolve()),
            str(bundle_path.resolve()),
            "-version",
            "4.0.1",
            "-tx",
            "n/a",
            "-output",
            str(report_path.resolve()),
        ],
        capture_output=True,
        text=True,
        timeout=240,
        check=False,
    )
    if not report_path.exists():
        raise RuntimeError(f"FHIR validator did not produce a report (exit {result.returncode})")
    outcome: dict[str, Any] = json.loads(report_path.read_text(encoding="utf-8"))
    issues = outcome.get("issue", [])
    if result.returncode or any(i["severity"] in ("fatal", "error") for i in issues):
        raise ValueError(f"Official R4 validation failed; see {report_path}")
    return outcome


def validate_server(bundle: dict[str, Any], server: str, report_path: Path) -> dict[str, Any]:
    if not server.startswith("https://"):
        raise ValueError("Remote FHIR validation requires an HTTPS server URL")
    request = Request(
        server.rstrip("/") + "/Bundle/$validate",
        data=json.dumps(bundle).encode(),
        method="POST",
        headers={"Content-Type": "application/fhir+json", "Accept": "application/fhir+json"},
    )
    try:
        with urlopen(request, timeout=60) as response:
            outcome: dict[str, Any] = json.loads(response.read())
            status = response.status
    except HTTPError as exc:
        outcome = json.loads(exc.read())
        status = exc.code
    report_path.write_text(json.dumps(outcome, indent=2), encoding="utf-8")
    if outcome.get("resourceType") != "OperationOutcome":
        raise ValueError(f"Validator returned no OperationOutcome; see {report_path}")
    if status >= 400 or any(
        issue["severity"] in ("error", "fatal") for issue in outcome.get("issue", [])
    ):
        raise ValueError(f"Remote R4 validation failed; see {report_path}")
    return outcome
