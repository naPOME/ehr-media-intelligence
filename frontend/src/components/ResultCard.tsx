import { FileTextOutlined, UserOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import type { SearchMatch } from "../lib/api";
import { formatDate, formatSimilarity } from "../lib/format";
import { ResourceBadge } from "./ResourceBadge";

export function ResultCard({
  match,
  rank,
  selected,
  onOpen,
}: {
  match: SearchMatch;
  rank: number;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <article className={`result-row ${selected ? "selected" : ""}`}>
      <button
        aria-label={`Open record: ${match.title}; ${match.patient_name}; MRN ${match.mrn}`}
        aria-pressed={selected}
        className="result-select"
        onClick={onOpen}
        type="button"
      >
        <div className="result-patient">
          <span className="patient-name">{match.patient_name}</span>
          <span className="result-rank">{rank}</span>
        </div>
        <div className="result-identifiers">
          MRN <strong>{match.mrn}</strong>
        </div>
        <h3 className="result-title">{match.title}</h3>
        <div className="record-meta">
          <ResourceBadge compact type={match.resource_type} />
          <span>{formatDate(match.record_date)}</span>
        </div>
        <p className="record-excerpt">{match.excerpt}</p>
        {match.summary_snippet && (
          <p className="result-summary">
            <span>AI patient summary:</span> {match.summary_snippet}
          </p>
        )}
        <div className="result-bottom">
          <span>
            {match.match_source === "summary" ? (
              <>
                <UserOutlined aria-hidden="true" />
                Patient summary match
              </>
            ) : (
              <>
                <FileTextOutlined aria-hidden="true" />
                Source record
              </>
            )}
          </span>
          <Tooltip title="Cosine similarity from -1 to 1. Relevance, not clinical confidence.">
            <span className="similarity-score">
              Similarity {formatSimilarity(match.relevance_score)}
            </span>
          </Tooltip>
        </div>
      </button>
    </article>
  );
}
