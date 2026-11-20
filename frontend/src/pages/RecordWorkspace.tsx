import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Grid, Input, Select } from "antd";
import type { InputRef } from "antd";
import {
  ArrowLeftOutlined,
  FileSearchOutlined,
  FilterOutlined,
  GlobalOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
  EmptyResults,
  ErrorState,
  ResultsSkeleton,
} from "../components/Feedback";
import { PatientDrawer } from "../components/PatientDrawer";
import { PatientReview } from "../components/PatientReview";
import type { Selection } from "../components/PatientReview";
import { ResourceBadge } from "../components/ResourceBadge";
import { ResultCard } from "../components/ResultCard";
import { getPatient } from "../lib/api";
import type { Patient, ResourceType } from "../lib/api";
import { formatDate } from "../lib/format";
import { useRecordSearch } from "../lib/use-search";

const suggestions = [
  "Abnormal kidney results",
  "Chest imaging findings",
  "Low hemoglobin",
];
type SearchState = ReturnType<typeof useRecordSearch>;

function ReviewWorkspace({
  context,
  search,
  initialRecordId,
  showSummary,
}: {
  context: Patient | null;
  search: SearchState;
  initialRecordId?: string;
  showSummary?: boolean;
}) {
  const [picked, setPicked] = useState<{
    selection: Selection;
    scope: string;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(!!context);
  const screens = Grid.useBreakpoint();
  const list = useRef<HTMLDivElement>(null);
  const patient = useQuery({
    queryKey: ["patient", context?.id],
    queryFn: ({ signal }) => {
      if (!context) throw new Error("No patient selected");
      return getPatient(context.id, signal);
    },
    enabled: !!context,
  });
  const hasQuery = !!search.draft.trim();
  const data = search.result.data;
  const scope =
    context?.id || `${search.query}-${JSON.stringify(search.filters)}`;
  const fallback: Selection | null =
    context && patient.data
      ? {
          patientId: context.id,
          recordId: showSummary
            ? null
            : initialRecordId || patient.data.records[0]?.id || null,
        }
      : null;
  const selection = picked?.scope === scope ? picked.selection : fallback;
  function openRecord(next: Selection) {
    setPicked({ selection: next, scope });
    setExpanded(false);
    setMobileOpen(true);
  }
  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (
      !["ArrowDown", "ArrowUp"].includes(event.key) ||
      !(event.target instanceof HTMLButtonElement) ||
      !event.target.classList.contains("result-select")
    )
      return;
    const buttons = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>(".result-select") || [],
    );
    const next =
      buttons.indexOf(event.target) + (event.key === "ArrowDown" ? 1 : -1);
    if (buttons[next]) {
      event.preventDefault();
      buttons[next].focus();
    }
  }
  const recent = patient.data?.records || [];
  const count = hasQuery ? data?.matches.length || 0 : recent.length;
  return (
    <div className="review-grid">
      <section aria-label="Search results" className="results-pane">
        <div className="pane-heading">
          <h2>
            {hasQuery ? "Results" : "Documents"}
            {count > 0 && <span className="count-badge">{count}</span>}
          </h2>
          <span>
            {hasQuery ? "Ranked by relevance" : context ? "Newest first" : ""}
          </span>
        </div>
        <div
          aria-busy={search.loading || (!!context && patient.isPending)}
          className="result-list"
          onKeyDown={moveFocus}
          ref={list}
        >
          {hasQuery ? (
            search.loading ? (
              <ResultsSkeleton />
            ) : search.result.isError ? (
              <ErrorState
                error={search.result.error}
                retry={() => void search.result.refetch()}
                title="Search could not be completed"
              />
            ) : data?.matches.length ? (
              data.matches.map((match, index) => (
                <ResultCard
                  key={`${match.patient_id}-${match.record_id || "history"}`}
                  match={match}
                  onOpen={() =>
                    openRecord({
                      patientId: match.patient_id,
                      recordId: match.record_id,
                    })
                  }
                  rank={index + 1}
                  selected={
                    selection?.patientId === match.patient_id &&
                    selection?.recordId === match.record_id
                  }
                />
              ))
            ) : (
              <EmptyResults
                reset={() => search.setFilters({ patientId: context?.id })}
              />
            )
          ) : context ? (
            patient.isPending ? (
              <ResultsSkeleton />
            ) : patient.isError ? (
              <ErrorState
                error={patient.error}
                retry={() => void patient.refetch()}
                title="Patient records could not be loaded"
              />
            ) : (
              recent.map((record) => (
                <article
                  className={`result-row ${selection?.recordId === record.id ? "selected" : ""}`}
                  key={record.id}
                >
                  <button
                    aria-label={`Open record: ${record.title}; ${context.name}; MRN ${context.mrn}`}
                    aria-pressed={selection?.recordId === record.id}
                    className="result-select context-document-row"
                    onClick={() =>
                      openRecord({ patientId: context.id, recordId: record.id })
                    }
                    type="button"
                  >
                    <h3 className="result-title">{record.title}</h3>
                    <div className="record-meta">
                      <ResourceBadge
                        compact
                        type={
                          record.resource_types.includes("DiagnosticReport")
                            ? "DiagnosticReport"
                            : "DocumentReference"
                        }
                      />
                      <span>{formatDate(record.record_date)}</span>
                    </div>
                  </button>
                </article>
              ))
            )
          ) : (
            <div className="empty-results">
              <SearchOutlined aria-hidden="true" />
              <h2>Search to find records</h2>
            </div>
          )}
        </div>
        <div className="results-status">
          <span>
            {hasQuery
              ? `${data?.matches.length || 0} matches`
              : context
                ? `${recent.length} patient documents`
                : "Across all patients"}
          </span>
        </div>
      </section>
      <section
        aria-label="Selected record"
        className="reader-pane desktop-reader"
      >
        {selection ? (
          <PatientReview
            key={`${selection.patientId}-${selection.recordId}`}
            onExpand={() => setExpanded(true)}
            selection={selection}
          />
        ) : (
          <div className="reader-empty">
            <FileSearchOutlined aria-hidden="true" />
            <h2>
              {context ? "Loading patient chart" : "Select a record to review"}
            </h2>
          </div>
        )}
      </section>
      <PatientDrawer
        onAfterClose={() => {
          if (!screens.lg)
            (
              list.current?.querySelector<HTMLButtonElement>(
                ".selected .result-select",
              ) ||
              list.current?.querySelector<HTMLButtonElement>(".result-select")
            )?.focus();
        }}
        onClose={() => {
          setExpanded(false);
          setMobileOpen(false);
        }}
        selection={
          selection && (screens.lg ? expanded : mobileOpen) ? selection : null
        }
      />
    </div>
  );
}

export function RecordWorkspace({
  context,
  onPatients,
  onAllRecords,
  initialRecordId,
  showSummary,
}: {
  context: Patient | null;
  onPatients: () => void;
  onAllRecords: () => void;
  initialRecordId?: string;
  showSummary?: boolean;
}) {
  const search = useRecordSearch(context?.id);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const input = useRef<InputRef>(null);
  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      const target = event.target;
      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !document.querySelector('[role="dialog"][aria-modal="true"]') &&
        !(
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        )
      ) {
        event.preventDefault();
        input.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const activeFilters = [
    search.filters.resourceType,
    search.filters.dateFrom,
  ].filter(Boolean).length;
  const hasQuery = !!search.draft.trim();
  function submit(event: FormEvent) {
    event.preventDefault();
    search.submit();
  }
  return (
    <div className="record-workspace">
      <div className="record-toolbar">
        <div className="workspace-title">
          <div>
            {context && (
              <Button
                aria-label="Back to patients"
                className="back-to-patients"
                icon={<ArrowLeftOutlined aria-hidden="true" />}
                onClick={onPatients}
                type="text"
              />
            )}
            <h1>{context ? "Patient chart" : "Record search"}</h1>
            <span className="search-scope">
              {context ? `MRN ${context.mrn}` : "Across all patients"}
            </span>
          </div>
        </div>
        <section
          aria-label="Search and filters"
          className={`search-toolbar ${filtersOpen ? "filters-open" : ""}`}
        >
          <form className="search-form" onSubmit={submit} role="search">
            <Input
              allowClear
              aria-label="Search patient records"
              autoComplete="off"
              className="clinical-search"
              maxLength={1000}
              onChange={(event) => search.setDraft(event.target.value)}
              onCompositionEnd={() => search.setComposing(false)}
              onCompositionStart={() => search.setComposing(true)}
              placeholder={
                context
                  ? "Search within this patient's records"
                  : "Search clinical findings across all patient records"
              }
              prefix={<SearchOutlined aria-hidden="true" />}
              ref={input}
              suffix={<kbd aria-hidden="true">/</kbd>}
              value={search.draft}
            />
            <Button
              aria-label="Search records"
              className="search-submit"
              disabled={!hasQuery}
              htmlType="submit"
              loading={search.loading}
              type="primary"
            >
              Search
            </Button>
            {context && (
              <Button
                aria-label="Search all patients"
                title="Search all patients"
                icon={<GlobalOutlined aria-hidden="true" />}
                onClick={onAllRecords}
              />
            )}
            <Button
              aria-controls="search-filter-controls"
              aria-expanded={filtersOpen}
              aria-label="Toggle search filters"
              className="filter-toggle"
              icon={<FilterOutlined aria-hidden="true" />}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Filters{activeFilters ? ` (${activeFilters})` : ""}
            </Button>
          </form>
          <div
            className="filter-toolbar"
            id="search-filter-controls"
            hidden={!filtersOpen}
          >
            <div className="filter-field">
              <label htmlFor="resource-type">Resource type</label>
              <Select<ResourceType | "all">
                aria-label="Record type"
                id="resource-type"
                onChange={(value) =>
                  search.setFilters((old) => ({
                    ...old,
                    resourceType: value === "all" ? undefined : value,
                  }))
                }
                options={[
                  { value: "all", label: "All record types" },
                  { value: "DiagnosticReport", label: "Diagnostic reports" },
                  { value: "DocumentReference", label: "Documents" },
                  { value: "Patient", label: "Patient histories" },
                ]}
                value={search.filters.resourceType || "all"}
              />
            </div>
            <div className="filter-field date-filter">
              <label htmlFor="record-date-from">Record dates</label>
              <label className="sr-only" htmlFor="record-date-to">
                Record end date
              </label>
              <DatePicker.RangePicker
                allowClear
                format="DD MMM YYYY"
                id={{ start: "record-date-from", end: "record-date-to" }}
                onChange={(dates) =>
                  search.setFilters((old) => ({
                    ...old,
                    dateFrom: dates?.[0]?.format("YYYY-MM-DD"),
                    dateTo: dates?.[1]?.format("YYYY-MM-DD"),
                  }))
                }
                placeholder={["From date", "To date"]}
                value={
                  search.filters.dateFrom && search.filters.dateTo
                    ? [
                        dayjs(search.filters.dateFrom),
                        dayjs(search.filters.dateTo),
                      ]
                    : null
                }
              />
            </div>
            {activeFilters > 0 && (
              <Button
                className="clear-filters"
                onClick={() => search.setFilters({ patientId: context?.id })}
                type="link"
              >
                Clear filters
              </Button>
            )}
            <span
              aria-atomic="true"
              aria-live="polite"
              className="search-status"
              role="status"
            >
              {search.loading
                ? "Searching records..."
                : hasQuery && search.result.data && !search.result.isError
                  ? `${search.result.data.matches.length} matches`
                  : context
                    ? "Selected patient only"
                    : ""}
            </span>
          </div>
          {!hasQuery && !context && (
            <div className="search-examples">
              {suggestions.map((suggestion) => (
                <Button
                  aria-label={suggestion}
                  key={suggestion}
                  onClick={() => search.submit(suggestion)}
                  size="small"
                  type="link"
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          )}
        </section>
      </div>
      <ReviewWorkspace
        context={context}
        search={search}
        initialRecordId={initialRecordId}
        showSummary={showSummary}
      />
    </div>
  );
}
