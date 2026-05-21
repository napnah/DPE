# 开发模块 M4：Web 前端与协作编辑体验

## 模块定位

面向用户的 **React + Vite** 应用：身份引导、总面板、群组/文档树、权限面板、群组设置、内联/独立文档编辑器，以及通过 **SecureYjsProvider + P2P mesh** 完成的实时协作。聚合 M1/M2/M3 能力为可演示的端到端产品界面。

## 工作区域

| 路径 | 说明 |
|------|------|
| `apps/web/` | 全部前端源码、`vite.config.ts`、静态资源 |
| `apps/web/src/pages/` | Dashboard、GroupPage、GroupSettingsPage、引导页等 |
| `apps/web/src/components/` | DocTreeNav、DocInlineEditor、DocNodePermissionsPanel、MemberRoleAssign 等 |
| `apps/web/src/lib/` | `api.ts`、`identity.ts`、`p2p-mesh.ts`、`mesh-context.ts`、`doc-persistence.ts`、`roles.ts` |
| `apps/web/src/designs/` | 设计稿/原型屏幕（可与实现渐进对齐） |
| `packages/yjs-provider/` | `@dpe/yjs-provider`：SignedUpdate、合并前守卫 |
| `docs/P4.md`、`docs/P5.md` | 协作同步与 UI 阶段说明 |

**不在本模块修改：**

- Nest 控制器与 Prisma（M2）
- signaling/lan-agent 服务端逻辑（M3）
- 底层 crypto 算法（M1，仅通过依赖使用）

## 工作职责

### 1. 身份与引导（`/`）

- 浏览器生成 Ed25519 密钥对；UID 展示与复制。
- `localStorage` 持久化；**origin 隔离**（localhost vs LAN IP 为两套用户）。
- 显示名编辑（同步控制平面，不改 UID）。

### 2. 总面板（`/dashboard`）

- 群列表（群主/成员）、建群、邀请码、待处理邀请。
- LAN 邻居/网络状态（调用 lan-agent）。
- 用户名 + UID 展示与复制。

### 3. 群组工作区（`/groups/:id`）

- 文档树导航；选中文件夹/文档。
- **新建子目录/文档**：`randomUuid()` 生成 `doc_id`；父目录为选中文件夹或选中文档的父节点（修复过选中文档时误 return）。
- 重命名、删除；P2P 信令状态与重试。
- 右侧 **DocNodePermissionsPanel**：我的角色、有效权限、可编辑 ACL 行（`acl_editable` 灰色不可改）。

### 4. 群组设置（`/groups/:id/settings`，群主）

- 角色标签、成员多角色分配（自动保存）。
- 新成员默认角色；**无**「新建子项默认权限模板」UI。
- 邀请成员、删除自定义角色（×）。

### 5. 文档编辑与同步

- JWT refresh → 解密 `doc_key`（LAN HTTP 走 Noble 兜底）。
- `SecureYjsProvider`：只读不可发写 update；SignedUpdate 广播。
- `mesh-context`：群组内 WebRTC + AuthEnvelope。
- 本地草稿持久化（`doc-persistence`）。

### 6. 构建与开发体验

- `vite.config.ts`：`envDir` 指向仓库根、`@dpe/crypto` alias 到源码以便 LAN 调试。
- `VITE_*` 指向 control-plane / signaling / lan-agent。

## 目标与完成标准

| 目标 | 完成标准 |
|------|----------|
| **G1 主路径可走通** | 引导 → 建群/入群 → 根下新建文档 → 进入编辑 → 两节点可见同步（需 M2/M3 就绪） |
| **G2 权限 UI 一致** | 面板展示与 M2 `getDocRoleAcls` 一致；不可编辑行 disabled + title 提示 |
| **G3 LAN 可用** | `http://192.168.x.x:5173` 下无 `randomUUID`/`importKey` 崩溃；`pnpm dev` 重启后生效 |
| **G4 协作安全** | 只读用户无法被他人合并写 update；违反时 merge-guard 拒绝 |
| **G5 P4/P5 验收** | `pnpm verify:p4`、`pnpm verify:p5` 通过 |

## 对外依赖

| 依赖 | 用途 |
|------|------|
| M2 REST | `api.ts` 全部管理面调用 |
| M3 WS/HTTP | 信令、lan-agent |
| M1 | crypto、proto、shared、acl（经 provider） |
| `@dpe/yjs-provider` | 编辑器同步核心 |

## 环境变量（构建时）

- `VITE_API_URL`、`VITE_SIGNALING_URL`、`VITE_LAN_AGENT_URL`
- 开发时与根 `.env` 一致；VM 使用 `.env.vm.example` 复制为 `.env`（localhost 服务）

## 典型任务示例

- 新页面/路由 → `apps/web/src/pages` + `App` 路由表 + `api.ts` 方法。
- 群组页交互 bug → 先查 `GroupPage.tsx` 与 M2 RPC 是否匹配。
- 编辑器无法解密 → 身份/`pk_admin`、JWT、`aes-gcm` 浏览器路径。
- 协作不同步 → M3 信令 + M4 mesh + M1 merge-guard 联合排查（T2）。

## 验收命令

```bash
pnpm --filter @dpe/yjs-provider test
pnpm --filter @dpe/web test        # 若有
pnpm verify:p4
pnpm verify:p5
pnpm dev   # 浏览器 http://localhost:5173
```

## 风险与边界

- **不做**：服务端权限最终裁决（以 M2 为准，UI 仅反映）。
- **注意**：混用 localhost 与 LAN IP 会导致「两个用户」；双机文档须写清应用访问 URL（见 `docs/platform-setup.md`）。
