import { useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Skeleton, Tabs, Tooltip } from "antd";
import {
  DownloadOutlined,
  ExpandOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { ApiError, getBundle, getPatient } from "../lib/api";
import { downloadJson, formatDate } from "../lib/format";
import { ErrorState } from "./Feedback";
import { SummaryPanel } from "./SummaryPanel";
import { RecordViewer } from "./RecordViewer";
import { TimelinePanel } from "./TimelinePanel";

function ChartScroll({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div aria-label={label} className="chart-scroll" role="region" tabIndex={0}>
      {children}
    </div>
  );
}

export type Selection = { patientId: string; recordId: string | null };

export function PatientReview({
  selection,
  onExpand,
}: {
  selection: Selection;
  onExpand?: () => void;
}) {
  const [tab, setTab] = useState(selection.recordId ? "document" : "summary");
  const [activeRecord, setActiveRecord] = useState<string | null>(
    selection.recordId,
  );
  const detail = useQuery({
    queryKey: ["patient", selection.patientId],
    queryFn: ({ signal }) => getPatient(selection.patientId, signal),
  });
  const cache = useQueryClient();
  const { message } = App.useApp();
  const download = useMutation({
    mutationFn: async (patientId: string) => {
      const bundle = await cache.fetchQuery({
        queryKey: ["bundle", patientId],
        queryFn: ({ signal }) => getBundle(patientId, signal),
        staleTime: 0,
      });
      downloadJson(bundle, `patient-${patientId}.fhir.json`);
    },
    onError: () => {
      void message.error(
        "The patient bundle could not be downloaded. Please try again.",
      );
    },
  });
  if (detail.isPending)
    return (
      <div
        aria-label="Loading patient"
        aria-busy="true"
        className="patient-loading"
      >
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  if (detail.isError || detail.data.patient.id !== selection.patientId)
    return (
      <ErrorState
        error={detail.error || new ApiError(404)}
        retry={() => void detail.refetch()}
        title="Patient could not be opened"
      />
    );
  const { patient, summary, records } = detail.data;
  function openSource(id: string) {
    if (records.some((record) => record.id === id)) {
      setActiveRecord(id);
      setTab("document");
    }
  }
  const selectedRecord = records.find((record) => record.id === activeRecord);
  return (
    <section aria-label="Patient record review" className="patient-review">
      <section aria-label="Patient demographics" className="patient-context">
        <div className="patient-context-main">
          <h2>{patient.name}</h2>
          <dl className="patient-identifiers">
            <div>
              <dt>DOB</dt>
              <dd>{patient.dob ? formatDate(patient.dob) : "Not recorded"}</dd>
            </div>
            <div>
              <dt>MRN</dt>
              <dd>{patient.mrn}</dd>
            </div>
            <div>
              <dt>Gender</dt>
              <dd>
                {patient.gender === "unknown" ? "Not recorded" : patient.gender}
              </dd>
            </div>
          </dl>
        </div>
        <div className="patient-actions">
          <Tooltip title="Download patient FHIR Bundle">
            <Button
              aria-label="Download patient FHIR Bundle"
              icon={<DownloadOutlined aria-hidden="true" />}
              loading={download.isPending}
              onClick={() => download.mutate(patient.id)}
              size="small"
              type="text"
            />
          </Tooltip>
          {onExpand && (
            <Tooltip title="Open patient chart">
              <Button
                aria-label="Open patient chart"
                icon={<ExpandOutlined aria-hidden="true" />}
                onClick={onExpand}
                size="small"
                type="text"
              />
            </Tooltip>
          )}
        </div>
      </section>
      <Tabs
        activeKey={tab}
        className="review-tabs"
        items={[
          {
            key: "document",
            label: "Source record",
            children: selectedRecord ? (
              <RecordViewer
                key={selectedRecord.id}
                patientId={patient.id}
                recordId={selectedRecord.id}
              />
            ) : (
              <div className="reader-empty">
                <FileTextOutlined aria-hidden="true" />
                <h3>No source record selected</h3>
                <p>Select a document from this patient's records.</p>
                <Button onClick={() => setTab("records")}>
                  View patient records
                </Button>
              </div>
            ),
          },
          {
            key: "summary",
            label: "Patient summary",
            children: (
              <SummaryPanel
                onSource={openSource}
                patientId={patient.id}
                records={records}
                summary={summary}
              />
            ),
          },
          {
            key: "timeline",
            label: "Timeline",
            children: (
              <TimelinePanel patientId={patient.id} onSource={openSource} />
            ),
          },
          {
            key: "records",
            label: `All records (${records.length})`,
            children: (
              <div className="patient-records">
                <div className="records-intro">
                  <h3>Patient documents</h3>
                  <span>Newest first</span>
                </div>
                {records.length ? (
                  <div
                    aria-label="Patient source records"
                    className="patient-record-list"
                  >
                    {records.map((record) => (
                      <Button
                        aria-label={`View source: ${record.title}`}
                        aria-pressed={activeRecord === record.id}
                        className={`patient-record-row ${activeRecord === record.id ? "selected" : ""}`}
                        key={record.id}
                        onClick={() => openSource(record.id)}
                        type="text"
                      >
                        <FileTextOutlined aria-hidden="true" />
                        <span className="source-record-label">
                          <strong>{record.title}</strong>
                          <span>{formatDate(record.record_date)}</span>
                        </span>
                        <span className="source-record-action">Open</span>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p>No source records available.</p>
                )}
              </div>
            ),
          },
        ].map((item) => ({
          ...item,
          children: (
            <ChartScroll
              key={item.key}
              label={
                item.key === "document"
                  ? "Document scroll area"
                  : item.key === "summary"
                    ? "Summary scroll area"
                    : item.key === "timeline"
                      ? "Patient timeline scroll area"
                      : "Patient records scroll area"
              }
            >
              {item.children}
            </ChartScroll>
          ),
        }))}
        onChange={setTab}
      />
    </section>
  );
}
