"""Patch groups.service.ts for multi-role governance and doc ACL metadata."""
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "apps/control-plane/src/groups/groups.service.ts"
text = path.read_text(encoding="utf-8")

# getDocRoleAcls: add my_access_level and can_manage_acl
old_return = """    return {
      doc_id: docId,
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        access_level: byRole[r.id] ?? 0,
      })),
    };
  }"""

new_return = """    const isOwner = group.ownerNodeId === callerNodeId;
    return {
      doc_id: docId,
      my_access_level: level,
      can_manage_acl: isOwner || level >= 3,
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        access_level: byRole[r.id] ?? 0,
      })),
    };
  }"""

if old_return in text:
    text = text.replace(old_return, new_return, 1)
else:
    print("WARN: getDocRoleAcls return block not found")

# updateGovernance: extend assignments block
old_assign = """      if (dto.assignments) {
        for (const a of dto.assignments) {
          await tx.memberRoleAssignment.upsert({
            where: { groupId_nodeId: { groupId, nodeId: a.node_id } },
            create: { groupId, nodeId: a.node_id, roleId: a.role_id },
            update: { roleId: a.role_id },
          });
          await syncMemberAllDocs(tx, groupId, a.node_id, group.ownerNodeId);
        }
      }"""

new_assign = """      if (dto.create_roles?.length) {
        const maxSort = await tx.groupRole.aggregate({
          where: { groupId },
          _max: { sortOrder: true },
        });
        let sort = (maxSort._max.sortOrder ?? 0) + 1;
        for (const cr of dto.create_roles) {
          const base = (cr.slug ?? cr.name)
            .trim()
            .toLowerCase()
            .replace(/\\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "");
          const slug = base || `role-${sort}`;
          await tx.groupRole.create({
            data: {
              groupId,
              name: cr.name.trim(),
              slug: `${slug}-${sort}`,
              color: cr.color ?? "#8250df",
              sortOrder: sort++,
              isBuiltin: false,
            },
          });
        }
      }
      const memberRoleUpdates = dto.member_roles?.length
        ? dto.member_roles
        : dto.assignments?.map((a) => ({ node_id: a.node_id, role_ids: [a.role_id] }));
      if (memberRoleUpdates?.length) {
        for (const m of memberRoleUpdates) {
          await tx.memberRoleAssignment.deleteMany({
            where: { groupId, nodeId: m.node_id },
          });
          for (const roleId of m.role_ids) {
            await tx.memberRoleAssignment.create({
              data: { groupId, nodeId: m.node_id, roleId },
            });
          }
          await syncMemberAllDocs(tx, groupId, m.node_id, group.ownerNodeId);
        }
      }"""

if old_assign in text:
    text = text.replace(old_assign, new_assign, 1)
else:
    print("WARN: assignments block not found")

# groupCard: multiple roles for non-owner
old_card = """    const assignment = await this.prisma.memberRoleAssignment.findUnique({
      where: { groupId_nodeId: { groupId: g.id, nodeId } },
    });
    const role = assignment
      ? await this.prisma.groupRole.findUnique({ where: { id: assignment.roleId } })
      : null;
    return {
      group_id: g.id,
      name: g.name,
      description: g.description,
      control_mode: g.controlMode,
      owner_node_id: g.ownerNodeId,
      proxy_base_url: g.proxyBaseUrl,
      created_at: g.createdAt,
      is_owner: false,
      my_role_name: role?.name ?? "成员",
      my_role_color: role?.color ?? "#656d76",
    };
  }"""

new_card = """    const assignments = await this.prisma.memberRoleAssignment.findMany({
      where: { groupId: g.id, nodeId },
    });
    const roleRows = assignments.length
      ? await this.prisma.groupRole.findMany({
          where: { id: { in: assignments.map((a) => a.roleId) } },
          orderBy: { sortOrder: "asc" },
        })
      : [];
    const my_role_name = roleRows.length
      ? roleRows.map((r) => r.name).join(" · ")
      : "成员";
    const my_role_color = roleRows[0]?.color ?? "#656d76";
    return {
      group_id: g.id,
      name: g.name,
      description: g.description,
      control_mode: g.controlMode,
      owner_node_id: g.ownerNodeId,
      proxy_base_url: g.proxyBaseUrl,
      created_at: g.createdAt,
      is_owner: false,
      my_role_name,
      my_role_color,
      my_roles: roleRows.map((r) => ({ name: r.name, color: r.color })),
    };
  }"""

if old_card in text:
    text = text.replace(old_card, new_card, 1)
else:
    print("WARN: groupCard block not found")

path.write_text(text, encoding="utf-8", newline="\n")
print("patched groups.service.ts")
