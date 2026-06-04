from pathlib import Path

path = Path(__file__).resolve().parents[1] / "apps/web/src/pages/GroupSettingsPage.tsx"
text = path.read_text(encoding="utf-8")
needle = """            <h2>邀请成员</h2>
            <div className="app-search-row">"""
insert = """            <h2>邀请成员</h2>
            <p className="app-muted">
              请填写对方总览页上的「节点 ID（UID）」，不要用自定义的 DPE_NODE_ID；可从「连接与邀请」页的邻居列表复制。
            </p>
            <div className="app-search-row">"""
if needle not in text:
    raise SystemExit("needle not found")
if "连接与邀请" in text and text.count("连接与邀请") > 1:
    pass
if insert.strip() in text:
    print("already patched")
else:
    text = text.replace(needle, insert)
    path.write_text(text, encoding="utf-8")
    print("patched")
