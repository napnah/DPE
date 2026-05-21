# 开发模块 M1：密码学、协议与 ACL 基础

## 模块定位

为全项目提供**与运行时无关**的密码学原语、Zod 协议定义、合并前 ACL 策略判断，以及跨端共享常量/工具。本模块不依赖 Nest、React 或 WebRTC，可被控制平面、浏览器与测试直接引用。

## 工作区域

| 路径 | 包名 | 说明 |
|------|------|------|
| `packages/crypto/` | `@dpe/crypto` | Ed25519、JWT(EdDSA)、AES-GCM、SignedUpdate、ReplayCache、文档密钥密封 |
| `packages/proto/` | `@dpe/proto` | AuthEnvelope、JwtPayload、SignedUpdate、KeyRotation、Operable RPC 等 Zod schema |
| `packages/acl/` | `@dpe/acl` | 合并前 role 校验、只读拒写等策略辅助 |
| `packages/shared/` | `@dpe/shared` | 版本号、ROLE 常量、`ROOT_DOC_ID`、`isFolderDoc`、`randomUuid` 等 |
| `docs/design.md`（§3–§4 密码与权限） | — | 本模块实现的规范来源 |
| `docs/P1.md` | — | 阶段交付与验收说明 |

**不在本模块修改：**

- `apps/*` 任何业务服务
- `packages/p2p`、`packages/yjs-provider`（属 M3/M4）
- Prisma schema、HTTP 路由（属 M2）

## 工作职责

### 1. 身份与密钥

- 浏览器/Node 统一的 NodeID 推导（公钥 → SHA-256 hex）。
- Ed25519 签名与验签；私钥不落服务端（Web 本地生成）。

### 2. JWT 与文档密钥

- 签发/校验 JWT；payload 中含 `doc_id`、`role`、`key_version`，**禁止**明文 `doc_key`。
- `doc_key` 使用管理员公钥密封后写入 JWT（`sealDocKeyForMember` 等）。

### 3. 文档载荷加密

- 每文档 AES-256-GCM；nonce + ciphertext。
- **LAN HTTP** 等无 `crypto.subtle` 环境须可用（如 `@noble/ciphers` 兜底）。

### 4. SignedUpdate 与防重放

- Yjs 更新封装为 SignedUpdate（含 `signer_node_id`、`seq`、签名）。
- ReplayCache：`(signer_node_id, seq)` 去重。

### 5. 协议 schema（`@dpe/proto`）

- 所有跨服务/跨进程消息的结构与校验；变更需版本化并同步 M2/M3/M4 消费方。
- Operable RPC：`SetDocRoleAcl`、`CreateChild`、`RenameDoc`、`DeleteDoc` 等 discriminated union。

### 6. ACL 策略（`@dpe/acl`）

- 合并前：发送方 `role >= 2`、接收方权限、签名有效。
- 文档树权限**不**做父子单调约束（以节点 ACL 为准，见 `design.md` §2.2）。

### 7. 共享工具（`@dpe/shared`）

- 权限级别常量、根目录 ID、文件夹判定、在 HTTP 下可用的 `randomUuid()` 等。

## 目标与完成标准

| 目标 | 完成标准 |
|------|----------|
| **G1 协议单一事实来源** | M2/M3/M4 仅通过 `@dpe/proto` 解析 RPC/帧，无重复手写 schema |
| **G2 安全基线可测** | `packages/crypto`、`packages/proto`、`packages/acl` 单元测试通过；`pnpm verify:p1` 绿色 |
| **G3 跨环境可用** | 在 `http://192.168.x.x` 下加解密、UUID 生成不依赖仅 secure context 的 API |
| **G4 与方案一致** | 实现对照 `docs/design.md` §3.5、§4 四级权限语义（0–3） |

## 对外接口（供其他模块使用）

- **导出**：`@dpe/crypto`、`@dpe/proto`、`@dpe/acl`、`@dpe/shared` 的 public API。
- **消费方**：M2（签发 JWT）、M3（AuthEnvelope）、M4（浏览器加解密与合并守卫）。

## 典型任务示例

- 新增 RPC op → 先改 `packages/proto/src/rpc.ts` + 测试，再通知 M2/M4。
- 轮换算法或 JWT claim → 改 crypto + 文档，并触发 M2 签发路径回归（T1/T2）。
- 新权限级别（若扩展 0–3）→ 同步 `shared` 常量、`acl` 策略、`design.md`。

## 验收命令

```bash
pnpm --filter @dpe/crypto test
pnpm --filter @dpe/proto test
pnpm --filter @dpe/acl test
pnpm --filter @dpe/shared test
pnpm verify:p1
```

## 风险与边界

- **不做**：HTTP 路由、数据库、UI、WebRTC 信令房间逻辑。
- **注意**：修改 JWT 字段或 SignedUpdate 布局会导致全链路不兼容，须协调 T2 做 E2E 回归。
