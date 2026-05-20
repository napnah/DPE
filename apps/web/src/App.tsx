import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import OnboardingPage from "./pages/OnboardingPage";
import GroupPage from "./pages/GroupPage";
import GroupSettingsPage from "./pages/GroupSettingsPage";
import DocEditorPage from "./pages/DocEditorPage";
import DesignRoutes from "./designs/DesignRoutes";
import { loadIdentity } from "./lib/identity";

function RequireIdentity({ children }: { children: ReactNode }) {
  if (!loadIdentity()) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/designs/*" element={<DesignRoutes />} />
      <Route path="/" element={<OnboardingPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireIdentity>
            <DashboardPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/connections"
        element={
          <RequireIdentity>
            <ConnectionsPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/groups/:groupId"
        element={
          <RequireIdentity>
            <GroupPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/groups/:groupId/settings"
        element={
          <RequireIdentity>
            <GroupSettingsPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/groups/:groupId/docs/:docId"
        element={
          <RequireIdentity>
            <DocEditorPage />
          </RequireIdentity>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
