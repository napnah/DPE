# P2P 网络修复报告

本文档记录 DPE 项目在双机/多浏览器协作场景下，针对 **实时文档同步失败**、**Yjs 一致性异常** 与 **连接状态误判** 等问题进行的排查与修复过程，便于后续维护与验收对照。

相关阶段设计见 [P3 — 信令与 AuthEnvelope](./P3.md)、[P4 — SecureYjsProvider](./P4.md)、[设计方案](./design.md)。

---

## 1. 问题背景

### 1.1 典型现象

| 现象 | 说明 |
|------|------|
| 需刷新才看到对方修改 | 对端已编辑，本机 textarea 不更新 |
| 并发编辑后内容分叉 | 例：A 写入 `1`、B 写入 `2`，刷新后 B 为 `2`、A 为 `21` |
| Debug 显示发送正常、对端无 rx | A：`tx` 增加、`open=2 authed=2`；B：`rx` 为 0、`open=0` |
| rx 增加但 UI 不变 | P2P 已收包，编辑器未反映 Yjs 状态 |
| `authErr=jwt_invalid:signature_or_unknown` | 双机 HTTP 访问时认证始终失败 |
| `authErr=channel_silent:xxxxxx` | 心跳判定通道无响应（`xxxxxx` 为对端 node_id 前 6 位） |
| `InvalidStateError` on `RTCDataChannel.send` | 通道未 `open` 时发送 AuthEnvelope |

### 1.2 测试环境要点

- 主机与虚拟机分别使用 **固定 origin**（如 `http://192.168.199.1:5173` 与 `http://192.168.199.128:5173`），避免 `localhost` 与 LAN IP 混用导致 `localStorage` 身份隔离。
- 信令：`ws://<host>:3002/ws`，房间 ID = `group_id`。
- 控制平面需配置 **持久化** `DPE_SIGNING_PRIVATE_KEY` / `DPE_SIGNING_PUBLIC_KEY`（见 `.env`），否则每次重启会换签发密钥。

---

## 2. 协作链路（修复视角）

```
用户输入 → Y.Text (Yjs CRDT)
         → SecureYjsProvider → SignedUpdate (加密/签名)
         → GroupP2pMesh.broadcast → WebRTC DataChannel
         → 对端 onChannelMessage → merge guard → Yjs apply
         → DocInlineEditor 同步 textarea
```

任一环节失败都会表现为「不同步」。修复按 **认证 → 连接 → 传输 → 合并 → UI** 分层推进。

---

## 3. 根因与对策

### 3.1 JWT 认证失败（`jwt_invalid`）

**根因（叠加）：**

1. **控制平面 ephemeral 签名密钥**：未设置 `DPE_SIGNING_*` 时，每次启动生成新密钥，数据库/本地缓存的 `pk_admin` 与当前签发密钥不一致。
2. **JWT 的 `doc_id` 错误**：群组页曾固定用 `root` 刷新 JWT，而实际编辑的是子文档，权限与 `doc_key` 不匹配。
3. **非安全上下文**：在 `http://`（非 localhost）下 `window.crypto.subtle` 不可用，依赖 `jose` 的 `jwtVerify` 会失败。

**对策：**

| 项 | 文件/位置 |
|----|-----------|
| `.env` 固定 `DPE_SIGNING_PRIVATE_KEY` / `DPE_SIGNING_PUBLIC_KEY` | 仓库根 `.env` |
| 按当前选中文档 `syncDocId` 刷新 JWT | `apps/web/src/pages/GroupPage.tsx` |
| 纯 JS Ed25519 验签（`@noble/curves`） | `packages/crypto/src/jwt.ts` |
| 诊断接口查看当前签发公钥 | `GET /signer/public-key`（`apps/control-plane/src/health.controller.ts`） |
| 更细 `authErr`（`aud_mismatch`、`expired` 等） | `apps/web/src/lib/p2p-mesh.ts` → `diagnoseJwtFailure` |

**操作建议：** 更换签名密钥后需 **新建群组** 或更新库内 `issuerPublicKey`；各浏览器通过建群/入群流程写入 `localStorage` 的 `pk_admin`。

---

### 3.2 WebRTC 幽灵连接与单向通道

**根因：**

1. **`connectPeer` 覆盖旧 `RTCPeerConnection`** 却不关闭旧连接，发送端认为 `open=2`，实际对端已断开。
2. **双方同时发起**：Initiator 既 `createDataChannel` 又注册 `ondatachannel`，后绑定通道覆盖前者，易出现单向可达。
3. **无固定协商角色**：`peers` 与 `offer` 竞态时可能重复建连。
4. **ICE candidate 早于 `setRemoteDescription`** 被丢弃，偶发永远连不上。
5. **心跳误判**：收到 `PING` 即刷新存活时间，掩盖「发 ping 收不到 pong」的真实 silence。

**对策（`apps/web/src/lib/p2p-mesh.ts`）：**

| 机制 | 说明 |
|------|------|
| Perfect negotiation | `node_id` 较小的一方 **唯一** 发起 offer（`shouldInitiate`） |
| 重连前 `cleanupPeer` | 关闭旧 PC/Channel，清空 `authenticated`、`lastAlive` |
| Initiator 不处理入站 DC | 仅 answer 方在 `ondatachannel` 上 `wireChannel` |
| `pendingCandidates` 队列 | `remoteDescription` 就绪后 `flushCandidates` |
| `connecting` 防并发 | 避免并行 `connectPeer` 互踩 |
| 健康循环（5s） | ping/pong、清理 `failed/closed` PC、对照信令 `peers` 列表补连 |
| `lastAlive` | 仅在 **pong / 业务消息 / 认证成功 / channel.onopen** 时更新；15s 无响应 → `channel_silent` 并 `cleanupPeer` |
| `channel.onclose` / 发送前 `readyState` 检查 | 避免 `InvalidStateError` |

---

### 3.3 Yjs 一致性（`21` 问题）

**根因：** 编辑器曾用「整段删除再整段插入」同步 `Y.Text`，并发时等价于错误的全量覆盖，CRDT 合并结果异常。

**对策：** `applyTextareaDeltaToYText` 计算首尾公共前缀/后缀，仅对中间段做 `delete` + `insert`（`apps/web/src/components/DocInlineEditor.tsx`）。

---

### 3.4 UI 未随远程更新

**根因：** `textarea` 聚焦时跳过 observer；或 `ytext.observe` 与 engine 初始化竞态。

**对策：**

- 聚焦时也更新 `value`，并尽量保持选区。
- `doc.on("update")` 在 `origin === DPE_PROVIDER_ORIGIN` 时调用 `syncTextareaFromYText`。
- 500ms 轮询 `observer()` 作为兜底（仅 UI，不改变 Yjs 语义）。

---

### 3.5 可观测性不足

**新增：** `apps/web/src/lib/realtime-debug.ts`，群组页展示：

```
Debug · tx <count>/<bytes>B · rx <count>/<bytes>B
· peers=<信令房间对等数> open=<open通道数> authed=<已认证对等数>
· reject=<合并守卫/Provider 拒绝原因>
· authErr=<握手/心跳/发送错误>
```

**其它：**

- 移除 `meshBusyRef`，避免 mesh 重初始化被卡住。
- 「重试连接」常显，可 `resetRealtimeDebugSnapshot` 后递增 `meshGen` 重建 mesh。

---

## 4. 涉及文件一览

| 文件 | 变更类型 |
|------|----------|
| `apps/web/src/lib/p2p-mesh.ts` | WebRTC 协商、心跳、清理、ICE 队列、认证诊断 |
| `apps/web/src/lib/realtime-debug.ts` | 运行时调试快照（新增） |
| `apps/web/src/pages/GroupPage.tsx` | JWT `doc_id`、Debug UI、错误文案、mesh 重试 |
| `apps/web/src/components/DocInlineEditor.tsx` | 增量同步 Y.Text、UI 强制同步、Provider 错误上报 |
| `packages/crypto/src/jwt.ts` | 非 secure context 下纯 JS 验签 |
| `apps/control-plane/src/health.controller.ts` | `/signer/public-key` 诊断 |

---

## 5. 相关 Git 提交（节选）

```
9ae5f8f fix(web): improve P2P mesh negotiation and heartbeat
cc65fe2 fix(web): force editor UI sync and always allow manual P2P retry
9778060 fix(web): surface provider errors in realtime debug
d58dd49 fix(crypto): pure-JS JWT verify for non-secure browser contexts
0742f45 feat(diag): expose signing pubkey and finer JWT auth failure reasons
0b3a877 fix(web): harden mesh lifecycle and surface actionable sync diagnostics
4445df7 fix(web): stabilize p2p sync and add runtime debug signals
0b8c904 fix(web): reflect remote updates while editor focused
```

---

## 6. 验收与排查清单

### 6.1 环境

- [ ] `pnpm dev` 后 signaling `:3002`、control-plane `:3001`、lan-agent `:3003` 健康。
- [ ] 双机使用 **同一网段 IP** 访问 Web，且各自完成身份引导。
- [ ] `.env` 中 `DPE_SIGNING_*` 已配置；`curl http://localhost:3001/signer/public-key` 中 `from_env: true`。
- [ ] 通过建群/入群进入群组（非直接拼 URL），保证 `pk_admin` 已缓存。

### 6.2 连接

- [ ] 群组页 P2P 状态为「已连接」。
- [ ] Debug：`peers=1`（两节点时）、`open=1`、`authed=1`，无持续 `authErr`。
- [ ] A 输入时 B 的 `rx` 字节数增加；反之亦然。

### 6.3 内容与一致性

- [ ] 双方不刷新即可看到对方字符变化。
- [ ] 并发输入后双端刷新，文本一致（无 `21` 类拼接异常）。

### 6.4 常见 authErr 对照

| authErr | 含义 | 处理 |
|---------|------|------|
| `jwt_invalid:signature_or_unknown` | 验签失败 | 对齐 `DPE_SIGNING_*`、重建群或更新 `pk_admin` |
| `auth_not_open_after_jwt` | 拉 JWT 期间通道关闭 | 点「重试连接」 |
| `channel_silent:xxxxxx` | 对端 `xxxxxx` 15s 无响应 | 自动 cleanup；检查 NAT/虚拟机网络 |
| `peer_public_key_missing` | 成员列表未含对端公钥 | 刷新群成员 API 后重试 mesh |
| `broadcast_send_failed` | 向已死通道广播 | 等待健康循环重连 |

---

## 7. 已知限制与后续建议

1. **仅 STUN、无 TURN**：跨复杂 NAT 时可能仍偶发连不通，课设 LAN 内一般可接受；生产需 TURN。
2. **HTTP GitLab / 开发服务器**：与 P2P 无关，但 LAN 访问务必用 IP 统一 origin。
3. **三节点及以上**：当前 mesh 为全连接，调试指标中 `peers` 为「房间内其他节点数」；若需扩展，应继续依赖 `shouldInitiate` 避免重复 offer。
4. **服务端快照**：P2P 失败时仍依赖 `localStorage` 与控制平面 snapshot API 做最终一致，非实时路径。

---

## 8. 参考

- [双机验收清单](./acceptance-dual-host.md)
- [平台与探测配置](./platform-setup.md)
- [威胁模型 — 传输与合并](./threat-model.md)
- 开发分工：[dev-03-network-p2p.md](../todo/dev-03-network-p2p.md)、[dev-04-web-collaboration.md](../todo/dev-04-web-collaboration.md)

---

*文档版本：与 `main` 上 P2P 修复提交同步（2026 课设维护）。*
