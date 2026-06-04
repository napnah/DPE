import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://dpe:dpe@localhost:5432/dpe";

const p = new PrismaClient();
const gid = process.argv[2];
const docId = process.argv[3] || "root";
const nodeId = process.argv[4];

const group = await p.group.findUnique({ where: { id: gid }, select: { ownerNodeId: true } });
console.log("group.ownerNodeId =", group?.ownerNodeId);

if (nodeId) {
  console.log("member.nodeId =", nodeId, " isOwner =", group?.ownerNodeId === nodeId);
  const grant = await p.aclGrant.findUnique({
    where: { groupId_docId_nodeId: { groupId: gid, docId, nodeId } },
  });
  console.log("aclGrant(", docId, ") =", grant);

  const assigns = await p.memberRoleAssignment.findMany({ where: { groupId: gid, nodeId } });
  console.log("roleAssignments:", assigns);

  for (const a of assigns) {
    const ra = await p.docRoleAcl.findUnique({
      where: { groupId_docId_roleId: { groupId: gid, docId, roleId: a.roleId } },
    });
    console.log("  docRoleAcl[", a.roleId, "] =", ra);
  }
}

await p.$disconnect();
