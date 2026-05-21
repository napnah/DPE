import type { Prisma } from "@prisma/client";
import { ROOT_DOC_ID } from "@dpe/shared";

export const BUILTIN_ROLES = [
  { slug: "admin", name: "管理员", color: "#0969da", level: 3 },
  { slug: "collaborator", name: "协作者", color: "#1a7f37", level: 2 },
  { slug: "reader", name: "读者", color: "#656d76", level: 1 },
] as const;

export type Tx = Prisma.TransactionClient;

/** Backfill RBAC for groups created before is_folder / RBAC tables. */
export async function ensureGroupRbac(
  tx: Tx,
  groupId: string,
  ownerNodeId: string,
): Promise<void> {
  const count = await tx.groupRole.count({ where: { groupId } });
  if (count === 0) {
    await seedGroupRbac(tx, groupId, ownerNodeId);
  }

  const rules = await tx.groupDefaultRules.findUnique({ where: { groupId } });
  if (!rules) return;

  const template = rules.createChildTemplate as Record<string, number>;
  const docs = await tx.docNode.findMany({ where: { groupId } });
  for (const d of docs) {
    const existing = await tx.docRoleAcl.count({
      where: { groupId, docId: d.docId },
    });
    if (existing === 0) {
      await applyCreateChildTemplate(tx, groupId, d.docId, template);
    }
  }

  const group = await tx.group.findUnique({ where: { id: groupId } });
  if (!group) return;

  const members = await tx.member.findMany({ where: { groupId, leftAt: null } });
  for (const m of members) {
    if (m.nodeId === group.ownerNodeId) continue;
    const assigned = await tx.memberRoleAssignment.count({
      where: { groupId, nodeId: m.nodeId },
    });
    if (assigned === 0) {
      await tx.memberRoleAssignment.create({
        data: {
          groupId,
          nodeId: m.nodeId,
          roleId: rules.defaultMemberRoleId,
        },
      });
    }
  }
  for (const m of members) {
    await syncMemberAllDocs(tx, groupId, m.nodeId, group.ownerNodeId);
  }
}

export async function seedGroupRbac(
  tx: Tx,
  groupId: string,
  ownerNodeId: string,
): Promise<{ adminId: string; readerId: string; template: Record<string, number> }> {
  const roles = await Promise.all(
    BUILTIN_ROLES.map((r, i) =>
      tx.groupRole.create({
        data: {
          groupId,
          slug: r.slug,
          name: r.name,
          color: r.color,
          sortOrder: i,
          isBuiltin: true,
        },
      }),
    ),
  );
  const bySlug = Object.fromEntries(roles.map((r) => [r.slug, r]));
  const template: Record<string, number> = {
    [bySlug.admin!.id]: 3,
    [bySlug.collaborator!.id]: 2,
    [bySlug.reader!.id]: 1,
  };
  await tx.groupDefaultRules.create({
    data: {
      groupId,
      defaultMemberRoleId: bySlug.reader!.id,
      createChildTemplate: template,
    },
  });
  await tx.memberRoleAssignment.create({
    data: { groupId, nodeId: ownerNodeId, roleId: bySlug.admin!.id },
  });
  await applyCreateChildTemplate(tx, groupId, ROOT_DOC_ID, template);
  return { adminId: bySlug.admin!.id, readerId: bySlug.reader!.id, template };
}

export async function applyCreateChildTemplate(
  tx: Tx,
  groupId: string,
  docId: string,
  template: Record<string, number>,
) {
  for (const [roleId, accessLevel] of Object.entries(template)) {
    await tx.docRoleAcl.create({
      data: { groupId, docId, roleId, accessLevel },
    });
  }
}


/** Copy parent doc role ACL rows onto a newly created child doc. */
export async function inheritParentDocAcl(
  tx: Tx,
  groupId: string,
  parentDocId: string,
  childDocId: string,
  ownerNodeId: string,
) {
  const parentAcls = await tx.docRoleAcl.findMany({
    where: { groupId, docId: parentDocId },
  });
  for (const row of parentAcls) {
    await tx.docRoleAcl.create({
      data: {
        groupId,
        docId: childDocId,
        roleId: row.roleId,
        accessLevel: row.accessLevel,
      },
    });
  }
  const members = await tx.memberRoleAssignment.findMany({ where: { groupId } });
  for (const m of members) {
    await syncMemberAllDocs(tx, groupId, m.nodeId, ownerNodeId);
  }
}

/** Operable (level 3) callers may only change ACL for roles currently below operable on this doc. */
export function canEditDocRoleAcl(
  callerIsOwner: boolean,
  callerLevel: number,
  targetRoleLevel: number,
): boolean {
  if (callerIsOwner) return true;
  if (callerLevel < 3) return false;
  return targetRoleLevel < 3;
}

export async function syncMemberDocGrant(
  tx: Tx,
  groupId: string,
  nodeId: string,
  docId: string,
  accessLevel: number,
) {
  if (accessLevel <= 0) {
    await tx.aclGrant.deleteMany({
      where: { groupId, docId, nodeId },
    });
    return;
  }
  await tx.aclGrant.upsert({
    where: { groupId_docId_nodeId: { groupId, docId, nodeId } },
    create: { groupId, docId, nodeId, role: accessLevel },
    update: { role: accessLevel },
  });
}

export async function syncAllMembersForDocRole(
  tx: Tx,
  groupId: string,
  docId: string,
  roleId: string,
  accessLevel: number,
) {
  const assignments = await tx.memberRoleAssignment.findMany({
    where: { groupId, roleId },
  });
  for (const a of assignments) {
    await syncMemberDocGrant(tx, groupId, a.nodeId, docId, accessLevel);
  }
}

/** Recompute effective ACL grants from all roles held by the member. */
export async function syncMemberAllDocs(
  tx: Tx,
  groupId: string,
  nodeId: string,
  ownerNodeId: string,
) {
  const group = await tx.group.findUnique({ where: { id: groupId } });
  if (!group) return;
  if (group.ownerNodeId === nodeId) {
    const docs = await tx.docNode.findMany({ where: { groupId } });
    for (const d of docs) {
      await syncMemberDocGrant(tx, groupId, nodeId, d.docId, 3);
    }
    return;
  }
  const assignments = await tx.memberRoleAssignment.findMany({
    where: { groupId, nodeId },
  });
  if (assignments.length === 0) return;

  const roleIds = new Set(assignments.map((a) => a.roleId));
  const docAcls = await tx.docRoleAcl.findMany({ where: { groupId } });
  const byDoc = new Map<string, number>();
  for (const row of docAcls) {
    if (!roleIds.has(row.roleId)) continue;
    byDoc.set(row.docId, Math.max(byDoc.get(row.docId) ?? 0, row.accessLevel));
  }
  for (const [docId, level] of byDoc) {
    await syncMemberDocGrant(tx, groupId, nodeId, docId, level);
  }
}

/** Effective access = max level across all roles assigned to the member. */
export async function resolveAccessLevel(
  tx: Tx,
  groupId: string,
  nodeId: string,
  docId: string,
  ownerNodeId: string,
): Promise<number> {
  if (ownerNodeId === nodeId) return 3;
  const assignments = await tx.memberRoleAssignment.findMany({
    where: { groupId, nodeId },
  });
  if (assignments.length === 0) return 0;

  let max = 0;
  for (const a of assignments) {
    const row = await tx.docRoleAcl.findUnique({
      where: {
        groupId_docId_roleId: { groupId, docId, roleId: a.roleId },
      },
    });
    max = Math.max(max, row?.accessLevel ?? 0);
  }
  return max;
}

export async function memberRoleIds(tx: Tx, groupId: string, nodeId: string): Promise<string[]> {
  const rows = await tx.memberRoleAssignment.findMany({
    where: { groupId, nodeId },
    select: { roleId: true },
  });
  return rows.map((r) => r.roleId);
}

export type MyRoleOnDoc = {
  role_id: string;
  name: string;
  color: string;
  access_level: number;
};

/** Roles held by the member and each role's access level on this doc. */
export async function resolveMyRolesOnDoc(
  tx: Tx,
  groupId: string,
  nodeId: string,
  docId: string,
  ownerNodeId: string,
): Promise<MyRoleOnDoc[]> {
  if (ownerNodeId === nodeId) {
    return [{ role_id: "owner", name: "群主", color: "#9a6700", access_level: 3 }];
  }
  const assignments = await tx.memberRoleAssignment.findMany({
    where: { groupId, nodeId },
  });
  if (assignments.length === 0) return [];

  const roleIds = assignments.map((a) => a.roleId);
  const roles = await tx.groupRole.findMany({
    where: { id: { in: roleIds } },
    orderBy: { sortOrder: "asc" },
  });
  const byRoleId = Object.fromEntries(roles.map((r) => [r.id, r]));
  const docRows = await tx.docRoleAcl.findMany({
    where: { groupId, docId, roleId: { in: roleIds } },
  });
  const levelByRole = Object.fromEntries(docRows.map((r) => [r.roleId, r.accessLevel]));

  return roles.map((r) => ({
    role_id: r.id,
    name: r.name,
    color: r.color,
    access_level: levelByRole[r.id] ?? 0,
  }));
}
