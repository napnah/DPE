import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CopyableField } from "../components/CopyableField";
import { MemberRoleAssign } from "../components/MemberRoleAssign";
import { api, type GovernancePayload } from "../lib/api";
import { stopGroupMesh } from "../lib/mesh-context";
import { useIdentity } from "../lib/use-identity";
import { memberDisplayLabel } from "../lib/display-names";
import { ROLE_LABELS } from "../lib/roles";

function rolesForMember(gov: GovernancePayload, nodeId: string): string[] {
  return gov.assignments.filter((a) => a.node_id === nodeId).map((a) => a.role_id);
}

export default function GroupSettingsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const identity = useIdentity();
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
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
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
        `确定删除角色「${roleName}」？\n将移除所有成员与该角色的关联，并从全部文档 ACL 中删除该角色。`,
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

  async function persistMemberRoles(memberNodeId: string, roleIds: string[]) {
    if (!nodeId) return;
    const previous = memberRoles[memberNodeId] ?? [];
    setMemberRoles((prev) => ({ ...prev, [memberNodeId]: roleIds }));
    setSavingMemberId(memberNodeId);
    setError(null);
    try {
      await api.updateGovernance(gid, {
        caller_node_id: nodeId,
        member_roles: [{ node_id: memberNodeId, role_ids: roleIds }],
      });
    } catch (e) {
      setMemberRoles((prev) => ({ ...prev, [memberNodeId]: previous }));
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingMemberId(null);
    }
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
          <p className="app-muted">角色定义、成员多角色、新成员默认角色、邀请成员</p>
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
                <li key={r.id}>
                  <span
                    className="app-role-tag"
                    style={{ borderColor: r.color, color: r.color, background: `${r.color}14` }}
                  >
                    <span className="app-role-tag__name">
                      {r.name}
                      {r.is_builtin ? "（内置）" : ""}
                    </span>
                    {!r.is_builtin && (
                      <button
                        type="button"
                        className="app-role-tag__remove"
                        disabled={busy}
                        aria-label={`删除角色 ${r.name}`}
                        onClick={() => void deleteRole(r.id, r.name)}
                      >
                        ×
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="app-panel">
            <h2>成员 · 角色</h2>
            <p className="app-muted">使用「添加」分配角色，点击标签上的 × 移除；修改后立即保存。</p>
            <table className="app-table app-table--member-roles">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>群组角色</th>
                </tr>
              </thead>
              <tbody>
                {gov.members.map((m) => (
                  <tr key={m.node_id}>
                    <td>
                      <strong>{memberDisplayLabel(m, nodeId)}</strong>
                    </td>
                    <td>
                      <MemberRoleAssign
                        roles={gov.roles.map((r) => ({ id: r.id, name: r.name, color: r.color }))}
                        assignedRoleIds={memberRoles[m.node_id] ?? []}
                        disabled={busy || savingMemberId === m.node_id}
                        onChange={(roleIds) => void persistMemberRoles(m.node_id, roleIds)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="app-panel">
            <h2>新成员默认角色</h2>
            <p className="app-muted">入群时自动分配的角色；新建目录/文档将继承父节点 ACL。</p>
            <label className="app-field">
              <span>默认角色</span>
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
            <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={() => void saveRules()}>
              保存
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
