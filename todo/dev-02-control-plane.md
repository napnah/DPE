# 开发模块 M2：控制平面与群组治理

## 模块定位

实现 **NestJS + PostgreSQL** 的「管理面」：群组生命周期、邀请入群、多角色 RBAC、文档树、按角色/节点的 ACL、JWT 刷新、Operable RPC，以及可选的 proxy 治理模式。是权限与结构的**权威数据源**。

## 工作区域

| 路径 | 说明 |
|------|------|
| `apps/control-plane/` | NestJS 应用（controllers、services、Prisma、JWT 签发） |
| `apps/control-plane/prisma/schema.prisma` | 数据模型：Group、Member、DocNode、DocRoleAcl、GroupRole 等 |
| `apps/control-plane/src/groups/` | 群组、治理、树、RPC、`groups-rbac.ts` |
| `apps/control-plane/src/crypto/` | 调用 `@dpe/crypto` 的 SigningService |
| `docker-compose.yml`（postgres 服务） | 本地 DB（与运维共享，schema 归本模块维护） |
| `docs/P2.md` | P2 阶段 API 与验收 |
| `docs/design.md`（§2 RBAC、§5 控制平面） | 行为规范 |

**不在本模块修改：**

- `apps/web` 页面与样式（M4）
- `apps/signaling`、`apps/lan-agent`（M3）
- `packages/yjs-provider`、P2P mesh 逻辑（M3/M4）
- 纯密码学实现（M1，仅调用）

## 工作职责

### 1. 群组与成员

- 建群、解散（仅群主）、成员列表、显示名同步。
- 邀请创建/接受/拒绝；入群时默认角色与 root 可见性。

### 2. RBAC 与治理

- 群组角色 CRUD（内置 admin/collaborator/reader + 自定义角色）。
- 成员多角色分配；`resolveAccessLevel` 取最高有效级别。
- 治理 API：默认成员角色；**不再**用「新建子项模板」写子节点 ACL（已改为继承父节点）。

### 3. 文档树与 Operable RPC

- `root` 为目录；`CreateChild`、`RenameDoc`、`DeleteDoc`。
- 新建子节点：**继承父节点 `docRoleAcl`**，并 `syncMemberAllDocs`。
- `requireOperable`：在目标节点上有效权限 ≥ 3（可操作）方可执行树结构 RPC。
- `SetDocRoleAcl`：群主全权限；非群主在节点上为可操作(3) 时，仅可改「当前级别 < 3」的角色行。

### 4. JWT 与密钥元数据

- `POST .../jwt/refresh`：按节点+文档解析 ACL，签发带密封 `doc_key` 的 JWT。
- 文档密钥版本、`rotate-key` 元数据。

### 5. 可见树 API

- `GET .../tree?node_id=`：按有效 ACL 过滤可见节点。
- `GET .../docs/:docId/role-acls`：含 `my_roles`、`can_manage_acl`、`acl_editable`。

### 6. 数据持久化

- Prisma 迁移/`db:push`；`ensureGroupRbac` 对旧群数据回填。

## 目标与完成标准

| 目标 | 完成标准 |
|------|----------|
| **G1 权限权威** | 任意文档有效权限仅由 DB 中角色 ACL + 成员角色分配决定，与 UI 展示一致 |
| **G2 RPC 安全** | 无 JWT 的 HTTP 调用仅做管理面操作；Operable RPC 校验调用者在**对应 doc** 上 level ≥ 3 |
| **G3 ACL 编辑规则** | 非群主不可修改已是可操作(3) 的角色行；后端 `Forbidden` + 前端 `acl_editable` |
| **G4 子节点继承** | `CreateChild` 后子节点 ACL 与父节点一致，成员 `aclGrant` 同步更新 |
| **G5 P2 验收** | `pnpm verify:p2` 通过；`scripts/e2e-smoke.mjs` 中建群/邀请/ACL/CreateChild 步骤通过（T2 执行） |

## 对外接口

| 类型 | 说明 |
|------|------|
| REST | `/groups`、`/invitations`、`/jwt/refresh`、`/tree`、`/rpc`、`/governance` 等 |
| 依赖 M1 | `@dpe/crypto`、`@dpe/proto`、`@dpe/shared` |
| 被 M4 消费 | `apps/web/src/lib/api.ts` 封装的 HTTP 客户端 |

## 环境变量（本模块相关）

- `DATABASE_URL`、`CONTROL_PLANE_PORT`
- `DPE_SIGNING_PRIVATE_KEY` / `DPE_SIGNING_PUBLIC_KEY`
- `DPE_JWT_TTL_SEC`、`DPE_PROXY_BASE_URL`

## 典型任务示例

- 新增治理字段 → `schema.prisma` + migration + `groups.service.ts` + M4 设置页。
- 调整 ACL 继承规则 → `groups-rbac.ts` `inheritParentDocAcl` + T2 E2E。
- 新 Operable RPC → M1 `proto` + 本模块 `operableRpc` + M4 调用。

## 验收命令

```bash
docker compose up -d postgres
cd apps/control-plane && pnpm db:push
pnpm --filter @dpe/control-plane test
pnpm verify:p2
# 控制平面单独启动
cd apps/control-plane && pnpm dev
curl http://localhost:3001/health
```

## 风险与边界

- **不做**：WebRTC、Yjs 合并、浏览器 localStorage 身份 UI。
- **注意**：`DPE_SIGNING_PRIVATE_KEY` 泄露等同群管理员能力；生产须 KMS/轮换策略（文档化即可，课设可简化）。
