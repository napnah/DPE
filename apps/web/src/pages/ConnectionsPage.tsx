import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { exportPublicKeyBase64Url, importPublicKeyBase64Url } from "@dpe/crypto";
import { api, saveGroupAdminKey, type InvitationRow } from "../lib/api";
import { fetchDiscovery, fetchNetwork, getLanAgentBaseUrl, searchPeers, type LanPeer } from "../lib/lan";
import { loadIdentity } from "../lib/identity";

export default function ConnectionsPage() {
  const identity = loadIdentity();
  const [network, setNetwork] = useState<Record<string, unknown> | null>(null);
  const [lanError, setLanError] = useState<string | null>(null);
  const [peers, setPeers] = useState<LanPeer[]>([]);
  const [peerQuery, setPeerQuery] = useState("");
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!identity) return;
    setError(null);
    try {
      setLanError(null);
      const [net, disc, inv] = await Promise.all([
        fetchNetwork().catch((e) => {
          setLanError(e instanceof Error ? e.message : "lan-agent 不可用");
          return null;
        }),
        fetchDiscovery().catch(() => ({ peers: [] })),
        api.listInvitations(identity.nodeId),
      ]);
      setNetwork(net);
      setPeers(disc.peers ?? []);
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
      const res = await searchPeers(peerQuery);
      setPeers(res.peers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜索失败");
    }
  }

  async function acceptInvitation(inv: InvitationRow) {
    if (!identity) return;
    setBusy(true);
    try {
      const { loadPrivateKey } = await import("../lib/identity");
      const sk = loadPrivateKey();
      if (!sk) return;
      const pk = await importPublicKeyBase64Url(identity.publicKeyBase64Url);
      const res = await api.acceptInvitation(inv.id, {
        node_id: identity.nodeId,
        public_key: exportPublicKeyBase64Url(pk),
      });
      saveGroupAdminKey(res.group_id, res.pk_admin);
      await refresh();
      setToast(`已加入「${inv.group?.name ?? inv.groupId}」`);
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
      <main className="app-page">
        <p>
          请先 <Link to="/">生成身份</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="app-page">
      <header className="app-page-header">
        <div>
          <p className="app-breadcrumb">
            <Link to="/dashboard">总览</Link>
            <span> / 连接与邀请</span>
          </p>
          <h1>连接与邀请</h1>
          <p className="app-muted">邀请、局域网邻居与加入群组</p>
        </div>
      </header>

      {toast && <div className="app-toast">{toast}</div>}
      {error && <p className="app-error">{error}</p>}

      <section className="app-panel">
        <h2>待处理邀请</h2>
        {invitations.length === 0 ? (
          <p className="app-muted">暂无新邀请</p>
        ) : (
          <ul className="app-invite-list">
            {invitations.map((inv) => (
              <li key={inv.id} className="app-invite-item">
                <div>
                  <strong>{inv.group?.name ?? inv.groupId}</strong>
                  <p className="app-muted">来自群组邀请</p>
                </div>
                <div className="app-row-actions">
                  <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={() => void acceptInvitation(inv)}>
                    接受
                  </button>
                  <button type="button" className="app-btn" disabled={busy} onClick={() => void rejectInvitation(inv)}>
                    拒绝
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="app-panel">
        <h2>网络与邻居</h2>
        {network ? (
          <p className="app-muted">本机网络已连接 LAN Agent</p>
        ) : (
          <p className="app-muted">
            {lanError ?? "无法连接 lan-agent"} · <code>{getLanAgentBaseUrl()}</code>
          </p>
        )}
        <div className="app-search-row">
          <input
            className="app-input"
            placeholder="按 UID 前缀搜索邻居…"
            value={peerQuery}
            onChange={(e) => setPeerQuery(e.target.value)}
          />
          <button type="button" className="app-btn" onClick={() => void onSearchUid()}>
            搜索
          </button>
        </div>
        <ul className="app-peer-list">
          {peers.length === 0 && <li className="app-muted">暂无邻居</li>}
          {peers.map((p) => (
            <li key={`${p.uid}-${p.host}`}>
              <span>{p.host}:{p.port}</span>
              <span className="app-muted">{p.source}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="app-panel app-panel--narrow">
        <h2>加入群组</h2>
        <p className="app-muted">输入群组 ID 申请加入（需群主或成员邀请审批流程外直连入群）</p>
        <input
          className="app-input"
          placeholder="群组 ID"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
        />
        <button
          type="button"
          className="app-btn app-btn--primary"
          style={{ marginTop: 8 }}
          onClick={() => setToast(joinCode ? `已提交加入 ${joinCode}` : "请输入群组 ID")}
        >
          申请加入
        </button>
      </section>
    </main>
  );
}
