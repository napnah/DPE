import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isFolderDoc } from "@dpe/shared";
import { api, type DocNodeRow, type DocRoleAclRow } from "../lib/api";
import { loadIdentity } from "../lib/identity";
import { ROLE_LABELS } from "../lib/roles";

export function DocNodePermissionsPanel({
  groupId,
  node,
  isOwner,
}: {
  groupId: string;
  node: DocNodeRow | undefined;
  isOwner: boolean;
}) {
  const identity = loadIdentity();
  const [docAcls, setDocAcls] = useState<DocRoleAclRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docId = node?.docId;
  const isFolder = node ? isFolderDoc(node) : true;

  useEffect(() => {
    if (!identity || !docId) {
      setDocAcls(null);
      return;
    }
    setLoading(true);
    setError(null);
    void api
      .getDocRoleAcls(groupId, docId, identity.nodeId)
      .then(setDocAcls)
      .catch((e) => {
        setDocAcls(null);
        setError(e instanceof Error ? e.message : "无法加载权限");
      })
      .finally(() => setLoading(false));
  }, [identity, groupId, docId]);

  async function setDocRoleAcl(roleId: string, level: number) {
    if (!identity || !docId || !docAcls?.can_manage_acl) return;
    try {
      await api.setDocRoleAcl(groupId, identity.nodeId, {
        doc_id: docId,
        group_role_id: roleId,
        access_level: level,
      });
      setDocAcls(await api.getDocRoleAcls(groupId, docId, identity.nodeId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  }

  if (!node) {
    return (
      <aside className="app-group-inspector">
        <p className="app-muted">在左侧选择目录或文档</p>
      </aside>
    );
  }

  const myLevel = docAcls?.my_access_level ?? 0;
  const canManage = docAcls?.can_manage_acl ?? isOwner;

  return (
    <aside className="app-group-inspector">
      <h2>当前节点权限</h2>
      <p className="app-muted app-node-target">
        <strong>{node.title}</strong>
        {isFolder ? "（目录）" : "（文档）"}
      </p>

      {isOwner && (
        <p className="app-muted">
          <Link to={`/groups/${groupId}/settings`}>群组设置</Link>
        </p>
      )}

      {loading && <p className="app-muted">加载中…</p>}
      {error && <p className="app-error">{error}</p>}

      {!loading && docAcls && myLevel >= 1 && (
        <>
          <section className="app-my-roles">
            <h3>我的角色与权限</h3>
            {docAcls.my_roles.length === 0 ? (
              <p className="app-muted">尚未分配群组角色</p>
            ) : (
              <ul className="app-my-roles__list">
                {docAcls.my_roles.map((r) => (
                  <li key={r.role_id}>
                    <span className="app-my-roles__name" style={{ color: r.color }}>
                      {r.name}
                    </span>
                    <span className="app-my-roles__level">{ROLE_LABELS[r.access_level] ?? "不可见"}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="app-my-roles__effective">
              在此节点的有效权限：
              <strong>{ROLE_LABELS[myLevel] ?? "不可见"}</strong>
            </p>
            {docAcls.my_roles.length > 1 && (
              <p className="app-muted app-my-roles__hint">持有多个角色时，取各角色权限的最高级别。</p>
            )}
          </section>

          {canManage && (
            <details className="app-collapsible">
              <summary className="app-collapsible__summary">各角色权限</summary>
              <div className="app-collapsible__body">
                <p className="app-muted">配置每个群组角色在此节点上的权限级别。</p>
                <ul className="app-template-list app-node-permissions">
                  {docAcls.roles.map((r) => (
                    <li key={r.id}>
                      <span className="app-node-permissions__role" style={{ color: r.color }}>
                        {r.name}
                      </span>
                      <select
                        className="app-select"
                        value={r.access_level}
                        onChange={(e) => void setDocRoleAcl(r.id, Number(e.target.value))}
                      >
                        {Object.entries(ROLE_LABELS).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}
        </>
      )}

      {!loading && docAcls && myLevel < 1 && (
        <p className="app-muted">你无权查看此节点。</p>
      )}
      {!loading && !docAcls && !error && (
        <p className="app-muted">你无权查看此节点的权限信息。</p>
      )}
    </aside>
  );
}
