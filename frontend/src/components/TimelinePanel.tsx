import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Segmented,
  Skeleton,
  Switch,
  Tag,
} from "antd";
import {
  CalendarOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  LineChartOutlined,
  RightOutlined,
} from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { getPatientTimeline } from "../lib/api";
import type { PatientTimeline } from "../lib/api";
import { formatDate } from "../lib/format";

type TimelineRecord = PatientTimeline["encounters"][number]["records"][number];
type LabTrend = PatientTimeline["trends"][number];

const kindLabels: Record<string, string> = {
  all: "All records",
  note: "Clinical notes",
  lab: "Labs",
  imaging: "Imaging",
  discharge: "Discharge",
};

function TrendChart({ trend }: { trend: LabTrend }) {
  const width = 360;
  const height = 100;
  const padding = 12;
  const values = trend.points.flatMap((point) => [
    point.value,
    ...(point.reference_low == null ? [] : [point.reference_low]),
    ...(point.reference_high == null ? [] : [point.reference_high]),
  ]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const y = (value: number) =>
    height - padding - ((value - min) / range) * (height - padding * 2);
  const x = (index: number) =>
    padding +
    (index / Math.max(trend.points.length - 1, 1)) * (width - padding * 2);
  const points = trend.points
    .map((point, index) => `${x(index)},${y(point.value)}`)
    .join(" ");
  const low = trend.points.at(-1)?.reference_low;
  const high = trend.points.at(-1)?.reference_high;
  return (
    <svg
      aria-label={`${trend.analyte} trend, ${trend.points.length} results`}
      className="trend-chart"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <title>{`${trend.analyte}: ${trend.points.map((point) => `${point.value} on ${formatDate(point.record_date)}`).join(", ")}`}</title>
      {low != null && high != null && (
        <rect
          className="trend-reference"
          height={Math.abs(y(low) - y(high))}
          width={width}
          x={0}
          y={Math.min(y(low), y(high))}
        />
      )}
      <polyline className="trend-line" fill="none" points={points} />
      {trend.points.map((point, index) => (
        <circle
          className={
            point.flag === "normal" ? "trend-dot" : "trend-dot abnormal"
          }
          cx={x(index)}
          cy={y(point.value)}
          key={`${point.record_id}-${point.record_date}`}
          r={5}
        />
      ))}
    </svg>
  );
}

function ResultTag({ flag }: { flag: string }) {
  return (
    <Tag color={flag === "high" ? "orange" : flag === "low" ? "blue" : "green"}>
      {flag === "normal" ? "In range" : flag}
    </Tag>
  );
}

export function TimelinePanel({
  patientId,
  onSource,
}: {
  patientId: string;
  onSource: (id: string) => void;
}) {
  const [kind, setKind] = useState("all");
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const timeline = useQuery({
    queryKey: ["patient-timeline", patientId],
    queryFn: ({ signal }) => getPatientTimeline(patientId, signal),
  });
  const encounters = useMemo(() => {
    if (!timeline.data) return [];
    return timeline.data.encounters
      .map((encounter) => ({
        ...encounter,
        records: encounter.records.filter((record: TimelineRecord) => {
          if (kind !== "all" && record.kind !== kind) return false;
          if (
            abnormalOnly &&
            !record.labs.some((lab) => ["high", "low"].includes(lab.flag))
          )
            return false;
          if (
            range?.[0] &&
            (!record.record_date ||
              record.record_date < range[0].format("YYYY-MM-DD"))
          )
            return false;
          if (
            range?.[1] &&
            (!record.record_date ||
              record.record_date > range[1].format("YYYY-MM-DD"))
          )
            return false;
          return true;
        }),
      }))
      .filter((encounter) => encounter.records.length);
  }, [abnormalOnly, kind, range, timeline.data]);
  if (timeline.isPending) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (timeline.isError)
    return (
      <Alert
        action={<Button onClick={() => void timeline.refetch()}>Retry</Button>}
        description="The patient's longitudinal history could not be loaded."
        showIcon
        title="Timeline unavailable"
        type="error"
      />
    );
  const data = timeline.data;
  return (
    <div className="timeline-panel">
      <div className="timeline-metrics" aria-label="Patient timeline summary">
        <div>
          <CalendarOutlined />
          <span>
            <strong>{data.counts.encounters}</strong>Encounters
          </span>
        </div>
        <div>
          <FileTextOutlined />
          <span>
            <strong>{data.counts.records}</strong>Records
          </span>
        </div>
        <div>
          <ExperimentOutlined />
          <span>
            <strong>{data.counts.abnormal_results}</strong>Abnormal results
          </span>
        </div>
        <div>
          <LineChartOutlined />
          <span>
            <strong>{data.counts.trends}</strong>Lab trends
          </span>
        </div>
      </div>
      {data.trends.length > 0 && (
        <section aria-labelledby="lab-trends-title" className="trend-section">
          <div className="timeline-section-heading">
            <h3 id="lab-trends-title">Lab trends</h3>
            <span>Reference range shaded</span>
          </div>
          <div className="trend-grid">
            {data.trends.map((trend) => {
              const latest = trend.points.at(-1)!;
              return (
                <article
                  className="trend-card"
                  key={`${trend.analyte}-${trend.unit}`}
                >
                  <div className="trend-card-header">
                    <div>
                      <span>{trend.analyte}</span>
                      <strong>
                        {latest.value} {trend.unit}
                      </strong>
                    </div>
                    <ResultTag flag={latest.flag} />
                  </div>
                  <TrendChart trend={trend} />
                  <div className="trend-axis">
                    <span>{formatDate(trend.points[0].record_date)}</span>
                    <span>{formatDate(latest.record_date)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <section aria-labelledby="encounters-title" className="encounter-section">
        <div className="timeline-section-heading">
          <h3 id="encounters-title">Clinical history</h3>
          <span>
            {encounters.reduce(
              (count, encounter) => count + encounter.records.length,
              0,
            )}{" "}
            records
          </span>
        </div>
        <div className="timeline-filters" aria-label="Timeline filters">
          <Segmented
            aria-label="Record type"
            onChange={(value) => setKind(String(value))}
            options={Object.entries(kindLabels).map(([value, label]) => ({
              value,
              label,
            }))}
            value={kind}
          />
          <DatePicker.RangePicker
            aria-label="Record date range"
            allowClear
            onChange={(value) => setRange(value)}
            value={range}
          />
          <label className="abnormal-switch">
            <Switch
              checked={abnormalOnly}
              onChange={setAbnormalOnly}
              size="small"
            />
            Abnormal only
          </label>
        </div>
        {encounters.length ? (
          <div className="encounter-list">
            {encounters.map((encounter) => (
              <article className="encounter-group" key={encounter.id}>
                <div className="encounter-heading">
                  <div>
                    <strong>{formatDate(encounter.start_date)}</strong>
                    <span>
                      {encounter.encounter_class || "Clinical record"}
                    </span>
                  </div>
                  <Tag>
                    {encounter.records.length}{" "}
                    {encounter.records.length === 1 ? "record" : "records"}
                  </Tag>
                </div>
                {encounter.records.map((record) => (
                  <button
                    className="timeline-record"
                    key={record.id}
                    onClick={() => onSource(record.id)}
                    type="button"
                  >
                    <span
                      className={`record-kind kind-${record.kind}`}
                      aria-hidden="true"
                    >
                      <FileTextOutlined />
                    </span>
                    <span className="timeline-record-body">
                      <span>
                        <strong>{record.title}</strong>
                        <Tag bordered={false}>{kindLabels[record.kind]}</Tag>
                      </span>
                      <small>{record.preview}</small>
                      {record.labs.map((lab) => (
                        <span className="inline-lab" key={lab.name}>
                          <b>{lab.name}</b> {lab.value} {lab.unit}{" "}
                          <ResultTag flag={lab.flag} />
                        </span>
                      ))}
                    </span>
                    <RightOutlined aria-hidden="true" />
                  </button>
                ))}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            description="No records match these timeline filters"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </section>
    </div>
  );
}
