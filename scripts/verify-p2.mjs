#!/usr/bin/env node
/**
 * P2 acceptance: P1 + control-plane build; optional API smoke with Postgres.
 *   pnpm verify:p2
 *   pnpm verify:p2 --api
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cpDir = path.join(root, "apps", "control-plane");
const DEFAULT_DB = "postgresql://dpe:dpe@localhost:5432/dpe";

function run(cmd, args, label, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true, env: process.env });
  if (r.status !== 0) {
    console.error(`FAIL: ${label}`);
    process.exit(r.status ?? 1);
  }
  console.log(`OK: ${label}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(baseUrl, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      const body = await res.json();
      if (body.status === "ok") return;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error("control-plane health timeout");
}

async function apiSmoke() {
  const { generateNodeKeyPair, bytesToBase64Url } = await import("@dpe/crypto");

  const owner = await generateNodeKeyPair();
  const base = "http://127.0.0.1:3099";

  const createRes = await fetch(`${base}/groups`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "verify-p2",
      owner_node_id: owner.nodeId,
      owner_public_key: bytesToBase64Url(owner.publicKey),
      control_mode: "proxy",
    }),
  });
  if (!createRes.ok) throw new Error(`create group: ${createRes.status} ${await createRes.text()}`);
  const created = await createRes.json();
  const groupId = created.group_id;
  if (!groupId || !created.pk_admin) throw new Error("invalid create response");

  const jwtRes = await fetch(`${base}/groups/${groupId}/jwt/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      node_id: owner.nodeId,
      doc_id: "root",
    }),
  });
  if (!jwtRes.ok) throw new Error(`jwt refresh: ${jwtRes.status} ${await jwtRes.text()}`);
  const jwtBody = await jwtRes.json();
  if (!jwtBody.jwt || jwtBody.role !== 3) throw new Error("invalid jwt response");

  const treeRes = await fetch(
    `${base}/groups/${groupId}/tree?node_id=${encodeURIComponent(owner.nodeId)}`,
  );
  if (!treeRes.ok) throw new Error(`tree: ${treeRes.status}`);
  const tree = await treeRes.json();
  if (!tree.nodes?.length) throw new Error("empty tree");

  console.log("OK: P2 API smoke (create, jwt, tree)");
}

async function main() {
  run("node", ["scripts/verify-p1.mjs"], "P1 baseline");

  run("pnpm", ["install"], "pnpm install");
  run("pnpm", ["--filter", "@dpe/control-plane", "exec", "prisma", "generate"], "prisma generate", cpDir);
  run("pnpm", ["--filter", "@dpe/control-plane", "build"], "control-plane build");

  if (!process.argv.includes("--api")) {
    console.log("\nP2 verification passed (build only). Run with --api for Postgres smoke.");
    return;
  }

  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DB;
  process.env.DATABASE_URL = databaseUrl;
  run(
    "pnpm",
    ["--filter", "@dpe/control-plane", "exec", "prisma", "db", "push", "--skip-generate"],
    "prisma db push",
    cpDir,
  );

  const child = spawn("pnpm", ["exec", "tsx", "src/main.ts"], {
    cwd: cpDir,
    env: {
      ...process.env,
      PORT: "3099",
      DATABASE_URL: databaseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  try {
    await waitHealth("http://127.0.0.1:3099");
    console.log("OK: control-plane health");
    await apiSmoke();
    console.log("\nP2 verification passed (with API smoke).");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
