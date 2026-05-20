import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { TechDetails, TechRow } from "../components/TechDetails";
import { MOCK_IDENTITY } from "../mock-data";
import type { DesignOutletContext } from "../DesignLayout";

export default function WelcomeScreen() {
  const { base, meta } = useOutletContext<DesignOutletContext>();
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onCreate() {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 600));
    setReady(true);
    setBusy(false);
  }

  return (
    <main className="dpe-page dpe-page--centered">
      <div className="dpe-hero-card">
        <p className="dpe-eyebrow">Distributed Privacy Editor</p>
        <h1>创建本机协作身份</h1>
        <p className="dpe-lead">
          {meta.tagline}。界面使用友好名称展示成员与节点；完整 Node ID、公钥等仅在技术详情中查看。
        </p>

        {!ready ? (
          <div className="dpe-stack">
            <ul className="dpe-checklist">
              <li>浏览器内生成 Ed25519 密钥对</li>
              <li>入群时钉扎管理员公钥（pk_admin）</li>
              <li>文档更新经 AES-GCM + SignedUpdate 同步</li>
            </ul>
            <button type="button" className="dpe-btn dpe-btn--primary" disabled={busy} onClick={() => void onCreate()}>
              {busy ? "正在生成…" : "生成本机身份"}
            </button>
          </div>
        ) : (
          <div className="dpe-identity-ready">
            <div className="dpe-avatar" aria-hidden>
              {MOCK_IDENTITY.displayName.slice(0, 1)}
            </div>
            <div>
              <h2>{MOCK_IDENTITY.displayName}</h2>
              <p className="dpe-muted">身份已就绪，可进入总览使用全部功能入口。</p>
            </div>
            <TechDetails>
              <TechRow label="Node ID (UID)" value={MOCK_IDENTITY.nodeId} />
              <TechRow label="公钥 (Base64URL)" value={MOCK_IDENTITY.publicKeyPreview} />
              <TechRow label="创建时间" value={MOCK_IDENTITY.createdAt} />
            </TechDetails>
            <div className="dpe-row-actions">
              <button type="button" className="dpe-btn dpe-btn--primary" onClick={() => nav(`${base}/dashboard`)}>
                进入总览
              </button>
              <Link to="/designs" className="dpe-btn dpe-btn--ghost">
                切换设计风格
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
