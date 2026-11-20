import { Component } from "react";
import type { ReactNode } from "react";
import { Button, Result } from "antd";

export class WorkspaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="workspace-main">
        <Result
          extra={
            <Button onClick={() => window.location.reload()} type="primary">
              Reload workspace
            </Button>
          }
          status="error"
          subTitle="Your records have not been changed. Reload the workspace to try again."
          title="The workspace couldn't be displayed"
        />
      </main>
    ) : (
      this.props.children
    );
  }
}
