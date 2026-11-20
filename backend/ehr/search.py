from __future__ import annotations

import json
import threading
import time
from datetime import date
from pathlib import Path
from typing import Any, Literal, Protocol, cast
from uuid import uuid4

import numpy as np
from chromadb.api.types import Metadata, Where

from ehr.config import Settings
from ehr.models import (
    ClinicalSummary,
    Model,
    ResourceType,
    SearchMatch,
    SearchResponse,
    content_hash,
)
from ehr.storage import Store


class Encoder(Protocol):
    name: str

    def chunks(self, text: str) -> list[str]: ...
    def encode(self, texts: list[str], *, query: bool = False) -> list[list[float]]: ...


class SentenceEncoder:
    def __init__(self, settings: Settings):
        from sentence_transformers import SentenceTransformer

        self.name = f"{settings.embedding_model}@{settings.embedding_revision}"
        self.model = SentenceTransformer(
            settings.embedding_model,
            revision=settings.embedding_revision,
            device="cpu",
            cache_folder=str(settings.data_dir / "huggingface" / "hub"),
        )

    def chunks(self, text: str) -> list[str]:
        tokenizer = self.model.tokenizer
        tokens = tokenizer.encode(text, add_special_tokens=False)
        size = self.model.max_seq_length - tokenizer.num_special_tokens_to_add(pair=False)
        step = max(1, size - 32)
        return [
            tokenizer.decode(tokens[start : start + size], skip_special_tokens=True)
            for start in range(0, len(tokens), step)
        ] or [text]

    def encode(self, texts: list[str], *, query: bool = False) -> list[list[float]]:
        method = self.model.encode_query if query else self.model.encode_document
        return cast(
            list[list[float]],
            method(texts, normalize_embeddings=True, show_progress_bar=False).tolist(),
        )


class IndexUnavailable(RuntimeError):
    pass


class IndexedChunk(Model):
    patient_id: str
    record_id: str
    date_ordinal: int
    resource_type: ResourceType
    match_source: Literal["document", "patient", "summary"]


class SearchIndex:
    def __init__(self, directory: Path, store: Store, encoder: Encoder):
        import chromadb
        from chromadb.config import Settings as ChromaSettings

        directory.mkdir(parents=True, exist_ok=True)
        self.manifest = directory / "search-index.json"
        self.client = chromadb.PersistentClient(
            path=str(directory / "chroma"), settings=ChromaSettings(anonymized_telemetry=False)
        )
        self.store = store
        self.encoder = encoder
        self.lock = threading.Lock()

    def dataset_hash(self) -> str:
        patients = self.store.patients()
        return content_hash(
            {
                "schema": 1,
                "encoder": self.encoder.name,
                "patients": [patient.model_dump(mode="json") for patient in patients],
                "records": [(record.id, record.clinical_hash()) for record in self.store.records()],
                "summaries": [self.store.summary(patient.id) for patient in patients],
            }
        )

    def state(self) -> dict[str, Any]:
        if not self.manifest.exists():
            raise IndexUnavailable("Search index is missing; run ehr index")
        state: dict[str, Any] = json.loads(self.manifest.read_text(encoding="utf-8"))
        if state["dataset_hash"] != self.dataset_hash():
            raise IndexUnavailable("Search index is stale; run ehr index after processing changes")
        return state

    def rebuild(self) -> dict[str, Any]:
        with self.lock:
            digest = self.dataset_hash()
            chunks: list[str] = []
            metadata: list[Metadata] = []

            def append(text: str, values: Metadata) -> None:
                for chunk in self.encoder.chunks(text):
                    chunks.append(chunk)
                    metadata.append(values)

            for patient in self.store.patients():
                common: dict[str, str | int] = {"patient_id": patient.id, "date_ordinal": -1}
                append(
                    f"{patient.name} MRN {patient.mrn} Gender {patient.gender} "
                    f"DOB {patient.dob or 'not documented'}",
                    {
                        **common,
                        "resource_type": "Patient",
                        "match_source": "patient",
                        "record_id": "",
                    },
                )
                cached = self.store.summary(patient.id)
                if cached and cached["status"] == "ready":
                    summary = ClinicalSummary.model_validate(cached["data"])
                    append(
                        summary.plain_text(),
                        {
                            **common,
                            "resource_type": "Patient",
                            "match_source": "summary",
                            "record_id": "",
                        },
                    )
            for record in self.store.records():
                common = {
                    "patient_id": record.patient.id,
                    "record_id": record.id,
                    "date_ordinal": record.record_date.toordinal() if record.record_date else -1,
                    "match_source": "document",
                }
                text = f"{record.title}\n{record.text}"
                if record.labs:
                    text += "\n" + json.dumps([lab.model_dump() for lab in record.labs])
                append(text, {**common, "resource_type": "DocumentReference"})
                if record.kind in ("lab", "imaging"):
                    append(text, {**common, "resource_type": "DiagnosticReport"})
            collection_name = "ehr-" + uuid4().hex
            collection = self.client.create_collection(
                collection_name, embedding_function=None, metadata={"hnsw:space": "cosine"}
            )
            try:
                for start in range(0, len(chunks), 128):
                    batch = chunks[start : start + 128]
                    collection.add(
                        ids=[str(i) for i in range(start, start + len(batch))],
                        embeddings=np.asarray(self.encoder.encode(batch), dtype=np.float32),
                        documents=batch,
                        metadatas=metadata[start : start + len(batch)],
                    )
                if self.dataset_hash() != digest:
                    raise IndexUnavailable("Data changed during indexing; retry ehr index")
                state = {
                    "collection": collection_name,
                    "dataset_hash": digest,
                    "chunks": len(chunks),
                    "encoder": self.encoder.name,
                }
                pending = self.manifest.with_suffix(".pending")
                pending.write_text(json.dumps(state), encoding="utf-8")
                pending.replace(self.manifest)
                return state
            except Exception:
                self.client.delete_collection(collection_name)
                raise

    def search(
        self,
        query: str,
        resource_type: ResourceType | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> SearchResponse:
        start = time.perf_counter()
        if not query.strip():
            raise ValueError("Search query cannot be empty")
        if date_from and date_to and date_from > date_to:
            raise ValueError("date_from must not be after date_to")
        with self.lock:
            state = self.state()
            collection = self.client.get_collection(state["collection"], embedding_function=None)
            filters: list[Where] = []
            if resource_type:
                filters.append({"resource_type": resource_type})
            if date_from or date_to:
                filters.append(
                    cast(
                        Where, {"date_ordinal": {"$gte": date_from.toordinal() if date_from else 1}}
                    )
                )
            if date_to:
                filters.append(cast(Where, {"date_ordinal": {"$lte": date_to.toordinal()}}))
            where: Where | None = (
                {"$and": filters} if len(filters) > 1 else filters[0] if filters else None
            )
            count = collection.count()
            matches: list[SearchMatch] = []
            if count:
                result = collection.query(
                    query_embeddings=np.asarray(
                        self.encoder.encode([query], query=True), dtype=np.float32
                    ),
                    n_results=count,
                    where=where,
                    include=["documents", "metadatas", "distances"],
                )
                seen: set[str] = set()
                for meta, text, distance in zip(
                    (result["metadatas"] or [[]])[0],
                    (result["documents"] or [[]])[0],
                    (result["distances"] or [[]])[0],
                    strict=True,
                ):
                    chunk = IndexedChunk.model_validate(meta)
                    key = chunk.record_id or "patient:" + chunk.patient_id
                    if key in seen:
                        continue
                    seen.add(key)
                    patient = self.store.patient(chunk.patient_id)
                    record = self.store.record(chunk.record_id) if chunk.record_id else None
                    if not patient:
                        raise IndexUnavailable("Indexed patient no longer exists; rebuild index")
                    cached = self.store.summary(patient.id)
                    summary = (
                        ClinicalSummary.model_validate(cached["data"])
                        if (cached and cached["status"] == "ready")
                        else None
                    )
                    matches.append(
                        SearchMatch(
                            patient_id=patient.id,
                            patient_name=patient.name,
                            mrn=patient.mrn,
                            record_id=record.id if record else None,
                            title=record.title if record else "Patient history",
                            record_date=record.record_date if record else None,
                            resource_type=chunk.resource_type,
                            match_source=chunk.match_source,
                            relevance_score=round(max(-1.0, min(1.0, 1 - float(distance))), 6),
                            excerpt=text[:800],
                            summary_snippet=summary.plain_text()[:320] if summary else None,
                        )
                    )
                    if len(matches) == 5:
                        break
            return SearchResponse(
                query=query,
                matches=matches,
                elapsed_ms=round((time.perf_counter() - start) * 1000, 3),
            )
