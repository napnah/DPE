# 测试模块 T2：集成测试、E2E、安全审计与双机验收（P6）

## 模块定位

在**多服务、多节点、真实数据库**条件下验证系统行为：API 冒烟、群组/ACL/CreateChild 链路、信令与 LAN 发现、威胁模型静态检查、双机（Windows + Linux VM）手工清单。对应 `docs/P6.md` 与课设最终交付质量。

## 工作区域

| 路径 | 说明 |
|------|------|
| `scripts/verify-p6.mjs` | P6 编排：P5 基线 + test/lint + security-audit [+ live] |
| `scripts/e2e-smoke.mjs` | HTTP API 端到端冒烟（建群、邀请、CreateChild、SetDocRoleAcl、JWT、tree） |
| `scripts/security-audit.mjs` | JWT 封装、merge-guard、AuthEnvelope 等静态对照 |
| `docs/P6.md` | 全量验收说明 |
| `docs/acceptance-dual-host.md` | 双机手工勾选项 |
| `docs/platform-setup.md` | 环境、probe、URL 固定策略 |
| `docs/threat-model.md` | 审计对照来源 |
| `.github/workflows/ci.yml` | CI 矩阵（ubuntu live / windows 离线） |
| `docker-compose.yml` | E2E 用 Postgres |

**不在本模块主导：**

- 各包内部纯函数单测（T1）
- 业务功能新开发（M1–M4，T2 只写/改测试与文档）

## 工作职责

### 1. API E2E（`e2e-smoke.mjs`）

典型步骤（以实现为准）：

1. Owner 建群  
2. 邀请 → 成员接受（root 只读）  
3. `CreateChild` 在 root 下新建文档  
4. `SetDocRoleAcl` 调整读者角色为可写  
5. 成员 `jwt/refresh` 得到 `role=2` 与密封 `doc_key`  
6. `tree` 可见 root（folder）与子文档  
7. 无 Operable 时 `CreateChild` 被拒绝  
8. `GET /members` 至少 2 人  

扩展用例（建议维护）：

- 父节点 **继承 ACL** 后子节点权限与 M2 一致  
- 非群主 **不可改** 已是可操作(3) 的角色 ACL 行  

### 2. Live 全栈（`pnpm verify:p6 --live`）

- 启动 Postgres（310x 端口避免与 `pnpm dev` 冲突，见 P6 文档）  
- `db:push` + 四服务 + smoke + 可选 signaling/lan-agent 检查  

### 3. 安全审计（`security-audit.mjs`）

对照 `docs/threat-model.md` / 方案 §3.5：

- JWT 中无明文 `doc_key`  
- 合并前 role/签名/重放  
- 只读 peer 写 update 被拒  
- P2P AuthEnvelope 首包  

### 4. 双机验收（手工 + 文档）

| 项 | 说明 |
|----|------|
| 拓扑 | 主机 + VM 各 `pnpm dev`，各自 `.env` |
| 发现 | `DPE_DISCOVERY_PROBE_HOSTS` 指向对端 LAN IP |
| 浏览器 | 每台固定 **一个** origin（全 IP 或全 localhost，不混用） |
| 协作 | 两用户同群、同文档、双向同步 |
| 回归 | `randomUuid`、AES 解密在 VM 的 `http://IP:5173` 下可用 |

清单维护：`docs/acceptance-dual-host.md`。

### 5. CI 与发布门禁

- PR/主分支：`verify:p6` 离线必绿；ubuntu job 可跑 `--live`。  
- 失败分类：环境（DB/Docker）、 flaky 网络、产品缺陷。

## 目标与完成标准

| 目标 | 完成标准 |
|------|----------|
| **G1 一键全量** | `pnpm verify:p6` 离线通过（Windows CI 路径） |
| **G2 数据库 E2E** | `pnpm verify:p6 --live` 通过（含 e2e-smoke） |
| **G3 安全基线** | `security-audit.mjs` 无新增高危项 |
| **G4 双机可演示** | acceptance 清单主要项可在课设环境完成并留截图/记录 |
| **G5 跨模块缺陷闭环** | E2E 失败能指派到 M1–M4 之一并复测 |

## 与各开发模块的协作

| 场景 | 指派 |
|------|------|
| smoke 403 CreateChild | M2 `requireOperable` / 继承 ACL |
| 邻居不可见 | M3 probe/mDNS + `.env` |
| `importKey` / 解密失败 | M1 + M4 vite/crypto 路径 |
| 信令未连接 | M3 + M4 重试 UI |
| 权限面板与 API 不一致 | M2 + M4 |

## 验收命令

```bash
# 离线（推荐日常/Windows CI）
pnpm verify:p6

# 完整 E2E（需 Docker Postgres）
docker compose up -d postgres
cd apps/control-plane && pnpm db:push && cd ../..
pnpm verify:p6 --live

# 仅 API（控制平面已起）
node scripts/e2e-smoke.mjs

# 安全审计
node scripts/security-audit.mjs
```

## 交付物

- `verify:p6` / `--live` 通过记录。  
- 双机验收勾选表（`acceptance-dual-host.md`）。  
- 已知局限说明（Issuer 沦陷、Redis 未用等，见 P6）。  

## 风险与边界

- **不做**：替代 T1 的细粒度单测；不修复产品代码（除测试脚本与文档）。  
- **注意**：E2E 端口与 `pnpm dev` 不要同时占用；flaky 网络测试应重试或标为 manual。  
