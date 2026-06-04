import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://dpe:dpe@localhost:5432/dpe";

const p = new PrismaClient();
const rows = await p.group.findMany({
  select: {
    id: true,
    name: true,
    controlMode: true,
    ownerPublicKey: true,
    proxyPublicKey: true,
    issuerPublicKey: true,
    createdAt: true,
  },
  orderBy: { createdAt: "asc" },
});
for (const r of rows) console.log(JSON.stringify(r));
await p.$disconnect();
