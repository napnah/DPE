# Distributed Privacy Editor (DPE)

P2P collaborative editor with encrypted CRDT sync, ACL, and optional proxy control plane.

## Quick start

```bash
cp .env.example .env
docker compose up -d postgres redis
pnpm install
pnpm dev
```

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
