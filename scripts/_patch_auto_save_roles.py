from pathlib import Path

p = Path(__file__).resolve().parents[1] / "apps/web/src/pages/GroupSettingsPage.tsx"
t = p.read_text(encoding="utf-8")

if "savingMemberId" not in t:
    t = t.replace(
        "  const [busy, setBusy] = useState(false);\n  const [toast, setToast]",
        "  const [busy, setBusy] = useState(false);\n  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);\n  const [toast, setToast]",
        1,
    )

old_fn = """  async function saveMemberRoles(memberNodeId: string) {
    if (!nodeId) return;
    setBusy(true);
    try {
      await api.updateGovernance(gid, {
        caller_node_id: nodeId,
        member_roles: [{ node_id: memberNodeId, role_ids: memberRoles[memberNodeId] ?? [] }],
      });
      setToast("成员角色已更新");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }"""

# corrupted toast variant
if old_fn not in t:
    start = t.find("  async function saveMemberRoles")
    end = t.find("  async function dissolveGroup()")
    if start == -1:
        raise SystemExit("saveMemberRoles not found")
    t = (
        t[:start]
        + """  async function persistMemberRoles(memberNodeId: string, roleIds: string[]) {
    if (!nodeId) return;
    const previous = memberRoles[memberNodeId] ?? [];
    setMemberRoles((prev) => ({ ...prev, [memberNodeId]: roleIds }));
    setSavingMemberId(memberNodeId);
    setError(null);
    try {
      await api.updateGovernance(gid, {
        caller_node_id: nodeId,
        member_roles: [{ node_id: memberNodeId, role_ids: roleIds }],
      });
    } catch (e) {
      setMemberRoles((prev) => ({ ...prev, [memberNodeId]: previous }));
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingMemberId(null);
    }
  }

"""
        + t[end:]
    )
else:
    t = t.replace(
        old_fn,
        """  async function persistMemberRoles(memberNodeId: string, roleIds: string[]) {
    if (!nodeId) return;
    const previous = memberRoles[memberNodeId] ?? [];
    setMemberRoles((prev) => ({ ...prev, [memberNodeId]: roleIds }));
    setSavingMemberId(memberNodeId);
    setError(null);
    try {
      await api.updateGovernance(gid, {
        caller_node_id: nodeId,
        member_roles: [{ node_id: memberNodeId, role_ids: roleIds }],
      });
    } catch (e) {
      setMemberRoles((prev) => ({ ...prev, [memberNodeId]: previous }));
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingMemberId(null);
    }
  }""",
        1,
    )

# table section - find by MemberRoleAssign block
import re

pattern = re.compile(
    r"<p className=\"app-muted\">\s*\n\s*使用「添加」.*?</p>\s*\n"
    r"\s*<table className=\"app-table app-table--member-roles\">.*?</table>",
    re.DOTALL,
)

replacement = """<p className="app-muted">使用「添加」分配角色，点击标签上的 × 移除；修改后立即保存。</p>
            <table className="app-table app-table--member-roles">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>群组角色</th>
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
                        disabled={busy || savingMemberId === m.node_id}
                        onChange={(roleIds) => void persistMemberRoles(m.node_id, roleIds)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>"""

m = pattern.search(t)
if not m:
    raise SystemExit("table section not found")
t = t[: m.start()] + replacement + t[m.end() :]

p.write_text(t, encoding="utf-8")
print("ok")
