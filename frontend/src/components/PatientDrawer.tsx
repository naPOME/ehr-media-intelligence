import { Drawer, Grid } from "antd";
import { PatientReview } from "./PatientReview";
import type { Selection } from "./PatientReview";

export function PatientDrawer({
  selection,
  onClose,
  onAfterClose,
}: {
  selection: Selection | null;
  onClose: () => void;
  onAfterClose?: () => void;
}) {
  const screens = Grid.useBreakpoint();
  return (
    <Drawer
      afterOpenChange={(open) => {
        if (!open) onAfterClose?.();
      }}
      aria-label="Patient chart"
      className="patient-drawer"
      destroyOnHidden
      onClose={onClose}
      open={!!selection}
      size={screens.md ? 820 : "100%"}
      title="Patient chart"
    >
      {selection && (
        <PatientReview
          key={`${selection.patientId}-${selection.recordId}`}
          selection={selection}
        />
      )}
    </Drawer>
  );
}
