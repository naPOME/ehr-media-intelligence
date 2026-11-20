from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Gender = Literal["male", "female", "other", "unknown"]
ResourceType = Literal["Patient", "DocumentReference", "DiagnosticReport"]


def content_hash(value: Any) -> str:
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(data.encode()).hexdigest()


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class Change(Model):
    field: str
    before: str | None
    after: str | None
    reason: str


class Patient(Model):
    id: str
    source_system: str
    mrn: str
    name: str = Field(min_length=1)
    dob: date | None = None
    gender: Gender = "unknown"


class LabValue(Model):
    name: str = Field(min_length=1)
    value: float
    unit: str | None = None
    reference_low: float | None = None
    reference_high: float | None = None
    flag: Literal["high", "low", "normal", "unknown"] = "unknown"

    @model_validator(mode="after")
    def valid_range(self) -> LabValue:
        if (
            self.reference_low is not None
            and self.reference_high is not None
            and self.reference_low > self.reference_high
        ):
            raise ValueError("reference_low must not exceed reference_high")
        return self


class Record(Model):
    id: str
    external_id: str
    source_file: str
    patient: Patient
    patient_alias: str | None = None
    kind: Literal["note", "discharge", "lab", "imaging"]
    title: str = Field(min_length=1)
    record_date: date | None
    encounter_id: str | None = None
    encounter_class: Literal["AMB", "IMP", "EMER"] | None = None
    text: str = Field(min_length=1, max_length=200_000)
    labs: list[LabValue] = Field(default_factory=list)
    changes: list[Change] = Field(default_factory=list)
    original: dict[str, Any] = Field(default_factory=dict)

    def clinical_hash(self) -> str:
        return content_hash(
            self.model_dump(mode="json", exclude={"source_file", "changes", "original"})
        )

    def document_fingerprint(self) -> str:
        data = self.model_dump(
            mode="json",
            include={
                "kind",
                "title",
                "record_date",
                "encounter_id",
                "text",
                "labs",
            },
        )
        return content_hash({"patient_id": self.patient.id, **data})


class Issue(Model):
    record_id: str
    field: str
    message: str
    severity: Literal["warning", "error"] = "error"


class CleaningResult(Model):
    records: list[Record] = Field(default_factory=list)
    issues: list[Issue] = Field(default_factory=list)


class SummaryItem(Model):
    text: str = Field(min_length=1)
    source_record_ids: list[str]


class ClinicalSummary(Model):
    chief_concern: SummaryItem
    key_diagnoses: list[SummaryItem]
    recent_media_records: list[SummaryItem]
    flagged_anomalies: list[SummaryItem]
    limitations: str
    disclaimer: str

    def items(self) -> list[SummaryItem]:
        return [
            self.chief_concern,
            *self.key_diagnoses,
            *self.recent_media_records,
            *self.flagged_anomalies,
        ]

    def plain_text(self) -> str:
        return " ".join([*(item.text for item in self.items()), self.limitations, self.disclaimer])


class SearchRequest(Model):
    query: str = Field(min_length=1, max_length=1000)


class SearchMatch(Model):
    patient_id: str
    patient_name: str
    mrn: str
    record_id: str | None
    title: str
    record_date: date | None
    resource_type: ResourceType
    match_source: Literal["document", "patient", "summary"]
    relevance_score: float
    excerpt: str
    summary_snippet: str | None
    summary_scope: Literal["patient_history"] = "patient_history"


class SearchResponse(Model):
    query: str
    matches: list[SearchMatch]
    elapsed_ms: float
