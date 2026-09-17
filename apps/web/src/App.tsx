import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "./AppShell";
import { CliConnectPage } from "./pages/CliConnectPage";
import { ComparePage } from "./pages/ComparePage";
import { DashboardPage } from "./pages/DashboardPage";
import { DevicePage } from "./pages/DevicePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SnapshotDetailPage } from "./pages/SnapshotDetailPage";
import { SnapshotsPage } from "./pages/SnapshotsPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="devices/:deviceId" element={<DevicePage />} />
          <Route path="compare" element={<ComparePage />} />
          <Route path="snapshots" element={<SnapshotsPage />} />
          <Route path="snapshots/:id" element={<SnapshotDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="cli/connect" element={<CliConnectPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
