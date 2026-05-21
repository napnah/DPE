# 开发模块 M3：网络发现、信令与 P2P 传输

## 模块定位

负责**节点如何找到彼此、建立会话并交换信令帧**：LAN mDNS/探测、UID 查询、WebSocket 信令中继、AuthEnvelope 握手，以及（与 M4 协作的）WebRTC DataChannel 载荷。不处理文档业务规则与数据库。

## 工作区域

| 路径 | 说明 |
|------|------|
| `apps/signaling/` | 群组房间 WebSocket：`join` / `leave` / `signal` / `peers` |
| `apps/lan-agent/` | mDNS、手动 peer、`/network`、`/discovery`、`DPE_DISCOVERY_PROBE_HOSTS` 探测 |
| `apps/lan-agent/src/load-env.ts` | 加载仓库根 `.env`（与 signaling 一致） |
| `apps/signaling/src/load-env.ts` | 同上 |
| `packages/p2p/` | AuthEnvelope 校验、首包握手、信令消息 schema 辅助 |
| `docs/P3.md` | P3 交付与协议说明 |
| `docs/platform-setup.md` | 双机、探测主机、端口说明 |
| `docs/acceptance-dual-host.md` | 双机邻居与信令验收（与 T2 共担） |

**不在本模块修改：**

- Prisma、群组 API（M2）
- Yjs `applyUpdate`、合并守卫（M4 + `@dpe/yjs-provider`）
- React 路由与页面（M4，可调用本模块 HTTP/WS URL）

## 工作职责

### 1. 信令服务（`apps/signaling`）

- 按 `group_id` 分房间转发 WebRTC signaling payload。
- 连接健康检查 `/health`；端口 `SIGNALING_PORT`（默认 3002）。
- 环境：`DPE_SIGNALING_URL`（供 lan-agent / 其他服务引用）。

### 2. LAN Agent（`apps/lan-agent`）

- 发布本机节点信息（`DPE_AGENT_HOST`、`DPE_AGENT_NAME`）。
- mDNS 服务发现；可选 `DPE_MDNS_INTERFACE`、`DPE_DISABLE_MDNS`。
- **探测回退**：`DPE_DISCOVERY_PROBE_HOSTS` 对指定 IP 轮询 `/network`（解决 mDNS 单向可见）。
- 手动 peer：`DPE_MANUAL_PEERS`。
- REST：`/network`、`/discovery`、按 UID 查 peer 等（以实现为准）。

### 3. P2P 包（`packages/p2p`）

- AuthEnvelope：连接建立后首包携带 JWT/身份，校验失败则拒绝数据通道。
- 与 `@dpe/proto` 对齐的消息结构。
- 单元测试覆盖握手与非法首包。

### 4. 双机 / 多节点拓扑

- 每台机器独立 `pnpm dev` + 独立 `.env`（示例见 `.env.example` / `.env.vm.example`）。
- 浏览器访问**固定 origin**（全 localhost 或全 LAN IP，勿混用 `localhost` 与 IP，否则身份 storage 隔离）。
- 文档化：主机填对端 IP 到 `DPE_DISCOVERY_PROBE_HOSTS`，VM 填主机 IP。

## 目标与完成标准

| 目标 | 完成标准 |
|------|----------|
| **G1 四服务健康** | `pnpm dev` 后 signaling:3002、lan-agent:3003 `/health` 返回 OK |
| **G2 信令房间** | 同群两节点 `join` 后互相收到 `peers` 并可 `signal` |
| **G3 邻居发现** | 单机 mDNS 或探测列表能看到对端；终端日志出现 `probe hosts`（若配置） |
| **G4 安全握手** | 无有效 AuthEnvelope 不进入明文 Yjs 同步（与 M4 联调） |
| **G5 P3 验收** | `pnpm verify:p3` 通过 |

## 对外接口

| 类型 | 消费者 |
|------|--------|
| `ws://host:3002/ws` | M4 `p2p-mesh` / 群组页信令 |
| `http://host:3003/*` | M4 dashboard、连接页、`VITE_LAN_AGENT_URL` |
| `@dpe/p2p` | M4 WebRTC 封装 |

## 环境变量（本模块相关）

| 变量 | 用途 |
|------|------|
| `SIGNALING_PORT` / `LAN_AGENT_PORT` | 服务端口 |
| `VITE_SIGNALING_URL` / `VITE_LAN_AGENT_URL` | Web 连接地址（M4 构建时注入） |
| `DPE_AGENT_HOST` / `DPE_AGENT_NAME` | 本机 LAN 身份 |
| `DPE_DISCOVERY_PROBE_HOSTS` | 逗号分隔对端 IP，探测邻居 |
| `DPE_MANUAL_PEERS` | 手工添加 peer |
| `DPE_MDNS_INTERFACE` / `DPE_DISABLE_MDNS` | mDNS 调优 |

## 典型任务示例

- 双机只见一端邻居 → 检查 probe 配置、`load-env` 是否加载根 `.env`、防火墙。
- 信令断开 → signaling 日志、群组页「重试信令」、房间 ID 是否等于 `group_id`。
- 新传输帧类型 → M1 proto + `packages/p2p` + M4 provider。

## 验收命令

```bash
pnpm --filter @dpe/p2p test
pnpm verify:p3
# 手动：两终端 pnpm dev，浏览器各开固定 origin，连接页查看邻居与信令状态
```

## 风险与边界

- **不做**：JWT 签发、文档 ACL 存储、群组设置 UI。
- **注意**：NAT/虚拟机网卡可能导致 mDNS 不可靠，探测列表是课设环境的**必要**补充而非可选装饰。
