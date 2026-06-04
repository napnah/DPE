from pathlib import Path
p = Path(__file__).resolve().parents[1] / "apps/web/src/pages/GroupSettingsPage.tsx"
t = p.read_text(encoding="utf-8")
t = t.replace(
    'placeholder="受邀人 Node ID"',
    'placeholder="对方节点 ID（技术标识）"',
)
p.write_text(t, encoding="utf-8")
print("ok")
