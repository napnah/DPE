from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

Path(ROOT / "apps/web/src/components/AppShell.tsx").write_text(
    """import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { UserDisplayNameButton } from "./UserDisplayNameButton";

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  const navClass = (prefix: string) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`) ? "is-active" : "";

  return (
    <div className="app app--breeze">
      <header className="app-shell__bar">
        <div className="app-shell__start">
          <Link to="/dashboard" className="app-shell__brand">
            DPE
          </Link>
          <nav className="app-shell__nav" aria-label="主导航">
            <Link to="/dashboard" className={navClass("/dashboard")}>
              总览
            </Link>
            <Link to="/connections" className={navClass("/connections")}>
              连接
            </Link>
          </nav>
        </div>
        <UserDisplayNameButton />
      </header>
      <div className="app-shell__body">{children}</div>
    </div>
  );
}
""",
    encoding="utf-8",
)

identity = ROOT / "apps/web/src/lib/identity.ts"
text = identity.read_text(encoding="utf-8")
if "dpe-display-name-changed" not in text:
    old = "  localStorage.setItem(DISPLAY_NAME_KEY, trimmed);\n}"
    new = """  localStorage.setItem(DISPLAY_NAME_KEY, trimmed);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("dpe-display-name-changed"));
  }
}"""
    if old not in text:
        raise SystemExit("identity patch anchor not found")
    identity.write_text(text.replace(old, new, 1), encoding="utf-8")

css = ROOT / "apps/web/src/index.css"
css_text = css.read_text(encoding="utf-8")
if ".app-shell__user-menu" not in css_text:
    insert = """
.app-shell__user-menu {
  position: relative;
}

.app-shell__user {
  font-size: var(--bz-font-size);
  font-weight: 500;
  color: var(--bz-muted);
  padding: 0.25rem 0.65rem;
  border-radius: var(--bz-radius);
  background: var(--bz-bg);
  border: 1px solid var(--bz-border-light);
  cursor: pointer;
  font-family: inherit;
}

.app-shell__user:hover {
  color: var(--bz-text);
  border-color: var(--bz-border);
}

.app-shell__user-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  width: min(280px, 90vw);
  padding: 0.75rem;
  background: var(--bz-surface);
  border: 1px solid var(--bz-border);
  border-radius: var(--bz-radius);
  box-shadow: var(--bz-shadow);
}

.app-shell__user-panel__hint {
  margin: 0 0 0.5rem;
  font-size: 12px;
  line-height: 1.4;
}

.app-shell__user-panel__hint code {
  font-size: 11px;
}
"""
    anchor = ".app-shell__user {\n  font-size: var(--bz-font-size);"
    if anchor in css_text:
        css_text = css_text.replace(
            """.app-shell__user {
  font-size: var(--bz-font-size);
  font-weight: 500;
  color: var(--bz-muted);
  padding: 0.25rem 0.5rem;
  border-radius: var(--bz-radius);
  background: var(--bz-bg);
  border: 1px solid var(--bz-border-light);
}
""",
            insert.strip() + "\n",
        )
    else:
        css_text = css_text.replace(".app-shell__body {", insert + "\n.app-shell__body {", 1)
    css.write_text(css_text, encoding="utf-8")

group_page = ROOT / "apps/web/src/pages/GroupPage.tsx"
gp = group_page.read_text(encoding="utf-8")
gp = gp.replace(
    'import { loadIdentity } from "../lib/identity";',
    'import { useIdentity } from "../lib/use-identity";',
)
gp = gp.replace("const identity = loadIdentity();", "const identity = useIdentity();")
group_page.write_text(gp, encoding="utf-8")

print("patched")
