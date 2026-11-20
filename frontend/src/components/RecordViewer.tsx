import { useQuery } from "@tanstack/react-query";
import { Collapse, Descriptions, Skeleton, Table, Tag } from "antd";
import { ApiError, getRecord } from "../lib/api";
import { formatDate } from "../lib/format";
import { ErrorState } from "./Feedback";

export function RecordViewer({
  recordId,
  patientId,
}: {
  recordId: string;
  patientId: string;
}) {
  const detail = useQuery({
    queryKey: ["record", recordId],
    queryFn: ({ signal }) => getRecord(recordId, signal),
  });
  if (detail.isPending)
    return (
      <div
        aria-label="Loading source record"
        aria-busy="true"
        className="record-viewer"
      >
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  if (detail.isError || detail.data.record.patient.id !== patientId)
    return (
      <ErrorState
        error={detail.error || new ApiError(404)}
        retry={() => void detail.refetch()}
        title="Record could not be opened"
      />
    );
  const { record } = detail.data;
  const kind = {
    note: "Clinical note",
    discharge: "Discharge summary",
    lab: "Laboratory report",
    imaging: "Imaging report",
  }[record.kind];
  return (
    <section aria-label="Source record content" className="record-viewer">
      <div className="document-heading">
        <span className="document-kind">{kind}</span>
        <span className="document-date">{formatDate(record.record_date)}</span>
        <h3>{record.title}</h3>
      </div>
      {!!record.labs?.length && (
        <section aria-label="Reported lab values" className="lab-results">
          <h4>Reported results</h4>
          <div
            aria-label="Laboratory results table"
            className="lab-table-scroll"
            role="region"
            tabIndex={0}
          >
            <Table
              columns={[
                { title: "Test", dataIndex: "name", key: "name" },
                {
                  title: "Result",
                  key: "result",
                  render: (_, lab) => (
                    <strong className="lab-value">{lab.value}</strong>
                  ),
                },
                {
                  title: "Unit",
                  dataIndex: "unit",
                  key: "unit",
                  render: (unit: string | null) => unit || "Not supplied",
                },
                {
                  title: "Reference interval",
                  key: "reference",
                  render: (_, lab) =>
                    lab.reference_low != null && lab.reference_high != null
                      ? `${lab.reference_low} - ${lab.reference_high}`
                      : lab.reference_low != null
                        ? `>= ${lab.reference_low}`
                        : lab.reference_high != null
                          ? `<= ${lab.reference_high}`
                          : "Not supplied",
                },
                {
                  title: "Source flag",
                  dataIndex: "flag",
                  key: "flag",
                  render: (flag: string) => (
                    <Tag className={`lab-flag flag-${flag}`}>
                      {flag === "unknown" ? "Not supplied" : flag}
                    </Tag>
                  ),
                },
              ]}
              dataSource={record.labs.map((lab, index) => ({
                ...lab,
                key: index,
              }))}
              pagination={false}
              size="small"
            />
          </div>
        </section>
      )}
      <div className="document-section-label">Report text</div>
      <div className="source-text">{record.text}</div>
      <Collapse
        className="record-data-panels"
        items={[
          {
            key: "provenance",
            label: "Source details",
            children: (
              <Descriptions
                column={1}
                items={[
                  {
                    key: "source",
                    label: "Source file",
                    children: record.source_file,
                  },
                  {
                    key: "identifier",
                    label: "Source record ID",
                    children: (
                      <span className="break-anywhere">
                        {record.external_id}
                      </span>
                    ),
                  },
                ]}
                size="small"
              />
            ),
          },
        ]}
      />
    </section>
  );
}
