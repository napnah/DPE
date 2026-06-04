from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# groups.dto.ts
dto = ROOT / "apps/control-plane/src/groups/groups.dto.ts"
dto_text = dto.read_text(encoding="utf-8")
if "delete_role_ids" not in dto_text:
    dto.write_text(
        dto_text.replace(
            "  roles?: { id?: string; name: string; color?: string }[];\n}",
            "  roles?: { id?: string; name: string; color?: string }[];\n"
            "  /** Remove roles: clear member assignments and doc ACL rows, then delete role */\n"
            "  delete_role_ids?: string[];\n}",
            1,
        ),
        encoding="utf-8",
    )

# groups.service.ts
svc = ROOT / "apps/control-plane/src/groups/groups.service.ts"
svc_text = svc.read_text(encoding="utf-8")
DELETE_BLOCK = """      if (dto.delete_role_ids?.length) {
        for (const roleId of dto.delete_role_ids) {
          const role = await tx.groupRole.findFirst({ where: { id: roleId, groupId } });
          if (!role) throw new NotFoundException(`role not found: ${roleId}`);
          if (role.isBuiltin) {
            throw new BadRequestException(`cannot delete builtin role: ${role.slug}`);
          }

          const affected = await tx.memberRoleAssignment.findMany({
            where: { groupId, roleId },
          });

          await tx.memberRoleAssignment.deleteMany({ where: { groupId, roleId } });
          await tx.docRoleAcl.deleteMany({ where: { groupId, roleId } });

          const rules = await tx.groupDefaultRules.findUnique({ where: { groupId } });
          if (rules) {
            const tpl = { ...(rules.createChildTemplate as Record<string, number>) };
            delete tpl[roleId];
            let defaultMemberRoleId = rules.defaultMemberRoleId;
            if (defaultMemberRoleId === roleId) {
              const reader = await tx.groupRole.findFirst({
                where: { groupId, slug: "reader" },
              });
              if (!reader) {
                throw new BadRequestException("no fallback role for default member");
              }
              defaultMemberRoleId = reader.id;
            }
            await tx.groupDefaultRules.update({
              where: { groupId },
              data: {
                defaultMemberRoleId,
                createChildTemplate: tpl,
              },
            });
          }

          await tx.groupRole.delete({ where: { id: roleId } });

          const seen = new Set<string>();
          for (const a of affected) {
            if (seen.has(a.nodeId)) continue;
            seen.add(a.nodeId);
            if (a.nodeId === group.ownerNodeId) continue;
            const remaining = await tx.memberRoleAssignment.count({
              where: { groupId, nodeId: a.nodeId },
            });
            if (remaining === 0) {
              await tx.aclGrant.deleteMany({ where: { groupId, nodeId: a.nodeId } });
            } else {
              await syncMemberAllDocs(tx, groupId, a.nodeId, group.ownerNodeId);
            }
          }
        }
      }
"""
if "delete_role_ids" not in svc_text:
    anchor = "      if (dto.create_roles?.length) {"
    if anchor not in svc_text:
        raise SystemExit("service anchor not found")
    svc.write_text(svc_text.replace(anchor, DELETE_BLOCK + anchor, 1), encoding="utf-8")

# GroupSettingsPage.tsx
settings = ROOT / "apps/web/src/pages/GroupSettingsPage.tsx"
settings.write_text(
    """import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CopyableField } from "../components/CopyableField";
import { api, type GovernancePayload } from "../lib/api";
import { stopGroupMesh } from "../lib/mesh-context";
import { loadIdentity } from "../lib/identity";
import { memberDisplayLabel } from "../lib/display-names";
import { ROLE_LABELS } from "../lib/roles";

function rolesForMember(gov: GovernancePayload, nodeId: string): string[] {
  return gov.assignments.filter((a) => a.node_id === nodeId).map((a) => a.role_id);
}

export default function GroupSettingsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const identity = loadIdentity();
  const nodeId = identity?.nodeId ?? "";
  const gid = groupId ?? "";
  const navigate = useNavigate();

  const [gov, setGov] = useState<GovernancePayload | null>(null);
  const [inviteUid, setInviteUid] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#8250df");
  const [memberRoles, setMemberRoles] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!nodeId || !gid) return;
    try {
      const data = await api.getGovernance(gid, nodeId);
      setGov(data);
      const map: Record<string, string[]> = {};
      for (const m of data.members) {
        map[m.node_id] = rolesForMember(data, m.node_id);
      }
      setMemberRoles(map);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "非群主或无法加载群组设置");
    }
  }, [nodeId, gid]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRules() {
    if (!nodeId || !gov?.default_rules) return;
    setBusy(true);
    try {
      await api.updateGovernance(gid, {
        caller_node_id: nodeId,
        default_member_role_id: gov.default_rules.default_member_role_id,
        create_child_template: gov.default_rules.create_child_template,
      });
      setToast("默认规则已保存");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function createRole() {
    if (!nodeId || !newRoleName.trim()) return;
    setBusy(true);
    try {
      await api.updateGovernance(gid, {
        caller_node_id: nodeId,
        create_roles: [{ name: newRoleName.trim(), color: newRoleColor }],
      });
      setNewRoleName("");
      setToast("角色已创建");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRole(roleId: string, roleName: string) {
    if (!nodeId) return;
    if (
      !window.confirm(
        `确定删除角色「${roleName}」？\\n将移除所有成员与该角色的关联，并从全部文档 ACL 中删除该角色。`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.updateGovernance(gid, {
        caller_node_id: nodeId,
        delete_role_ids: [roleId],
      });
      setToast(`已删除角色「${roleName}」`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveMemberRoles(memberNodeId: string) {
    if (!nodeId) return;
    setBusy(true);
    try {
      await api.updateGovernance(gid, {
        caller_node_id: nodeId,
        member_roles: [{ node_id: memberNodeId, role_ids: memberRoles[memberNodeId] ?? [] }],
      });
      setToast("成员角色已更新");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function toggleMemberRole(memberNodeId: string, roleId: string) {
    setMemberRoles((prev) => {
      const cur = prev[memberNodeId] ?? [];
      const next = cur.includes(roleId) ? cur.filter((id) => id !== roleId) : [...cur, roleId];
      return { ...prev, [memberNodeId]: next };
    });
  }

  async function dissolveGroup() {
    if (!nodeId) return;
    const name = gov?.name ?? gid;
    if (!window.confirm(`确定解散群组「${name}」？所有成员、文档与权限将被永久删除，无法恢复。`)) {
      return;
    }
    setBusy(true);
    try {
      await api.dissolveGroup(gid, nodeId);
      localStorage.removeItem(`dpe_group_${gid}_pk_admin`);
      await stopGroupMesh();
      navigate("/dashboard", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "解散群组失败");
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    if (!nodeId || !inviteUid.trim()) return;
    setBusy(true);
    try {
      await api.createInvitation(gid, nodeId, inviteUid.trim());
      setInviteUid("");
      setToast("邀请已发送");
    } catch (e) {
      setError(e instanceof Error ? e.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  }

  if (!identity) {
    return (
      <main className="app-page">
        <Link to="/">完成引导</Link>
      </main>
    );
  }

  return (
    <main className="app-page">
      <header className="app-page-header">
        <div>
          <p className="app-breadcrumb">
            <Link to="/dashboard">总览</Link>
            <span> / </span>
            <Link to={`/groups/${gid}`}>{gov?.name ?? "群组"}</Link>
            <span> / 群组设置</span>
          </p>
          <h1>群组设置</h1>
          <p className="app-muted">角色定义、成员多角色、新建子项默认权限模板、邀请成员</p>
        </div>
      </header>

      {toast && <div className="app-toast">{toast}</div>}
      {error && <p className="app-error">{error}</p>}
      {!gov && !error && <p className="app-muted">加载中…</p>}

      {gov && (
        <>
          <section className="app-panel app-panel--identity">
            <h2>群组标识</h2>
            <p className="app-muted">邀请他人或配置网络时，可提供下方群组 ID。</p>
            <CopyableField label="群组 ID" value={gov.group_id ?? gid} hint="UUID，不可修改" />
          </section>

          <section className="app-panel">
            <h2>定义角色</h2>
            <p className="app-muted">成员可同时拥有多个角色；有效权限取各角色在文档上的最高级别。</p>
            <div className="app-form-row">
              <input
                className="app-input"
                placeholder="角色名称"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
              />
              <input
                type="color"
                className="app-input app-input--color"
                value={newRoleColor}
                onChange={(e) => setNewRoleColor(e.target.value)}
                aria-label="角色颜色"
              />
              <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={() => void createRole()}>
                创建角色
              </button>
            </div>
            <h3>已有角色</h3>
            <ul className="app-role-chips">
              {gov.roles.map((r) => (
                <li key={r.id} className="app-role-chip-row">
                  <span className="app-role-chip" style={{ borderColor: r.color, color: r.color }}>
                    {r.name}
                    {r.is_builtin ? "（内置）" : ""}
                  </span>
                  {!r.is_builtin && (
                    <button
                      type="button"
                      className="app-btn app-btn--small app-btn--danger"
                      disabled={busy}
                      onClick={() => void deleteRole(r.id, r.name)}
                    >
                      删除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="app-panel">
            <h2>成员 · 角色（可多选）</h2>
            <p className="app-muted">勾选后点击「保存」生效；未保存前切换页面会丢失修改。</p>
            <table className="app-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>群组角色</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {gov.members.map((m) => (
                  <tr key={m.node_id}>
                    <td>
                      <strong>{memberDisplayLabel(m, nodeId)}</strong>
                    </td>
                    <td>
                      <div className="app-role-checkboxes">
                        {gov.roles.map((r) => (
                          <label key={r.id} className="app-role-check">
                            <input
                              type="checkbox"
                              checked={(memberRoles[m.node_id] ?? []).includes(r.id)}
                              disabled={busy}
                              onChange={() => toggleMemberRole(m.node_id, r.id)}
                            />
                            <span style={{ color: r.color }}>{r.name}</span>
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="app-btn app-btn--small"
                        disabled={busy}
                        onClick={() => void saveMemberRoles(m.node_id)}
                      >
                        保存
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="app-panel">
            <h2>新建子项默认权限模板</h2>
            <p className="app-muted">按「群组角色 → 权限级别」配置；新建目录/文档时自动套用。</p>
            <label className="app-field">
              <span>新成员默认角色（入群时自动分配）</span>
              <select
                className="app-select"
                disabled={busy || !gov.default_rules}
                value={gov.default_rules?.default_member_role_id ?? ""}
                onChange={(e) =>
                  setGov({
                    ...gov,
                    default_rules: gov.default_rules
                      ? { ...gov.default_rules, default_member_role_id: e.target.value }
                      : null,
                  })
                }
              >
                {gov.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <ul className="app-template-list">
              {gov.roles.map((r) => (
                <li key={r.id}>
                  <span style={{ color: r.color, fontWeight: 600 }}>{r.name}</span>
                  <select
                    className="app-select"
                    disabled={busy || !gov.default_rules}
                    value={String(gov.default_rules?.create_child_template?.[r.id] ?? 0)}
                    onChange={(e) => {
                      const tpl = { ...(gov.default_rules?.create_child_template ?? {}) };
                      tpl[r.id] = Number(e.target.value);
                      setGov({
                        ...gov,
                        default_rules: gov.default_rules
                          ? { ...gov.default_rules, create_child_template: tpl }
                          : null,
                      });
                    }}
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
            <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={() => void saveRules()}>
              保存默认模板
            </button>
          </section>

          <section className="app-panel">
            <h2>邀请成员</h2>
            <div className="app-search-row">
              <input
                className="app-input"
                placeholder="对方节点 ID（技术标识）"
                value={inviteUid}
                onChange={(e) => setInviteUid(e.target.value)}
              />
              <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={() => void sendInvite()}>
                发送邀请
              </button>
            </div>
          </section>
          <section className="app-panel app-panel--danger">
            <h2>危险操作</h2>
            <p className="app-muted">解散后群组、文档、成员与邀请记录将永久删除，无法恢复。</p>
            <button
              type="button"
              className="app-btn app-btn--danger"
              disabled={busy}
              onClick={() => void dissolveGroup()}
            >
              解散群组
            </button>
          </section>
        </>
      )}
    </main>
  );
}
""",
    encoding="utf-8",
)

# index.css
css = ROOT / "apps/web/src/index.css"
css_text = css.read_text(encoding="utf-8")
if ".app-copyable" not in css_text:
    block = """
.app-copyable {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.app-copyable:last-child {
  margin-bottom: 0;
}

.app-copyable__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
}

.app-copyable__label {
  font-size: var(--bz-font-size);
  font-weight: 600;
  color: var(--bz-text);
}

.app-copyable__hint {
  font-size: 12px;
}

.app-copyable__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.app-copyable__value {
  flex: 1;
  min-width: 0;
  padding: 0.4rem 0.55rem;
  font-size: 12px;
  word-break: break-all;
  background: var(--bz-bg);
  border: 1px solid var(--bz-border-light);
  border-radius: var(--bz-radius);
}

.app-panel--identity .app-copyable + .app-copyable {
  margin-top: 0.25rem;
}

.app-role-chip-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
"""
    css.write_text(css_text.replace("/* Pages */", block + "\n/* Pages */", 1), encoding="utf-8")

# GovernancePayload group_id if missing
api_ts = ROOT / "apps/web/src/lib/api.ts"
api_text = api_ts.read_text(encoding="utf-8")
if "group_id" not in api_text.split("GovernancePayload")[1].split("export")[0]:
    api_text = api_text.replace(
        "export type GovernancePayload = {\n  name: string;",
        "export type GovernancePayload = {\n  group_id: string;\n  name: string;",
        1,
    )
    api_ts.write_text(api_text, encoding="utf-8")

print("done")
