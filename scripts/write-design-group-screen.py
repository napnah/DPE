# -*- coding: utf-8 -*-
from pathlib import Path

CONTENT = r'''import { useMemo, useState } from "react";
import { Link, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { ROOT_DOC_ID } from "@dpe/shared";
import { DocTreeNav } from "../../components/DocTreeNav";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { TechDetails, TechRow } from "../components/TechDetails";
import type { DesignOutletContext } from "../DesignLayout";
import {
  CONTROL_MODE_LABELS,
  MOCK_ALL_GROUPS,
  MOCK_DOC_ROLE_ACLS,
  MOCK_DOC_TREE,
  MOCK_EDITOR_CONTENT,
  ROLE_LABELS,
  shortId,
  type MockDocNode,
} from "../mock-data";

function isFolder(n: MockDocNode) {
  return n.isFolder ?? n.docId === ROOT_DOC_ID;
}

export default function GroupScreen() {
  const { groupId } = useParams<{ groupId: string }>();
  const { base } = useOutletContext<DesignOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const gid = groupId ?? "grp-course-2026";

  const groupCard = MOCK_ALL_GROUPS.find((g) => g.group_id === gid);
  const group = {
    group_id: gid,
    name: groupCard?.name ?? "群组预览",
    control_mode: "proxy" as const,
    proxy_base_url: null,
  };

  const [nodes, setNodes] = useState(MOCK_DOC_TREE);
  const [selectedId, setSelectedId] = useState(() => searchParams.get("doc") ?? ROOT_DOC_ID);
  const [p2pStatus, setP2pStatus] = useState<"connected" | "connecting" | "failed">("connected");
  const [newDocTitle, setNewDocTitle] = useState("");
  const [roleAcls, setRoleAcls] = useState(MOCK_DOC_ROLE_ACLS);
  const [content, setContent] = useState(MOCK_EDITOR_CONTENT);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const selectedNode = nodes.find((n) => n.docId === selectedId);
  const selectedIsFolder = selectedNode ? isFolder(selectedNode) : true;
  const isOwner = groupCard?.is_owner ?? false;
  const canManageAcl = isOwner;

  const createParentId = selectedIsFolder
    ? selectedId
    : (selectedNode?.parentDocId ?? ROOT_DOC_ID);
  const createParent = nodes.find((n) => n.docId === createParentId);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  function selectNode(id: string) {
    setSelectedId(id);
    setSearchParams(id === ROOT_DOC_ID ? {} : { doc: id }, { replace: true });
    setRoleAcls(MOCK_DOC_ROLE_ACLS);
  }

  function createChild(is_folder: boolean) {
    const parent = nodes.find((n) => n.docId === createParentId);
    if (!parent || !isFolder(parent)) {
      flash("请先选中一个目录");
      return;
    }
    const id = `${is_folder ? "folder" : "doc"}-${Date.now()}`;
    setNodes((list) => [
      ...list,
      {
        docId: id,
        parentDocId: createParentId,
        title: newDocTitle.trim() || (is_folder ? "未命名目录" : "未命名文档"),
        keyVersion: 1,
        isFolder: is_folder,
      },
    ]);
    setNewDocTitle("");
    if (!is_folder) selectNode(id);
    flash(is_folder ? "已创建子目录" : "已创建文档");
  }

  return (
    <main className="dpe-page dpe-page--group">
      {toast && <div className="dpe-toast">{toast}</div>}

      <header className="dpe-page-header dpe-page-header--compact">
        <div>
          <p className="dpe-breadcrumb">
            <Link to={`${base}/dashboard`}>总览</Link>
            <span>/</span>
            <span>{group.name}</span>
          </p>
          <h1>{group.name}</h1>
          <div className="dpe-inline-meta">
            <StatusBadge
              label={p2pStatus === "connected" ? "P2P 已连接" : p2pStatus === "connecting" ? "连接中" : "信令未连接"}
              tone={p2pStatus === "connected" ? "ok" : p2pStatus === "failed" ? "err" : "warn"}
            />
            <span className="dpe-muted">{CONTROL_MODE_LABELS[group.control_mode] ?? group.control_mode}</span>
            {isOwner && (
              <Link to={`${base}/groups/${gid}/settings`} className="dpe-btn dpe-btn--small">
                群组设置
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="dpe-group-layout">
        <aside className="dpe-sidebar">
          <div className="dpe-sidebar__head">
            <h2>文档</h2>
          </div>
          <p className="dpe-hint">目录与文档在同一页；点击即可切换。</p>
          <DocTreeNav
            nodes={nodes}
            groupId={gid}
            activeId={selectedId}
            onSelectNode={selectNode}
            className="dpe-tree-nav"
          />
          <input
            className="dpe-input dpe-input--compact"
            placeholder="名称…"
            value={newDocTitle}
            onChange={(e) => setNewDocTitle(e.target.value)}
          />
          <p className="dpe-muted" style={{ fontSize: 12 }}>
            创建于：{createParent?.title ?? "根目录"}
          </p>
          <button type="button" className="dpe-btn dpe-btn--small" onClick={() => createChild(true)}>
            子目录
          </button>
          <button type="button" className="dpe-btn dpe-btn--small dpe-btn--primary" onClick={() => createChild(false)}>
            文档
          </button>
        </aside>

        <section className="dpe-group-main">
          {selectedIsFolder ? (
            <div className="dpe-empty-state">
              <h2>{selectedNode?.title ?? "根目录"}</h2>
              <p className="dpe-muted">选择左侧文档进行编辑，或新建子目录/文档。</p>
            </div>
          ) : (
            <>
              <h2>{selectedNode?.title}</h2>
              <textarea
                className="dpe-editor"
                style={{ minHeight: 360 }}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </>
          )}
        </section>

        <aside className="dpe-inspector">
          <h3>当前节点权限</h3>
          <p className="dpe-muted">
            <strong>{selectedNode?.title}</strong>
            {selectedIsFolder ? "（目录）" : "（文档）"}
          </p>
          {!canManageAcl && <p className="dpe-muted">仅群主可修改角色权限映射。</p>}
          <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0" }}>
            {roleAcls.map((r) => (
              <li key={r.roleId} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ minWidth: 72, color: r.color, fontWeight: 600 }}>{r.name}</span>
                {canManageAcl ? (
                  <select
                    className="dpe-select"
                    value={r.access_level}
                    onChange={(e) => {
                      const level = Number(e.target.value);
                      setRoleAcls((list) =>
                        list.map((x) => (x.roleId === r.roleId ? { ...x, access_level: level } : x)),
                      );
                      flash(`已更新 ${ROLE_LABELS[level]}`);
                    }}
                  >
                    {Object.entries(ROLE_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>{ROLE_LABELS[r.access_level]}</span>
                )}
              </li>
            ))}
          </ul>
          <TechDetails title="RPC">
            <TechRow label="SetDocRoleAcl" value={selectedId} />
          </TechDetails>
          {isOwner && selectedId !== ROOT_DOC_ID && (
            <button
              type="button"
              className="dpe-btn dpe-btn--danger dpe-btn--block"
              style={{ marginTop: 12 }}
              onClick={() => setDeleteOpen(true)}
            >
              删除节点
            </button>
          )}
        </aside>
      </div>

      <Modal
        open={deleteOpen}
        title="删除"
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <button type="button" className="dpe-btn" onClick={() => setDeleteOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="dpe-btn dpe-btn--danger"
              onClick={() => {
                setNodes((list) => list.filter((n) => n.docId !== selectedId));
                selectNode(ROOT_DOC_ID);
                setDeleteOpen(false);
                flash("已删除");
              }}
            >
              确认
            </button>
          </>
        }
      >
        <p>确定删除「{selectedNode?.title}」？</p>
      </Modal>
    </main>
  );
}
'''

path = Path(__file__).resolve().parents[1] / "apps/web/src/designs/screens/GroupScreen.tsx"
path.write_text(CONTENT, encoding="utf-8", newline="\n")
print("wrote design GroupScreen")
