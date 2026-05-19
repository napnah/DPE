import { Link, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import OnboardingPage from "./pages/OnboardingPage";
import GroupPage from "./pages/GroupPage";
export default function App() {
  return (<Routes>
    <Route path="/" element={<OnboardingPage />} />
    <Route path="/dashboard" element={<DashboardPage />} />
    <Route path="/groups/:groupId" element={<GroupPage />} />
    <Route path="*" element={<div><Link to="/">Home</Link></div>} />
  </Routes>);
}