import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { GroupCard } from "../../components/GroupCard";
import { Modal } from "../components/Modal";
import { TechDetails, TechRow } from "../components/TechDetails";
import type { DesignOutletContext } from "../DesignLayout";
import { MOCK_ALL_GROUPS, MOCK_IDENTITY, shortId } from "../mock-data";

export default function DashboardScreen() {
  const { base } = useOutletContext<DesignOutletContext>();
  const [createOpen, setCreateOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  return (
    <main className="dpe-page">
      <header className="dpe-page-header">
        <div>
          <h1>总览</h1>
          <p className="dpe-muted">我的群组与协作空间 — 设计预览</p>
        </div>
        <div className="dpe-page-header__actions">
          <Link to={`${base}/connections`} className="dpe-btn">
            连接与邀请
          </Link>
          <button type="button" className="dpe-btn dpe-btn--primary" onClick={() => setCreateOpen(true)}>
            新建群组
          </button>
        </div>
      </header>

      {toast && <div className="dpe-toast">{toast}</div>}

      <section className="dpe-panel">
        <h2>我的群组</h2>
        <div className="group-card-grid">
          {MOCK_ALL_GROUPS.map((g) => (
            <GroupCard
              key={g.group_id}
              group={g}
              to={`${base}/groups/${g.group_id}`}
            />
          ))}
        </div>
      </section>

      <Modal
        open={createOpen}
        title="新建群组"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="dpe-btn" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="dpe-btn dpe-btn--primary"
              onClick={() => {
                setCreateOpen(false);
                flash(newGroupName ? `已创建「${newGroupName}」` : "已创建群组");
                setNewGroupName("");
                setNewGroupDesc("");
              }}
            >
              创建
            </button>
          </>
        }
      >
        <label className="dpe-field">
          <span>群组名称</span>
          <input
            className="dpe-input"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="例如：课程项目组"
          />
        </label>
        <label className="dpe-field">
          <span>群组描述</span>
          <input
            className="dpe-input"
            value={newGroupDesc}
            onChange={(e) => setNewGroupDesc(e.target.value)}
            placeholder="可选"
          />
        </label>
        <TechDetails>
          <TechRow label="API" value="POST /groups" />
          <TechRow label="owner_node_id" value={shortId(MOCK_IDENTITY.nodeId, 20)} />
        </TechDetails>
      </Modal>
    </main>
  );
}
