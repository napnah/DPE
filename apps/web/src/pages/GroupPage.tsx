import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, loadGroupAdminKey, type DocNodeRow } from "../lib/api";
import { loadIdentity } from "../lib/identity";
import { startGroupMesh, stopGroupMesh } from "../lib/mesh-context";

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const identity = loadIdentity();
  const gid = groupId ?? "";

  const [nodes, setNodes] = useState<DocNodeRow[]>([]);
  const [members, setMembers] = useState<{ node_id: string; public_key: string }[]>([]);
  const [aclUid, setAclUid] = useState("");
  const [aclRole, setAclRole] = useState(2);
  const [p2pStatus, setP2pStatus] = useState("未连接");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity || !gid) return;
    const pkAdmin = loadGroupAdminKey(gid);
    if (!pkAdmin) {
      setError("未保存 pk_admin，请从建群/入群流程进入");
    }

    void (async () => {
      try {
        const [tree, mem] = await Promise.all([
          api.getTree(gid, identity.nodeId),
          api.listMembers(gid),
        ]);
        setNodes(tree.nodes);
        setMembers(mem.members);

        const memberMap = new Map(mem.members.map((m) => [m.node_id, m.public_key]));
        if (pkAdmin) {
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
          setP2pStatus("信令已连接");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      }
    })();

    return () => {
      void stopGroupMesh();
    };
  }, [identity, gid]);

  async function setAcl() {
    if (!identity || !aclUid.trim()) return;
    try {
      await api.setAcl(gid, identity.nodeId, {
        op: "SetACL",
        doc_id: "root",
        user_node_id: aclUid.trim(),
        role: aclRole,
      });
      const tree = await api.getTree(gid, identity.nodeId);
      setNodes(tree.nodes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ACL 更新失败");
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
    <main style={{ padding: "2rem", maxWidth: 800 }}>
      <p>
        <Link to="/dashboard">← 总面板</Link>
      </p>
      <h1>群组</h1>
      <p>
        <code>{gid}</code> · P2P: {p2pStatus}
      </p>
      {error && <p style={{ color: "#f88" }}>{error}</p>}

      <div className="card">
        <h2>文档树</h2>
        <ul>
          {nodes.map((n) => (
            <li key={n.docId}>
              <Link to={`/groups/${gid}/docs/${n.docId}`}>{n.title}</Link>{" "}
              <small>({n.docId})</small>
            </li>
          ))}
        </ul>
        {nodes.length === 0 && <p>无可见文档</p>}
      </div>

      <div className="card">
        <h2>成员 ({members.length})</h2>
        <ul style={{ fontSize: 13 }}>
          {members.map((m) => (
            <li key={m.node_id}>
              <code>{m.node_id.slice(0, 16)}…</code>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>设置 ACL（Root）</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 400 }}>
          <input
            value={aclUid}
            onChange={(e) => setAclUid(e.target.value)}
            placeholder="成员 UID"
            style={{ padding: 8 }}
          />
          <label>
            角色
            <select
              value={aclRole}
              onChange={(e) => setAclRole(Number(e.target.value))}
              style={{ marginLeft: 8 }}
            >
              <option value={1}>1 只读</option>
              <option value={2}>2 可写</option>
              <option value={3}>3 可操作</option>
            </select>
          </label>
          <button type="button" onClick={() => void setAcl()}>
            应用 SetACL
          </button>
        </div>
      </div>
    </main>
  );
}
