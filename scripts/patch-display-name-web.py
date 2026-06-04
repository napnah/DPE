# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

(ROOT / "apps/web/src/lib/identity.ts").write_text(
    r'''import {
  base64UrlToBytes,
  bytesToBase64Url,
  exportPublicKeyBase64Url,
  generateNodeKeyPair,
} from "@dpe/crypto";

const UID_KEY = "dpe_uid";
const SK_KEY = "dpe_sk";
const PK_KEY = "dpe_pk";
const DISPLAY_NAME_KEY = "dpe_display_name";

export interface StoredIdentity {
  nodeId: string;
  publicKeyBase64Url: string;
  displayName: string;
}

export function loadDisplayName(): string | null {
  const name = localStorage.getItem(DISPLAY_NAME_KEY)?.trim();
  return name && name.length > 0 ? name : null;
}

export function saveDisplayName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 32) {
    throw new Error("用户名须为 1–32 个字符");
  }
  localStorage.setItem(DISPLAY_NAME_KEY, trimmed);
}

export function hasUserProfile(): boolean {
  const nodeId = localStorage.getItem(UID_KEY);
  const sk = localStorage.getItem(SK_KEY);
  const pk = localStorage.getItem(PK_KEY);
  return Boolean(nodeId && sk && pk && loadDisplayName());
}

/** Keys only (before username step). */
export function loadIdentityKeys(): { nodeId: string; publicKeyBase64Url: string } | null {
  const nodeId = localStorage.getItem(UID_KEY);
  const sk = localStorage.getItem(SK_KEY);
  const pk = localStorage.getItem(PK_KEY);
  if (!nodeId || !sk || !pk) return null;
  return { nodeId, publicKeyBase64Url: pk };
}

export function loadIdentity(): StoredIdentity | null {
  const keys = loadIdentityKeys();
  const displayName = loadDisplayName();
  if (!keys || !displayName) return null;
  return { ...keys, displayName };
}

export async function createAndStoreIdentity(): Promise<{ nodeId: string; publicKeyBase64Url: string }> {
  const pair = await generateNodeKeyPair();
  const publicKeyBase64Url = exportPublicKeyBase64Url(pair.publicKey);
  localStorage.setItem(UID_KEY, pair.nodeId);
  localStorage.setItem(SK_KEY, bytesToBase64Url(pair.privateKey));
  localStorage.setItem(PK_KEY, publicKeyBase64Url);
  return { nodeId: pair.nodeId, publicKeyBase64Url };
}

export function loadPrivateKey(): Uint8Array | null {
  const sk = localStorage.getItem(SK_KEY);
  return sk ? base64UrlToBytes(sk) : null;
}
''',
    encoding="utf-8",
)

(ROOT / "apps/web/src/lib/display-names.ts").write_text(
    r'''export function shortNodeId(nodeId: string, len = 8): string {
  if (nodeId.length <= len) return nodeId;
  return `${nodeId.slice(0, len)}…`;
}

export function memberDisplayLabel(
  member: { node_id: string; display_name?: string },
  selfNodeId?: string,
): string {
  const name = member.display_name?.trim();
  if (name) {
    return selfNodeId && member.node_id === selfNodeId ? `${name}（我）` : name;
  }
  return shortNodeId(member.node_id, 10);
}

export function peerDisplayLabel(peer: { uid: string; name?: string }): string {
  const name = peer.name?.trim();
  return name || shortNodeId(peer.uid, 10);
}
''',
    encoding="utf-8",
)

(ROOT / "apps/web/src/pages/OnboardingPage.tsx").write_text(
    r'''import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createAndStoreIdentity,
  loadDisplayName,
  loadIdentityKeys,
  saveDisplayName,
} from "../lib/identity";
import { api } from "../lib/api";
import { shortNodeId } from "../lib/display-names";

export default function OnboardingPage() {
  const nav = useNavigate();
  const [keys, setKeys] = useState(loadIdentityKeys);
  const [displayName, setDisplayName] = useState(loadDisplayName() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (keys && loadDisplayName()) {
      nav("/dashboard", { replace: true });
    }
  }, [keys, nav]);

  async function createIdentity() {
    setBusy(true);
    setError(null);
    try {
      const id = await createAndStoreIdentity();
      setKeys(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function finishProfile() {
    if (!keys) return;
    setBusy(true);
    setError(null);
    try {
      saveDisplayName(displayName);
      await api.syncDisplayName(keys.nodeId, displayName.trim());
      nav("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  const needsKeys = !keys;
  const needsName = keys && !loadDisplayName();

  return (
    <main className="app-page" style={{ maxWidth: 560 }}>
      <h1>Distributed Privacy Editor</h1>
      {needsKeys ? (
        <>
          <p className="app-muted">首次使用须生成本机密钥（节点 ID 仅用于底层协议，日常以用户名为准）。</p>
          <section className="app-panel">
            <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={() => void createIdentity()}>
              {busy ? "生成中…" : "生成本机身份"}
            </button>
          </section>
        </>
      ) : needsName ? (
        <>
          <p className="app-muted">
            请设置<strong>用户名</strong>（群组内展示）。节点 ID{" "}
            <code title={keys.nodeId}>{shortNodeId(keys.nodeId, 12)}</code> 仅作技术标识。
          </p>
          <section className="app-panel">
            <label className="app-label" htmlFor="display-name">
              用户名
            </label>
            <input
              id="display-name"
              className="app-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例如：陈同学"
              maxLength={32}
              autoFocus
            />
            <button
              type="button"
              className="app-btn app-btn--primary"
              style={{ marginTop: 12 }}
              disabled={busy || !displayName.trim()}
              onClick={() => void finishProfile()}
            >
              {busy ? "保存中…" : "进入总览"}
            </button>
          </section>
        </>
      ) : null}
      {error && <p className="app-error">{error}</p>}
    </main>
  );
}
''',
    encoding="utf-8",
)

(ROOT / "apps/web/src/App.tsx").write_text(
    r'''import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import OnboardingPage from "./pages/OnboardingPage";
import GroupPage from "./pages/GroupPage";
import GroupSettingsPage from "./pages/GroupSettingsPage";
import DocEditorPage from "./pages/DocEditorPage";
import DesignRoutes from "./designs/DesignRoutes";
import { hasUserProfile } from "./lib/identity";

function RequireProfile({ children }: { children: ReactNode }) {
  if (!hasUserProfile()) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/designs/*" element={<DesignRoutes />} />
      <Route path="/" element={<OnboardingPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireProfile>
            <DashboardPage />
          </RequireProfile>
        }
      />
      <Route
        path="/connections"
        element={
          <RequireProfile>
            <ConnectionsPage />
          </RequireProfile>
        }
      />
      <Route
        path="/groups/:groupId"
        element={
          <RequireProfile>
            <GroupPage />
          </RequireProfile>
        }
      />
      <Route
        path="/groups/:groupId/settings"
        element={
          <RequireProfile>
            <GroupSettingsPage />
          </RequireProfile>
        }
      />
      <Route
        path="/groups/:groupId/docs/:docId"
        element={
          <RequireProfile>
            <DocEditorPage />
          </RequireProfile>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
''',
    encoding="utf-8",
)

# api.ts patches via substring
api = ROOT / "apps/web/src/lib/api.ts"
t = api.read_text(encoding="utf-8")
if "syncDisplayName" not in t:
    t = t.replace(
        "  members: { node_id: string; public_key: string }[];",
        "  members: { node_id: string; public_key: string; display_name?: string }[];",
    )
    t = t.replace(
        """    owner_public_key: string;
    control_mode?: "owner_direct" | "proxy";""",
        """    owner_public_key: string;
    owner_display_name?: string;
    control_mode?: "owner_direct" | "proxy";""",
    )
    t = t.replace(
        "  acceptInvitation(invitationId: string, body: { node_id: string; public_key: string }) {",
        "  acceptInvitation(\n    invitationId: string,\n    body: { node_id: string; public_key: string; display_name?: string },\n  ) {",
    )
    t = t.replace(
        'export const api = {\n  createGroup(body: {',
        """export const api = {
  syncDisplayName(nodeId: string, displayName: string) {
    return request<{ ok: boolean; display_name: string }>("/users/me/display-name", {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId, display_name: displayName }),
    });
  },

  createGroup(body: {""",
    )
    api.write_text(t, encoding="utf-8")
    print("ok api.ts")

print("web core done")
