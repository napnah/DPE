#!/usr/bin/env node
/**
 * P1 acceptance: proto + crypto + acl unit tests and package builds.
 * Optional: node scripts/verify-p1.mjs --health
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, label) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`FAIL: ${label}`);
    process.exit(r.status ?? 1);
  }
  console.log(`OK: ${label}`);
}

async function main() {
  run("pnpm", ["--filter", "@dpe/proto", "test"], "proto tests");
  run("pnpm", ["--filter", "@dpe/proto", "build"], "proto build");
  run("pnpm", ["--filter", "@dpe/shared", "build"], "shared build");
  run("pnpm", ["--filter", "@dpe/crypto", "test"], "crypto tests");
  run("pnpm", ["--filter", "@dpe/crypto", "build"], "crypto build");
  run("pnpm", ["--filter", "@dpe/acl", "test"], "acl tests");
  run("pnpm", ["--filter", "@dpe/acl", "build"], "acl build");

  if (process.argv.includes("--health")) {
    for (const { url, name } of [
      { url: "http://localhost:3001/health", name: "control-plane" },
      { url: "http://localhost:3002/health", name: "signaling" },
      { url: "http://localhost:3003/health", name: "lan-agent" },
    ]) {
      try {
        const res = await fetch(url);
        const body = await res.json();
        if (body.status !== "ok") throw new Error(JSON.stringify(body));
        console.log(`OK: ${name} health`);
      } catch {
        console.warn(`SKIP: ${name} not running (${url})`);
      }
    }
  }

  console.log("\nP1 verification passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
