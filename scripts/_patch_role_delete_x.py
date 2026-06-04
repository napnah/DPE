from pathlib import Path

p = Path(__file__).resolve().parents[1] / "apps/web/src/pages/GroupSettingsPage.tsx"
t = p.read_text(encoding="utf-8")

old = """            <ul className="app-role-chips">
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
            </ul>"""

new = """            <ul className="app-role-chips">
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
            </ul>"""

if old not in t:
    raise SystemExit("role chips block not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("ok")
