import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "./AppShell";
import { CliConnectPage } from "./pages/CliConnectPage";
import { DashboardPage } from "./pages/DashboardPage";
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
