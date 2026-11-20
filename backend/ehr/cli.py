from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path
from typing import Any

from ehr.config import Settings
from ehr.fhir import validate_official, validate_server
from ehr.fixtures import seed
from ehr.pipeline import ingest, summarize_all
from ehr.search import SearchIndex, SentenceEncoder
from ehr.storage import Store
from ehr.summarization import make_provider


def main() -> int:
    parser = argparse.ArgumentParser(description="Synthetic EHR processing and verification")
    sub = parser.add_subparsers(dest="command", required=True)
    seed_parser = sub.add_parser("seed", help="Generate 50 synthetic records in JSON and CSV")
    seed_parser.add_argument("--output", type=Path, default=Path("../sample-data"))
    ingestion = sub.add_parser(
        "ingest", help="Clean inputs, save records and validate FHIR Bundles"
    )
    ingestion.add_argument("paths", nargs="+", type=Path)
    sub.add_parser("summarize", help="Generate or reuse patient summaries")
    sub.add_parser("index", help="Rebuild the persistent semantic search index")
    export = sub.add_parser("export", help="Export stored FHIR Bundles")
    export.add_argument("--output", type=Path, default=Path("../artifacts/bundles"))
    validation = sub.add_parser(
        "validate", help="Validate every exported Bundle with official R4 tooling"
    )
    validator_source = validation.add_mutually_exclusive_group()
    validator_source.add_argument("--jar", type=Path)
    validator_source.add_argument(
        "--server", help="HTTPS R4 base URL; sends synthetic Bundles to this server"
    )
    validation.add_argument("--output", type=Path, default=Path("../artifacts/validation"))
    benchmark = sub.add_parser("benchmark", help="Measure real warmed search endpoint latency")
    benchmark.add_argument("--repeats", type=int, default=20)
    args = parser.parse_args()
    settings = Settings()
    store = Store(settings.data_dir)
    output: Any
    exit_code = 0
    if args.command == "seed":
        output = {"files": [str(path) for path in seed(args.output)]}
    elif args.command == "ingest":
        output = ingest(store, args.paths)
        exit_code = 1 if output["status"] == "completed_with_errors" else 0
    elif args.command == "summarize":
        output = summarize_all(store, make_provider(settings))
        exit_code = 1 if output["failed"] else 0
    elif args.command == "index":
        output = SearchIndex(settings.data_dir, store, SentenceEncoder(settings)).rebuild()
    elif args.command in ("export", "validate"):
        args.output.mkdir(parents=True, exist_ok=True)
        output = {"files": []}
        for patient in store.patients():
            path = args.output / f"{patient.id}.json"
            bundle = store.bundle(patient.id)
            if bundle is None:
                continue
            path.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
            if args.command == "validate":
                report_path = path.with_suffix(".validation.json")
                if args.server:
                    validate_server(bundle, args.server, report_path)
                else:
                    jar = args.jar or settings.fhir_validator_jar
                    if jar is None:
                        parser.error("Provide --server, --jar or EHR_FHIR_VALIDATOR_JAR")
                    validate_official(path, jar, report_path)
            output["files"].append(str(path))
    else:
        from fastapi.testclient import TestClient

        from ehr.api import create_app

        if args.repeats < 1:
            parser.error("--repeats must be positive")
        if len(store.records()) < 50:
            parser.error("Benchmark requires at least 50 stored records")
        timings = []
        queries = [
            "abnormal kidney results",
            "chest imaging with opacity",
            "low hemoglobin",
            "diabetes and high glucose",
            "normal liver ultrasound",
        ]
        with TestClient(create_app(settings)) as client:
            client.post("/search", json={"query": queries[0]}).raise_for_status()
            for number in range(args.repeats):
                started = time.perf_counter()
                response = client.post("/search", json={"query": queries[number % len(queries)]})
                response.raise_for_status()
                timings.append((time.perf_counter() - started) * 1000)
        ordered = sorted(timings)
        output = {
            "records": len(store.records()),
            "requests": len(timings),
            "median_ms": round(statistics.median(timings), 3),
            "p95_ms": round(ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))], 3),
            "max_ms": round(max(timings), 3),
            "under_2_seconds": max(timings) < 2000,
            "scope": "warmed in-process HTTP endpoint; excludes process/model startup",
        }
        exit_code = 0 if output["under_2_seconds"] else 1
    print(json.dumps(output, indent=2, default=str))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
