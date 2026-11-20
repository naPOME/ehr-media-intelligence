from __future__ import annotations

from collections import defaultdict
from datetime import date

from pydantic import Field

from ehr.models import LabValue, Model, Patient, Record
from ehr.storage import Store


class TimelineRecord(Model):
    id: str
    title: str
    kind: str
    record_date: date | None
    encounter_id: str | None
    encounter_class: str | None
    resource_types: list[str]
    preview: str
    labs: list[LabValue]


class TimelineEncounter(Model):
    id: str
    encounter_class: str | None
    start_date: date | None
    end_date: date | None
    records: list[TimelineRecord]


class LabTrendPoint(Model):
    record_id: str
    record_date: date
    value: float
    unit: str | None
    reference_low: float | None
    reference_high: float | None
    flag: str


class LabTrend(Model):
    analyte: str
    unit: str | None
    latest_flag: str
    points: list[LabTrendPoint] = Field(min_length=2)


class TimelineCounts(Model):
    encounters: int
    records: int
    abnormal_results: int
    trends: int


class PatientTimeline(Model):
    patient: Patient
    encounters: list[TimelineEncounter]
    trends: list[LabTrend]
    counts: TimelineCounts


def _preview(text: str, limit: int = 180) -> str:
    compact = " ".join(text.split())
    return compact if len(compact) <= limit else compact[: limit - 1].rstrip() + "…"


def _timeline_record(record: Record) -> TimelineRecord:
    return TimelineRecord(
        id=record.id,
        title=record.title,
        kind=record.kind,
        record_date=record.record_date,
        encounter_id=record.encounter_id,
        encounter_class=record.encounter_class,
        resource_types=["DocumentReference", "DiagnosticReport"]
        if record.kind in ("lab", "imaging")
        else ["DocumentReference"],
        preview=_preview(record.text),
        labs=record.labs,
    )


def build_timeline(store: Store, patient_id: str) -> PatientTimeline | None:
    patient = store.patient(patient_id)
    if patient is None:
        return None
    records = store.records(patient_id)
    grouped: dict[str, list[Record]] = defaultdict(list)
    for record in records:
        key = record.encounter_id or f"record:{record.id}"
        grouped[key].append(record)

    encounters: list[TimelineEncounter] = []
    for encounter_id, items in grouped.items():
        dated = [item.record_date for item in items if item.record_date]
        items.sort(key=lambda item: (item.record_date or date.min, item.id), reverse=True)
        encounters.append(
            TimelineEncounter(
                id=encounter_id.removeprefix("record:"),
                encounter_class=next(
                    (item.encounter_class for item in items if item.encounter_class), None
                ),
                start_date=min(dated) if dated else None,
                end_date=max(dated) if dated else None,
                records=[_timeline_record(item) for item in items],
            )
        )
    encounters.sort(key=lambda item: (item.end_date or date.min, item.id), reverse=True)

    series: dict[tuple[str, str | None], list[LabTrendPoint]] = defaultdict(list)
    abnormal = 0
    for record in records:
        for lab in record.labs:
            abnormal += lab.flag in ("high", "low")
            if record.record_date:
                series[(lab.name, lab.unit)].append(
                    LabTrendPoint(
                        record_id=record.id,
                        record_date=record.record_date,
                        value=lab.value,
                        unit=lab.unit,
                        reference_low=lab.reference_low,
                        reference_high=lab.reference_high,
                        flag=lab.flag,
                    )
                )
    trends = []
    for (analyte, unit), points in series.items():
        points.sort(key=lambda point: (point.record_date, point.record_id))
        if len(points) > 1:
            trends.append(
                LabTrend(
                    analyte=analyte,
                    unit=unit,
                    latest_flag=points[-1].flag,
                    points=points,
                )
            )
    trends.sort(key=lambda trend: trend.analyte.casefold())
    return PatientTimeline(
        patient=patient,
        encounters=encounters,
        trends=trends,
        counts=TimelineCounts(
            encounters=len(encounters),
            records=len(records),
            abnormal_results=abnormal,
            trends=len(trends),
        ),
    )
