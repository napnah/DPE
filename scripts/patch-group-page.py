# -*- coding: utf-8 -*-
from pathlib import Path

P = Path(__file__).resolve().parents[1] / "apps/web/src/pages/GroupPage.tsx"
t = P.read_text(encoding="utf-8")

t = t.replace(
    'import { api, loadGroupAdminKey, type DocNodeRow } from "../lib/api";',
    'import { api, loadGroupAdminKey, type DocNodeRow, type DocRoleAclRow } from "../lib/api";\nimport { ROLE_LABELS } from "../lib/roles";',
)
t = t.replace(
    '  const [aclUid, setAclUid] = useState("");\n  const [aclRole, setAclRole] = useState(2);\n  const [aclDocId, setAclDocId] = useState(ROOT_DOC_ID);',
    '  const [docAcls, setDocAcls] = useState<DocRoleAclRow | null>(null);\n  const [isOwner, setIsOwner] = useState(false);',
)

if "loadDocAcls" not in t:
    t = t.replace(
        "  async function refreshTree() {",
        """  async function loadDocAcls(docId: string) {
    if (!identity) return;
    try {
      setDocAcls(await api.getDocRoleAcls(gid, docId, identity.nodeId));
    } catch {
      setDocAcls(null);
    }
  }

  async function refreshTree() {""",
    )

t = t.replace(
    "      const [tree, mem] = await Promise.all([",
    "      const myGroups = await api.listAllGroups(identity.nodeId);\n      setIsOwner(myGroups.find((g) => g.group_id === gid)?.is_owner ?? false);\n      const [tree, mem] = await Promise.all([",
)

t = t.replace(
    """  async function setAcl() {
    if (!identity || !aclUid.trim()) return;
    try {
      await api.setAcl(gid, identity.nodeId, {
        op: "SetACL",
        doc_id: aclDocId,
        user_node_id: aclUid.trim(),
        role: aclRole,
      });
      await refreshTree();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ACL 更新失败");
    }
  }""",
    """  async function setDocRoleAcl(roleId: string, level: number) {
    if (!identity) return;
    try {
      await api.setDocRoleAcl(gid, identity.nodeId, {
        doc_id: selectedDoc,
        group_role_id: roleId,
        access_level: level,
      });
      await loadDocAcls(selectedDoc);
      await refreshTree();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "权限更新失败");
    }
  }""",
)

old = """      <div className="card">
        <h2>设置权限</h2>"""
if old in t:
    idx = t.index(old)
    end = t.index("    </main>", idx)
    # replace only permissions card - find closing div before members... actually structure is members then permissions
    pass

# Simpler: replace from设置权限 through 应用 SetACL block
import re
t = re.sub(
    r'      <div className="card">\s*<h2>设置权限</h2>.*?</div>\s*</div>\s*\n    </main>',
    '''      <div className="card">
        <h2>文档权限（按群组角色）</h2>
        <p style={{ fontSize: 13, color: "#656d76" }}>
          当前节点：<strong>{selectedParent?.title}</strong>
          {isOwner && (
            <> · <Link to={`/groups/${gid}/settings`}>群组权限管理</Link></>
          )}
        </p>
        {!docAcls ? (
          <button type="button" className="app-btn" onClick={() => void loadDocAcls(selectedDoc)}>
            加载该节点的角色权限
          </button>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {docAcls.roles.map((r) => (
              <li key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ minWidth: 72, color: r.color, fontWeight: 600 }}>{r.name}</span>
                <select
                  className="app-select"
                  value={r.access_level}
                  onChange={(e) => void setDocRoleAcl(r.id, Number(e.target.value))}
                >
                  {Object.entries(ROLE_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>''',
    t,
    count=1,
    flags=re.DOTALL,
)

P.write_text(t, encoding="utf-8")
print("done", P)
