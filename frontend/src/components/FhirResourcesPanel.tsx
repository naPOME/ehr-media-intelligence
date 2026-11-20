import { useQuery } from "@tanstack/react-query";
import { Empty, Skeleton, Table, Tag } from "antd";
import { getBundle } from "../lib/api";
import { formatDate } from "../lib/format";
import { ErrorState } from "./Feedback";

type FhirReference = { reference?: string };
type FhirResource = {
  resourceType: string;
  id?: string;
  status?: string;
  description?: string;
  title?: string;
  conclusion?: string;
  name?: Array<{ text?: string; given?: string[]; family?: string }>;
  code?: { text?: string; coding?: Array<{ display?: string }> };
  valueQuantity?: { value?: number; unit?: string };
  effectiveDateTime?: string;
  issued?: string;
  date?: string;
  context?: {
    period?: { start?: string };
    encounter?: FhirReference[];
  };
  subject?: FhirReference;
  encounter?: FhirReference;
  result?: FhirReference[];
};
type FhirBundle = {
  entry?: Array<{ resource?: FhirResource }>;
};
type ResourceRow = {
  key: string;
  resourceType: string;
  id: string;
  title: string;
  date: string | null;
  status: string | null;
  links: string[];
};

function resourceTitle(resource: FhirResource): string {
  const code =
    resource.code?.text ||
    resource.code?.coding?.find((item) => item.display)?.display;
  if (resource.resourceType === "Observation") {
    const quantity = resource.valueQuantity;
    if (quantity?.value != null)
      return `${code || "Result"} - ${quantity.value}${quantity.unit ? ` ${quantity.unit}` : ""}`;
  }
  if (resource.resourceType === "Patient" && resource.name?.length) {
    const name = resource.name[0];
    const formatted =
      name.text ||
      [...(name.given || []), name.family].filter(Boolean).join(" ");
    if (formatted) return formatted;
  }
  return (
    resource.description ||
    resource.title ||
    code ||
    resource.conclusion ||
    resource.resourceType
  );
}

function resourceDate(resource: FhirResource): string | null {
  return (
    resource.effectiveDateTime ||
    resource.issued ||
    resource.date ||
    resource.context?.period?.start ||
    null
  );
}

function resourceLinks(resource: FhirResource): string[] {
  const links = [
    resource.subject?.reference,
    resource.encounter?.reference,
    ...(resource.context?.encounter || []).map((item) => item.reference),
    ...(resource.result || []).map((item) => item.reference),
  ];
  return [...new Set(links.filter((link): link is string => Boolean(link)))];
}

export function FhirResourcesPanel({
  patientId,
  active,
}: {
  patientId: string;
  active: boolean;
}) {
  const bundle = useQuery({
    queryKey: ["bundle", patientId],
    queryFn: ({ signal }) => getBundle(patientId, signal),
    enabled: active,
    staleTime: 30_000,
  });

  if (bundle.isPending)
    return (
      <div
        aria-label="Loading FHIR resources"
        aria-busy="true"
        className="fhir-resources"
      >
        <Skeleton active paragraph={{ rows: 5 }} />
      </div>
    );
  if (bundle.isError)
    return (
      <ErrorState
        error={bundle.error}
        retry={() => void bundle.refetch()}
        title="FHIR resources could not be loaded"
      />
    );

  const entries = (bundle.data as FhirBundle).entry || [];
  const rows: ResourceRow[] = entries.flatMap(({ resource }) =>
    resource?.resourceType
      ? [
          {
            key: `${resource.resourceType}/${resource.id || "unknown"}`,
            resourceType: resource.resourceType,
            id: resource.id || "Not assigned",
            title: resourceTitle(resource),
            date: resourceDate(resource),
            status: resource.status || null,
            links: resourceLinks(resource),
          },
        ]
      : [],
  );

  return (
    <section
      aria-label="Linked FHIR R4 resources"
      className="fhir-resources"
      role="region"
      tabIndex={0}
    >
      <div className="fhir-resources-heading">
        <h3>FHIR resources</h3>
        <span>{rows.length} resources</span>
      </div>
      {rows.length ? (
        <Table<ResourceRow>
          columns={[
            {
              title: "Resource",
              dataIndex: "resourceType",
              key: "resourceType",
              sorter: (a, b) => a.resourceType.localeCompare(b.resourceType),
              render: (resourceType: string) => <Tag>{resourceType}</Tag>,
              width: 170,
            },
            {
              title: "Details",
              dataIndex: "title",
              key: "title",
              sorter: (a, b) => a.title.localeCompare(b.title),
              render: (title: string, row) => (
                <div className="fhir-resource-detail">
                  <strong>{title}</strong>
                  {row.links.length > 0 && (
                    <span className="fhir-resource-links">
                      Linked to {row.links.join(" | ")}
                    </span>
                  )}
                </div>
              ),
            },
            {
              title: "Date",
              dataIndex: "date",
              key: "date",
              sorter: (a, b) => (a.date || "").localeCompare(b.date || ""),
              render: (date: string | null) => formatDate(date),
              width: 150,
            },
            {
              title: "Status",
              dataIndex: "status",
              key: "status",
              sorter: (a, b) => (a.status || "").localeCompare(b.status || ""),
              render: (status: string | null) => status || "Not recorded",
              width: 130,
            },
            {
              title: "FHIR ID",
              dataIndex: "id",
              key: "id",
              sorter: (a, b) => a.id.localeCompare(b.id),
              render: (id: string) => (
                <code className="break-anywhere">{id}</code>
              ),
              width: 210,
            },
          ]}
          dataSource={rows}
          pagination={{
            defaultPageSize: 10,
            pageSizeOptions: [10, 25, 50],
            showSizeChanger: true,
            showTotal: (total) => `${total} resources`,
          }}
          rowKey="key"
          scroll={{ x: 850 }}
          size="small"
        />
      ) : (
        <Empty description="No FHIR resources are available for this patient" />
      )}
    </section>
  );
}
