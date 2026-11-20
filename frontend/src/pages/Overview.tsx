import { useQuery } from "@tanstack/react-query";
import { Avatar, Button, Empty, Skeleton, Tag } from "antd";
import {
  ArrowRightOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  ScanOutlined,
  SearchOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import { getOverview } from "../lib/api";
import { formatDate, initials } from "../lib/format";
import { ErrorState } from "../components/Feedback";

export function Overview() {
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: ({ signal }) => getOverview(signal),
  });
  if (overview.isPending)
    return (
      <div className="overview-page">
        <h1>Overview</h1>
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    );
  if (overview.isError)
    return (
      <ErrorState
        title="Overview could not be loaded"
        error={overview.error}
        retry={() => void overview.refetch()}
      />
    );
  const { metrics, recent_patients: patients, summaries } = overview.data;
  const stats = [
    { label: "Patients", value: metrics.patients, icon: <TeamOutlined /> },
    { label: "Documents", value: metrics.records, icon: <FileTextOutlined /> },
    {
      label: "Lab reports",
      value: metrics.lab_reports,
      icon: <ExperimentOutlined />,
    },
    {
      label: "Imaging reports",
      value: metrics.imaging_reports,
      icon: <ScanOutlined />,
    },
  ];
  return (
    <section className="overview-page" aria-label="Clinical overview">
      <div className="page-heading">
        <h1>Overview</h1>
        <Link className="ant-btn ant-btn-primary page-action" to="/records">
          <SearchOutlined aria-hidden="true" /> Search records
        </Link>
      </div>
      <div
        className="overview-metrics"
        role="region"
        aria-label="Record library overview"
      >
        {stats.map((stat, index) => (
          <div className={`metric-card metric-${index}`} key={stat.label}>
            <div>
              <span>{stat.label}</span>
              <strong>{stat.value.toLocaleString()}</strong>
            </div>
            <span className="metric-icon" aria-hidden="true">
              {stat.icon}
            </span>
          </div>
        ))}
      </div>
      <div className="overview-grid">
        <section
          className="overview-panel recent-patients"
          aria-label="Recent patient records"
        >
          <div className="panel-heading">
            <h2>Recent patient records</h2>
            <Link to="/patients">
              View all <ArrowRightOutlined aria-hidden="true" />
            </Link>
          </div>
          <div className="recent-patient-list">
            {patients.length ? (
              patients.map((item) => (
                <Link
                  className="recent-patient-row"
                  key={item.patient.id}
                  to={`/patients/${item.patient.id}${item.latest_record_id ? `?record=${encodeURIComponent(item.latest_record_id)}` : ""}`}
                >
                  <Avatar className="patient-avatar" size={42}>
                    {initials(item.patient.name)}
                  </Avatar>
                  <div className="recent-patient-name">
                    <strong>{item.patient.name}</strong>
                    <span>{item.patient.mrn}</span>
                  </div>
                  <div className="recent-record-title">
                    <span>{item.latest_record_title || "No documents"}</span>
                    <time>{formatDate(item.latest_record_date)}</time>
                  </div>
                  <ArrowRightOutlined
                    aria-hidden="true"
                    className="row-arrow"
                  />
                </Link>
              ))
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No patient records"
              />
            )}
          </div>
        </section>
        <section
          className="overview-panel overview-summaries"
          aria-label="Patient summaries"
        >
          <div className="panel-heading">
            <h2>Patient summaries</h2>
            <Tag>{metrics.summaries_ready}</Tag>
          </div>
          <div className="overview-summary-list">
            {summaries.length ? (
              summaries.map(({ patient, summary }) => (
                <Link
                  key={patient.id}
                  className="overview-summary-card"
                  to={`/patients/${patient.id}?tab=summary`}
                >
                  <div className="summary-patient">
                    <Avatar className="patient-avatar" size={36}>
                      {initials(patient.name)}
                    </Avatar>
                    <strong>{patient.name}</strong>
                    <ArrowRightOutlined aria-hidden="true" />
                  </div>
                  <p>{summary.data?.chief_concern.text}</p>
                  <span className="summary-date">
                    {summary.generated_at
                      ? formatDate(summary.generated_at)
                      : ""}
                    <Tag>AI summary</Tag>
                  </span>
                </Link>
              ))
            ) : (
              <div className="overview-empty">
                <FileTextOutlined aria-hidden="true" />
                <p>No summaries available</p>
                <Button href="/patients">View patients</Button>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
