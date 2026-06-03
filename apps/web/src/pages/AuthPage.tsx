import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { applyAuthSession, normalizeAuthIdentity } from "../lib/auth-session";
import {
  createLegacyIdentityPayload,
  getAuthToken,
  hasMigratedLegacyIdentity,
  loadIdentity,
  markLegacyIdentityMigrated,
} from "../lib/identity";

type AuthMode = "login" | "register";

export default function AuthPage({ initialMode }: { initialMode: AuthMode }) {
  const nav = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const legacyIdentity = useMemo(
    () => (hasMigratedLegacyIdentity() ? null : createLegacyIdentityPayload()),
    [],
  );

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  useEffect(() => {
    if (loadIdentity() && getAuthToken()) {
      nav(redirectTo, { replace: true });
    }
  }, [nav, redirectTo]);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
  }, [initialMode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("请填写账号和密码");
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setError("密码至少 8 位");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const raw =
        mode === "register"
          ? await api.register({
              username: username.trim(),
              password,
              display_name: displayName.trim() || username.trim(),
              legacy_identity: legacyIdentity ?? undefined,
            })
          : await api.login({
              username: username.trim(),
              password,
            });
      const auth = normalizeAuthIdentity(raw);
      if (!auth.token || !auth.nodeId || !auth.privateKeyBase64) {
        throw new Error("登录响应不完整，请检查控制平面服务");
      }
      applyAuthSession(auth);
      if (legacyIdentity) markLegacyIdentityMigrated();
      nav(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === "register" ? "注册失败" : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-page__backdrop" aria-hidden />
      <div className="auth-page__frame">
        <aside className="auth-page__hero">
          <p className="auth-page__eyebrow">Distributed Privacy Editor</p>
          <h1 className="auth-page__title">本机账号，安全协作</h1>
          <p className="auth-page__lead">
            身份与文档快照保存在本机数据库；浏览器仅保存短期会话。登录后可在任意浏览器标签页继续同一账号协作。
          </p>
          <ul className="auth-page__features">
            <li>账号密码登录（Argon2id）</li>
            <li>群组 RBAC 与 P2P 加密同步</li>
            <li>Yjs 文档状态持久化到数据库</li>
          </ul>
        </aside>

        <section className="auth-page__card" aria-labelledby="auth-form-title">
          <div className="auth-page__tabs" role="tablist" aria-label="登录方式">
            <Link
              to="/login"
              className={`auth-page__tab ${mode === "login" ? "is-active" : ""}`}
              role="tab"
              aria-selected={mode === "login"}
            >
              登录
            </Link>
            <Link
              to="/register"
              className={`auth-page__tab ${mode === "register" ? "is-active" : ""}`}
              role="tab"
              aria-selected={mode === "register"}
            >
              注册
            </Link>
          </div>

          <h2 id="auth-form-title" className="auth-page__form-title">
            {mode === "login" ? "登录你的 DPE 账号" : "创建本机账号"}
          </h2>
          <p className="auth-page__form-hint">
            {mode === "login"
              ? "使用在本机控制平面注册的账号密码。"
              : "注册后将自动生成分布式节点密钥并绑定到该账号。"}
          </p>

          <form className="auth-page__form" onSubmit={(e) => void submit(e)}>
            <label className="app-label" htmlFor="auth-username">
              账号
            </label>
            <input
              id="auth-username"
              className="app-input auth-page__input"
              autoComplete="username"
              placeholder="3–32 位字母、数字、下划线"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
              autoFocus
            />

            <label className="app-label" htmlFor="auth-password">
              密码
            </label>
            <input
              id="auth-password"
              type="password"
              className="app-input auth-page__input"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder={mode === "login" ? "输入密码" : "至少 8 位"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />

            {mode === "register" && (
              <>
                <label className="app-label" htmlFor="auth-password2">
                  确认密码
                </label>
                <input
                  id="auth-password2"
                  type="password"
                  className="app-input auth-page__input"
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={busy}
                />

                <label className="app-label" htmlFor="auth-display-name">
                  显示名（可选）
                </label>
                <input
                  id="auth-display-name"
                  className="app-input auth-page__input"
                  placeholder="群组内展示的名称"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={busy}
                />
              </>
            )}

            {legacyIdentity && mode === "register" && (
              <p className="auth-page__notice">
                检测到旧版浏览器本地身份，注册时会自动迁移并绑定到本账号（保留原 node_id 与群组成员关系）。
              </p>
            )}

            {error && (
              <p className="app-error auth-page__error" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="app-btn app-btn--primary auth-page__submit"
              disabled={busy || !username.trim() || !password}
            >
              {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并进入"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
