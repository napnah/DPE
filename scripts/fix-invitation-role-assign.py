from pathlib import Path

path = Path(__file__).resolve().parents[1] / "apps/control-plane/src/groups/groups.service.ts"
text = path.read_text(encoding="utf-8")

old = """      await this.prisma.memberRoleAssignment.upsert({
        where: {
          groupId_nodeId_roleId: {
            groupId: inv.groupId,
            nodeId: dto.node_id,
            roleId: rules.defaultMemberRoleId,
          },
        },
        create: {
          groupId: inv.groupId,
          nodeId: dto.node_id,
          roleId: rules.defaultMemberRoleId,
        },
        update: {},
      });"""

new = """      const hasDefaultRole = await this.prisma.memberRoleAssignment.findFirst({
        where: {
          groupId: inv.groupId,
          nodeId: dto.node_id,
          roleId: rules.defaultMemberRoleId,
        },
      });
      if (!hasDefaultRole) {
        await this.prisma.memberRoleAssignment.create({
          data: {
            groupId: inv.groupId,
            nodeId: dto.node_id,
            roleId: rules.defaultMemberRoleId,
          },
        });
      }"""

if old in text:
    text = text.replace(old, new, 1)
elif "hasDefaultRole" not in text:
    old2 = """      await this.prisma.memberRoleAssignment.upsert({
        where: { groupId_nodeId: { groupId: inv.groupId, nodeId: dto.node_id } },
        create: {
          groupId: inv.groupId,
          nodeId: dto.node_id,
          roleId: rules.defaultMemberRoleId,
        },
        update: { roleId: rules.defaultMemberRoleId },
      });"""
    if old2 in text:
        text = text.replace(old2, new, 1)

path.write_text(text, encoding="utf-8", newline="\n")
print("fixed")
