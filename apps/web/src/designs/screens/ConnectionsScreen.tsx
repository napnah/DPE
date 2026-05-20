import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { TechDetails, TechRow } from "../components/TechDetails";
import type { DesignOutletContext } from "../DesignLayout";
import {
  MOCK_INVITATIONS,
  MOCK_NETWORK,
  MOCK_PEERS,
} from "../mock-data";

export default function ConnectionsScreen() {
  const { base } = useOutletContext<DesignOutletContext>();
  const [invitations, setInvitations] = useState(MOCK_INVITATIONS);
  const [peers] = useState(MOCK_PEERS);
  const [peerQuery, setPeerQuery] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  return (
    <main className="dpe-page">
      <header className="dpe-page-header">
        <div>
          <p className="dpe-breadcrumb">
            <Link to={`${base}/dashboard`}>总览</Link>
            <span>/</span>
            <span>连接与邀请</span>
          </p>
          <h1>连接与邀请</h1>
          <p className="dpe-muted">邀请、局域网邻居与加入群组 — 设计预览</p>
        </div>
      </header>

      {toast && <div className="dpe-toast">{toast}</div>}

      <div className="dpe-split-panels">
        <section className="dpe-panel">
          <h2>待处理邀请</h2>
          {invitations.length === 0 ? (
            <p className="dpe-empty">暂无新邀请</p>
          ) : (
            <ul className="dpe-invite-cards">
              {invitations.map((inv) => (
                <li key={inv.id} className="dpe-invite-card">
                  <div>
                    <strong>{inv.groupName}</strong>
                    <p className="dpe-muted">
                      {inv.inviterName} 邀请你 · {inv.invitedAt}
                    </p>
                  </div>
                  <div className="dpe-row-actions">
                    <button
                      type="button"
                      className="dpe-btn dpe-btn--primary"
                      onClick={() => {
                        setInvitations((list) => list.filter((i) => i.id !== inv.id));
                        flash(`已接受「${inv.groupName}」`);
                      }}
                    >
                      接受
                    </button>
                    <button
                      type="button"
                      className="dpe-btn"
                      onClick={() => {
                        setInvitations((list) => list.filter((i) => i.id !== inv.id));
                        flash("已拒绝邀请");
                      }}
                    >
                      拒绝
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dpe-panel">
          <h2>网络与邻居</h2>
          <div className="dpe-stat-grid">
            <div className="dpe-stat">
              <span className="dpe-stat__label">LAN Agent</span>
              <StatusBadge label="已连接" tone="ok" />
            </div>
            <div className="dpe-stat">
              <span className="dpe-stat__label">本机</span>
              <span>{MOCK_NETWORK.hostname}</span>
            </div>
          </div>
          <div className="dpe-search-row">
            <input
              className="dpe-input"
              placeholder="按备注名或主机名搜索…"
              value={peerQuery}
              onChange={(e) => setPeerQuery(e.target.value)}
            />
            <button type="button" className="dpe-btn" onClick={() => flash("已搜索邻居")}>
              搜索
            </button>
          </div>
          <ul className="dpe-list">
            {peers.map((p) => (
              <li key={p.id} className="dpe-peer-row">
                <div>
                  <strong>{p.displayName}</strong>
                  <span className="dpe-muted">{p.source === "mDNS" ? "自动发现" : "手动添加"}</span>
                </div>
                <button type="button" className="dpe-btn dpe-btn--small" onClick={() => flash(`已向 ${p.displayName} 发送邀请`)}>
                  邀请
                </button>
              </li>
            ))}
          </ul>
          <TechDetails title="接口">
            <TechRow label="lan-agent" value={MOCK_NETWORK.lanAgent} />
            <TechRow label="signaling" value={MOCK_NETWORK.signaling} />
          </TechDetails>
        </section>
      </div>

      <section className="dpe-panel dpe-panel--narrow">
        <h2>通过群组 ID 加入</h2>
        <label className="dpe-field">
          <span>群组标识</span>
          <input
            className="dpe-input"
            placeholder="例如 grp-course-2026"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="dpe-btn dpe-btn--primary"
          onClick={() => flash(joinCode ? `已提交加入「${joinCode}」` : "请输入群组标识")}
        >
          申请加入
        </button>
      </section>
    </main>
  );
}
