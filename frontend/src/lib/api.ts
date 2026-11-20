import createClient from "openapi-fetch";
import type { components, paths } from "./api.generated";

export type Patient = components["schemas"]["Patient"];
export type PatientListItem = components["schemas"]["PatientListItem"];
export type SearchResponse = components["schemas"]["SearchResponse"];
export type SearchMatch = components["schemas"]["SearchMatch"];
export type ResourceType = SearchMatch["resource_type"];
export type PatientDetail = components["schemas"]["PatientDetail"];
export type RecordDetail = components["schemas"]["RecordDetail"];
export type SummaryItem = components["schemas"]["SummaryItem"];
export type ClinicalSummary = components["schemas"]["ClinicalSummary"];
export type PatientTimeline = components["schemas"]["PatientTimeline"];
export type IntakePreview = components["schemas"]["IntakePreview"];
export type IntakeItem = components["schemas"]["IntakeItem"];
export type IntakeDraftSummary = components["schemas"]["IntakeDraftSummary"];
export type IntakePublishResult = components["schemas"]["IntakePublishResult"];
export type SearchFilters = {
  patientId?: string;
  resourceType?: ResourceType;
  dateFrom?: string;
  dateTo?: string;
};
export type Health = { searchReady: boolean; provider: string };

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 503
        ? "The record library is temporarily unavailable. Please try again shortly."
        : status === 404
          ? "This record is no longer available."
          : status === 422
            ? "Check your search and filter values, then try again."
            : "We couldn't load this information. Please try again.",
    );
    this.name = "ApiError";
  }
}

const client = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE_URL || "/api",
});
const requestSignal = (signal: AbortSignal) =>
  AbortSignal.any([signal, AbortSignal.timeout(15_000)]);

export async function searchRecords(
  query: string,
  filters: SearchFilters,
  signal: AbortSignal,
) {
  const result = await client.POST("/search", {
    body: { query },
    params: {
      query: {
        patient_id: filters.patientId,
        resource_type: filters.resourceType,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      },
    },
    signal: requestSignal(signal),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}

export async function getPatient(id: string, signal: AbortSignal) {
  const result = await client.GET("/patients/{patient_id}", {
    params: { path: { patient_id: id } },
    signal: requestSignal(signal),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}

export async function getRecord(id: string, signal: AbortSignal) {
  const result = await client.GET("/records/{record_id}", {
    params: { path: { record_id: id } },
    signal: requestSignal(signal),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}

export async function getBundle(id: string, signal: AbortSignal) {
  const result = await client.GET("/patients/{patient_id}/bundle", {
    params: { path: { patient_id: id } },
    signal: requestSignal(signal),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}

export async function getPatientTimeline(id: string, signal: AbortSignal) {
  const result = await client.GET("/patients/{patient_id}/timeline", {
    params: { path: { patient_id: id } },
    signal: requestSignal(signal),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}

export async function getIntakeDrafts(signal: AbortSignal) {
  const result = await client.GET("/intake", {
    signal: requestSignal(signal),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}

export async function previewIntake(filename: string, content: string) {
  const result = await client.POST("/intake/preview", {
    body: { filename, content },
    signal: AbortSignal.timeout(30_000),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}

export async function publishIntake(draftId: string) {
  const result = await client.POST("/intake/{draft_id}/publish", {
    params: { path: { draft_id: draftId } },
    signal: AbortSignal.timeout(60_000),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}

export async function getHealth(signal: AbortSignal): Promise<Health> {
  const result = await client.GET("/health", { signal: requestSignal(signal) });
  if (
    !result.data ||
    !result.response.ok ||
    typeof result.data.search_ready !== "boolean"
  )
    throw new ApiError(result.response.status || 500);
  return {
    searchReady: result.data.search_ready,
    provider:
      typeof result.data.summary_provider === "string"
        ? result.data.summary_provider
        : "",
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "We couldn't reach the record library. Check your connection and try again.";
}

export type PatientDirectoryOptions = NonNullable<
  paths["/patients"]["get"]["parameters"]["query"]
>;
export type PatientSort = NonNullable<PatientDirectoryOptions["sort_by"]>;

export async function getPatients(
  options: PatientDirectoryOptions,
  signal: AbortSignal,
) {
  const result = await client.GET("/patients", {
    params: { query: options },
    signal: requestSignal(signal),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}

export async function getLibrary(signal: AbortSignal) {
  const result = await client.GET("/library", {
    signal: requestSignal(signal),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}

export async function exportPatients(
  options: PatientDirectoryOptions,
  signal: AbortSignal,
) {
  const result = await client.GET("/patients/export", {
    params: { query: options },
    parseAs: "blob",
    signal: requestSignal(signal),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}

export async function getOverview(signal: AbortSignal) {
  const result = await client.GET("/overview", {
    signal: requestSignal(signal),
  });
  if (!result.data || !result.response.ok)
    throw new ApiError(result.response.status);
  return result.data;
}
