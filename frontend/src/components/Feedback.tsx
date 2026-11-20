import { Button, Empty, Result, Skeleton } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { errorMessage } from "../lib/api";

export function ErrorState({
  error,
  retry,
  title = "Something interrupted this view",
}: {
  error: unknown;
  retry: () => void;
  title?: string;
}) {
  return (
    <div className="feedback-panel" role="alert">
      <Result
        extra={
          <Button icon={<ReloadOutlined aria-hidden="true" />} onClick={retry}>
            Try again
          </Button>
        }
        status="warning"
        subTitle={errorMessage(error)}
        title={<h2>{title}</h2>}
      />
    </div>
  );
}

export function EmptyResults({ reset }: { reset: () => void }) {
  return (
    <div className="feedback-panel">
      <Empty
        description={
          <>
            <h3>No records in this view</h3>
            <p>Try a broader phrase or adjust the resource type and dates.</p>
          </>
        }
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      >
        <Button onClick={reset}>Clear filters</Button>
      </Empty>
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    <div
      aria-label="Searching records"
      aria-busy="true"
      className="result-list"
    >
      {[0, 1, 2].map((key) => (
        <div className="result-card skeleton-card" key={key}>
          <Skeleton active avatar paragraph={{ rows: 2 }} />
        </div>
      ))}
    </div>
  );
}
