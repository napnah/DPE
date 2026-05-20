import { useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import type { DesignOutletContext } from "../DesignLayout";
import {
  MOCK_ALL_GROUPS,
  MOCK_GROUP_ROLES,
  MOCK_MEMBERS,
  ROLE_LABELS,
} from "../mock-data";

export default function GroupSettingsScreen() {
  const { groupId } = useParams<{ groupId: string }>();
  const { base } = useOutletContext<DesignOutletContext>();
  const gid = groupId ?? "grp-course-2026";
  const group = MOCK_ALL_GROUPS.find((g) => g.group_id === gid) ?? MOCK_ALL_GROUPS[0];
  const [roles, setRoles] = useState(MOCK_GROUP_ROLES);
  const [newRoleName, setNewRoleName] = useState("");
  const [memberRoles, setMemberRoles] = useState<Record<string, string[]>>({
    [MOCK_MEMBERS[1]?.node_id ?? "b1"]: ["role-collab"],
    [MOCK_MEMBERS[2]?.node_id ?? "c2"]: ["role-reader"],
  });
  const [defaultRole, setDefaultRole] = useState("role-reader");
  const [template, setTemplate] = useState<Record<string, number>>({
    "role-admin": 3,
    "role-collab": 2,
    "role-reader": 1,
  });
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  function toggleRole(nodeId: string, roleId: string) {
    setMemberRoles((prev) => {
      const cur = prev[nodeId] ?? [];
      const next = cur.includes(roleId) ? cur.filter((id) => id !== roleId) : [...cur, roleId];
      return { ...prev, [nodeId]: next };
    });
  }

  return (
    <main className="dpe-page">
      <header className="dpe-page-header">
        <div>
          <p className="dpe-breadcrumb">
            <Link to={`${base}/dashboard`}>总览</Link>
            <span>/</span>
            <Link to={`${base}/groups/${gid}`}>{group.name}</Link>
            <span>/</span>
            <span>群组设置</span>
          </p>
          <h1>群组设置</h1>
          <p className="dpe-muted">创建角色、成员多角色、新建子项默认「角色→权限」模板</p>
        </div>
      </header>

      {toast && <div className="dpe-toast">{toast}</div>}

      <section className="dpe-panel">
        <h2>创建角色</h2>
        <div className="dpe-search-row">
          <input
            className="dpe-input"
            placeholder="角色名称"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
          />
          <button
            type="button"
            className="dpe-btn dpe-btn--primary"
            onClick={() => {
              if (!newRoleName.trim()) return;
              const id = `role-${Date.now()}`;
              setRoles((r) => [...r, { id, name: newRoleName.trim(), color: "#8250df" }]);
              setTemplate((t) => ({ ...t, [id]: 1 }));
              setNewRoleName("");
              flash("角色已创建");
            }}
          >
            创建
          </button>
        </div>
        <ul className="app-role-chips">
          {roles.map((r) => (
            <li key={r.id}>
              <span className="app-role-chip" style={{ borderColor: r.color, color: r.color }}>
                {r.name}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="dpe-panel">
        <h2>成员 ↔ 角色（可多选）</h2>
        {MOCK_MEMBERS.filter((m) => m.displayName !== "你（本机）").map((m) => (
          <div key={m.node_id} className="dpe-peer-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <strong>{m.displayName}</strong>
            <div className="app-role-checkboxes">
              {roles.map((r) => (
                <label key={r.id} className="app-role-check">
                  <input
                    type="checkbox"
                    checked={(memberRoles[m.node_id] ?? []).includes(r.id)}
                    onChange={() => toggleRole(m.node_id, r.id)}
                  />
                  <span style={{ color: r.color }}>{r.name}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="dpe-panel">
        <h2>新建子项默认权限模板</h2>
        <p className="dpe-muted">每个群组角色 → 新建目录/文档时的初始权限</p>
        <label className="dpe-field">
          <span>新成员默认角色</span>
          <select className="dpe-select" value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <ul className="app-template-list">
          {roles.map((r) => (
            <li key={r.id}>
              <span style={{ color: r.color, fontWeight: 600 }}>{r.name}</span>
              <select
                className="dpe-select"
                value={String(template[r.id] ?? 0)}
                onChange={(e) => setTemplate((t) => ({ ...t, [r.id]: Number(e.target.value) }))}
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
        <button type="button" className="dpe-btn dpe-btn--primary" onClick={() => flash("默认模板已保存")}>
          保存
        </button>
      </section>
    </main>
  );
}
