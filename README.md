# EHR Media Intelligence backend

This backend cleans synthetic patient exports, converts them to FHIR R4, creates short AI summaries, and searches the records by meaning. It includes 50 synthetic records across 10 patients. The React/Ant Design frontend has not been built yet.

## Run locally

Install [uv](https://docs.astral.sh/uv/getting-started/installation/). Run these commands from this project's `backend` directory:

```powershell
uv sync --locked --python 3.12 --extra dev
Copy-Item .env.example .env
```

Set `GEMINI_API_KEY` in `backend/.env`. Keep that file private. The model can be changed with `EHR_GEMINI_MODEL`.

```powershell
uv run ehr seed
uv run ehr ingest ../sample-data/patients.json ../sample-data/reports.csv
uv run ehr summarize
uv run ehr index
uv run uvicorn ehr.api:app --host 127.0.0.1 --port 8011
```

Open http://127.0.0.1:8011/docs for the interactive API documentation. The first indexing run downloads the embedding model. Later runs use the local model cache.

If no API key is available, skip `ehr summarize`. Ingestion, FHIR, document search, and record retrieval still work; summaries are explicitly unavailable. No generated sample text is substituted for an AI response.

To use the assessment's named OpenAI provider, set `EHR_LLM_PROVIDER=openai`, set `OPENAI_API_KEY`, and select a supported model with `EHR_OPENAI_MODEL`. Run `ehr summarize` and `ehr index` again. Gemini is an intentional user-requested addition; the assessment names OpenAI or Claude.

Run preprocessing commands before starting the server. Stop the server for imports and index rebuilds, then restart it. This local implementation assumes one preprocessing writer.

## Input contract

JSON input is an array of objects. CSV uses the same field names; its `labs` column contains a JSON array. The included files are complete examples.

Required fields are `record_id`, `mrn`, `name`, `kind`, `title`, and `text`. Supported kinds are `note`, `discharge`, `lab`, and `imaging`.

```json
{
  "record_id": "synthetic-lab-001",
  "source_system": "synthetic",
  "mrn": "mrn-00001",
  "patient_id": "source-person-1",
  "name": "Synthetic Patient 01",
  "dob": "14/03/1985",
  "gender": "F",
  "kind": "lab",
  "title": "Renal panel",
  "record_date": "2026-03-11",
  "encounter_id": "synthetic-visit-1",
  "encounter_class": "AMB",
  "text": "Creatinine 2.1 mg/dL; source flags this result as high.",
  "labs": [{
    "name": "Creatinine", "value": 2.1, "unit": "mg/dL",
    "reference_low": 0.6, "reference_high": 1.2, "flag": "high"
  }]
}
```

Dates accept ISO dates/timestamps, `DD/MM/YYYY`, and `DD-MM-YYYY`. Slash dates are explicitly day-first. DOB and record date may be absent; invalid dates, future DOBs, and records preceding DOB are rejected. Clinical dates retain their supplied calendar date; no midnight timestamp is invented.

MRNs are scoped to `source_system`, uppercased, and stripped of spaces/hyphens; leading zeros remain. This rule is for the documented synthetic export format. Names are not used to merge patients. Conflicting names, DOBs, gender, source patient IDs, record ownership, or known encounter classes are quarantined and reported. Unknown demographic values never overwrite known values. Supported encounter classes are `AMB`, `IMP`, and `EMER`; an absent class stays unknown.

Repeated source records are skipped. Conflicting copies of a source record within one import are both quarantined. Identical documents under different record IDs are detected by patient, content, category, date, title, encounter, and lab values. A changed existing source record updates its previous record. The original row and cleaning changes remain available in stored records; import reports keep the per-run decisions.

## Stored data and FHIR

SQLite is the source of truth. It stores patients, source aliases, records, document fingerprints, patient Bundles, summary state/cache keys, and import reports. Its location defaults to `data/` beside this README. Relative data-directory settings are anchored to `backend/`.

FHIR output contains `Patient`, `DocumentReference`, and `DiagnosticReport`, with `Encounter` and `Observation` when supplied information needs them. Each patient gets a collection Bundle. Document text is embedded as a UTF-8 attachment and retained in resource narratives. Diagnostic status stays `unknown` because the input format does not supply final/preliminary status. Clinical codes are not guessed.

FHIR R4 models come from `fhirclient`, which Task 2 explicitly permits. Modern `fhir.resources` targets R5/R4B, so using it without checking its version would not meet exact R4. Pydantic v2 validates the application's inputs and output models. This library choice differs from the stack table and should be mentioned in the submission.

Every import checks R4 model structure, resource identity uniqueness, patient ownership, and reference resolution. Each accepted record and its updated patient Bundle are committed in the same SQLite transaction. Export Bundles with:

```powershell
uv run ehr export
```

For independent validation of these synthetic Bundles against an R4 server:

```powershell
uv run ehr validate --server https://hapi.fhir.org/baseR4
```

This sends the Bundles to that public validation endpoint and saves its OperationOutcome reports under `artifacts/validation/`. Alternatively, download the official HL7 validator CLI and use `uv run ehr validate --jar PATH_TO_VALIDATOR_JAR`. That local command requires Java and disables external terminology lookup with `-tx n/a`. Missing optional performer information can produce warnings; errors fail validation.

## Summaries and search

Summaries are generated from the stored Bundle's patient, decoded documents, reports, and observations. Each factual summary item must reference existing document IDs. Unsupported citations and summaries of 200 words or more are rejected. The word limit includes limitations and the server-controlled AI disclaimer. These checks do not prove clinical accuracy; source comparison remains necessary.

The cache key includes patient identity, Bundle content, provider, model, and prompt version. Record changes mark prior summaries stale. Failures are stored explicitly and can be retried by rerunning `ehr summarize`. Histories above the current 100,000-character processing limit fail visibly instead of being silently truncated. There is no automatic split-history summarization.

Search uses a pinned `all-MiniLM-L6-v2` revision and cosine similarity in persistent ChromaDB. Documents are split by the model's tokenizer with overlap. Lab/imaging records have searchable DocumentReference and DiagnosticReport representations; matches are combined by source record so they do not occupy duplicate result slots.

Patient demographics and ready AI summaries are also embedded. A summary match is labelled `match_source=summary` and `resource_type=Patient`; it is patient-wide and has no invented clinical date. Date filters exclude undated matches. Document result cards may contain a patient-history summary snippet, which is explicitly labelled with `summary_scope=patient_history`.

The index records its dataset/model fingerprint. Changed data makes it stale, and the endpoint returns 503 until it is rebuilt. A new index is published only after its embeddings have been written successfully. Old index collections are retained locally. Retrieval scans all ranked chunks before choosing five distinct matches; this favors correct deduplication for the assessment-sized dataset and needs a different paging approach for large collections.

## HTTP contract

| Request | Response |
| --- | --- |
| `GET /health` | Process status and separate search readiness |
| `POST /search` | Up to five distinct ranked matches with patient identity, dates, types, excerpts, scores, summary snippets |
| `GET /patients/{id}` | Demographics, summary state/content, newest-first record list |
| `GET /patients/{id}/bundle` | Patient's stored FHIR Bundle |
| `GET /records/{id}` | Cleaned record, original row, changes, and linked FHIR resources |
| `GET /ingestion-runs/{id}` | Cleaning decisions, counts, issues, and Bundle validation results |

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:8011/search?resource_type=DiagnosticReport&date_from=2026-03-01&date_to=2026-03-31' -Method Post -ContentType 'application/json' -Body '{"query":"abnormal kidney results"}'
```

Search filters are query parameters. Resource type accepts `Patient`, `DocumentReference`, or `DiagnosticReport`. Date bounds are inclusive and use each record's clinical date. Scores are cosine search similarity, not probabilities or clinical confidence. Missing entities return 404; invalid requests return 422; missing/stale indexes return 503. CORS permits the configured frontend origin, initially `http://localhost:5173`.

## Verification

```powershell
uv run ruff check ehr tests
uv run ruff format --check ehr tests
uv run mypy ehr
uv run pytest -q
uv run pytest -q --run-model-tests
uv run ehr benchmark --repeats 20
```

Regular tests use deterministic test-only encoders/providers and a real temporary SQLite/Chroma store. The model flag also checks actual clinical-topic retrieval with the real embedding model on 50 records. The benchmark measures the warmed FastAPI endpoint through HTTP TestClient, including request/response handling; it excludes model/process startup and network transport. A separate localhost HTTP check is needed to establish that the running server responds.

The included GitHub Actions workflow runs lint, format, strict types, and all model tests when this directory is used as its own repository. The workflow has not been executed on GitHub from this checkout.

This is a local synthetic-data assessment backend. Authentication, hospital connectivity, OCR/PDF extraction, machine interfaces, and deployment are not implemented. No real patient data belongs in this project.
