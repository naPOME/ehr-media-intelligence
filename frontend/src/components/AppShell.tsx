import type { ReactNode } from "react";
import { useState } from "react";
import {
  Breadcrumb,
  Button,
  Drawer,
  Grid,
  Layout,
  Menu,
  Modal,
  Popover,
  Tag,
  Tooltip,
} from "antd";
import {
  PlusOutlined,
  TeamOutlined,
  FileSearchOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  AppstoreOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../lib/api";
import { Link, useLocation } from "react-router-dom";

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const view = pathname.startsWith("/patients")
    ? "patients"
    : pathname === "/records"
      ? "records"
      : pathname === "/intake"
        ? "intake"
        : "overview";
  const pageLabel =
    view === "patients"
      ? "Patients"
      : view === "records"
        ? "Record search"
        : view === "intake"
          ? "Data intake"
          : "Overview";
  const [guideOpen, setGuideOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const navigation = (
    <nav aria-label="Workspace">
      <Menu
        mode="inline"
        selectedKeys={[view]}
        onClick={() => setNavigationOpen(false)}
        items={[
          {
            key: "overview",
            icon: <AppstoreOutlined aria-hidden="true" />,
            label: <Link to="/overview">Overview</Link>,
          },
          {
            key: "patients",
            icon: <TeamOutlined aria-hidden="true" />,
            label: <Link to="/patients">Patients</Link>,
          },
          {
            key: "records",
            icon: <FileSearchOutlined aria-hidden="true" />,
            label: <Link to="/records">Record search</Link>,
          },
          {
            key: "intake",
            icon: <InboxOutlined aria-hidden="true" />,
            label: <Link to="/intake">Data intake</Link>,
          },
        ]}
      />
    </nav>
  );
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 30_000,
  });
  const status = health.isPending
    ? "Connecting"
    : health.isError
      ? "Connection unavailable"
      : health.data.searchReady
        ? "Library connected"
        : "Library unavailable";
  return (
    <Layout className="clinical-app dashboard-shell">
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      <Layout.Sider
        className="dashboard-sidebar"
        collapsed={collapsed}
        collapsedWidth={72}
        width={224}
        theme="light"
        trigger={null}
        breakpoint="xl"
        onBreakpoint={setCollapsed}
      >
        <a
          className="sidebar-brand"
          href="#main-content"
          aria-label="Everwell Clinic workspace"
        >
          <span className="brand-mark" aria-hidden="true">
            <PlusOutlined />
          </span>
          {!collapsed && (
            <span>
              <strong>Everwell</strong>
            </span>
          )}
        </a>
        {navigation}
        <div className="sidebar-footer">
          <Tooltip title={collapsed ? "Search guide" : ""} placement="right">
            <Button
              type="text"
              icon={<QuestionCircleOutlined aria-hidden="true" />}
              onClick={() => setGuideOpen(true)}
              aria-label="Open search guide"
            >
              {!collapsed && "Help and shortcuts"}
            </Button>
          </Tooltip>
        </div>
      </Layout.Sider>
      <Layout className="dashboard-body">
        <header className="app-header dashboard-header">
          <div className="header-location">
            <Button
              aria-label={
                screens.lg
                  ? collapsed
                    ? "Expand sidebar"
                    : "Collapse sidebar"
                  : "Open navigation"
              }
              icon={
                collapsed || !screens.lg ? (
                  <MenuUnfoldOutlined aria-hidden="true" />
                ) : (
                  <MenuFoldOutlined aria-hidden="true" />
                )
              }
              onClick={() =>
                screens.lg ? setCollapsed(!collapsed) : setNavigationOpen(true)
              }
              type="text"
            />
            <Breadcrumb
              items={[{ title: "Workspace" }, { title: pageLabel }]}
            />
          </div>
          <div className="header-actions">
            <Popover
              title="Record library"
              content={
                <div className="connection-info">
                  <p>{status}.</p>
                  <Button
                    icon={<ReloadOutlined aria-hidden="true" />}
                    onClick={() => void health.refetch()}
                    size="small"
                  >
                    Check connection
                  </Button>
                </div>
              }
              trigger="click"
            >
              <Button
                aria-label={`Connection: ${status}`}
                className="connection-button"
                type="text"
              >
                <span
                  aria-hidden="true"
                  className={`status-dot ${health.data?.searchReady ? "online" : ""}`}
                />
                <span className="connection-label">{status}</span>
              </Button>
            </Popover>
            <Tag className="demo-tag">Demo workspace</Tag>
          </div>
        </header>
        <main className="clinical-main" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </Layout>
      <Drawer
        title="Everwell Clinic workspace"
        placement="left"
        size={264}
        open={navigationOpen}
        onClose={() => setNavigationOpen(false)}
        className="navigation-drawer"
        destroyOnHidden
      >
        {navigation}
        <Button
          icon={<QuestionCircleOutlined aria-hidden="true" />}
          onClick={() => {
            setNavigationOpen(false);
            setGuideOpen(true);
          }}
        >
          Help and shortcuts
        </Button>
      </Drawer>
      <Modal
        footer={
          <Button onClick={() => setGuideOpen(false)} type="primary">
            Close guide
          </Button>
        }
        onCancel={() => setGuideOpen(false)}
        open={guideOpen}
        title="Search and review records"
      >
        <div className="guide-content">
          <ol>
            <li>
              <strong>Start with a patient.</strong> Open a chart from Patients,
              or use Record search to search across the library. Enter a
              clinical phrase, then narrow by resource type or record date. Date
              bounds are inclusive; undated records are excluded when filtering
              by dates.
            </li>
            <li>
              <strong>Select a match.</strong> Check the patient name and MRN in
              the results, then verify the name, DOB and MRN above the source
              reader.
            </li>
            <li>
              <strong>Review the source.</strong> The selected document opens
              directly. Switch to Patient summary or All records for more
              context.
            </li>
          </ol>
          <p>
            A similarity score measures search relevance, not clinical
            confidence. Patient summaries cover the full available history and
            may include records outside the search dates.
          </p>
          <p>
            <kbd>/</kbd> Focus search. Use Tab and Enter to open results, and
            Escape to close the mobile patient chart.
          </p>
        </div>
      </Modal>
    </Layout>
  );
}
