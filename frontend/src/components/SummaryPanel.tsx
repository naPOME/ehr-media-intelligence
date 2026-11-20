import { Alert, Button, Tag } from "antd";
import {
  FileSearchOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import type { ClinicalSummary, PatientDetail, SummaryItem } from "../lib/api";
import { formatDate } from "../lib/format";

type Props = {
  summary: PatientDetail["summary"];
  records: PatientDetail["records"];
  onSource: (id: string) => void;
};

export function SummaryPanel({ summary, records, onSource }: Props) {
  if (summary.status !== "ready" || !summary.data) {
    const messages = {
      unavailable: [
        "AI summary not available",
        "You can still review this patient's source records. A summary will appear here once it has been generated.",
      ],
      stale: [
        "The patient history has changed",
        "The previous summary is out of date. Review the sources; an updated summary is required before it can be shown.",
      ],
      failed: [
        "The summary could not be generated",
        "The source records are available. A new summary will need to be generated before it can be shown.",
      ],
      ready: [
        "AI summary not available",
        "Review the source records for this patient.",
      ],
    };
    const [title] = messages[summary.status];
    return (
      <div className="summary-unavailable">
        <span className="unavailable-icon">
          <FileSearchOutlined />
        </span>
        <h3>{title}</h3>

        <Button
          disabled={!records.length}
          onClick={() => records[0] && onSource(records[0].id)}
        >
          Review source records
        </Button>
      </div>
    );
  }
  const data: ClinicalSummary = summary.data;
  function item(value: SummaryItem, key: string) {
    return (
      <div className="summary-item" key={key}>
        <p>{value.text}</p>
        <div className="source-citations">
          {value.source_record_ids.map((id, index) => (
            <Button
              aria-label={`View source: ${records.find((record) => record.id === id)?.title || "record"}`}
              icon={<FileSearchOutlined />}
              key={id}
              onClick={() => onSource(id)}
              size="small"
              type="link"
            >
              Source {index + 1}
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
        <Tag className="ai-tag">AI-generated</Tag>
        <span>
          {summary.generated_at
            ? `Generated ${formatDate(summary.generated_at)}`
            : "Patient history"}
        </span>
      </div>
      {sections.map((section) => (
        <section className="summary-section" key={section.label}>
          <h3>{section.label}</h3>
          {section.items.length ? (
            section.items.map((value, index) =>
              item(value, `${section.label}-${index}`),
            )
          ) : (
            <p className="muted">Not documented in the supplied history.</p>
          )}
        </section>
      ))}
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
