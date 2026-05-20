import { Navigate, Route, Routes } from "react-router-dom";
import { DesignLayout } from "./DesignLayout";
import DesignPickerPage from "./DesignPickerPage";
import ConnectionsScreen from "./screens/ConnectionsScreen";
import DashboardScreen from "./screens/DashboardScreen";
import EditorScreen from "./screens/EditorScreen";
import GroupScreen from "./screens/GroupScreen";
import GroupSettingsScreen from "./screens/GroupSettingsScreen";
import WelcomeScreen from "./screens/WelcomeScreen";

export default function DesignRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DesignPickerPage />} />
      <Route path="/:variant" element={<DesignLayout />}>
        <Route index element={<Navigate to="welcome" replace />} />
        <Route path="welcome" element={<WelcomeScreen />} />
        <Route path="dashboard" element={<DashboardScreen />} />
        <Route path="connections" element={<ConnectionsScreen />} />
        <Route path="groups/:groupId" element={<GroupScreen />} />
        <Route path="groups/:groupId/settings" element={<GroupSettingsScreen />} />
        <Route path="groups/:groupId/docs/:docId" element={<EditorScreen />} />
      </Route>
    </Routes>
  );
}
