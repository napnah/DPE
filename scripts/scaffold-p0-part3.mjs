import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function w(rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

w("apps/web/index.html", `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Distributed Privacy Editor</title>
</head>
<body>
  <motion.div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`.replace("<motion.div id=\"root\"></div>", "<div id=\"root\"></motion.div>").replace("</motion.div>", "</div>"));

w("apps/web/src/pages/DashboardPage.tsx", `import { Link } from "react-router-dom";

export default function DashboardPage() {
  const uid = localStorage.getItem("dpe_uid") ?? "unknown";
  return (
    <main style={{ padding: "2rem" }}>
      <h1>总面板</h1>
      <p>UID: <code>{uid}</code></p>
      <div className="card">
        <h2>网络与邻居</h2>
        <p>lan-agent: http://localhost:3003</p>
      </div>
      <div className="card">
        <h2>群组</h2>
        <Link to="/groups/demo">演示群组</Link>
      </div>
    </main>
  );
}
`);

w("apps/web/src/pages/GroupPage.tsx", `import { useParams } from "react-router-dom";

export default function GroupPage() {
  const { groupId } = useParams();
  return (
    <main style={{ padding: "2rem" }}>
      <h1>群组: {groupId}</h1>
      <p>文档树与富文本编辑器（P5）</p>
    </main>
  );
}
`);

const design = fs.readFileSync(path.join(root, "方案.md"), "utf8");
w("docs/design.md", design);

w("docs/architecture.md", `# DPE Architecture

See [design.md](./design.md) for the cryptographic and P2P design.

## Components

- **apps/web** — React UI (dashboard + group panel)
- **apps/control-plane** — NestJS IdP (JWT, ACL, RPC)
- **apps/signaling** — WebRTC signaling
- **apps/lan-agent** — mDNS / LAN discovery bridge (Windows + Linux)
- **packages/** — crypto, proto, acl, yjs-provider

## Control modes

- \`owner_direct\` — owner signs JWT
- \`proxy\` — proxy server allocates permissions (default for demos)
`);

w("docs/platform-setup.md", `# Platform Setup (Windows / Linux)

## Requirements

- Node.js 20+
- pnpm 9+
- Docker (control-plane + Postgres + Redis)

## Windows

- Install Docker Desktop with WSL2
- Allow Node through firewall for LAN agent (port 3003)
- If mDNS fails, add manual peers in lan-agent config (P3)

## Linux

- Docker Engine + docker compose plugin
- Open UDP 5353 if using mDNS (ufw allow 5353/udp)

## Dev

\`\`\`bash
pnpm install
pnpm dev
\`\`\`
`);

w("docs/threat-model.md", `# Threat Model

See design doc section 6. DPE protects against unauthorized members and eavesdropping; does not protect against a malicious Admin or proxy.
`);

w("docs/requirements.md", `# Requirements

User requirements are mapped in the project plan (sections 6.2 and 6.3).
`);

w("README.md", `# Distributed Privacy Editor (DPE)

P2P collaborative editor with encrypted CRDT sync, ACL, and optional proxy control plane.

## Quick start

\`\`\`bash
cp .env.example .env
docker compose up -d postgres redis
pnpm install
pnpm dev
\`\`\`

| Service | URL |
|---------|-----|
| Web | http://localhost:5173 |
| Control plane | http://localhost:3001/health |
| Signaling | http://localhost:3002/health |
| LAN agent | http://localhost:3003/health |

## Docs

- [Design (中文)](./docs/design.md) — also [方案.md](./方案.md)
- [Architecture](./docs/architecture.md)
- [Platform setup](./docs/platform-setup.md)

## License

MIT
`);

w(".github/workflows/ci.yml", `name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install
      - run: pnpm build
`);

console.log("part3 done");