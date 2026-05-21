# 测试模块 T1：单元测试与包级验收（P1–P5 离线）

## 模块定位

在各开发模块**边界内**验证正确性：Vitest 单元测试、TypeScript 编译、分阶段 `verify:p1`–`verify:p5` 脚本。**不启动**完整四服务栈与 Postgres（除非某 verify 脚本局部需要，以脚本为准）。目标是快速反馈、CI 友好、问题可定位到单一包。

## 工作区域

| 路径 | 说明 |
|------|------|
| `packages/*/src/**/*.test.ts` | crypto、proto、acl、shared、p2p、yjs-provider 等 |
| `apps/web/src/**/*.test.ts` | 如 `doc-persistence.test.ts` |
| `apps/control-plane/**/*.spec.ts` | 若存在 Nest 单测 |
| `scripts/verify-p1.mjs` … `scripts/verify-p5.mjs` | 分阶段离线验收编排 |
| `package.json`（根） | `test`、`verify:p*` 脚本入口 |
| `docs/P1.md` … `docs/P5.md` | 各阶段「Verify」小节 |
| `turbo.json` / 各包 `vitest.config.ts` | 测试任务图 |

**不在本模块主导：**

- `scripts/e2e-smoke.mjs`、`verify:p6 --live`（属 T2）
- `docs/acceptance-dual-host.md` 手工勾项（属 T2）
- 生产部署与渗透（课设范围外，仅静态审计由 T2 触发）

## 工作职责

### 1. 包级单元测试

| 归属开发模块 | 测试重点 |
|--------------|----------|
| M1 | JWT  roundtrip、AES-GCM、SignedUpdate 验签、ReplayCache、schema parse |
| M1 | `randomUuid` 在无 `randomUUID` 环境下降级 |
| M3 | AuthEnvelope、非法首包拒绝 |
| M4 | merge-guard、secure-provider、doc-persistence |
| M2 | 若有 service 单测：RBAC 解析、`canEditDocRoleAcl` 逻辑（优先抽到 `groups-rbac` 可测函数） |

### 2. 分阶段离线验收

| 命令 | 主要覆盖 |
|------|----------|
| `pnpm verify:p1` | M1 包构建 + test |
| `pnpm verify:p2` | M2 control-plane 构建 + 相关检查 |
| `pnpm verify:p3` | M3 signaling、lan-agent、p2p |
| `pnpm verify:p4` | M4 yjs-provider |
| `pnpm verify:p5` | M4 web 构建 + lint |

### 3. 全仓质量门禁

- `pnpm test`：Turbo 调度各 workspace `test`。
- `pnpm lint` / `tsc --noEmit`：类型与风格（以仓库脚本为准）。

### 4. 测试编写规范

- 新增 M1 协议字段 → 必须补 `proto` parse 测试。
- 修复 LAN/浏览器兼容 → 补 **无** `crypto.randomUUID` / 无 `subtle` 的用例（见 `random-uuid.test.ts`、`aes-gcm.test.ts`）。
- 合并策略变更 → 更新 `secure-provider.test.ts` 或 acl 测试。

## 目标与完成标准

| 目标 | 完成标准 |
|------|----------|
| **G1 快速回归** | 开发者改 M1–M4 后 5 分钟内可跑相关包 test + 对应 `verify:p*` 绿 |
| **G2 阶段可追溯** | 每个 P 文档中的 checkbox 有对应自动化或明确「手工」说明 |
| **G3 CI 离线绿** | GitHub Actions Windows/Ubuntu 跑 `verify:p6` 的**离线部分**或 `verify:p1`–`p5` 不依赖 DB |
| **G4 缺陷定位** | 失败日志能指向具体 package 名，而非仅「全仓失败」 |

## 与各开发模块的协作

- **提测前**：开发模块自测 `pnpm --filter <pkg> test`。
- **接口变更**：M1 proto 破坏性变更 → 同步更新 M2/M3/M4 测试 fixture。
- **不替代 T2**：通过 P5 不代表双机 P2P、Postgres E2E 已通过。

## 验收命令

```bash
pnpm test
pnpm lint
pnpm verify:p1
pnpm verify:p2
pnpm verify:p3
pnpm verify:p4
pnpm verify:p5
```

## 交付物

- 通过的 test 报告（CI 日志或本地 Vitest 输出）。
- 失败时：最小复现步骤 + 归属模块标签（M1–M4）。

## 风险与边界

- **不做**：双浏览器手工验收、虚拟机网络排障（T2 文档化）。
- **注意**：Windows 上 Prisma `generate` EPERM 属环境 issue，见 README，非单测逻辑错误。
