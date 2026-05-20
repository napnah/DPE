import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { exportPublicKeyBase64Url, importPublicKeyBase64Url } from "@dpe/crypto";
import { api, saveGroupAdminKey, type GroupSummary, type InvitationRow } from "../lib/api";
import { fetchDiscovery, fetchNetwork, searchPeers, type LanPeer } from "../lib/lan";
import { loadIdentity, loadPrivateKey } from "../lib/identity";

export default function DashboardPage() {
  const identity = loadIdentity();
  const [network, setNetwork] = useState<Record<string, unknown> | null>(null);
  const [peers, setPeers] = useState<LanPeer[]>([]);
  const [uidQuery, setUidQuery] = useState("");
  const [owned, setOwned] = useState<GroupSummary[]>([]);
  const [joined, setJoined] = useState<GroupSummary[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [inviteUid, setInviteUid] = useState("");
  const [inviteGroupId, setInviteGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!identity) return;
    setError(null);
    try {
      const [net, disc, o, j, inv] = await Promise.all([
        fetchNetwork().catch(() => null),
        fetchDiscovery().catch(() => ({ peers: [] })),
        api.listGroups(identity.nodeId, "owner"),
        api.listGroups(identity.nodeId, "member"),
        api.listInvitations(identity.nodeId),
      ]);
      setNetwork(net);
      setPeers(disc.peers ?? []);
      setOwned(o);
      setJoined(j);
      setInvitations(inv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [identity]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function onSearchUid() {
    try {
      const res = await searchPeers(uidQuery);
      setPeers(res.peers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜索失败");
    }
  }

  async function createGroup() {
    if (!identity || !newGroupName.trim()) return;
    setBusy(true);
    try {
      const sk = loadPrivateKey();
      if (!sk) throw new Error("缺少私钥");
      const pk = await importPublicKeyBase64Url(identity.publicKeyBase64Url);
      const created = await api.createGroup({
        name: newGroupName.trim(),
        owner_node_id: identity.nodeId,
        owner_public_key: exportPublicKeyBase64Url(pk),
        control_mode: "proxy",
      });
      saveGroupAdminKey(created.group_id, created.pk_admin);
      setNewGroupName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "建群失败");
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    if (!identity || !inviteGroupId || !inviteUid.trim()) return;
    setBusy(true);
    try {
      await api.createInvitation(inviteGroupId, identity.nodeId, inviteUid.trim());
      setInviteUid("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvitation(inv: InvitationRow) {
    if (!identity) return;
    const sk = loadPrivateKey();
    if (!sk) return;
    setBusy(true);
    try {
      const pk = await importPublicKeyBase64Url(identity.publicKeyBase64Url);
      const res = await api.acceptInvitation(inv.id, {
        node_id: identity.nodeId,
        public_key: exportPublicKeyBase64Url(pk),
      });
      saveGroupAdminKey(res.group_id, res.pk_admin);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "接受失败");
    } finally {
      setBusy(false);
    }
  }

  async function rejectInvitation(inv: InvitationRow) {
    if (!identity) return;
    setBusy(true);
    try {
      await api.rejectInvitation(inv.id, identity.nodeId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "拒绝失败");
    } finally {
      setBusy(false);
    }
  }

  if (!identity) {
    return (
      <main style={{ padding: "2rem" }}>
        <p>
          请先 <Link to="/">生成身份</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", maxWidth: 720 }}>
      <h1>总面板</h1>
      <p>
        UID: <code>{identity.nodeId}</code>
      </p>
      {error && <p style={{ color: "#f88" }}>{error}</p>}

      <div className="card">
        <h2>网络信息</h2>
        {network ? (
          <pre style={{ fontSize: 12, overflow: "auto" }}>{JSON.stringify(network, null, 2)}</pre>
        ) : (
          <p>无法连接 lan-agent（请运行 <code>pnpm dev</code>）</p>
        )}
      </div>

      <div className="card">
        <h2>网上邻居 / 搜索 UID</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={uidQuery}
            onChange={(e) => setUidQuery(e.target.value)}
            placeholder="UID 前缀"
            style={{ flex: 1, padding: 8 }}
          />
          <button type="button" onClick={() => void onSearchUid()}>
            搜索
          </button>
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {peers.length === 0 && <li>暂无邻居</li>}
          {peers.map((p) => (
            <li key={`${p.uid}-${p.host}`}>
              <code>{p.uid}</code> @ {p.host}:{p.port} ({p.source})
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>建群</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="群组名称"
            style={{ flex: 1, padding: 8 }}
          />
          <button type="button" disabled={busy} onClick={() => void createGroup()}>
            创建
          </button>
        </div>
      </div>

      <div className="card">
        <h2>邀请成员</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            value={inviteGroupId}
            onChange={(e) => setInviteGroupId(e.target.value)}
            placeholder="群组 ID"
            style={{ padding: 8 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={inviteUid}
              onChange={(e) => setInviteUid(e.target.value)}
              placeholder="对方 UID"
              style={{ flex: 1, padding: 8 }}
            />
            <button type="button" disabled={busy} onClick={() => void sendInvite()}>
              邀请
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>邀请函</h2>
        {invitations.length === 0 && <p>无待处理邀请</p>}
        {invitations.map((inv) => (
          <div key={inv.id} style={{ marginBottom: 8 }}>
            <strong>{inv.group?.name ?? inv.groupId}</strong>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button type="button" disabled={busy} onClick={() => void acceptInvitation(inv)}>
                接受
              </button>
              <button type="button" disabled={busy} onClick={() => void rejectInvitation(inv)}>
                拒绝
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>我管理的群</h2>
        <ul>
          {owned.map((g) => (
            <li key={g.group_id}>
              <Link to={`/groups/${g.group_id}`}>{g.name}</Link>{" "}
              <small>({g.group_id.slice(0, 8)}…)</small>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>我加入的群</h2>
        <ul>
          {joined.map((g) => (
            <li key={g.group_id}>
              <Link to={`/groups/${g.group_id}`}>{g.name}</Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
