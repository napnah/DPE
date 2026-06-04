from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "apps/web/src/pages/GroupSettingsPage.tsx"
text = path.read_text(encoding="utf-8")

# fix import
if "MemberRoleAssign" not in text:
    text = text.replace(
        'import { CopyableField } from "../components/CopyableField";',
        'import { CopyableField } from "../components/CopyableField";\nimport { MemberRoleAssign } from "../components/MemberRoleAssign";',
    )

# remove toggleMemberRole function
start = text.find("  function toggleMemberRole")
end = text.find("  async function dissolveGroup()")
if start != -1 and end != -1:
    text = text[:start] + text[end:]

# replace member roles section
old_table = """          <section className="app-panel">
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
          </section>"""

# try corrupted variants - use regex-free search for key marker
marker_start = '<h2>成员 · 角色'
marker_end = '</section>\n\n          <section className="app-panel">\n            <h2>新建子项'
idx_s = text.find(marker_start)
idx_e = text.find(marker_end)
if idx_s == -1 or idx_e == -1:
    raise SystemExit("member section markers not found")

new_section = """          <section className="app-panel">
            <h2>成员 · 角色</h2>
            <p className="app-muted">
              使用「添加」分配角色，点击标签上的 × 移除；修改后点击「保存」生效。
            </p>
            <table className="app-table app-table--member-roles">
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
                      <MemberRoleAssign
                        roles={gov.roles.map((r) => ({ id: r.id, name: r.name, color: r.color }))}
                        assignedRoleIds={memberRoles[m.node_id] ?? []}
                        disabled={busy}
                        onChange={(roleIds) =>
                          setMemberRoles((prev) => ({ ...prev, [m.node_id]: roleIds }))
                        }
                      />
                    </td>
                    <td className="app-table__actions">
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
            <h2>新建子项"""

text = text[:idx_s] + new_section + text[idx_e + len("</section>\n\n          <section className=\"app-panel\">\n            <h2>新建子项") :]

path.write_text(text, encoding="utf-8")

css = ROOT / "apps/web/src/index.css"
css_text = css.read_text(encoding="utf-8")
if ".app-member-roles" not in css_text:
    block = """
.app-member-roles {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.5rem;
}

.app-member-roles__tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  flex: 1;
  min-width: 0;
}

.app-member-roles__empty {
  font-size: 12px;
}

.app-role-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.15rem 0.35rem 0.15rem 0.5rem;
  border: 1px solid;
  border-radius: var(--bz-radius);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
}

.app-role-tag__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.75;
}

.app-role-tag__remove:hover:not(:disabled) {
  opacity: 1;
  background: rgba(0, 0, 0, 0.06);
}

.app-member-roles__add {
  position: relative;
  flex-shrink: 0;
}

.app-member-roles__add-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

.app-member-roles__caret {
  font-size: 10px;
  opacity: 0.7;
}

.app-role-add-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 140px;
  margin: 0;
  padding: 0.25rem 0;
  list-style: none;
  background: var(--bz-surface);
  border: 1px solid var(--bz-border);
  border-radius: var(--bz-radius);
  box-shadow: var(--bz-shadow);
}

.app-role-add-menu__item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.4rem 0.65rem;
  border: none;
  background: transparent;
  font-size: var(--bz-font-size);
  text-align: left;
  cursor: pointer;
  color: var(--bz-text);
}

.app-role-add-menu__item:hover:not(:disabled) {
  background: var(--bz-bg);
}

.app-role-add-menu__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.app-table--member-roles td:nth-child(2) {
  min-width: 220px;
}

.app-table__actions {
  vertical-align: middle;
  white-space: nowrap;
}
"""
    css.write_text(css_text.replace(".app-role-checkboxes {", block + "\n.app-role-checkboxes {", 1), encoding="utf-8")

print("ok")
