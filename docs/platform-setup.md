# Platform Setup (Windows / Linux)

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

```bash
pnpm install
pnpm dev
```
