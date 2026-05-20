from pathlib import Path

path = Path(__file__).resolve().parents[1] / "apps/control-plane/src/groups/groups.service.ts"
text = path.read_text(encoding="utf-8")

if "resolveMyRolesOnDoc" not in text:
    text = text.replace(
        "  resolveAccessLevel,\n",
        "  resolveAccessLevel,\n  resolveMyRolesOnDoc,\n",
        1,
    )

old = """    const isOwner = group.ownerNodeId === callerNodeId;
    return {
      doc_id: docId,
      my_access_level: level,
      can_manage_acl: isOwner || level >= 3,
      roles: roles.map((r) => ("""

new = """    const isOwner = group.ownerNodeId === callerNodeId;
    const my_roles = await resolveMyRolesOnDoc(
      this.prisma,
      groupId,
      callerNodeId,
      docId,
      group.ownerNodeId,
    );
    return {
      doc_id: docId,
      my_access_level: level,
      my_roles,
      can_manage_acl: isOwner || level >= 3,
      roles: roles.map((r) => ("""

if old in text:
    text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8", newline="\n")
    print("patched")
else:
    print("pattern not found")
