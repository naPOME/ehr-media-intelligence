import { lazy, Suspense, useEffect } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { AppShell } from "./components/AppShell";
import { ErrorState } from "./components/Feedback";
import { ApiError, getPatient } from "./lib/api";

const Overview = lazy(() =>
  import("./pages/Overview").then((module) => ({ default: module.Overview })),
);
const PatientDirectory = lazy(() =>
  import("./components/PatientDirectory").then((module) => ({
    default: module.PatientDirectory,
  })),
);
const RecordWorkspace = lazy(() =>
  import("./pages/RecordWorkspace").then((module) => ({
    default: module.RecordWorkspace,
  })),
);
function PatientChart() {
  const { patientId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: ["patient", patientId],
    queryFn: ({ signal }) => getPatient(patientId, signal),
  });
  if (detail.isPending) return <Skeleton active paragraph={{ rows: 12 }} />;
  const recordId = params.get("record") || undefined;
  if (
    detail.isError ||
    detail.data.patient.id !== patientId ||
    (recordId && !detail.data.records.some((record) => record.id === recordId))
  ) {
    return (
      <ErrorState
        title="Patient could not be opened"
        error={detail.error || new ApiError(404)}
        retry={() => void detail.refetch()}
      />
    );
  }
  return (
    <RecordWorkspace
      key={`${patientId}-${recordId}-${params.get("tab")}`}
      context={detail.data.patient}
      initialRecordId={recordId}
      showSummary={params.get("tab") === "summary"}
      onPatients={() => void navigate("/patients")}
      onAllRecords={() => void navigate("/records")}
    />
  );
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const title = location.pathname.startsWith("/patients/")
      ? "Patient chart"
      : location.pathname === "/patients"
        ? "Patients"
        : location.pathname === "/records"
          ? "Record search"
          : "Overview";
    document.title = `${title} | Everwell Clinic`;
  }, [location.pathname]);
  return (
    <AppShell>
      <Suspense fallback={<Skeleton active paragraph={{ rows: 10 }} />}>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route
            path="/patients"
            element={
              <PatientDirectory
                onOpen={(patient) => void navigate(`/patients/${patient.id}`)}
              />
            }
          />
          <Route path="/patients/:patientId" element={<PatientChart />} />
          <Route
            path="/records"
            element={
              <RecordWorkspace
                context={null}
                onPatients={() => void navigate("/patients")}
                onAllRecords={() => void navigate("/records")}
              />
            }
          />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
