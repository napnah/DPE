# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(rel: str, old: str, new: str) -> None:
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"missing in {rel}")
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("ok", rel)


# DashboardPage
dash = ROOT / "apps/web/src/pages/DashboardPage.tsx"
d = dash.read_text(encoding="utf-8")
if "identity.displayName" not in d:
    d = d.replace(
        'import { loadIdentity, loadPrivateKey } from "../lib/identity";',
        'import { loadIdentity, loadPrivateKey } from "../lib/identity";\nimport { api } from "../lib/api";',
    )
    # api already imported - check
    if d.count('import { api') > 1:
        d = d.replace(
            'import { api, saveGroupAdminKey, type GroupCardRow } from "../lib/api";\nimport { loadIdentity, loadPrivateKey } from "../lib/identity";\nimport { api } from "../lib/api";',
            'import { api, saveGroupAdminKey, type GroupCardRow } from "../lib/api";\nimport { loadIdentity, loadPrivateKey } from "../lib/identity";',
        )
    d = d.replace(
        "  useEffect(() => { void refresh(); }, [refresh]);",
        """  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!identity) return;
    void api.syncDisplayName(identity.nodeId, identity.displayName).catch(() => {});
  }, [identity?.nodeId, identity?.displayName]);""",
    )
    d = d.replace(
        '          <p className="app-muted">我的群组与协作空间</p>',
        '          <p className="app-muted">你好，{identity.displayName} · 我的群组与协作空间</p>',
    )
    d = d.replace(
        """      const created = await api.createGroup({
        name: newGroupName.trim(),
        description: newGroupDesc.trim(),
        owner_node_id: identity.nodeId,
        owner_public_key: exportPublicKeyBase64Url(pk),
        control_mode: "proxy",
      });""",
        """      const created = await api.createGroup({
        name: newGroupName.trim(),
        description: newGroupDesc.trim(),
        owner_node_id: identity.nodeId,
        owner_public_key: exportPublicKeyBase64Url(pk),
        owner_display_name: identity.displayName,
        control_mode: "proxy",
      });""",
    )
    dash.write_text(d, encoding="utf-8")
    print("ok DashboardPage")

# ConnectionsPage
conn = ROOT / "apps/web/src/pages/ConnectionsPage.tsx"
c = conn.read_text(encoding="utf-8")
if "peerDisplayLabel" not in c:
    c = c.replace(
        'import { loadIdentity } from "../lib/identity";',
        'import { loadIdentity } from "../lib/identity";\nimport { peerDisplayLabel } from "../lib/display-names";',
    )
    c = c.replace(
        '        node_id: identity.nodeId,\n        public_key: exportPublicKeyBase64Url(pk),',
        '        node_id: identity.nodeId,\n        public_key: exportPublicKeyBase64Url(pk),\n        display_name: identity.displayName,',
    )
    c = c.replace(
        'placeholder="按 UID 前缀搜索邻居…"',
        'placeholder="按邻居名称或节点前缀搜索…"',
    )
    c = c.replace(
        """          {peers.map((p) => (
            <li key={`${p.uid}-${p.host}`}>
              <span>{p.host}:{p.port}</span>
              <span className="app-muted">{p.source}</span>
            </li>
          ))}""",
        """          {peers.map((p) => (
            <li key={`${p.uid}-${p.host}`}>
              <strong>{peerDisplayLabel(p)}</strong>
              <span className="app-muted">
                {p.host}:{p.port} · {p.source}
              </span>
            </li>
          ))}""",
    )
    conn.write_text(c, encoding="utf-8")
    print("ok ConnectionsPage")

# GroupSettingsPage
gs = ROOT / "apps/web/src/pages/GroupSettingsPage.tsx"
g = gs.read_text(encoding="utf-8")
if "memberDisplayLabel" not in g:
    g = g.replace(
        'import { loadIdentity } from "../lib/identity";',
        'import { loadIdentity } from "../lib/identity";\nimport { memberDisplayLabel } from "../lib/display-names";',
    )
    g = g.replace(
        'placeholder="对方 UID"',
        'placeholder="对方节点 ID（邀请仍按技术 ID）"',
    )
    if 'placeholder="对方 UID"' in g:
        pass
    g = g.replace(
        """                    <td>
                      <code>{m.node_id.slice(0, 12)}…</code>
                    </td>""",
        """                    <td>
                      <strong>{memberDisplayLabel(m, identity.nodeId)}</strong>
                    </td>""",
    )
    gs.write_text(g, encoding="utf-8")
    print("ok GroupSettingsPage")

# GroupPage header
gp = ROOT / "apps/web/src/pages/GroupPage.tsx"
p = gp.read_text(encoding="utf-8")
if "identity.displayName" not in p and "loadIdentity()" in p:
    p = p.replace(
        "  const identity = loadIdentity();\n  const nodeId = identity?.nodeId ?? \"\";",
        "  const identity = loadIdentity();\n  const nodeId = identity?.nodeId ?? \"\";\n  const myName = identity?.displayName ?? \"\";",
    )
    p = p.replace(
        "            <span>{groupName}</span>",
        "            <span>{groupName}</span>\n            <span className=\"app-muted\"> · {myName}</span>",
    )
    gp.write_text(p, encoding="utf-8")
    print("ok GroupPage")

print("pages done")
