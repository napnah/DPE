# -*- coding: utf-8 -*-
from pathlib import Path

GROUP_PAGE = r'''import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { isFolderDoc } from "@dpe/shared";
import { DocTreeNav, ROOT_DOC_ID } from "../components/DocTreeNav";
import { DocInlineEditor } from "../components/DocInlineEditor";
import { DocNodePermissionsPanel } from "../components/DocNodePermissionsPanel";
import { api, loadGroupAdminKey, type DocNodeRow } from "../lib/api";
import { loadIdentity } from "../lib/identity";
import { startGroupMesh, stopGroupMesh } from "../lib/mesh-context";

function isFolder(n: DocNodeRow) {
  return isFolderDoc(n);
}

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const identity = loadIdentity();
  const gid = groupId ?? "";

  const [nodes, setNodes] = useState<DocNodeRow[]>([]);
  const [groupName, setGroupName] = useState("群组");
  const [isOwner, setIsOwner] = useState(false);
  const [p2pStatus, setP2pStatus] = useState("未连接");
  const [error, setError] = useState<string | null>(null);
  const [meshGen, setMeshGen] = useState(0);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [selectedId, setSelectedId] = useState(ROOT_DOC_ID);

  const selectedNode = nodes.find((n) => n.docId === selectedId);
  const parentIsFolder = selectedNode ? isFolder(selectedNode) : true;
  const selectedIsFolder = selectedNode ? isFolder(selectedNode) : true;

  useEffect(() => {
    const doc = searchParams.get("doc");
    if (doc) setSelectedId(doc);
  }, [searchParams]);

  const selectNode = useCallback(
    (docId: string) => {
      setSelectedId(docId);
      setSearchParams(docId === ROOT_DOC_ID ? {} : { doc: docId }, { replace: true });
    },
    [setSearchParams],
  );

  const connectMesh = useCallback(
    async (signal: AbortSignal) => {
      const pkAdmin = loadGroupAdminKey(gid);
      if (!pkAdmin) {
        setP2pStatus("未连接");
        setError("未配置 pk_admin，请从建群/入群流程接入");
        return;
      }
      if (!identity) return;

      setP2pStatus("连接中…");
      setError(null);

      const myGroups = await api.listAllGroups(identity.nodeId);
      const card = myGroups.find((g) => g.group_id === gid);
      setIsOwner(card?.is_owner ?? false);
      if (card) setGroupName(card.name);

      const tree = await api.getTree(gid, identity.nodeId);
      if (signal.aborted) return;
      setNodes(tree.nodes);

      const memberMap = new Map<string, string>();
      const mem = await api.listMembers(gid);
      for (const m of mem.members) memberMap.set(m.node_id, m.public_key);

      await startGroupMesh({
        groupId: gid,
        nodeId: identity.nodeId,
        adminPublicKeyBase64Url: pkAdmin,
        memberPublicKeys: memberMap,
        getJwt: async () => {
          const r = await api.refreshJwt(gid, identity.nodeId, "root");
          return r.jwt;
        },
      });
      if (signal.aborted) return;

      setP2pStatus("已连接");
      setError(null);
    },
    [gid, identity],
  );

  useEffect(() => {
    if (!identity || !gid) return;
    const ac = new AbortController();
    void connectMesh(ac.signal).catch((e) => {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : "P2P 连接失败");
      setP2pStatus("信令未连接");
    });
    return () => {
      ac.abort();
      void stopGroupMesh();
    };
  }, [identity, gid, meshGen, connectMesh]);

  async function refreshTree() {
    if (!identity) return;
    const tree = await api.getTree(gid, identity.nodeId);
    setNodes(tree.nodes);
  }

  function retryP2p() {
    setMeshGen((n) => n + 1);
  }

  async function createChild(is_folder: boolean) {
    if (!identity || !parentIsFolder) return;
    const parentId = selectedIsFolder ? selectedId : (selectedNode?.parentDocId ?? ROOT_DOC_ID);
    const doc_id = crypto.randomUUID();
    try {
      await api.createChild(gid, identity.nodeId, {
        parent_doc_id: parentId,
        doc_id,
        title: newItemTitle.trim() || (is_folder ? "未命名目录" : "未命名文档"),
        is_folder,
      });
      await refreshTree();
      setNewItemTitle("");
      if (!is_folder) selectNode(doc_id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : is_folder ? "创建目录失败" : "创建文档失败");
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

  const createParentId = selectedIsFolder
    ? selectedId
    : (selectedNode?.parentDocId ?? ROOT_DOC_ID);
  const createParent = nodes.find((n) => n.docId === createParentId);

  return (
    <main className="app-group-page">
      <header className="app-page-header app-group-page__header">
        <div>
          <p className="app-breadcrumb">
            <Link to="/dashboard">总览</Link>
            <span> / </span>
            <span>{groupName}</span>
          </p>
          <h1>{groupName}</h1>
          <p className="app-muted">
            P2P: {p2pStatus}
            {p2pStatus === "信令未连接" && (
              <>
                {" "}
                <button type="button" className="app-btn app-btn--small" onClick={retryP2p}>
                  重试连接
                </button>
              </>
            )}
            {isOwner && (
              <>
                {" "}
                · <Link to={`/groups/${gid}/settings`}>群组设置</Link>
              </>
            )}
          </p>
        </div>
      </header>

      {error && <p className="app-error app-group-page__error">{error}</p>}

      <div className="app-group-layout">
        <aside className="app-group-sidebar">
          <h2>文档</h2>
          <p className="app-muted app-group-sidebar__hint">点击目录或文档在同一页查看与编辑</p>
          <DocTreeNav nodes={nodes} groupId={gid} activeId={selectedId} onSelectNode={selectNode} />
          <div className="app-group-sidebar__create">
            <span className="app-muted">
              创建于：<strong>{createParent?.title ?? "根目录"}</strong>
            </span>
            <input
              className="app-input"
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              placeholder="名称"
            />
            <div className="app-form-row">
              <button
                type="button"
                className="app-btn"
                disabled={!createParent || !isFolder(createParent)}
                onClick={() => void createChild(true)}
              >
                新建子目录
              </button>
              <button
                type="button"
                className="app-btn app-btn--primary"
                disabled={!createParent || !isFolder(createParent)}
                onClick={() => void createChild(false)}
              >
                新建文档
              </button>
            </div>
          </div>
        </aside>

        <section className="app-group-main">
          {selectedIsFolder ? (
            <div className="app-empty-state">
              <h2>{selectedNode?.title ?? "根目录"}</h2>
              <p className="app-muted">选择左侧文档进行协作编辑，或在当前目录下新建子项。</p>
            </div>
          ) : (
            <DocInlineEditor groupId={gid} docId={selectedId} />
          )}
        </section>

        <DocNodePermissionsPanel groupId={gid} node={selectedNode} isOwner={isOwner} />
      </div>
    </main>
  );
}
'''

path = Path(__file__).resolve().parents[1] / "apps/web/src/pages/GroupPage.tsx"
path.write_text(GROUP_PAGE, encoding="utf-8", newline="\n")
print("wrote", path)
