import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function w(rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

w(".gitignore", ["node_modules/", "dist/", ".turbo/", ".env", "*.pem", "coverage/", ".dpe/", ""].join("\n"));
w(".gitattributes", "* text=auto eol=lf\n");
w("pnpm-workspace.yaml", "packages:\n  - packages/*\n  - apps/*\n");

w("LICENSE", "MIT License\n\nCopyright (c) 2026 DPE Contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the Software), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTY OF ANY KIND.\n");

w(".env.example", [
  "DATABASE_URL=postgresql://dpe:dpe@localhost:5432/dpe",
  "REDIS_URL=redis://localhost:6379",
  "CONTROL_PLANE_PORT=3001",
  "SIGNALING_PORT=3002",
  "LAN_AGENT_PORT=3003",
  "VITE_API_URL=http://localhost:3001",
  "VITE_SIGNALING_URL=ws://localhost:3002",
  ""].join("\n"));

w("scripts/clean.mjs", [
  'import fs from "node:fs";',
  'import path from "node:path";',
  'const root = path.resolve(import.meta.dirname, "..");',
  'for (const name of ["dist", ".turbo"]) {',
  '  const p = path.join(root, name);',
  '  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });',
  '}',
  'console.log("cleaned");',
  ""].join("\n"));

function pkgJson(name, desc, deps = {}, devDeps = {}) {
  return JSON.stringify({
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    description: desc,
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    scripts: {
      build: "tsc",
      dev: "tsc --watch",
      test: "vitest run",
      lint: "tsc --noEmit",
    },
    dependencies: deps,
    devDependencies: {
      "@types/node": "^22.10.0",
      typescript: "^5.7.2",
      vitest: "^2.1.8",
      ...devDeps,
    },
  }, null, 2) + "\n";
}

function tsconfig() {
  return JSON.stringify({
    extends: "../../tsconfig.base.json",
    compilerOptions: { outDir: "dist", rootDir: "src", composite: true },
    include: ["src"],
  }, null, 2) + "\n";
}

const packages = [
  ["packages/shared", "@dpe/shared", "Shared constants"],
  ["packages/proto", "@dpe/proto", "Protocol schemas", { zod: "^3.24.1" }],
  ["packages/crypto", "@dpe/crypto", "Cryptography", { "@noble/ed25519": "^2.2.3", "@noble/hashes": "^1.6.1" }, { "@dpe/proto": "workspace:*" }],
  ["packages/acl", "@dpe/acl", "ACL policy", {}, { "@dpe/shared": "workspace:*" }],
  ["packages/yjs-provider", "@dpe/yjs-provider", "Yjs P2P provider", { yjs: "^13.6.20" }, { "@dpe/proto": "workspace:*", "@dpe/crypto": "workspace:*", "@dpe/acl": "workspace:*" }],
];

for (const row of packages) {
  const [dir, name, desc, deps = {}, dev = {}] = row;
  w(dir + "/package.json", pkgJson(name, desc, deps, dev));
  w(dir + "/tsconfig.json", tsconfig());
  w(dir + "/src/index.ts", `export const PACKAGE_NAME = ${JSON.stringify(name)};\n`);
  w(dir + "/vitest.config.ts", 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { environment: "node" } });\n');
}

console.log("scaffold packages done");