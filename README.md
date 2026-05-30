# Distributed Privacy Editor (DPE)

分布式隐私协作文档编辑器：P2P 加密同步、逐节点 ACL、可选代理控制平面（JWT / 群组 / 邀请）。

## 功能概览

| 能力 | 说明 |
|------|------|
| 身份 | 浏览器端 Ed25519，UID = SHA-256(公钥) |
| 群组 | 建群、邀请、入群；`root` 为**目录**，子文档可编辑 |
| 权限 | 0–3 级（不可见 / 只读 / 可写 / 可操作）；`SetACL`、无父子权限单调约束 |
| 协作 | Yjs CRDT + AES-GCM **SignedUpdate**；合并前校验 role / 签名 / 防重放 |
| P2P | WebRTC 信令 mesh、AuthEnvelope 握手、LAN 发现（mDNS + 手动 peer） |
| 控制平面 | NestJS + PostgreSQL：JWT 签发（密封 `doc_key`）、文档树、RPC |

Web 路由：`/` 生成身份 → `/dashboard` 总面板 → `/groups/:id` 群组 → `/groups/:id/docs/:docId` 编辑。

## 环境要求

- Node.js **20+**
- pnpm **9+**（仓库使用 `packageManager: pnpm@9.15.0`）
- Docker（仅 **PostgreSQL** 本地开发必需；`redis` 在 compose 中可选，当前控制平面未强依赖）

## 快速启动
在仓库根目录使用 docker 启动：
```shell
docker compose up -d
```
停止：
```shell
docker compose down
```

## 开发者部署
### 首次初始化（一次性）

在仓库根目录执行：

```bash
pnpm install
cp .env.example .env          # Windows: copy .env.example .env
docker compose up -d postgres
cd apps/control-plane && pnpm db:push && cd ../..
```

`.env` 中 Web 默认指向本机服务（与 `pnpm dev` 端口一致）：

| 变量 | 默认值 |
|------|--------|
| `VITE_API_URL` | http://localhost:3001 |
| `VITE_SIGNALING_URL` | ws://localhost:3002 |
| `VITE_LAN_AGENT_URL` | http://localhost:3003 |

### 一键启动（日常开发）

初始化完成后，在**仓库根目录**：

```bash
pnpm dev
```

Turbo 会并行启动：

| 服务 | 端口 | 健康检查 |
|------|------|----------|
| Web（Vite） | 5173 | http://localhost:5173 |
| Control plane | 3001 | http://localhost:3001/health |
| Signaling | 3002 | http://localhost:3002/health |
| LAN agent | 3003 | http://localhost:3003/health |

浏览器打开 **http://localhost:5173** → 生成身份 → 建群/入群 → 在根目录下新建文档 → 进入子文档协作编辑。

> 须通过建群或接受邀请流程进入群组，以便将 `pk_admin` 写入 `localStorage`；否则 P2P / JWT 可能失败。

## 常用命令

```bash
pnpm dev              # 一键启动全部开发服务
pnpm build            # 全仓构建
pnpm test             # 全仓单元测试
pnpm lint             # 全仓 TypeScript 检查

pnpm verify:p6        # 推荐：P5 基线 + test/lint + 安全审计（无需 DB）
pnpm verify:p6 --live # 完整 E2E（需 Postgres，见 docs/P6.md）
```

分阶段验收：`verify:p1` … `verify:p5`，说明见各 `docs/P*.md`。

## 仓库结构

```
apps/
  web/              React 前端
  control-plane/    认证、ACL、JWT、群组 API
  signaling/        WebRTC 信令
  lan-agent/        mDNS / 邻居发现
packages/
  crypto, proto, acl, p2p, yjs-provider, shared
docs/               设计说明与 P1–P6 交付文档
scripts/            verify-p*.mjs、e2e-smoke、security-audit
```

## 文档

- [设计方案（中文）](./docs/design.md) · [方案.md](./方案.md)
- [架构](./docs/architecture.md) · [平台说明](./docs/platform-setup.md)
- 阶段文档：[P1](./docs/P1.md) [P2](./docs/P2.md) [P3](./docs/P3.md) [P4](./docs/P4.md) [P5](./docs/P5.md) [P6](./docs/P6.md)
- [双机验收清单](./docs/acceptance-dual-host.md)

## 故障排查

| 现象 | 处理 |
|------|------|
| 无法连接 lan-agent | 确认 `pnpm dev` 已启动；检查 `.env` 中 `VITE_LAN_AGENT_URL` |
| 用 `http://192.168.x.x:5173` 打开文档报 `importKey` | 非安全上下文无 `crypto.subtle`；已用 `@noble/ciphers` 兜底，需重启 `pnpm dev` 并刷新 |
| P2P 信令未连接 | 群组页点「重试信令」；确认 signaling :3002 可达 |
| 文档加载 / 签名失败 | 重新建群或入群以刷新 `pk_admin`；勿直接打开 `docs/root`（根为目录） |
| `prisma generate` EPERM（Windows） | 先关闭占用 Prisma 的 `pnpm dev`，再 `cd apps/control-plane && pnpm db:generate:safe` |
| Docker 未启动 | `docker compose up -d postgres` 后再 `db:push` |

## License

MIT
