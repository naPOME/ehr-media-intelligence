from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ehr.config import Settings
from ehr.models import (
    ClinicalSummary,
    Model,
    Patient,
    Record,
    ResourceType,
    SearchRequest,
    SearchResponse,
)
from ehr.search import Encoder, IndexUnavailable, SearchIndex, SentenceEncoder
from ehr.storage import Store


class SummaryView(Model):
    status: Literal["unavailable", "ready", "stale", "failed"]
    data: ClinicalSummary | None = None
    generated_at: str | None = None
    provider: str | None = None
    model: str | None = None
    error: str | None = None


class RecordPreview(Model):
    id: str
    title: str
    record_date: date | None
    resource_types: list[str]


class PatientDetail(Model):
    patient: Patient
    summary: SummaryView
    records: list[RecordPreview]


class RecordDetail(Model):
    record: Record
    fhir_resources: list[dict[str, Any]]


def create_app(settings: Settings | None = None, encoder: Encoder | None = None) -> FastAPI:
    settings = settings or Settings()
    store: Store | None = None
    index: SearchIndex | None = None

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        nonlocal store, index
        store = Store(settings.data_dir)
        if encoder or (settings.data_dir / "search-index.json").exists():
            index = SearchIndex(settings.data_dir, store, encoder or SentenceEncoder(settings))
        yield

    app = FastAPI(
        title="EHR Media Intelligence",
        version="0.1.0",
        lifespan=lifespan,
        description="Synthetic patient records only. Local assessment backend.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    def database() -> Store:
        if store is None:
            raise HTTPException(503, "Database has not started")
        return store

    @app.exception_handler(IndexUnavailable)
    async def unavailable(_: Any, exc: IndexUnavailable) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @app.get("/health")
    def health() -> dict[str, Any]:
        database()
        try:
            state = index.state() if index else None
        except IndexUnavailable:
            state = None
        return {
            "status": "ok",
            "search_ready": state is not None,
            "indexed_chunks": state["chunks"] if state else 0,
            "summary_provider": settings.llm_provider,
        }

    @app.post("/search", response_model=SearchResponse)
    def search(
        body: SearchRequest,
        resource_type: ResourceType | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> SearchResponse:
        if date_from and date_to and date_from > date_to:
            raise HTTPException(422, "date_from must not be after date_to")
        if index is None:
            raise IndexUnavailable("Search index is missing; run ehr index and restart the backend")
        return index.search(body.query, resource_type, date_from, date_to)

    @app.get("/patients/{patient_id}", response_model=PatientDetail)
    def patient_detail(patient_id: str) -> PatientDetail:
        db = database()
        patient = db.patient(patient_id)
        if patient is None:
            raise HTTPException(404, "Patient not found")
        cached = db.summary(patient_id)
        view = SummaryView(status="unavailable")
        if cached:
            view = SummaryView(
                status=cached["status"],
                data=cached["data"] if cached["status"] == "ready" else None,
                generated_at=cached["generated_at"],
                provider=cached["provider"],
                model=cached["model"],
                error=cached["error"],
            )
        records = sorted(
            db.records(patient_id),
            key=lambda record: (record.record_date or date.min, record.id),
            reverse=True,
        )
        return PatientDetail(
            patient=patient,
            summary=view,
            records=[
                RecordPreview(
                    id=record.id,
                    title=record.title,
                    record_date=record.record_date,
                    resource_types=["DocumentReference", "DiagnosticReport"]
                    if record.kind in ("lab", "imaging")
                    else ["DocumentReference"],
                )
                for record in records
            ],
        )

    @app.get("/patients/{patient_id}/bundle")
    def patient_bundle(patient_id: str) -> dict[str, Any]:
        bundle = database().bundle(patient_id)
        if bundle is None:
            raise HTTPException(404, "Patient Bundle not found")
        return bundle

    @app.get("/records/{record_id}", response_model=RecordDetail)
    def record_detail(record_id: str) -> RecordDetail:
        db = database()
        record = db.record(record_id)
        if record is None:
            raise HTTPException(404, "Record not found")
        bundle = db.bundle(record.patient.id)
        resources = [entry["resource"] for entry in bundle["entry"]] if bundle else []
        linked = [r for r in resources if r["id"] == record.id]
        observation_refs = {ref["reference"] for r in linked for ref in r.get("result", [])}
        linked.extend(r for r in resources if f"Observation/{r['id']}" in observation_refs)
        return RecordDetail(record=record, fhir_resources=linked)

    @app.get("/ingestion-runs/{run_id}")
    def ingestion_run(run_id: str) -> dict[str, Any]:
        report = database().run(run_id)
        if report is None:
            raise HTTPException(404, "Ingestion run not found")
        return report

    return app


app = create_app()
