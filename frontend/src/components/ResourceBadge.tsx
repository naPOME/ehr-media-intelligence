import {
  FileTextOutlined,
  ExperimentOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Tag } from "antd";
import type { ResourceType } from "../lib/api";

export function ResourceBadge({
  type,
  compact = false,
}: {
  type: ResourceType;
  compact?: boolean;
}) {
  const labels = {
    Patient: "Patient history",
    DocumentReference: "Document",
    DiagnosticReport: "Diagnostic report",
  };
  const icons = {
    Patient: <UserOutlined />,
    DocumentReference: <FileTextOutlined />,
    DiagnosticReport: <ExperimentOutlined />,
  };
  return (
    <Tag className={`resource-badge resource-${type}`} icon={icons[type]}>
      {compact
        ? labels[type]
        : type === "DocumentReference"
          ? "Document reference"
          : labels[type]}
    </Tag>
  );
}
