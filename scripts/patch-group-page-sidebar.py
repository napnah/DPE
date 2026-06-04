#!/usr/bin/env python3
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "apps/web/src/pages/GroupPage.tsx"
t = p.read_text(encoding="utf-8")
old = """          <h2>文档</h2>
          <p className="app-muted app-group-sidebar__hint">根目录与文档在同一页查看与编辑</p>
          <DocTreeNav"""
new = """          <DocTreeNav"""
if old not in t:
    raise SystemExit("pattern not found")
p.write_text(t.replace(old, new), encoding="utf-8")
print("ok")
