import {
  base64UrlToBytes,
  bytesToBase64Url,
  deriveNodeId,
  exportPublicKeyBase64Url,
  generateNodeKeyPair,
} from "@dpe/crypto";

const UID_KEY = "dpe_uid";
const SK_KEY = "dpe_sk";
const PK_KEY = "dpe_pk";
const DISPLAY_NAME_KEY = "dpe_display_name";
const SESSION_KEY = "dpe_auth_token";
const ACCOUNT_KEY = "dpe_account_identity";
const MIGRATED_KEY = "dpe_identity_migrated";
export const AUTH_CHANGED_EVENT = "dpe-auth-changed";

export type StoredIdentity = {
  nodeId: string;
  publicKeyBase64Url: string;
  privateKeyBase64Url: string;
  displayName: string;
  userId?: string;
  username?: string;
};

export type LegacyIdentityPayload = {
  node_id: string;
  public_key: string;
  private_key_base64?: string;
};

function normalizeDisplayName(raw?: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "未命名用户";
  return s.slice(0, 32);
}

export function getAuthToken(): string | null {
  const t = localStorage.getItem(SESSION_KEY)?.trim();
  return t && t.length > 0 ? t : null;
}

export function setAuthToken(token: string): void {
  localStorage.setItem(SESSION_KEY, token.trim());
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearAuthToken(): void {
  localStorage.removeItem(SESSION_KEY);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function saveDisplayName(name: string): void {
  localStorage.setItem(DISPLAY_NAME_KEY, normalizeDisplayName(name));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("dpe-display-name-changed"));
  }
}

export function loadDisplayName(): string | null {
  const account = loadIdentity();
  if (account?.displayName) return account.displayName;
  const name = localStorage.getItem(DISPLAY_NAME_KEY)?.trim();
  return name && name.length > 0 ? name : null;
}

export function hasUserProfile(): boolean {
  return Boolean(loadIdentity() && getAuthToken());
}

/** Alias for route guards — account session is required. */
export const isLoggedIn = hasUserProfile;

export function saveAccountIdentity(identity: StoredIdentity): void {
  const value: StoredIdentity = {
    ...identity,
    displayName: normalizeDisplayName(identity.displayName),
  };
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(value));
  saveDisplayName(value.displayName);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearAccountIdentity(): void {
  localStorage.removeItem(ACCOUNT_KEY);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function loadIdentity(): StoredIdentity | null {
  const raw = localStorage.getItem(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as StoredIdentity;
    if (!data.nodeId || !data.publicKeyBase64Url || !data.privateKeyBase64Url) return null;
    return {
      ...data,
      displayName: normalizeDisplayName(data.displayName),
    };
  } catch {
    return null;
  }
}

export function loadIdentityKeys(): { nodeId: string; publicKeyBase64Url: string } | null {
  const id = loadIdentity();
  if (!id) return null;
  return { nodeId: id.nodeId, publicKeyBase64Url: id.publicKeyBase64Url };
}

export function loadPrivateKey(): Uint8Array | null {
  const id = loadIdentity();
  if (!id) return null;
  return base64UrlToBytes(id.privateKeyBase64Url);
}

export function createLegacyIdentityPayload(): LegacyIdentityPayload | null {
  const nodeId = localStorage.getItem(UID_KEY);
  const publicKey = localStorage.getItem(PK_KEY);
  const privateKey = localStorage.getItem(SK_KEY);
  if (!nodeId || !publicKey) return null;
  const derived = deriveNodeId(base64UrlToBytes(publicKey));
  if (derived !== nodeId) return null;
  return {
    node_id: nodeId,
    public_key: publicKey,
    private_key_base64: privateKey ?? undefined,
  };
}

export function markLegacyIdentityMigrated(): void {
  localStorage.setItem(MIGRATED_KEY, "1");
}

export function hasMigratedLegacyIdentity(): boolean {
  return localStorage.getItem(MIGRATED_KEY) === "1";
}

/** Fallback guest-only identity path (kept for compatibility before login). */
export async function createAndStoreIdentity(): Promise<{ nodeId: string; publicKeyBase64Url: string }> {
  const pair = await generateNodeKeyPair();
  const publicKeyBase64Url = exportPublicKeyBase64Url(pair.publicKey);
  localStorage.setItem(UID_KEY, pair.nodeId);
  localStorage.setItem(SK_KEY, bytesToBase64Url(pair.privateKey));
  localStorage.setItem(PK_KEY, publicKeyBase64Url);
  return { nodeId: pair.nodeId, publicKeyBase64Url };
}
