import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { isFolderDoc, randomUuid } from "@dpe/shared";
import { DocTreeNav, ROOT_DOC_ID } from "../components/DocTreeNav";
import { DocInlineEditor } from "../components/DocInlineEditor";
import { DocNodePermissionsPanel } from "../components/DocNodePermissionsPanel";
import { api, loadGroupAdminKey, type DocNodeRow } from "../lib/api";
import { useIdentity } from "../lib/use-identity";
import { startGroupMesh, stopGroupMesh } from "../lib/mesh-context";
import {
  getRealtimeDebugSnapshot,
  resetRealtimeDebugSnapshot,
  subscribeRealtimeDebug,
  type RealtimeDebugSnapshot,
} from "../lib/realtime-debug";

function isFolder(n: DocNodeRow) {
  return isFolderDoc(n);
}

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const identity = useIdentity();
  const nodeId = identity?.nodeId ?? "";
  const myName = identity?.displayName ?? "";
  const gid = groupId ?? "";

  const [nodes, setNodes] = useState<DocNodeRow[]>([]);
  const [groupName, setGroupName] = useState("群组");
  const [isOwner, setIsOwner] = useState(false);
  const [p2pStatus, setP2pStatus] = useState("未连接");
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<RealtimeDebugSnapshot>(() => getRealtimeDebugSnapshot());
  const [meshGen, setMeshGen] = useState(0);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [renameTitle, setRenameTitle] = useState("");
  const [selectedId, setSelectedId] = useState(ROOT_DOC_ID);
  const meshBusyRef = useRef(false);

  const selectedNode = nodes.find((n) => n.docId === selectedId);
  const selectedIsFolder = selectedNode ? isFolder(selectedNode) : true;
  const syncDocId = selectedIsFolder ? ROOT_DOC_ID : selectedId;

  useEffect(() => {
    setRenameTitle(selectedNode?.title ?? "");
  }, [selectedId, selectedNode?.title]);

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

  useEffect(() => {
    const off = subscribeRealtimeDebug((snapshot) => setDebug(snapshot));
    return off;
  }, []);

  useEffect(() => {
    if (!nodeId || !gid) return;
    let cancelled = false;
    void (async () => {
      try {
        const myGroups = await api.listAllGroups(nodeId);
        if (cancelled) return;
        const card = myGroups.find((g) => g.group_id === gid);
        setIsOwner(card?.is_owner ?? false);
        if (card) setGroupName(card.name);
        const tree = await api.getTree(gid, nodeId);
        if (cancelled) return;
        setNodes(tree.nodes);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载群组失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gid, nodeId]);

  useEffect(() => {
    if (!nodeId || !gid) return;

    const pkAdmin = loadGroupAdminKey(gid);
    if (!pkAdmin) {
      setP2pStatus("未连接");
      setError("未缓存 pk_admin，请从建群/入群流程进入");
      return;
    }

    const ac = new AbortController();
    const gen = meshGen;

    void (async () => {
      if (meshBusyRef.current) return;
      meshBusyRef.current = true;
      setP2pStatus("连接中…");
      setError(null);

      try {
        const mem = await api.listMembers(gid);
        if (ac.signal.aborted || gen !== meshGen) return;

        const memberMap = new Map<string, string>();
        for (const m of mem.members) memberMap.set(m.node_id, m.public_key);

        await startGroupMesh({
          groupId: gid,
          nodeId,
          adminPublicKeyBase64Url: pkAdmin,
          memberPublicKeys: memberMap,
          getJwt: async () => {
            const r = await api.refreshJwt(gid, nodeId, syncDocId);
            return r.jwt;
          },
        });

        if (ac.signal.aborted || gen !== meshGen) return;
        setP2pStatus("已连接");
        setError(null);
      } catch (e) {
        if (ac.signal.aborted || gen !== meshGen) return;
        setError(e instanceof Error ? e.message : "P2P 连接失败");
        setP2pStatus("信令未连接");
      } finally {
        meshBusyRef.current = false;
      }
    })();

    return () => {
      ac.abort();
      meshBusyRef.current = false;
      void stopGroupMesh();
    };
  }, [gid, nodeId, meshGen, syncDocId]);

  async function refreshTree() {
    if (!nodeId) return;
    const tree = await api.getTree(gid, nodeId);
    setNodes(tree.nodes);
  }

  function retryP2p() {
    resetRealtimeDebugSnapshot();
    setMeshGen((n) => n + 1);
  }

  async function renameSelected() {
    if (!nodeId || selectedId === ROOT_DOC_ID) return;
    const title = renameTitle.trim();
    if (!title) {
      setError("名称不能为空");
      return;
    }
    try {
      await api.renameDoc(gid, nodeId, selectedId, title);
      await refreshTree();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "重命名失败");
    }
  }

  async function deleteSelected() {
    if (!nodeId || selectedId === ROOT_DOC_ID) return;
    const label = selectedNode?.title ?? selectedId;
    const hint = selectedIsFolder
      ? "仅可删除空目录，且无法恢复。"
      : "删除后无法恢复。";
    if (!window.confirm(`确定删除「${label}」？${hint}`)) return;
    try {
      await api.deleteDoc(gid, nodeId, selectedId);
      localStorage.removeItem(`dpe_doc_${gid}_${selectedId}`);
      const parentId = selectedNode?.parentDocId ?? ROOT_DOC_ID;
      await refreshTree();
      selectNode(parentId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function createChild(is_folder: boolean) {
    if (!nodeId) return;
    const parentId = selectedIsFolder
      ? selectedId
      : (selectedNode?.parentDocId ?? ROOT_DOC_ID);
    const parent = nodes.find((n) => n.docId === parentId);
    if (!parent || !isFolder(parent)) return;
    const doc_id = randomUuid();
    try {
      await api.createChild(gid, nodeId, {
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
      setError(e instanceof Error ? e.message : is_folder ? "新建目录失败" : "新建文档失败");
    }
  }

  if (!identity) {
    return (
      <main className="app-page">
        <p>
          请先 <Link to="/">完成引导</Link>
        </p>
      </main>
    );
  }

  const createParentId = selectedIsFolder
    ? selectedId
    : (selectedNode?.parentDocId ?? ROOT_DOC_ID);
  const createParent = nodes.find((n) => n.docId === createParentId);

  return (
    <main className="app-group-page app-group-page--shell">
      <header className="app-page-header app-group-page__header">
        <div>
          <p className="app-breadcrumb">
            <Link to="/dashboard">总览</Link>
            <span> / </span>
            <span>{groupName}</span>
            <span className="app-muted"> · {myName}</span>
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
          <p className="app-muted">
            Debug · tx {debug.txCount}/{debug.txBytes}B · rx {debug.rxCount}/{debug.rxBytes}B
            {debug.lastRejectReason ? ` · reject=${debug.lastRejectReason}` : ""}
            {debug.lastAuthError ? ` · authErr=${debug.lastAuthError}` : ""}
          </p>
        </div>
      </header>

      {error && <p className="app-error app-group-page__error">{error}</p>}

      <div className="app-group-layout">
        <aside className="app-group-sidebar">
          <DocTreeNav nodes={nodes} groupId={gid} activeId={selectedId} onSelectNode={selectNode} />
          <div className="app-group-sidebar__create">
            <span className="app-muted">
              创建于：<strong>{createParent?.title ?? "根目录"}</strong>
            </span>
            <input
              className="app-input"
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              placeholder="标题"
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
          {selectedId !== ROOT_DOC_ID && (
            <div className="app-group-sidebar__manage">
              <h3>当前项</h3>
              <label className="app-muted" htmlFor="rename-doc-title">
                名称
              </label>
              <input
                id="rename-doc-title"
                className="app-input"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void renameSelected();
                }}
              />
              <div className="app-form-row">
                <button type="button" className="app-btn" onClick={() => void renameSelected()}>
                  重命名
                </button>
                <button
                  type="button"
                  className="app-btn app-btn--danger"
                  onClick={() => void deleteSelected()}
                >
                  删除
                </button>
              </div>
              <p className="app-muted app-group-sidebar__hint">
                需要对该节点具备可治理权限（角色 ≥ 3）。目录须为空才能删除。
              </p>
            </div>
          )}
        </aside>

        <section className="app-group-main">
          {selectedIsFolder ? (
            <div className="app-empty-state">
              <h2>{selectedNode?.title ?? "根目录"}</h2>
              <p className="app-muted">选择左侧文档进入协作编辑，或在当前目录下新建条目。</p>
            </div>
          ) : (
            <DocInlineEditor key={selectedId} groupId={gid} docId={selectedId} />
          )}
        </section>

        <DocNodePermissionsPanel groupId={gid} node={selectedNode} isOwner={isOwner} />
      </div>
    </main>
  );
}
