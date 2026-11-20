import type { Page, Route } from "@playwright/test";
import type {
  ClinicalSummary,
  PatientDetail,
  RecordDetail,
  SearchMatch,
} from "../src/lib/api";

export const patientId = "synthetic-patient-1";
export const recordId = "synthetic-record-1";
export const match: SearchMatch = {
  patient_id: patientId,
  patient_name: "Patient 02",
  mrn: "MRN00042",
  record_id: recordId,
  title: "Renal panel",
  record_date: "2026-03-15",
  resource_type: "DiagnosticReport",
  match_source: "document",
  relevance_score: 0.72,
  excerpt:
    "Creatinine 2.1 mg/dL, flagged high. No established kidney diagnosis is documented.",
  summary_snippet: null,
  summary_scope: "patient_history",
};
export const summary: ClinicalSummary = {
  chief_concern: {
    text: "Fatigue and reduced urine output are documented.",
    source_record_ids: [recordId],
  },
  key_diagnoses: [],
  recent_media_records: [
    {
      text: "Creatinine 2.1 mg/dL was flagged high on 15 March 2026.",
      source_record_ids: [recordId],
    },
  ],
  flagged_anomalies: [],
  limitations: "The source history is limited.",
  disclaimer:
    "AI-generated summary. Verify against source records; this is not a clinical decision.",
};
export const patient: PatientDetail = {
  patient: {
    id: patientId,
    source_system: "synthetic",
    mrn: "MRN00042",
    name: "Patient 02",
    dob: "1985-03-14",
    gender: "female",
  },
  summary: {
    status: "unavailable",
    data: null,
    generated_at: null,
    provider: null,
    model: null,
    error: null,
  },
  records: [
    {
      id: recordId,
      title: "Renal panel",
      record_date: "2026-03-15",
      resource_types: ["DocumentReference", "DiagnosticReport"],
    },
  ],
};
export const record: RecordDetail = {
  record: {
    id: recordId,
    external_id: "lab-42",
    source_file: "synthetic-labs.csv",
    patient: patient.patient,
    patient_alias: "synthetic-person",
    kind: "lab",
    title: "Renal panel",
    record_date: "2026-03-15",
    encounter_id: null,
    encounter_class: null,
    text: "Creatinine 2.1 mg/dL, flagged high. No established kidney diagnosis is documented.",
    labs: [
      {
        name: "Creatinine",
        value: 2.1,
        unit: "mg/dL",
        reference_low: 0.6,
        reference_high: 1.2,
        flag: "high",
      },
    ],
    changes: [
      {
        field: "mrn",
        before: "mrn-00042",
        after: "MRN00042",
        reason: "Canonical MRN; leading zeros preserved",
      },
    ],
    original: {},
  },
  fhir_resources: [
    { resourceType: "DocumentReference", id: recordId },
    { resourceType: "DiagnosticReport", id: recordId },
  ],
};
export const bundle = {
  resourceType: "Bundle",
  type: "collection",
  entry: [{ resource: { resourceType: "Patient", id: patientId } }],
};
export const fulfill = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

export async function mockApi(
  page: Page,
  options: {
    ready?: boolean;
    matches?: SearchMatch[];
    status?: PatientDetail["summary"]["status"];
  } = {},
) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/overview")
      return fulfill(route, {
        metrics: {
          patients: 1,
          records: 1,
          lab_reports: 1,
          imaging_reports: 0,
          summaries_ready: options.ready ? 1 : 0,
          latest_record_date: "2026-03-15",
        },
        recent_patients: [
          {
            patient: patient.patient,
            record_count: 1,
            latest_record_date: "2026-03-15",
            summary_status: options.ready ? "ready" : "unavailable",
            latest_record_id: record.record.id,
            latest_record_title: record.record.title,
          },
        ],
        summaries: options.ready
          ? [
              {
                patient: patient.patient,
                summary: {
                  ...patient.summary,
                  status: "ready",
                  data: summary,
                  generated_at: "2026-11-20T08:00:00Z",
                },
              },
            ]
          : [],
      });
    if (path === "/api/health")
      return fulfill(route, {
        status: "ok",
        search_ready: true,
        indexed_chunks: 80,
        summary_provider: "gemini",
      });
    if (path === "/api/library")
      return fulfill(route, {
        patients: 1,
        records: 1,
        lab_reports: 1,
        imaging_reports: 0,
        summaries_ready: options.ready ? 1 : 0,
        latest_record_date: "2026-03-15",
      });
    if (path === "/api/patients")
      return fulfill(route, {
        items: [
          {
            patient: patient.patient,
            record_count: 1,
            latest_record_date: "2026-03-15",
            summary_status: options.ready ? "ready" : "unavailable",
          },
        ],
        total: 1,
      });
    if (path === "/api/search") {
      const body: { query: string } = route.request().postDataJSON();
      return fulfill(route, {
        query: body.query,
        matches: options.matches ?? [
          {
            ...match,
            summary_snippet: options.ready ? summary.chief_concern.text : null,
          },
        ],
        elapsed_ms: 94,
      });
    }
    if (path.endsWith("/bundle")) return fulfill(route, bundle);
    if (path.startsWith("/api/patients/"))
      return fulfill(route, {
        ...patient,
        summary: {
          ...patient.summary,
          status: options.ready ? "ready" : options.status || "unavailable",
          data: options.ready ? summary : null,
          generated_at: options.ready ? "2026-11-20T08:00:00Z" : null,
        },
      });
    if (path.startsWith("/api/records/")) return fulfill(route, record);
    return fulfill(route, { detail: "Not found" }, 404);
  });
}
