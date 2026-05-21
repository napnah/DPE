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

## Acceptance (P6)

```bash
pnpm verify:p6           # unit + lint + security audit (no DB)
pnpm verify:p6 --live    # + Postgres E2E API + signaling + lan-agent
```

双机 LAN 验收见 [acceptance-dual-host.md](./acceptance-dual-host.md)。

### 重启后互相发现不了

1. **两边都** `docker compose up -d postgres` 后 `pnpm dev`（根目录 `.env` 会被 lan-agent / signaling / web 加载）。
2. **主机** `.env`：`DPE_DISCOVERY_PROBE_HOSTS=192.168.199.128`；**虚拟机** 复制 `.env.vm.example` 为 `.env`，设 `DPE_DISCOVERY_PROBE_HOSTS=192.168.199.1` 与本机 `192.168.199.128` 的 `VITE_*`。
3. 启动后看主机终端是否有 `[lan-agent] probe hosts: 192.168.199.128`；没有则说明 `.env` 未生效或未重启。
4. 浏览器**固定** `http://192.168.199.1:5173` 或 `http://192.168.199.128:5173`（不要混用 `localhost`）；「连接」页连的是本页面对应的 `VITE_LAN_AGENT_URL`。
5. 自检：`http://本机IP:3003/discovery` 的 `peers` 数组；对端需 **3003 可达**（防火墙放行 TCP 3003、UDP 5353）。
6. VM IP 若 DHCP 变了，更新两边 `DPE_DISCOVERY_PROBE_HOSTS`。
