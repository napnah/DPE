import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CopyableField } from "../components/CopyableField";
import { GroupCard } from "../components/GroupCard";
import { api, saveGroupAdminKey, type GroupCardRow } from "../lib/api";
import { useIdentity } from "../lib/use-identity";

export default function DashboardPage() {
  const identity = useIdentity();
  const [groups, setGroups] = useState<GroupCardRow[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!identity) return;
    setError(null);
    try {
      setGroups(await api.listAllGroups());
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [identity]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createGroup() {
    if (!identity || !newGroupName.trim()) return;
    setBusy(true);
    try {
      const created = await api.createGroup({
        name: newGroupName.trim(),
        description: newGroupDesc.trim(),
        owner_node_id: identity.nodeId,
        owner_public_key: identity.publicKeyBase64Url,
        owner_display_name: identity.displayName,
        control_mode: "proxy",
      });
      saveGroupAdminKey(created.group_id, created.pk_admin);
      setNewGroupName("");
      setNewGroupDesc("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "建群失败");
    } finally {
      setBusy(false);
    }
  }

  if (!identity) {
    return (
      <main className="app-page">
        <p>
          请先 <Link to="/login">登录账号</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="app-page">
      <header className="app-page-header">
        <div>
          <h1>总览</h1>
          <p className="app-muted">我的群组与协作空间</p>
        </div>
        <Link to="/connections" className="app-btn">
          连接与邀请
        </Link>
      </header>
      {error && <p className="app-error">{error}</p>}

      <section className="app-panel app-panel--identity">
        <h2>账号身份</h2>
        <p className="app-muted">邀请他人入群时请提供下方节点 ID（UID）；显示名仅用于展示。</p>
        {identity.username && (
          <CopyableField label="登录账号" value={identity.username} hint="本机控制平面账号" />
        )}
        <CopyableField label="显示名" value={identity.displayName} />
        <CopyableField label="节点 ID（UID）" value={identity.nodeId} hint="技术标识，不可修改" />
      </section>

      <section className="app-panel">
        <h2>新建群组</h2>
        <div className="app-form-row">
          <input
            className="app-input"
            placeholder="群组名称"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
          <input
            className="app-input"
            placeholder="群组描述"
            value={newGroupDesc}
            onChange={(e) => setNewGroupDesc(e.target.value)}
          />
          <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={() => void createGroup()}>
            创建
          </button>
        </div>
      </section>
      <section className="app-panel">
        <h2>我的群组</h2>
        {groups.length === 0 ? (
          <p className="app-muted">暂无群组</p>
        ) : (
          <div className="group-card-grid">
            {groups.map((g) => (
              <GroupCard key={g.group_id} group={g} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
