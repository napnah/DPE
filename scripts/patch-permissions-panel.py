# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

(ROOT / "apps/web/src/components/DocNodePermissionsPanel.tsx").write_text(
    r'''import { useEffect, useState } from "react";
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
  const nodeId = loadIdentity()?.nodeId ?? "";
  const [docAcls, setDocAcls] = useState<DocRoleAclRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docId = node?.docId;
  const isFolder = node ? isFolderDoc(node) : true;
  const visibleAcls = docAcls?.doc_id === docId ? docAcls : null;

  useEffect(() => {
    if (!nodeId || !docId) {
      setDocAcls(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void api
      .getDocRoleAcls(groupId, docId, nodeId)
      .then((data) => {
        if (cancelled) return;
        setDocAcls(data);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setDocAcls(null);
        const msg = e instanceof Error ? e.message : "无法加载权限";
        if (msg.toLowerCase().includes("failed to fetch")) {
          setError("无法连接控制平面，请确认 pnpm dev 已启动");
        } else {
          setError(msg);
        }
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [groupId, docId, nodeId]);

  async function setDocRoleAcl(roleId: string, level: number) {
    if (!nodeId || !docId || !visibleAcls?.can_manage_acl) return;
    try {
      await api.setDocRoleAcl(groupId, nodeId, {
        doc_id: docId,
        group_role_id: roleId,
        access_level: level,
      });
      setDocAcls(await api.getDocRoleAcls(groupId, docId, nodeId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  }

  if (!node) {
    return (
      <aside className="app-group-inspector">
        <p className="app-muted">请先选择目录或文档</p>
      </aside>
    );
  }

  const myLevel = visibleAcls?.my_access_level ?? 0;
  const canManage = visibleAcls?.can_manage_acl ?? isOwner;
  const showLoading = loading && !visibleAcls;

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

      {showLoading && <p className="app-muted">加载中…</p>}
      {loading && visibleAcls && (
        <p className="app-muted" style={{ fontSize: 11, opacity: 0.7 }}>
          刷新中…
        </p>
      )}
      {error && !loading && <p className="app-error">{error}</p>}

      {visibleAcls && myLevel >= 1 && (
        <>
          <section className="app-my-roles">
            <h3>我的角色与权限</h3>
            {visibleAcls.my_roles.length === 0 ? (
              <p className="app-muted">尚未分配群组角色</p>
            ) : (
              <ul className="app-my-roles__list">
                {visibleAcls.my_roles.map((r) => (
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
            {visibleAcls.my_roles.length > 1 && (
              <p className="app-muted app-my-roles__hint">拥有多个角色时，取各角色权限的最高级别。</p>
            )}
          </section>

          {canManage && (
            <details className="app-collapsible">
              <summary className="app-collapsible__summary">各角色权限</summary>
              <div className="app-collapsible__body">
                <p className="app-muted">配置每个群组角色在此节点上的权限级别</p>
                <ul className="app-template-list app-node-permissions">
                  {visibleAcls.roles.map((r) => (
                    <li key={r.id}>
                      <span className="app-node-permissions__role" style={{ color: r.color }}>
                        {r.name}
                      </span>
                      <select
                        className="app-select"
                        value={r.access_level}
                        disabled={loading}
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

      {!loading && visibleAcls && myLevel < 1 && (
        <p className="app-muted">无权查看此节点。</p>
      )}
      {!loading && !visibleAcls && !error && (
        <p className="app-muted">无权查看此节点的权限信息。</p>
      )}
    </aside>
  );
}
''',
    encoding="utf-8",
)
print("DocNodePermissionsPanel.tsx")

gp = ROOT / "apps/web/src/pages/GroupPage.tsx"
g = gp.read_text(encoding="utf-8")
g = g.replace(
    "  const refresh = useCallback(async () => {\n    if (!identity) return;",
    "  const refresh = useCallback(async () => {\n    if (!nodeId) return;",
)
g = g.replace(
    "      setGroups(await api.listAllGroups(identity.nodeId));",
    "      setGroups(await api.listAllGroups(nodeId));",
) if "listAllGroups(identity.nodeId)" in g else g
# Group page refresh uses getTree with nodeId already?
if "  }, [identity]);" in g and "const refresh = useCallback" in g:
    # only first occurrence after refresh - be careful
    idx = g.find("  const refresh = useCallback")
    chunk = g[idx : idx + 400]
    if "[identity]" in chunk:
        g = g[:idx] + chunk.replace("  }, [identity]);", "  }, [nodeId]);", 1) + g[idx + 400 :]

gp.write_text(g, encoding="utf-8")
print("GroupPage.tsx touch")
