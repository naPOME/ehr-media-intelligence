import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Result,
  Space,
  Statistic,
  Steps,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type {
  IntakeItem,
  IntakePreview,
  IntakePublishResult,
} from "../lib/api";
import {
  errorMessage,
  getIntakeDrafts,
  previewIntake,
  publishIntake,
} from "../lib/api";
import { formatDate } from "../lib/format";

const statusConfig = {
  ready: { color: "green", label: "Ready" },
  update: { color: "blue", label: "Update" },
  duplicate: { color: "default", label: "Duplicate" },
  rejected: { color: "red", label: "Needs attention" },
} as const;

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="intake-json">{JSON.stringify(value, null, 2)}</pre>;
}

export function DataIntake() {
  const [preview, setPreview] = useState<IntakePreview | null>(null);
  const [selected, setSelected] = useState<IntakeItem | null>(null);
  const [published, setPublished] = useState<IntakePublishResult | null>(null);
  const { message } = App.useApp();
  const cache = useQueryClient();
  const drafts = useQuery({
    queryKey: ["intake-drafts"],
    queryFn: ({ signal }) => getIntakeDrafts(signal),
  });
  const upload = useMutation({
    mutationFn: async (file: File) =>
      previewIntake(file.name, await file.text()),
    onSuccess: (data) => {
      setPreview(data);
      setPublished(null);
      void cache.invalidateQueries({ queryKey: ["intake-drafts"] });
    },
    onError: (error) => void message.error(errorMessage(error)),
  });
  const publish = useMutation({
    mutationFn: publishIntake,
    onSuccess: (data) => {
      setPublished(data);
      void cache.invalidateQueries();
    },
    onError: (error) => void message.error(errorMessage(error)),
  });
  const columns: ColumnsType<IntakeItem> = [
    {
      title: "Patient",
      dataIndex: "patient_name",
      sorter: (a, b) => a.patient_name.localeCompare(b.patient_name),
      render: (value, row) => (
        <span className="patient-cell">
          <strong>{value}</strong>
          <small>{row.mrn}</small>
        </span>
      ),
    },
    {
      title: "Record",
      dataIndex: "title",
      ellipsis: true,
      render: (value, row) => (
        <span className="patient-cell">
          <strong>{value}</strong>
          <small>{formatDate(row.record_date)}</small>
        </span>
      ),
    },
    {
      title: "Type",
      dataIndex: "kind",
      filters: ["note", "lab", "imaging", "discharge"].map((value) => ({
        text: value,
        value,
      })),
      onFilter: (value, row) => row.kind === value,
      render: (value) => <Tag>{value}</Tag>,
    },
    {
      title: "Cleaning",
      key: "changes",
      sorter: (a, b) => a.changes.length - b.changes.length,
      render: (_, row) =>
        `${row.changes.length} ${row.changes.length === 1 ? "change" : "changes"}`,
    },
    {
      title: "FHIR",
      key: "fhir",
      render: (_, row) => (
        <Tag icon={<SafetyCertificateOutlined />}>
          {row.fhir_resources.length} valid
        </Tag>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      filters: Object.entries(statusConfig).map(([value, item]) => ({
        text: item.label,
        value,
      })),
      onFilter: (value, row) => row.status === value,
      render: (value: IntakeItem["status"]) => (
        <Tag color={statusConfig[value].color}>{statusConfig[value].label}</Tag>
      ),
    },
    {
      title: "",
      key: "view",
      width: 90,
      render: (_, row) => (
        <Button onClick={() => setSelected(row)} size="small" type="link">
          Review
        </Button>
      ),
    },
  ];
  const currentStep = published ? 2 : preview ? 1 : 0;
  return (
    <div className="intake-page">
      <div className="page-heading intake-heading">
        <div>
          <h1>Data intake</h1>
          <p>
            Review source data before it enters the clinical record library.
          </p>
        </div>
        <Steps
          current={currentStep}
          items={[
            { title: "Upload" },
            { title: "Review" },
            { title: "Publish" },
          ]}
          size="small"
        />
      </div>
      {!preview && (
        <div className="intake-start-grid">
          <section
            className="intake-upload-card"
            aria-labelledby="upload-title"
          >
            <Upload.Dragger
              accept=".json,.csv,.txt"
              beforeUpload={(file) => {
                upload.mutate(file);
                return Upload.LIST_IGNORE;
              }}
              disabled={upload.isPending}
              maxCount={1}
              showUploadList={false}
            >
              <CloudUploadOutlined className="upload-icon" />
              <h2 id="upload-title">Drop an EHR export here</h2>
              <p>or choose a JSON, CSV, or plain-text file</p>
              <Button loading={upload.isPending} type="primary">
                Choose file
              </Button>
              <small>
                Maximum file size: 10 MB. No data is published during preview.
              </small>
            </Upload.Dragger>
          </section>
          <aside
            className="intake-process"
            aria-label="Intake validation process"
          >
            <h2>Before records are published</h2>
            <div>
              <FileSearchOutlined />
              <span>
                <strong>Clean and normalize</strong>
                <small>Dates, MRNs, demographics, and required fields</small>
              </span>
            </div>
            <div>
              <DatabaseOutlined />
              <span>
                <strong>Reconcile identities</strong>
                <small>
                  Duplicates, conflicting patients, and existing records
                </small>
              </span>
            </div>
            <div>
              <SafetyCertificateOutlined />
              <span>
                <strong>Validate FHIR R4</strong>
                <small>Resources and patient references are checked</small>
              </span>
            </div>
          </aside>
        </div>
      )}
      {preview && !published && (
        <section className="intake-review" aria-live="polite">
          <div className="intake-review-header">
            <div>
              <Button onClick={() => setPreview(null)} type="link">
                Upload another file
              </Button>
              <h2>{preview.filename}</h2>
              <span>{preview.counts.total} source rows reviewed</span>
            </div>
            <Space>
              <Button onClick={() => setPreview(null)}>Cancel</Button>
              <Button
                disabled={preview.counts.ready + preview.counts.updates === 0}
                icon={<CheckCircleOutlined />}
                loading={publish.isPending}
                onClick={() => publish.mutate(preview.id)}
                type="primary"
              >
                Publish {preview.counts.ready + preview.counts.updates} records
              </Button>
            </Space>
          </div>
          <div className="intake-stats">
            <Statistic title="Ready" value={preview.counts.ready} />
            <Statistic title="Updates" value={preview.counts.updates} />
            <Statistic title="Duplicates" value={preview.counts.duplicates} />
            <Statistic
              className={preview.counts.rejected ? "has-errors" : ""}
              title="Needs attention"
              value={preview.counts.rejected}
            />
          </div>
          {preview.file_issues.length > 0 && (
            <Alert
              description={preview.file_issues.join(" ")}
              showIcon
              title="Input review notes"
              type="warning"
            />
          )}
          <Table
            columns={columns}
            dataSource={preview.items}
            locale={{
              emptyText: <Empty description="No valid records were found" />,
            }}
            pagination={{
              defaultPageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => `${total} records`,
            }}
            rowKey="id"
            scroll={{ x: 980 }}
            size="middle"
          />
        </section>
      )}
      {published && (
        <section className="intake-result">
          <Result
            extra={[
              <Button key="patients" href="/patients" type="primary">
                Open patient directory
              </Button>,
              <Button
                key="again"
                onClick={() => {
                  setPreview(null);
                  setPublished(null);
                }}
              >
                Import another file
              </Button>,
            ]}
            icon={<CheckCircleOutlined />}
            status={published.failed ? "warning" : "success"}
            subTitle={`${published.inserted} inserted, ${published.updated} updated, ${published.unchanged} unchanged.${published.search_index_rebuilt ? " Search is ready with the new records." : ""}`}
            title={
              published.failed
                ? "Published with exceptions"
                : "Records published"
            }
          />
          {published.errors.length > 0 && (
            <Alert
              description={published.errors.join(" ")}
              showIcon
              type="warning"
            />
          )}
        </section>
      )}
      {!preview && (
        <section
          className="recent-intakes"
          aria-labelledby="recent-intakes-title"
        >
          <div className="timeline-section-heading">
            <h2 id="recent-intakes-title">Recent intake activity</h2>
            <Button
              icon={<FileSearchOutlined />}
              onClick={() => void drafts.refetch()}
              size="small"
            >
              Refresh
            </Button>
          </div>
          <Table
            dataSource={drafts.data || []}
            loading={drafts.isPending}
            pagination={false}
            rowKey="id"
            size="small"
            columns={[
              { title: "File", dataIndex: "filename" },
              {
                title: "Created",
                dataIndex: "created_at",
                render: (value) => new Date(value).toLocaleString(),
              },
              { title: "Records", dataIndex: ["counts", "total"] },
              {
                title: "Status",
                dataIndex: "status",
                render: (value) => (
                  <Tag color={value === "review" ? "gold" : "green"}>
                    {value.replaceAll("_", " ")}
                  </Tag>
                ),
              },
            ]}
          />
        </section>
      )}
      <Drawer
        destroyOnHidden
        onClose={() => setSelected(null)}
        open={Boolean(selected)}
        size="large"
        title="Record reconciliation"
      >
        {selected && (
          <div className="intake-detail">
            <Descriptions
              bordered
              column={1}
              size="small"
              items={[
                {
                  key: "patient",
                  label: "Patient",
                  children: `${selected.patient_name} · ${selected.mrn}`,
                },
                { key: "record", label: "Record", children: selected.title },
                {
                  key: "status",
                  label: "Decision",
                  children: (
                    <Tag color={statusConfig[selected.status].color}>
                      {statusConfig[selected.status].label}
                    </Tag>
                  ),
                },
                {
                  key: "fhir",
                  label: "FHIR resources",
                  children: selected.fhir_resources.map((item) => (
                    <Tag key={item}>{item}</Tag>
                  )),
                },
              ]}
            />
            {selected.issues.length > 0 && (
              <Alert
                description={selected.issues.join(" ")}
                showIcon
                title="Reconciliation issue"
                type="warning"
              />
            )}
            <section>
              <h3>Cleaning audit</h3>
              {selected.changes.length ? (
                selected.changes.map((change) => (
                  <div
                    className="audit-row"
                    key={`${change.field}-${change.reason}`}
                  >
                    <strong>{change.field}</strong>
                    <span>
                      <del>{change.before ?? "Missing"}</del>
                      <b>→</b>
                      <ins>{change.after ?? "Missing"}</ins>
                    </span>
                    <small>{change.reason}</small>
                  </div>
                ))
              ) : (
                <Empty
                  description="No normalization changes"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </section>
            <div className="json-compare">
              <section>
                <Typography.Title level={5}>Source</Typography.Title>
                <JsonBlock value={selected.original} />
              </section>
              <section>
                <Typography.Title level={5}>Normalized</Typography.Title>
                <JsonBlock value={selected.normalized} />
              </section>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
