#!/usr/bin/env node
/**
 * Static checks aligned with 方案 threat model (§3.5, §3.3, §2.2).
 *   node scripts/security-audit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const violations = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function mustMatch(rel, pattern, message) {
  const text = read(rel);
  if (!pattern.test(text)) {
    violations.push({ file: rel, message });
  }
}

function mustNotMatch(rel, pattern, message) {
  const text = read(rel);
  if (pattern.test(text)) {
    violations.push({ file: rel, message });
  }
}

// JWT: doc_key field present; signing path uses seal helper on control-plane.
mustMatch("packages/proto/src/jwt.ts", /doc_key/, "JWT schema includes doc_key field");
mustMatch(
  "apps/control-plane/src/crypto/signing.service.ts",
  /sealDocKeyForMember/,
  "control-plane seals doc keys for members",
);

// Data plane: merge guards before apply.
mustMatch("packages/yjs-provider/src/merge-guard.ts", /canMergeContentWrite/, "merge guard enforces writable role");
mustMatch("packages/yjs-provider/src/merge-guard.ts", /ReplayCache|replay/, "replay protection wired");
mustMatch("packages/yjs-provider/src/secure-provider.ts", /validateAndDecryptIncoming/, "provider uses merge guard");

// P2P: AuthEnvelope handshake.
mustMatch("packages/p2p/src/auth-handshake.ts", /acceptAuthEnvelope/, "P2P AuthEnvelope handshake");
mustMatch("packages/p2p/src/auth-handshake.ts", /verifyJwt/, "P2P verifies JWT with pinned admin key");

// Web: trust refresh + root folder; inline editor on group page (DocEditorPage redirects).
mustMatch(
  "apps/web/src/components/DocInlineEditor.tsx",
  /parseJwtPayload/,
  "inline editor parses JWT after control-plane refresh",
);
mustNotMatch(
  "apps/web/src/components/DocInlineEditor.tsx",
  /verifyJwt\s*\(/,
  "editor must not verifyJwt with pinned pk (ephemeral issuer breaks)",
);
mustMatch(
  "apps/web/src/pages/DocEditorPage.tsx",
  /Navigate/,
  "legacy /docs/:id routes redirect to group workspace",
);
mustMatch(
  "apps/web/src/pages/GroupPage.tsx",
  /isFolder|isFolderNode|ROOT_DOC_ID/,
  "group tree treats root as folder",
);

// Design: RBAC documented; monotonic law removed.
const design = read("docs/design.md");
if (!/RBAC/.test(design)) {
  violations.push({ file: "docs/design.md", message: "RBAC section missing" });
}
if (/权限单调律/.test(design)) {
  violations.push({ file: "docs/design.md", message: "obsolete 权限单调律 still present" });
}

// Secrets: .env must be gitignored (local .env for dev is OK).
const gitignore = read(".gitignore");
if (!/^\s*\.env\s*$/m.test(gitignore)) {
  violations.push({ file: ".gitignore", message: ".env must be listed in .gitignore" });
}

if (violations.length > 0) {
  console.error("Security audit FAILED:\n");
  for (const v of violations) {
    console.error(`  - ${v.file}: ${v.message}`);
  }
  process.exit(1);
}

console.log("OK: security audit (" + (12) + " checks)");
