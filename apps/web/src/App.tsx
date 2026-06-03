import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import DashboardPage from "./pages/DashboardPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import GroupPage from "./pages/GroupPage";
import GroupSettingsPage from "./pages/GroupSettingsPage";
import DocEditorPage from "./pages/DocEditorPage";
import DesignRoutes from "./designs/DesignRoutes";
import { isLoggedIn } from "./lib/identity";

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <AppShell>{children}</AppShell>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  if (isLoggedIn()) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/designs/*" element={<DesignRoutes />} />
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route
        path="/login"
        element={
          <GuestOnly>
            <LoginPage />
          </GuestOnly>
        }
      />
      <Route
        path="/register"
        element={
          <GuestOnly>
            <RegisterPage />
          </GuestOnly>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/connections"
        element={
          <RequireAuth>
            <ConnectionsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/groups/:groupId"
        element={
          <RequireAuth>
            <GroupPage />
          </RequireAuth>
        }
      />
      <Route
        path="/groups/:groupId/settings"
        element={
          <RequireAuth>
            <GroupSettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/groups/:groupId/docs/:docId"
        element={
          <RequireAuth>
            <DocEditorPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
