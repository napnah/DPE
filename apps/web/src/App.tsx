import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import OnboardingPage from "./pages/OnboardingPage";
import GroupPage from "./pages/GroupPage";
import DocEditorPage from "./pages/DocEditorPage";
import { loadIdentity } from "./lib/identity";

function RequireIdentity({ children }: { children: ReactNode }) {
  if (!loadIdentity()) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
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
        path="/groups/:groupId"
        element={
          <RequireIdentity>
            <GroupPage />
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
