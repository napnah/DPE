# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

app = ROOT / "apps/web/src/App.tsx"
t = app.read_text(encoding="utf-8")
if "AppShell" not in t:
    t = t.replace(
        'import { Navigate, Route, Routes } from "react-router-dom";',
        'import { Navigate, Route, Routes } from "react-router-dom";\nimport { AppShell } from "./components/AppShell";',
    )
    t = t.replace(
        "  if (!hasUserProfile()) return <Navigate to=\"/\" replace />;\n  return children;",
        "  if (!hasUserProfile()) return <Navigate to=\"/\" replace />;\n  return <AppShell>{children}</AppShell>;",
    )
    app.write_text(t, encoding="utf-8")
    print("App.tsx")

onb = ROOT / "apps/web/src/pages/OnboardingPage.tsx"
o = onb.read_text(encoding="utf-8")
o = o.replace(
    '<main className="app-page" style={{ maxWidth: 560 }}>',
    '<main className="app-page app-page--narrow">',
)
onb.write_text(o, encoding="utf-8")
print("OnboardingPage")

# Group page: full-bleed inside shell (no double padding on header area)
gp = ROOT / "apps/web/src/pages/GroupPage.tsx"
g = gp.read_text(encoding="utf-8")
if "app-group-page--shell" not in g:
    g = g.replace(
        '<main className="app-group-page">',
        '<main className="app-group-page app-group-page--shell">',
    )
    gp.write_text(g, encoding="utf-8")
    print("GroupPage")

# Add shell override in index if missing
css = ROOT / "apps/web/src/index.css"
c = css.read_text(encoding="utf-8")
if "app-group-page--shell" not in c:
    c += """
.app-group-page--shell {
  margin: 0 -1rem;
}

.app-shell__body > .app-group-page--shell {
  margin: 0;
}
"""
    css.write_text(c, encoding="utf-8")
    print("index.css shell margin")

print("done")
