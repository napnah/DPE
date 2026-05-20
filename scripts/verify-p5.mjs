#!/usr/bin/env node
/**
 * P5 acceptance: P4 baseline + web build.
 *   pnpm verify:p5
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
  run("node", ["scripts/verify-p4.mjs"], "P4 baseline");
  run("pnpm", ["install"], "pnpm install");
  run("pnpm", ["--filter", "@dpe/web", "build"], "web build");
  console.log("\nP5 verification passed.");
}

main();
