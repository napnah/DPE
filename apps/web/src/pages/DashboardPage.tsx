import { Link } from "react-router-dom";

export default function DashboardPage() {
  const uid = localStorage.getItem("dpe_uid") ?? "unknown";
  return (
    <main style={{ padding: "2rem" }}>
      <h1>总面板</h1>
      <p>UID: <code>{uid}</code></p>
      <div className="card">
        <h2>网络与邻居</h2>
        <p>lan-agent: http://localhost:3003</p>
      </div>
      <div className="card">
        <h2>群组</h2>
        <Link to="/groups/demo">演示群组</Link>
      </div>
    </main>
  );
}
