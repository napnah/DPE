from pathlib import Path

p = Path(__file__).resolve().parents[1] / "apps/web/src/pages/GroupSettingsPage.tsx"
t = p.read_text(encoding="utf-8")
bad = """          <section className="app-panel">
                      <section className="app-panel">
            <h2>成员 · 角色</h2>"""
good = """          <section className="app-panel">
            <h2>成员 · 角色</h2>"""
if bad not in t:
    raise SystemExit("pattern not found")
p.write_text(t.replace(bad, good, 1), encoding="utf-8")
print("ok")
