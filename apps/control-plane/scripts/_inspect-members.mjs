import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://dpe:dpe@localhost:5432/dpe";

const p = new PrismaClient();
const gid = process.argv[2] || "ecd15b74-f8c7-452b-8acf-3dacc9dfd3eb";
const members = await p.member.findMany({
  where: { groupId: gid },
  select: { nodeId: true, publicKey: true, displayName: true, leftAt: true },
});
console.log("group:", gid);
for (const m of members) console.log(JSON.stringify(m));
await p.$disconnect();
