# DPE Architecture

See [design.md](./design.md) for the cryptographic and P2P design.

## Components

- **apps/web** — React UI (dashboard + group panel)
- **apps/control-plane** — NestJS IdP (JWT, ACL, RPC)
- **apps/signaling** — WebRTC signaling
- **apps/lan-agent** — mDNS / LAN discovery bridge (Windows + Linux)
- **packages/** — crypto, proto, acl, yjs-provider

## Control modes

- `owner_direct` — owner signs JWT
- `proxy` — proxy server allocates permissions (default for demos)
