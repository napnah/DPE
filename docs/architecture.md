# DPE Architecture

See [design.md](./design.md) for the cryptographic and P2P design.

## 整体架构图

系统采用 **控制平面** 与 **数据平面** 分离：元数据、认证与权限由本机控制平面统一管理；文档协作更新经 **WebRTC P2P** 直连同步，载荷为 **AES-GCM 加密的 SignedUpdate**，合并前由 `yjs-provider` 做 ACL 校验。

```mermaid
flowchart TB
  subgraph clients["客户端浏览器（每节点一份）"]
    direction TB
    WEB["apps/web<br/>React + Vite"]
    UI["总览 / 群组 / 文档树 / 编辑器"]
    YJS["Yjs Doc + SecureYjsProvider"]
    MESH["GroupP2pMesh<br/>WebRTC DataChannel"]
    WEB --> UI
    UI --> YJS
    YJS -->|"SignedUpdate JSON"| MESH
  end

  subgraph pkgs["共享能力层 packages/"]
    CRYPTO["crypto<br/>Ed25519 · JWT · AES-GCM"]
    ACL["acl<br/>0–3 级权限判定"]
    PROTO["proto<br/>SignedUpdate · AuthEnvelope"]
    YPROV["yjs-provider<br/>合并守卫 · 加密同步"]
    P2PLIB["p2p<br/>信令消息编解码"]
    CRYPTO --- ACL
    PROTO --- YPROV
  end

  subgraph control["控制平面 Control Plane"]
    CP["apps/control-plane<br/>NestJS :3001"]
    AUTH["/auth 账号会话<br/>Argon2id · Bearer Token"]
    GOV["群组 / RBAC / ACL / 文档树"]
    SNAP["DocState 快照 API"]
    CP --> AUTH
    CP --> GOV
    CP --> SNAP
    PG[("PostgreSQL<br/>users · groups · doc_states")]
    REDIS[("Redis 可选<br/>snapshot 读缓存")]
    SNAP --> PG
    SNAP -.-> REDIS
  end

  subgraph network["网络与发现"]
    SIG["apps/signaling<br/>WebSocket :3002<br/>SDP / ICE 中继"]
    LAN["apps/lan-agent<br/>HTTP :3003<br/>mDNS · peer 搜索"]
  end

  %% 控制面 HTTP
  WEB -->|"REST + Bearer"| CP
  YJS -->|"refreshJwt · snapshot"| CP

  %% 信令与发现
  MESH <-->|"WebSocket signal"| SIG
  WEB -->|"发现 / 搜索 UID"| LAN

  %% P2P 数据面（节点间）
  MESH <-->|"DTLS + AuthEnvelope<br/>加密 SignedUpdate"| MESH

  %% 包依赖
  WEB -.-> pkgs
  CP -.-> pkgs
  MESH -.-> pkgs

  classDef plane fill:#e8f4fc,stroke:#3daee9,color:#232629
  classDef store fill:#f0f0f0,stroke:#7f8c8d,color:#232629
  classDef p2p fill:#e8f8ef,stroke:#27ae60,color:#232629
  class clients,pkgs plane
  class control plane
  class PG,REDIS store
  class network,SIG,LAN p2p
```

### 协作数据流（单文档）

```mermaid
sequenceDiagram
  participant A as 节点 A 浏览器
  participant SIG as Signaling :3002
  participant CP as Control Plane :3001
  participant B as 节点 B 浏览器

  A->>CP: login / refreshJwt(doc_id)
  CP-->>A: JWT（含密封 doc_key）
  B->>CP: login / refreshJwt(doc_id)
  CP-->>B: JWT

  A->>SIG: join room(group_id)
  B->>SIG: join room(group_id)
  A->>B: WebRTC offer/answer/ICE（经 SIG）
  A->>B: AuthEnvelope（JWT 握手）
  Note over A,B: authed → registerPeer

  A->>A: Yjs update → SignedUpdate
  A->>B: P2P DataChannel（加密帧）
  B->>B: merge-guard → Y.applyUpdate
  B->>B: 编辑器 UI 同步

  A->>CP: POST snapshot（可选持久化）
  CP->>CP: doc_states + 失效 Redis
```

## Components

- **apps/web** — React UI（登录/注册、总览、群组工作区、文档树、内联编辑器）
- **apps/control-plane** — NestJS IdP（账号认证、JWT、逐文档 ACL、RBAC、文档树、快照）
- **apps/signaling** — WebRTC 信令（WebSocket mesh 房间）
- **apps/lan-agent** — mDNS / LAN 发现（Windows + Linux）
- **packages/** — `crypto`, `proto`, `acl`, `p2p`, `yjs-provider`, `shared`

## Control modes

- `owner_direct` — owner signs JWT
- `proxy` — proxy server allocates permissions (default for demos)

## 端口一览（开发环境）

| 服务 | 端口 | 说明 |
|------|------|------|
| Web (Vite) | 5173 | 前端 SPA |
| Control plane | 3001 | REST API、认证、快照 |
| Signaling | 3002 | WebRTC 信令 |
| LAN agent | 3003 | 局域网发现 |
| PostgreSQL | 5432 | 持久化（Docker Compose） |
