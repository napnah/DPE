import type { AuthIdentity } from "./api";
import {
  clearAccountIdentity,
  clearAuthToken,
  saveAccountIdentity,
  saveDisplayName,
  setAuthToken,
  type StoredIdentity,
} from "./identity";

function pickString(raw: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Normalize API payload (camelCase or snake_case). */
export function normalizeAuthIdentity(raw: unknown): AuthIdentity {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    userId: pickString(o, "userId", "user_id"),
    username: pickString(o, "username"),
    nodeId: pickString(o, "nodeId", "node_id"),
    publicKey: pickString(o, "publicKey", "public_key"),
    privateKeyBase64: pickString(o, "privateKeyBase64", "private_key_base64"),
    displayName: pickString(o, "displayName", "display_name") || pickString(o, "username"),
    token: pickString(o, "token"),
    expiresAt: pickString(o, "expiresAt", "expires_at"),
  };
}

export function applyAuthSession(auth: AuthIdentity): StoredIdentity {
  const identity: StoredIdentity = {
    userId: auth.userId,
    username: auth.username,
    nodeId: auth.nodeId,
    publicKeyBase64Url: auth.publicKey,
    privateKeyBase64Url: auth.privateKeyBase64,
    displayName: auth.displayName,
  };
  setAuthToken(auth.token);
  saveDisplayName(auth.displayName);
  saveAccountIdentity(identity);
  return identity;
}

export function clearAuthSession(): void {
  clearAuthToken();
  clearAccountIdentity();
}
