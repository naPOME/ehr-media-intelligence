import { useDeferredValue, useRef, useState } from "react";
import type { Key } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  App,
  Avatar,
  Button,
  Checkbox,
  DatePicker,
  Dropdown,
  Empty,
  Input,
  Grid,
  Pagination,
  Popover,
  Segmented,
  Select,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { TableColumnsType, TableProps } from "antd";
import {
  DownloadOutlined,
  FileSearchOutlined,
  FilterOutlined,
  FileTextOutlined,
  MoreOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import type {
  Patient,
  PatientDirectoryOptions,
  PatientListItem,
  PatientSort,
} from "../lib/api";
import { errorMessage, exportPatients, getPatients } from "../lib/api";
import { formatDate, initials } from "../lib/format";
import { ErrorState } from "./Feedback";

const optionalColumns = [
  { label: "Date of birth", value: "dob" },
  { label: "Gender", value: "gender" },
  { label: "Documents", value: "record_count" },
  { label: "Latest record", value: "latest_record_date" },
  { label: "Patient summary", value: "summary_status" },
];
const statusLabels = {
  ready: "Available",
  unavailable: "Not generated",
  stale: "Needs refresh",
  failed: "Unavailable",
};
const sortableKeys = new Set([
  "name",
  "mrn",
  "dob",
  "gender",
  "record_count",
  "latest_record_date",
  "summary_status",
]);

export function PatientDirectory({
  onOpen,
}: {
  onOpen: (patient: Patient) => void;
}) {
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState<PatientDirectoryOptions>({
    sort_by: "name",
    order: "asc",
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<PatientListItem[]>([]);
  const [columns, setColumns] = useState(
    optionalColumns.map((column) => column.value),
  );
  const [density, setDensity] = useState<"small" | "middle">("middle");
  const [exporting, setExporting] = useState(false);
  const [dateKey, setDateKey] = useState(0);
  const tableRegion = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(query.trim());
  const options = {
    ...filters,
    query: deferred,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
  const patients = useQuery({
    queryKey: ["patients", options],
    queryFn: ({ signal }) => getPatients(options, signal),
    placeholderData: keepPreviousData,
  });
  const busy = patients.isFetching || deferred !== query.trim();
  const total = patients.data?.total ?? 0;
  const hasDirectoryFilters = !!(
    filters.gender ||
    filters.summary_status ||
    filters.date_from ||
    filters.date_to
  );
  const activeFilters = !!(query || hasDirectoryFilters);

  function updateFilters(next: PatientDirectoryOptions) {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
    setSelected([]);
  }
  function reset() {
    setQuery("");
    setFilters({ sort_by: "name", order: "asc" });
    setPage(1);
    setSelected([]);
    setDateKey((key) => key + 1);
  }
  function resetDirectoryFilters() {
    setFilters((current) => ({
      sort_by: current.sort_by,
      order: current.order,
    }));
    setPage(1);
    setSelected([]);
    setDateKey((key) => key + 1);
  }
  async function download(ids?: string[]) {
    setExporting(true);
    try {
      const blob = await exportPatients(
        { ...filters, query: deferred, patient_ids: ids },
        new AbortController().signal,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = ids ? "selected-patients.csv" : "patients.csv";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      void message.success(
        ids
          ? `Exported ${ids.length} selected patients`
          : "Patient directory exported",
      );
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  }
  const orderFor = (key: PatientSort) =>
    filters.sort_by === key
      ? filters.order === "desc"
        ? ("descend" as const)
        : ("ascend" as const)
      : null;
  const allColumns: TableColumnsType<PatientListItem> = [
    {
      title: "Patient",
      key: "name",
      width: screens.md ? 240 : 180,
      fixed: "start",
      sorter: true,
      sortOrder: orderFor("name"),
      render: (_, item) => (
        <div className="patient-cell">
          <Avatar className="patient-avatar" size={34}>
            {initials(item.patient.name)}
          </Avatar>
          <div>
            <Button
              aria-label={`Open patient: ${item.patient.name}; MRN ${item.patient.mrn}`}
              className="patient-open-button"
              onClick={() => onOpen(item.patient)}
              type="link"
            >
              {item.patient.name}
            </Button>
          </div>
        </div>
      ),
    },
    {
      title: "MRN",
      key: "mrn",
      width: 128,
      sorter: true,
      sortOrder: orderFor("mrn"),
      render: (_, item) => (
        <span className="patient-mrn">{item.patient.mrn}</span>
      ),
    },
    {
      title: "Date of birth",
      key: "dob",
      width: 142,
      sorter: true,
      sortOrder: orderFor("dob"),
      render: (_, item) =>
        item.patient.dob ? (
          formatDate(item.patient.dob)
        ) : (
          <span className="muted">Not recorded</span>
        ),
    },
    {
      title: "Gender",
      key: "gender",
      width: 100,
      sorter: true,
      sortOrder: orderFor("gender"),
      render: (_, item) => (
        <span className="capitalize">
          {item.patient.gender === "unknown"
            ? "Not recorded"
            : item.patient.gender}
        </span>
      ),
    },
    {
      title: "Documents",
      key: "record_count",
      width: 120,
      align: "right",
      sorter: true,
      sortOrder: orderFor("record_count"),
      render: (_, item) => (
        <span className="document-count">
          <FileTextOutlined aria-hidden="true" /> {item.record_count}
        </span>
      ),
    },
    {
      title: "Latest record",
      key: "latest_record_date",
      width: 150,
      sorter: true,
      sortOrder: orderFor("latest_record_date"),
      render: (_, item) => formatDate(item.latest_record_date),
    },
    {
      title: "Patient summary",
      key: "summary_status",
      width: 152,
      sorter: true,
      sortOrder: orderFor("summary_status"),
      render: (_, item) => (
        <Tag color={item.summary_status === "ready" ? "blue" : undefined}>
          {statusLabels[item.summary_status]}
        </Tag>
      ),
    },
    {
      title: <span className="sr-only">Actions</span>,
      key: "actions",
      width: 62,
      fixed: screens.md ? "end" : undefined,
      render: (_, item) => (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              {
                key: "open",
                label: "Open patient chart",
                icon: <FileSearchOutlined />,
              },
              {
                key: "export",
                label: "Export patient row",
                icon: <DownloadOutlined />,
              },
            ],
            onClick: ({ key }) =>
              key === "open"
                ? onOpen(item.patient)
                : void download([item.patient.id]),
          }}
        >
          <Button
            type="text"
            aria-label={`Actions for ${item.patient.name}`}
            icon={<MoreOutlined aria-hidden="true" />}
          />
        </Dropdown>
      ),
    },
  ];
  const onTableChange: TableProps<PatientListItem>["onChange"] = (
    _,
    __,
    sorter,
  ) => {
    const current = Array.isArray(sorter) ? sorter[0] : sorter;
    if (
      typeof current.columnKey === "string" &&
      sortableKeys.has(current.columnKey)
    ) {
      updateFilters({
        sort_by: current.order ? (current.columnKey as PatientSort) : "name",
        order: current.order === "descend" ? "desc" : "asc",
      });
    }
  };
  const selectedKeys: Key[] = selected.map((item) => item.patient.id);
  return (
    <section
      aria-label="Patient directory"
      className="patient-directory dashboard-directory"
    >
      <div className="directory-heading">
        <h1>
          Patients <span className="page-count">{total}</span>
        </h1>
      </div>
      <div className="directory-card">
        <div
          className={`patient-table-toolbar${filtersOpen ? " filters-expanded" : ""}`}
        >
          <div
            className={`patient-search-controls${filtersOpen ? " filters-expanded" : ""}`}
          >
            <Input.Search
              allowClear
              aria-label="Find patient by name or MRN"
              autoComplete="off"
              placeholder="Search patients"
              className="patient-lookup"
              enterButton="Search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
                setSelected([]);
              }}
              onSearch={() => void patients.refetch()}
            />
            <Button
              aria-label="Toggle patient filters"
              aria-expanded={filtersOpen}
              className="filters-toggle"
              icon={<FilterOutlined aria-hidden="true" />}
              type={hasDirectoryFilters ? "primary" : "default"}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Filters
            </Button>
            {filtersOpen && (
              <div
                className="patient-filters"
                role="group"
                aria-label="Patient filters"
              >
                <Select
                  allowClear
                  aria-label="Filter by gender"
                  placeholder="All genders"
                  value={filters.gender}
                  onChange={(gender) => updateFilters({ gender })}
                  options={[
                    { label: "Male", value: "male" },
                    { label: "Female", value: "female" },
                    { label: "Other", value: "other" },
                    { label: "Not recorded", value: "unknown" },
                  ]}
                />
                <Select
                  allowClear
                  aria-label="Filter by summary"
                  placeholder="All summaries"
                  value={filters.summary_status}
                  onChange={(summary_status) =>
                    updateFilters({ summary_status })
                  }
                  options={Object.entries(statusLabels).map(
                    ([value, label]) => ({
                      value,
                      label,
                    }),
                  )}
                />
                <DatePicker.RangePicker
                  key={dateKey}
                  aria-label="Latest record date range"
                  placeholder={["Latest record from", "To date"]}
                  format="DD MMM YYYY"
                  onChange={(dates) =>
                    updateFilters({
                      date_from: dates?.[0]?.format("YYYY-MM-DD"),
                      date_to: dates?.[1]?.format("YYYY-MM-DD"),
                    })
                  }
                />
                {hasDirectoryFilters && (
                  <Button type="link" onClick={resetDirectoryFilters}>
                    Reset
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="table-actions">
            <Tooltip title="Refresh">
              <Button
                aria-label="Refresh patient list"
                icon={<ReloadOutlined aria-hidden="true" />}
                loading={patients.isFetching}
                onClick={() => void patients.refetch()}
              />
            </Tooltip>
            <Popover
              trigger="click"
              placement="bottomRight"
              title="Table settings"
              content={
                <div className="table-settings">
                  <Segmented
                    aria-label="Table density"
                    options={[
                      { label: "Comfortable", value: "middle" },
                      { label: "Compact", value: "small" },
                    ]}
                    value={density}
                    onChange={setDensity}
                  />
                  <Checkbox.Group
                    options={optionalColumns}
                    value={columns}
                    onChange={(values) => setColumns(values.map(String))}
                  />
                  <Button
                    type="link"
                    onClick={() => {
                      setColumns(optionalColumns.map((column) => column.value));
                      setDensity("middle");
                    }}
                  >
                    Reset
                  </Button>
                </div>
              }
            >
              <Button
                aria-label="Table settings"
                icon={<SettingOutlined aria-hidden="true" />}
              />
            </Popover>
            <Button
              icon={<DownloadOutlined aria-hidden="true" />}
              disabled={!total || busy}
              loading={exporting}
              onClick={() => void download()}
            >
              Export
            </Button>
          </div>
        </div>
        {selected.length > 0 && (
          <div className="selection-toolbar" role="status">
            <strong>
              {selected.length} {selected.length === 1 ? "patient" : "patients"}{" "}
              selected
            </strong>
            <Button
              size="small"
              icon={<DownloadOutlined aria-hidden="true" />}
              loading={exporting}
              onClick={() =>
                void download(selected.map((row) => row.patient.id))
              }
            >
              Export selected
            </Button>
            <Button size="small" type="link" onClick={() => setSelected([])}>
              Clear selection
            </Button>
          </div>
        )}
        {patients.isError ? (
          <ErrorState
            error={patients.error}
            retry={() => void patients.refetch()}
            title="Patients could not be loaded"
          />
        ) : (
          <div
            aria-label="Patient list"
            className="directory-table-scroll"
            role="region"
            tabIndex={0}
            ref={tableRegion}
          >
            <Table<PatientListItem>
              columns={allColumns.filter(
                (column) =>
                  ["name", "mrn", "actions"].includes(String(column.key)) ||
                  columns.includes(String(column.key)),
              )}
              dataSource={patients.data?.items ?? []}
              loading={busy}
              pagination={false}
              rowKey={(item) => item.patient.id}
              size={density}
              sticky={{
                getContainer: () => tableRegion.current ?? document.body,
              }}
              onChange={onTableChange}
              rowSelection={{
                selectedRowKeys: selectedKeys,
                preserveSelectedRowKeys: true,
                fixed: true,
                columnWidth: 44,
                onChange: (_, rows) => setSelected(rows),
                getCheckboxProps: (item) => ({
                  "aria-label": `Select ${item.patient.name}`,
                }),
              }}
              onRow={(item) => ({ onDoubleClick: () => onOpen(item.patient) })}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      activeFilters
                        ? "No patients match your filters"
                        : "No patient records yet"
                    }
                  >
                    {activeFilters && (
                      <Button onClick={reset}>Clear filters</Button>
                    )}
                  </Empty>
                ),
              }}
            />
          </div>
        )}
        <div className="directory-pagination">
          <span aria-live="polite">
            {busy
              ? "Loading..."
              : selected.length
                ? `${selected.length} selected`
                : `${total} patients`}
          </span>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger
            showQuickJumper
            pageSizeOptions={[5, 10, 20, 50, 100]}
            showTotal={(count, range) =>
              `${range[0]}-${range[1]} of ${count} patients`
            }
            onChange={(next, size) => {
              setPage(size !== pageSize ? 1 : next);
              setPageSize(size);
              tableRegion.current?.scrollTo({ top: 0 });
            }}
          />
        </div>
      </div>
    </section>
  );
}
