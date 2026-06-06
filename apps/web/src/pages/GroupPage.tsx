import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { isFolderDoc, randomUuid } from "@dpe/shared";
import { DocTreeNav, ROOT_DOC_ID } from "../components/DocTreeNav";
import { DocInlineEditor } from "../components/DocInlineEditor";
import { DocNodePermissionsPanel } from "../components/DocNodePermissionsPanel";
import {
  ApiError,
  api,
  loadGroupAdminKey,
  loadGroupControlPlaneUrl,
  resolveGroupControlPlaneUrl,
  saveGroupControlPlaneUrl,
  type DocNodeRow,
} from "../lib/api";
import { useIdentity } from "../lib/use-identity";
import { getActiveMesh, startGroupMesh, stopGroupMesh } from "../lib/mesh-context";
import { resetRealtimeDebugSnapshot } from "../lib/realtime-debug";
import { clearRealtimeTrace, setRealtimeTraceContext } from "../lib/realtime-trace";
import {
  buildMeshSignalingUrls,
  fetchDiscovery,
  fetchLocalSignalingUrl,
  subscribeDiscovery,
  type LanPeer,
} from "../lib/lan";

function isFolder(n: DocNodeRow) {
  return isFolderDoc(n);
}

function explainGroupError(error: unknown, nodeId: string, groupId: string): string {
  if (error instanceof ApiError) {
    const msg = error.message.toLowerCase();
    if (error.status === 403 && msg.includes("not a member")) {
      return `当前身份不在该群组内（node_id=${nodeId}）。请在此身份下重新接受邀请后再进入群组 ${groupId}。`;
    }
    if (error.status === 404 && msg.includes("group")) {
      return `群组不存在或已被解散（group_id=${groupId}）。请返回总览页确认群组列表。`;
    }
    if (error.status === 401) {
      return `当前会话认证失效（node_id=${nodeId}）。请重新进入群组并刷新凭证。`;
    }
  }
  return error instanceof Error ? error.message : "操作失败";
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
  const [adminPublicKey, setAdminPublicKey] = useState<string | null>(null);
  const [controlPlaneUrl, setControlPlaneUrl] = useState<string | undefined>(() =>
    resolveGroupControlPlaneUrl(gid, searchParams.get("control")),
  );
  const [peers, setPeers] = useState<LanPeer[]>([]);
  const [localSignalingUrl, setLocalSignalingUrl] = useState<string | undefined>();
  const [p2pStatus, setP2pStatus] = useState("未连接");
  const [error, setError] = useState<string | null>(null);
  const [meshGen, setMeshGen] = useState(0);

  const [newItemTitle, setNewItemTitle] = useState("");
  const [renameTitle, setRenameTitle] = useState("");
  const [selectedId, setSelectedId] = useState(ROOT_DOC_ID);

  const selectedNode = nodes.find((n) => n.docId === selectedId);
  const selectedIsFolder = selectedNode ? isFolder(selectedNode) : true;
  const syncDocId = selectedIsFolder ? ROOT_DOC_ID : selectedId;
  const syncDocIdRef = useRef(syncDocId);
  const peerSignalingUrls = useMemo(
    () => [...new Set(peers.map((p) => p.signalingUrl).filter(Boolean))].sort(),
    [peers],
  );
  const peerSignalingKey = peerSignalingUrls.join("\n");
  // Signaling URLs must accumulate monotonically. lan-agent discovery is probe-based
  // and flaps (a neighbour briefly drops out of the list); if we let the signaling set
  // SHRINK on a flap, meshSignalingKey changes and the whole mesh is stopped/restarted,
  // tearing down the WebRTC offer/answer handshake before it can complete. So we only
  // ever ADD rendezvous URLs, never remove them.
  const seenSignalingRef = useRef<Set<string>>(new Set());
  const [meshSignalingUrls, setMeshSignalingUrls] = useState<string[]>([]);
  useEffect(() => {
    const candidates = buildMeshSignalingUrls({
      localSignalingUrl,
      peerSignalingUrls,
      controlPlaneUrl: controlPlaneUrl ?? loadGroupControlPlaneUrl(gid) ?? undefined,
    });
    let grew = false;
    for (const u of candidates) {
      if (!seenSignalingRef.current.has(u)) {
        seenSignalingRef.current.add(u);
        grew = true;
      }
    }
    if (grew) setMeshSignalingUrls([...seenSignalingRef.current].sort());
  }, [localSignalingUrl, controlPlaneUrl, gid, peerSignalingKey]);
  const meshSignalingKey = meshSignalingUrls.join("\n");
  const meshSignalingUrlsRef = useRef<string[]>([]);
  meshSignalingUrlsRef.current = meshSignalingUrls;
  // Push newly-learned rendezvous URLs into the RUNNING mesh instead of restarting it.
  useEffect(() => {
    getActiveMesh()?.addSignalingUrls(meshSignalingUrls);
  }, [meshSignalingKey]);
  const controlQuery = controlPlaneUrl ? `?control=${encodeURIComponent(controlPlaneUrl)}` : "";
  useEffect(() => {
    syncDocIdRef.current = syncDocId;
  }, [syncDocId]);
  useEffect(() => {
    void getActiveMesh()?.reauthAllChannels();
  }, [syncDocId]);
  useEffect(() => {
    setRealtimeTraceContext({
      groupId: gid,
      nodeId: nodeId?.slice(0, 16),
      docId: syncDocId,
      origin: typeof location !== "undefined" ? location.origin : "",
    });
  }, [gid, nodeId, syncDocId]);
  useEffect(() => {
    setRenameTitle(selectedNode?.title ?? "");
  }, [selectedId, selectedNode?.title]);

  useEffect(() => {
    const doc = searchParams.get("doc");
    if (doc) setSelectedId(doc);
    const resolved = resolveGroupControlPlaneUrl(gid, searchParams.get("control"));
    setControlPlaneUrl(resolved);
  }, [searchParams, gid]);

  const selectNode = useCallback(
    (docId: string) => {
      setSelectedId(docId);
      const next: Record<string, string> = {};
      if (docId !== ROOT_DOC_ID) next.doc = docId;
      if (controlPlaneUrl) next.control = controlPlaneUrl;
      setSearchParams(next, { replace: true });
    },
    [controlPlaneUrl, setSearchParams],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchLocalSignalingUrl().then((url) => {
      if (!cancelled && url) setLocalSignalingUrl(url);
    });
    void fetchDiscovery()
      .then((d) => {
        if (!cancelled) setPeers(d.peers);
      })
      .catch(() => {
        if (!cancelled) setPeers([]);
      });
    const off = subscribeDiscovery((list) => {
      if (!cancelled) setPeers(list);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    if (!nodeId || !gid) return;
    let cancelled = false;
    void (async () => {
      try {
        const myGroups = await api.listAllGroupsFederated(nodeId, peers);
        if (cancelled) return;
        const card = myGroups.find(
          (g) => g.group_id === gid && (!controlPlaneUrl || g.control_plane_url === controlPlaneUrl),
        ) ?? myGroups.find((g) => g.group_id === gid);
        setIsOwner(card?.is_owner ?? false);
        const cp = card?.control_plane_url ?? controlPlaneUrl ?? loadGroupControlPlaneUrl(gid) ?? undefined;
        if (card) {
          setGroupName(card.name);
          // Never downgrade a known issuer key to the local fallback: a partial
          // federated response would otherwise flip adminPublicKey and churn the mesh.
          setAdminPublicKey((prev) => card.issuer_public_key ?? prev ?? loadGroupAdminKey(gid) ?? null);
          if (cp) {
            // Pin the first resolved control-plane URL; discovery refreshes must not
            // flip it back and forth (which would stop/start the whole P2P mesh).
            setControlPlaneUrl((prev) => prev ?? cp);
            saveGroupControlPlaneUrl(gid, cp);
          }
        }
        const tree = await api.getTree(gid, nodeId, cp);
        if (cancelled) return;
        setNodes(tree.nodes);
      } catch (e) {
        if (!cancelled) {
          setError(explainGroupError(e, nodeId, gid));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gid, nodeId, controlPlaneUrl]);


  useEffect(() => {
    if (!nodeId || !gid) return;

    const cp =
      controlPlaneUrl ?? loadGroupControlPlaneUrl(gid) ?? undefined;
    const pkAdmin = adminPublicKey ?? loadGroupAdminKey(gid);
    if (!pkAdmin) {
      setP2pStatus("未连接");
      setError(
        `缺少该群组的管理员公钥。当前 node_id=${nodeId}；请刷新群组列表或重新进入 group_id=${gid}。`,
      );
      return;
    }

    const ac = new AbortController();
    const gen = meshGen;
    let startedMeshToken: number | undefined;
    let ownsStartedMesh = false;

    void (async () => {
      setP2pStatus("连接中…");
      setError(null);

      try {
        const mem = await api.listMembers(gid, cp);
        if (ac.signal.aborted || gen !== meshGen) return;

        const memberMap = new Map<string, string>();
        for (const m of mem.members) memberMap.set(m.node_id, m.public_key);

        const started = await startGroupMesh({
          groupId: gid,
          nodeId,
          adminPublicKeyBase64Url: pkAdmin,
          memberPublicKeys: memberMap,
          signalingUrls: meshSignalingUrlsRef.current,
          getJwt: async () => {
            const r = await api.refreshJwt(gid, nodeId, syncDocIdRef.current, cp);
            return r.jwt;
          },
        });
        startedMeshToken = started.token;
        ownsStartedMesh = started.owned;

        if (ac.signal.aborted || gen !== meshGen) {
          if (started.owned) void stopGroupMesh(started.token);
          return;
        }
        setP2pStatus("已连接");
        setError(null);
      } catch (e) {
        if (ac.signal.aborted || gen !== meshGen) return;
        setError(explainGroupError(e, nodeId, gid));
        setP2pStatus("信令未连接");
      }
    })();

    return () => {
      ac.abort();
      if (ownsStartedMesh && typeof startedMeshToken === "number") void stopGroupMesh(startedMeshToken);
    };
  }, [gid, nodeId, adminPublicKey, controlPlaneUrl, meshGen]);

  async function refreshTree() {
    if (!nodeId) return;
    const tree = await api.getTree(gid, nodeId, controlPlaneUrl);
    setNodes(tree.nodes);
  }

  function retryP2p() {
    resetRealtimeDebugSnapshot();
    clearRealtimeTrace();
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
      await api.renameDoc(gid, nodeId, selectedId, title, controlPlaneUrl);
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
      await api.deleteDoc(gid, nodeId, selectedId, controlPlaneUrl);
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
      await api.createChild(
        gid,
        nodeId,
        {
          parent_doc_id: parentId,
          doc_id,
          title: newItemTitle.trim() || (is_folder ? "未命名目录" : "未命名文档"),
          is_folder,
        },
        controlPlaneUrl,
      );
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
            {" "}
            <button type="button" className="app-btn app-btn--small" onClick={retryP2p}>
              重试连接
            </button>
            {isOwner && (
              <>
                {" "}
                · <Link to={`/groups/${gid}/settings${controlQuery}`}>群组设置</Link>
              </>
            )}
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
            <DocInlineEditor
              key={selectedId}
              groupId={gid}
              docId={selectedId}
              controlPlaneUrl={controlPlaneUrl}
            />
          )}
        </section>

        <DocNodePermissionsPanel
          groupId={gid}
          node={selectedNode}
          isOwner={isOwner}
          controlPlaneUrl={controlPlaneUrl}
        />
      </div>
    </main>
  );
}
