import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Space, Tag, Tooltip } from "antd";
import {
  FileSearchOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import type { ClinicalSummary, PatientDetail, SummaryItem } from "../lib/api";
import { errorMessage, generatePatientSummary, getHealth } from "../lib/api";
import { formatDate } from "../lib/format";

type Props = {
  patientId: string;
  summary: PatientDetail["summary"];
  records: PatientDetail["records"];
  onSource: (id: string) => void;
};

export function SummaryPanel({ patientId, summary, records, onSource }: Props) {
  const [generationError, setGenerationError] = useState<string | null>(null);
  const cache = useQueryClient();
  const { message } = App.useApp();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => getHealth(signal),
    staleTime: 30_000,
  });
  const generate = useMutation({
    mutationFn: () => generatePatientSummary(patientId),
    onMutate: () => setGenerationError(null),
    onSuccess: (result) => {
      cache.setQueryData<PatientDetail>(["patient", patientId], (current) =>
        current ? { ...current, summary: result.summary } : current,
      );
      void cache.invalidateQueries({ queryKey: ["overview"] });
      void cache.invalidateQueries({ queryKey: ["patients"] });
      if (result.search_index_status === "failed") {
        void message.warning(
          "The summary is ready, but semantic search could not be refreshed.",
        );
      } else {
        void message.success(
          result.status === "cached"
            ? "The AI summary is already up to date."
            : "AI summary generated and checked against its source links.",
        );
      }
    },
    onError: (error) => setGenerationError(errorMessage(error)),
  });
  const providerName = health.data?.provider
    ? health.data.provider === "gemini"
      ? "Gemini"
      : "OpenAI"
    : "AI";
  const providerUnavailable =
    health.isSuccess && health.data.summaryReady === false;
  if (summary.status !== "ready" || !summary.data) {
    const messages = {
      unavailable: [
        "Create a patient summary",
        "Summarize this patient's notes, lab results, and imaging reports in one place.",
      ],
      stale: [
        "New records need a fresh summary",
        "Update the summary to include the latest patient records.",
      ],
      failed: [
        "Summary couldn't be created",
        "The last attempt failed. Try again to summarize this patient's records.",
      ],
      ready: [
        "Create a patient summary",
        "Summarize this patient's notes, lab results, and imaging reports in one place.",
      ],
    };
    const [title, description] = messages[summary.status];
    return (
      <div className="summary-unavailable">
        <div className="summary-empty-card">
          <span className="unavailable-icon">
            <RobotOutlined aria-hidden="true" />
          </span>
          <div>
            <h3>{generate.isPending ? "Creating summary…" : title}</h3>
            <p role="status" aria-live="polite">
              {generate.isPending
                ? "Reviewing the patient records. This may take a moment."
                : description}
            </p>
          </div>
        </div>
        {providerUnavailable && (
          <Alert
            description="Ask your workspace administrator to enable AI summaries."
            showIcon
            title={`${providerName} is not configured`}
            type="info"
          />
        )}
        {generationError && (
          <Alert
            closable
            description={generationError}
            onClose={() => setGenerationError(null)}
            showIcon
            title="Summary generation did not complete"
            type="error"
          />
        )}
        <Space wrap>
          <Tooltip
            title={
              providerUnavailable
                ? `Configure the ${providerName} API key to enable summaries`
                : undefined
            }
          >
            <Button
              disabled={!records.length || providerUnavailable}
              icon={<RobotOutlined aria-hidden="true" />}
              loading={generate.isPending}
              onClick={() => generate.mutate()}
              type="primary"
            >
              {summary.status === "stale"
                ? "Update summary"
                : summary.status === "failed"
                  ? "Try again"
                  : "Generate summary"}
            </Button>
          </Tooltip>
          <Button
            disabled={!records.length}
            icon={<FileSearchOutlined aria-hidden="true" />}
            onClick={() => records[0] && onSource(records[0].id)}
          >
            View records
          </Button>
        </Space>
        <p className="summary-safety-copy">
          Each finding links to the patient records it came from.
        </p>
      </div>
    );
  }
  const data: ClinicalSummary = summary.data;
  function item(value: SummaryItem, key: string) {
    return (
      <div className="summary-item" key={key}>
        <p>{value.text}</p>
        <div className="source-citations">
          {value.source_record_ids.map((id) => (
            <Button
              aria-label={`View source: ${records.find((record) => record.id === id)?.title || "record"}`}
              icon={<FileSearchOutlined />}
              key={id}
              title={
                records.find((record) => record.id === id)?.title ||
                "View record"
              }
              onClick={() => onSource(id)}
              size="small"
              type="link"
            >
              {records.find((record) => record.id === id)?.title ||
                "View record"}
            </Button>
          ))}
        </div>
      </div>
    );
  }
  const sections = [
    { label: "Chief concern", items: [data.chief_concern] },
    { label: "Key diagnoses", items: data.key_diagnoses },
    { label: "Recent labs & imaging", items: data.recent_media_records },
    { label: "Flagged findings", items: data.flagged_anomalies },
  ];
  return (
    <div className="clinical-summary">
      <div className="summary-heading">
        <h3 className="summary-title">Patient summary</h3>
        <div className="summary-heading-meta">
          <Tag className="ai-tag" icon={<RobotOutlined />}>
            AI-generated
          </Tag>
          <span>
            {summary.generated_at
              ? `Generated ${formatDate(summary.generated_at)}`
              : "Patient history"}
          </span>
        </div>
        <Tooltip
          title={
            providerUnavailable
              ? `Configure the ${providerName} API key to check for updates`
              : "Checks whether new patient records need to be included"
          }
        >
          <Button
            disabled={providerUnavailable}
            icon={<ReloadOutlined />}
            loading={generate.isPending}
            onClick={() => generate.mutate()}
            size="small"
          >
            Check for updates
          </Button>
        </Tooltip>
      </div>
      {generationError && (
        <Alert
          closable
          description={generationError}
          onClose={() => setGenerationError(null)}
          showIcon
          title="Summary update did not complete"
          type="error"
        />
      )}
      <div className="summary-sections">
        {sections.map((section, sectionIndex) => (
          <section
            className={`summary-section summary-section-${sectionIndex}`}
            key={section.label}
          >
            <h3>{section.label}</h3>
            {section.items.length ? (
              section.items.map((value, index) =>
                item(value, `${section.label}-${index}`),
              )
            ) : (
              <p className="muted">Not documented.</p>
            )}
          </section>
        ))}
      </div>
      {data.limitations && (
        <div className="summary-limitations">
          <strong>History limitations</strong>
          <p>{data.limitations}</p>
        </div>
      )}
      <Alert
        icon={<SafetyCertificateOutlined />}
        showIcon
        title={data.disclaimer}
        type="info"
      />
    </div>
  );
}
