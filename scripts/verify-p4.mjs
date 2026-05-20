#!/usr/bin/env node
/**
 * P4 acceptance: P3 baseline + @dpe/yjs-provider two-node sync tests.
 *   pnpm verify:p4
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, label, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true, env: process.env });
  if (r.status !== 0) {
    console.error(`FAIL: ${label}`);
    process.exit(r.status ?? 1);
  }
  console.log(`OK: ${label}`);
}

function main() {
  run("node", ["scripts/verify-p3.mjs"], "P3 baseline");
  run("pnpm", ["turbo", "run", "build", "--filter", "@dpe/yjs-provider"], "yjs-provider build");
  run("pnpm", ["turbo", "run", "test", "--filter", "@dpe/yjs-provider"], "yjs-provider tests");
  console.log("\nP4 verification passed.");
}

main();
