import { StrictMode } from "react";
import { BrowserRouter } from "react-router-dom";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter";
import "antd/dist/reset.css";
import "./styles.css";
import "./dashboard.css";
import { App } from "./App";
import { WorkspaceBoundary } from "./components/WorkspaceBoundary";
import { clinicalTheme } from "./lib/theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider theme={clinicalTheme}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <WorkspaceBoundary>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </WorkspaceBoundary>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
