# -*- coding: utf-8 -*-
from pathlib import Path

CONTENT = r'''import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type GovernancePayload } from "../lib/api";
import { loadIdentity } from "../lib/identity";
import { ROLE_LABELS } from "../lib/roles";

function rolesForMember(gov: GovernancePayload, nodeId: string): string[] {
  return gov.assignments.filter((a) => a.node_id === nodeId).map((a) => a.role_id);
}

export default function GroupSettingsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const identity = loadIdentity();
  const gid = groupId ?? "";

  const [gov, setGov] = useState<GovernancePayload | null>(null);
  const [inviteUid, setInviteUid] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#8250df");
  const [memberRoles, setMemberRoles] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!identity || !gid) return;
    try {
      const data = await api.getGovernance(gid, identity.nodeId);
      setGov(data);
      const map: Record<string, string[]> = {};
      for (const m of data.members) {
        map[m.node_id] = rolesForMember(data, m.node_id);
      }
      setMemberRoles(map);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "仅群主可管理群组设置");
    }
  }, [identity, gid]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRules() {
    if (!identity || !gov?.default_rules) return;
    setBusy(true);
    try {
      await api.updateGovernance(gid, {
        caller_node_id: identity.nodeId,
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
    if (!identity || !newRoleName.trim()) return;
    setBusy(true);
    try {
      await api.updateGovernance(gid, {
        caller_node_id: identity.nodeId,
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

  async function saveMemberRoles(nodeId: string) {
    if (!identity) return;
    setBusy(true);
    try {
      await api.updateGovernance(gid, {
        caller_node_id: identity.nodeId,
        member_roles: [{ node_id: nodeId, role_ids: memberRoles[nodeId] ?? [] }],
      });
      setToast("成员角色已更新");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    } finally {
      setBusy(false);
    }
  }

  function toggleMemberRole(nodeId: string, roleId: string) {
    setMemberRoles((prev) => {
      const cur = prev[nodeId] ?? [];
      const next = cur.includes(roleId) ? cur.filter((id) => id !== roleId) : [...cur, roleId];
      return { ...prev, [nodeId]: next };
    });
  }

  async function sendInvite() {
    if (!identity || !inviteUid.trim()) return;
    setBusy(true);
    try {
      await api.createInvitation(gid, identity.nodeId, inviteUid.trim());
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
        <Link to="/">生成身份</Link>
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
          <section className="app-panel">
            <h2>创建角色</h2>
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
                  <span className="app-role-chip" style={{ borderColor: r.color, color: r.color }}>
                    {r.name}
                    {r.is_builtin ? "（内置）" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="app-panel">
            <h2>成员 ↔ 角色（可多选）</h2>
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
                      <code>{m.node_id.slice(0, 12)}…</code>
                    </td>
                    <td>
                      <div className="app-role-checkboxes">
                        {gov.roles.map((r) => (
                          <label key={r.id} className="app-role-check">
                            <input
                              type="checkbox"
                              checked={(memberRoles[m.node_id] ?? []).includes(r.id)}
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
                placeholder="受邀人 Node ID"
                value={inviteUid}
                onChange={(e) => setInviteUid(e.target.value)}
              />
              <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={() => void sendInvite()}>
                发送邀请
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
'''

path = Path(__file__).resolve().parents[1] / "apps/web/src/pages/GroupSettingsPage.tsx"
path.write_text(CONTENT, encoding="utf-8", newline="\n")
print("wrote", path)
