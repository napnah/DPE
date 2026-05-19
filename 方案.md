
### 系统架构总览：控制平面与数据平面分离

在 P2P 局域网形态下，系统将拆分为两个核心逻辑平面：

1. **控制平面 (Control Plane - 认证与调度)：** 由群组创建者（Admin，如用户 A）所在节点兼任「微型认证中心（Local IdP）」。负责 ACL 变更、对称密钥生命周期、签发 JWT、结构型 RPC。
2. **数据平面 (Data Plane - 协作与同步)：** 基于 mDNS 发现 + WebRTC 数据通道，使用 Yjs 进行 CRDT 状态合并；**所有经 P2P 转发的文档更新均为对称加密后的二进制载荷**，并在合并前做**授权校验**（非仅依赖「善良节点丢包」）。

---

### 1. 网络拓扑与身份发现 (Network & Identity)

#### 1.1 节点与身份（非对称）

* 每个节点在首次初始化时生成 **Ed25519** 密钥对 `(sk_node, pk_node)`。
* **NodeID** = `SHA-256(pk_node)` 的十六进制（或 Base64URL）表示，作为节点在群组内的稳定标识。
* 入群时通过带外渠道（邀请链接 / 二维码 / 首次面对面）交换并**钉扎（pin）Admin 的 `pk_admin`**，后续所有 JWT 必须用该公钥验签，防止伪造 IdP。

#### 1.2 服务发现与组网

* 节点通过 **mDNS**（或同类 LAN 发现协议）暴露自身服务与 NodeID。
* **建群：** 用户 A 创建群组并成为 **Admin**，本地启动认证服务（签发 JWT、处理 RPC）。
* **Overlay：** 用户 B、C 接受邀请后，与 A/B/C 建立 **WebRTC DataChannel**（信令可经 Admin 或 LAN 内 relay）。数据通道建立后的**第一条应用层消息**必须为 **AuthEnvelope**（见 §3.2），否则对端关闭连接。

> **说明：** WebRTC 自带 DTLS，仍对 Yjs update 做应用层加密（`Key(doc)`），形成纵深防御；不可见性的**硬保障**是「没有密钥则无法解密」，连接拒绝是附加层。

---

### 2. 文档树结构与 ACL 规则 (Tree Structure & ACL)

#### 2.1 树形结构

群组初始化一棵文档树，根为 `Root`。树上每个节点 $x$ 对应一个 **`doc_id`**（稳定 UUID），并拥有独立的内容协作上下文（一个 Yjs `Y.Doc` 或子文档）。

#### 2.2 权限单调律

设 $p_u(x)$ 为用户 $u$ 在节点 $x$ 的权限等级，对任意边 $(\text{father}(x), x)$：

$$p_u(x) \le p_u(\text{father}(x))$$

#### 2.3 权限分级 (0–3)

| 级别 | 名称 | 能力摘要 |
|------|------|----------|
| 0 | Invisible | 不可见、不可解密、不可同步 |
| 1 | Readonly | 可解密并合并**他人已授权**的更新；**不可产生会被合并的写更新** |
| 2 | Writable | 可读写文档**内容**（Yjs 层），不可改树结构 / ACL |
| 3 | Operable | 在 Writable 基础上，可调用 Admin RPC 改树与 ACL |

#### 2.4 密钥与树 ACL 的对应关系

* 每个 `doc_id` 维护独立对称密钥 **`Key(doc)`**（32 字节，CSPRNG 生成）。
* **父节点可读不自动等价于子节点可读**：子节点 `doc_id` 单独存 ACL；仅当 $p_u(x) \ge 1$ 时，Admin 才在 JWT 中下发该节点的 `Key(x)`。
* 用户权限从 $\ge 1$ 降为 $0$，或从 $\ge 2$ 降为 $1$ 时：Admin **轮换** `Key(doc)`（见 §3.4），作废旧 JWT，并广播 `KeyRotation` 通知（经加密控制信道或 Admin 单播）。

---

### 3. 密码学设计 (Cryptography)

#### 3.1 算法选型

| 用途 | 算法 | 说明 |
|------|------|------|
| 节点身份、update 签名 | **Ed25519** | `Sign(sk_node, …)` / `Verify(pk_node, …)` |
| Admin 签发 JWT | **EdDSA (Ed25519)** 或 **ES256** | Header 标明 `alg`，群组内统一 |
| 封装 `Key(doc)` | **X25519 + HKDF** 或 **RSA-OAEP-3072** | 推荐：`doc_key = sealed_box(pk_node, Key(doc))` |
| 加密 Yjs update | **AES-256-GCM** | 每条 update 独立 **96-bit nonce** |
| NodeID 派生 | **SHA-256** | `NodeID = hash(pk_node)` |

#### 3.2 连接握手：AuthEnvelope

节点 B 与 C 建立 DataChannel 后，B 发送：

```json
{
  "type": "auth",
  "node_id": "<B 的 NodeID>",
  "jwt": "<Admin 签发的 JWT 字符串>",
  "proof": "<可选：Sign(sk_B, jwt || challenge) 防 JWT 被 C 重放冒用>"
}
```

对端 C 的处理顺序：

1. 用钉扎的 `pk_admin` **验签 JWT**（`exp`、`aud`=群组 ID、`sub`=B 的 NodeID）。
2. 确认 JWT 中 `node_id` / `sub` 与连接声称的 B 一致；若启用 `proof`，验证 `pk_B` 对 challenge 的签名。
3. 通过后标记该 peer 对 `doc_id` 的 `role`，并缓存至会话表；失败则 **关闭 DataChannel**。

#### 3.3 JWT 结构（控制平面）

**Payload 示例（签发前）：**

```json
{
  "iss": "<Admin NodeID>",
  "sub": "<B 的 NodeID>",
  "aud": "<group_id>",
  "doc_id": "x",
  "role": 2,
  "doc_key": "<Base64URL: Encrypt(pk_B, Key(x))>",
  "key_version": 3,
  "iat": 1710000000,
  "exp": 1710003600,
  "jti": "<uuid>"
}
```

* **`doc_key` 必须为密文**，禁止明文放入 JWT；JWT 整体由 Admin 私钥签名。
* **`key_version`**：与 `Key(doc)` 轮换代数一致；数据面信封必须携带相同版本，否则拒绝解密/合并。
* 会话续期：在 `exp` 前向 Admin **刷新**；撤销权限后立即失效（见 §3.4）。

#### 3.4 密钥轮换（Key Rotation）

在以下事件触发 Admin 对 `doc_id` 生成新 `Key(doc)` 并 `key_version++`：

* 用户对该 `doc_id` 权限降为 0 或 1（原 $\ge 2$ 写用户降为只读时可选择轮换，建议降 0 必轮换）；
* 用户退群；
* Admin 主动撤销泄露怀疑。

流程：向仍授权节点签发新 JWT → 广播 `KeyRotation { doc_id, key_version, doc_key_enc_for_each }`（或各自向 Admin 拉取）→ 旧 `key_version` 的 **SignedUpdate** 在宽限期后不再接受。

#### 3.5 数据平面：加密与授权信封

Yjs 原生 `Uint8Array` update **不直接上链**，统一封装为 **SignedUpdate**：

```text
SignedUpdate := {
  doc_id,
  key_version,
  nonce,                    // 12 bytes, random per message
  ciphertext,               // AES-256-GCM( Key(doc), nonce, plaintext=raw_yjs_update )
  signer_node_id,           // 发送方 NodeID
  seq,                      // 发送方对该 doc 的单调递增序号（64-bit）
  sig                       // Ed25519( sk_sender, canonical_bytes(以上字段) )
}
```

**接收方合并前校验（所有节点统一执行，不可省略）：**

1. 会话表中该 peer 的 JWT 有效且 `role` $\ge$ 本次操作所需级别；
2. `key_version` 与本地当前一致；
3. `Verify(pk_sender, sig)` 通过，且 `signer_node_id` 与 JWT `sub` 一致；
4. **`role >= 2` 才允许合并内容写操作**；`role == 1` 时若 `sig` 合法但属于写路径，**拒绝调用 `Y.applyUpdate`**（不是可选的「网络层丢包」）；
5. 检查 `(signer_node_id, seq)` 未在本地重放缓存中出现；
6. AES-GCM 解密成功后，再 `Y.applyUpdate(doc, plaintext)`。

> **只读与可写共用同一 `Key(doc)`**：机密性由对称加密保证；**写权限由 JWT `role` + 合并前策略保证**，二者分工明确。

#### 3.6 Level 0 的保障层次

| 层次 | 机制 |
|------|------|
| **强保障** | 无 `Key(doc)` → 无法解密 `ciphertext`，抓包只见密文 |
| **附加** | 无有效 JWT / AuthEnvelope 失败 → 不建立或未授权 DataChannel |

---

### 4. 四级权限执行 (Per-Level Behavior)

#### 级别 0：Invisible (不可见)

* **控制平面：** Admin 拒绝为 `doc_id` 签发 JWT。
* **数据平面：** B 无 `Key(doc)`；即使旁路收到密文也无法解密。AuthEnvelope 无合法 JWT 时，对端不授权同步会话。

#### 级别 1：Readonly (只读)

* **控制平面：** 签发 `role: 1` 的 JWT，`doc_key = Encrypt(pk_B, Key(doc))`。
* **数据平面：**
  * B 解密并 **apply 他人 SignedUpdate**（验签 + `role>=2` 的发送方 + 防重放 + 解密）。
  * B **不得**发出会被他人合并的写 update：若 B 仍发送 SignedUpdate，其他节点在步骤 4 **拒绝合并**（策略校验，非礼貌性丢包）。
  * 可选优化：只读会话在发送侧不挂载写路径 UI，降低误发。

#### 级别 2：Writable (可写)

* **控制平面：** 签发 `role: 2`，分发当前 `key_version` 下的 `Key(doc)`。
* **数据平面：**
  * B 本地 `Y.transact` 产生 `raw_yjs_update`，封装为 SignedUpdate 并 **Ed25519 签名**后广播。
  * 对端按 §3.5 校验通过后 `applyUpdate`。
  * **树结构变更**（新建/删除子 `doc_id`、移动节点）不通过 Yjs 内容通道，由控制平面 RPC 处理。

#### 级别 3：Operable (可操作)

* **控制平面：** 签发 `role: 3`；允许调用 Admin **高权限 RPC**（TLS/mTLS 或同一 DataChannel 上的 `control` 多路复用）：
  * `CreateChild(parent_id, …)`、`DeleteDoc(doc_id)`、`SetACL(user, doc_id, role)` 等。
* **数据平面：** 具备 Writable 全部能力；Admin 执行 RPC 后向全网广播 **ACL 快照 / KeyRotation**（结构变更与密钥变更走控制平面，不走 Yjs）。

**Operable RPC 鉴权：** 请求携带 `role: 3` 的 JWT（或短期 **RPC capability token**，由 Admin 签发、单次使用）；Admin 校验 JWT + NodeID 签名后执行。

---

### 5. 与 Yjs 的边界

| 职责 | 组件 |
|------|------|
| CRDT 合并、无冲突编辑 | Yjs（`Y.Doc` / `Y.Map` / `Y.Text` 等） |
| 机密性 | AES-GCM + `Key(doc)` |
| 授权、身份、防重放 | JWT + SignedUpdate + 合并前策略 |
| 树与 ACL、密钥轮换 | Admin 控制平面 |

同步协议可在 [y-protocols](https://github.com/yjs/y-protocols) 之上增加 **AuthEnvelope** 与 **SignedUpdate** 帧类型；Provider 在 `applyUpdate` 前插入解密与校验钩子。

---

### 6. 架构优势与威胁模型说明

1. **性能：** Admin 仅在发证、轮换密钥、结构/RPC 时介入；高频打字同步在 P2P 间传输 **密文 SignedUpdate**，不经过 Admin 转发。
2. **安全：**
   * **不可见：** 无密钥则无法解密（主保障）。
   * **不可越权写：** 合并前强制校验 `role` 与签名，恶意节点不能通过「不丢包」策略绕过。
   * **不可冒充：** JWT `sub` 与 Ed25519 签名绑定 NodeID；可选 challenge `proof` 防 JWT 重放。
   * **撤销与泄露：** `key_version` + 轮换 + `exp`/`jti` 控制会话生命周期。
3. **局限（诚实说明）：** 恶意 **Admin** 可读取全群明文；本方案面向 **防未授权成员与旁路窃听**，不抵御 compromised Admin。纯 P2P 无 relay 时，需保证所有同步路径均执行 §3.5 校验，或仅与已 Auth 的 peer 交换数据。

---

### 7. 实现检查清单（开发对照）

- [ ] 节点 Ed25519 密钥对与 NodeID 生成、Admin 公钥钉扎
- [ ] JWT 签发/验签、`doc_key` 非对称封装
- [ ] 每 `doc_id` 独立 `Key(doc)` 与 `key_version`
- [ ] SignedUpdate：AES-GCM + nonce + seq + Ed25519
- [ ] 合并前统一校验（role、重放、key_version）
- [ ] 权限变更触发 KeyRotation 与 JWT 作废
- [ ] Operable RPC 与 Yjs 数据面分离
- [ ] WebRTC 首包 AuthEnvelope
