# 本机账号登录与 Yjs 持久化实现说明

本文档说明 DPE 在“无公网服务器、仅本机控制平面”场景下实现的账号登录与 Yjs 数据持久化方案。

## 1. 目标

- 将身份从浏览器 `localStorage` 主导，升级为 **本机数据库主导**。
- 支持账号/密码登录（`/auth/register`, `/auth/login`, `/auth/me`）。
- 将文档快照落库到 `doc_states`，浏览器缓存仅作兜底。
- 可选 Redis 加速 `snapshot` 读取。

## 2. 数据模型

控制平面 Prisma schema 新增：

- `users`：账号主表（`username`, `password_hash`）。
- `user_keys`：账号绑定的节点身份（`node_id`, `public_key`），以及私钥密文。
- `user_sessions`：登录会话（token hash、过期时间）。
- `doc_states`：Yjs 快照持久化（`state_base64`, `key_version`）。

保留现有 `doc_snapshots` 以兼容历史数据路径，新的 `snapshot API` 以 `doc_states` 为主。

## 3. 登录与身份流程

1. 前端在引导页选择登录/注册。
2. 注册时可携带旧浏览器身份（`legacy_identity`）做一次性迁移绑定。
3. 后端校验密码（Argon2id）并签发会话 token。
4. 前端保存：
   - `dpe_auth_token`（会话）
   - `dpe_account_identity`（当前账号身份：`nodeId/publicKey/privateKey`）
5. 群组相关 API 优先从 `Authorization: Bearer <token>` 解析登录身份；`node_id` 参数保留兼容。

## 4. 私钥存储安全

- 登录密码使用 `Argon2id` 存储 hash（不可逆）。
- `user_keys.private_key_cipher` 使用 AES-256-GCM 保存私钥密文；
  - key 由 `scrypt(password, salt)` 派生；
  - 保存 `salt/iv/tag`。
- 登录时用用户输入密码解密私钥并返回给前端运行态使用。

> 说明：当前是本机课设实现，后续可升级为硬件密钥/系统密钥链/分布式密钥管理。

## 5. Yjs 持久化与 Redis 缓存

- 新增 `DocStateService`：
  - `GET /groups/:id/docs/:docId/snapshot`：先查 Redis，再查 `doc_states`。
  - `POST /groups/:id/docs/:docId/snapshot`：写 `doc_states`，并失效 Redis 键。
- Redis Key：
  - `dpe:doc:snapshot:<groupId>:<docId>`
- 一致性策略：
  - **数据库为准**，Redis 仅缓存。
  - 写入路径先 DB 再删缓存，避免脏读。

## 6. 兼容与迁移

- 浏览器旧键（`dpe_uid/dpe_sk/dpe_pk`）仍保留，注册时可迁移到账号体系。
- 迁移完成后打 `dpe_identity_migrated` 标记，避免重复绑定。
- 现有群组、ACL、P2P 协议不需要重建，继续使用 `node_id` 兼容运行。

## 7. 后续升级建议

1. 引入多设备身份（一账号多 `node_id`）与设备管理页。
2. `groups/*` 接口全面去除 `node_id` query，统一由登录态推导。
3. 引入增量 `DocUpdate` 日志表，优化断网重连后快速补偿同步。
4. 将会话改为 HttpOnly Cookie + CSRF 防护。
5. 将本机 Postgres 抽象为可替换的分布式数据库后端。
