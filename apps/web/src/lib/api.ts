import type { LanPeer } from "./lan";
import {
  isRemoteDemoViewer,
  resolveClientControlPlaneUrl,
  resolveControlPlaneBaseUrl,
} from "./dev-tunnel";

const API = resolveControlPlaneBaseUrl();

export function getApiBaseUrl(): string {
  return API.replace(/\/$/, "");
}

const REMOTE_FETCH_TIMEOUT_MS = 8_000;

function federatedControlPlaneBases(peers: Pick<LanPeer, "controlUrl">[]): string[] {
  const local = getApiBaseUrl();
  if (isRemoteDemoViewer()) return [local];
  const bases = new Set<string>([local]);
  for (const peer of peers) {
    const base = peer.controlUrl?.trim();
    if (base) bases.add(base);
  }
  return [...bases];
}

async function requestAt<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const root = (resolveClientControlPlaneUrl(base) ?? base).replace(/\/$/, "");
  const session = loadSessionToken();
  const res = await fetch(`${root}${path}`, {
    ...init,
    signal: init?.signal ?? (isRemoteDemoViewer() ? AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) : undefined),
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session}` } : {}),
      ...init?.headers,
    },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as T) : ({} as T);
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : text || res.statusText;
    throw new ApiError(res.status, msg);
  }
  return body;
}

function loadSessionToken(): string | null {
  const raw = localStorage.getItem("dpe_auth_token");
  return raw?.trim() ? raw.trim() : null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = loadSessionToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session}` } : {}),
      ...init?.headers,
    },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as T) : ({} as T);
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : text || res.statusText;
    throw new ApiError(res.status, msg);
  }
  return body;
}

export type GroupSummary = {
  group_id: string;
  name: string;
  description?: string;
  control_mode: string;
  owner_node_id: string;
  issuer_public_key?: string;
  proxy_base_url: string | null;
  created_at: string;
  control_plane_url?: string;
};

export type GroupCardRow = GroupSummary & {
  is_owner: boolean;
  my_role_name: string;
  my_role_color: string;
};

export type AuthIdentity = {
  userId: string;
  username: string;
  nodeId: string;
  publicKey: string;
  privateKeyBase64: string;
  displayName: string;
  token: string;
  expiresAt: string;
};

export type DocNodeRow = {
  docId: string;
  parentDocId: string | null;
  title: string;
  keyVersion: number;
  isFolder?: boolean;
};

export type InvitationRow = {
  id: string;
  groupId: string;
  inviterNodeId: string;
  inviteeNodeId: string;
  status: string;
  group: { id: string; name: string; issuerPublicKey: string };
  /** 邀请记录所在的控制平面（群主节点）；接受/拒绝须打到同一地址 */
  control_plane_url?: string;
};

export type GovernancePayload = {
  group_id: string;
  name: string;
  description: string;
  roles: { id: string; name: string; slug: string; color: string; is_builtin: boolean }[];
  assignments: { node_id: string; role_id: string }[];
  default_rules: {
    default_member_role_id: string;
    create_child_template: Record<string, number>;
  } | null;
  members: { node_id: string; public_key: string; display_name?: string }[];
};

export type MyRoleOnDocRow = {
  role_id: string;
  name: string;
  color: string;
  access_level: number;
};

export type DocRoleAclRow = {
  doc_id: string;
  my_access_level: number;
  my_roles: MyRoleOnDocRow[];
  can_manage_acl: boolean;
  roles: {
    id: string;
    name: string;
    color: string;
    access_level: number;
    acl_editable?: boolean;
  }[];
};

export const api = {
  getApiBaseUrl,

  register(body: {
    username: string;
    password: string;
    display_name?: string;
    legacy_identity?: {
      node_id: string;
      public_key: string;
      private_key_base64?: string;
    };
  }) {
    return request<AuthIdentity>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  login(body: { username: string; password: string }) {
    return request<AuthIdentity>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  me() {
    return request<{
      user_id: string;
      username: string;
      display_name: string;
      node_id: string;
      public_key: string;
    }>("/auth/me");
  },

  syncDisplayName(nodeId: string | null, displayName: string) {
    return request<{ ok: boolean; display_name: string }>("/users/me/display-name", {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId ?? undefined, display_name: displayName }),
    });
  },

  createGroup(body: {
    name: string;
    description?: string;
    owner_node_id: string;
    owner_public_key: string;
    owner_display_name?: string;
    control_mode?: "owner_direct" | "proxy";
  }) {
    return request<{
      group_id: string;
      pk_admin: string;
      name: string;
    }>("/groups", { method: "POST", body: JSON.stringify(body) });
  },

  listAllGroups(nodeId?: string | null) {
    const query = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : "";
    return request<GroupCardRow[]>(`/users/me/groups/all${query}`);
  },

  async listAllGroupsFederated(nodeId: string | null | undefined, peers: Pick<LanPeer, "controlUrl">[]) {
    const query = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : "";
    const chunks = await Promise.all(
      federatedControlPlaneBases(peers).map(async (base) => {
        try {
          const rows = await requestAt<GroupCardRow[]>(base, `/users/me/groups/all${query}`);
          return rows.map((row) => ({ ...row, control_plane_url: base }));
        } catch {
          return [];
        }
      }),
    );
    const seen = new Set<string>();
    const out: GroupCardRow[] = [];
    for (const row of chunks.flat()) {
      const key = `${row.control_plane_url ?? ""}:${row.group_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  },

  listGroups(nodeId: string, role: "owner" | "member") {
    return request<GroupSummary[]>(
      `/users/me/groups?node_id=${encodeURIComponent(nodeId)}&role=${role}`,
    );
  },

  listInvitations(nodeId?: string | null) {
    const query = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : "";
    return request<InvitationRow[]>(`/users/me/invitations${query}`);
  },

  /** 本机 + 已发现邻居上的待处理邀请（双机各自数据库时，邀请在群主节点） */
  async listInvitationsFederated(nodeId: string, peers: Pick<LanPeer, "controlUrl">[]) {
    const chunks = await Promise.all(
      federatedControlPlaneBases(peers).map(async (base) => {
        try {
          const rows = await requestAt<InvitationRow[]>(
            base,
            `/users/me/invitations?node_id=${encodeURIComponent(nodeId)}`,
          );
          return rows.map((r) => ({ ...r, control_plane_url: base }));
        } catch {
          return [];
        }
      }),
    );
    const seen = new Set<string>();
    const out: InvitationRow[] = [];
    for (const row of chunks.flat()) {
      const key = `${row.control_plane_url ?? ""}:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  },

  createInvitation(groupId: string, inviterNodeId: string, inviteeNodeId: string, controlPlaneUrl?: string) {
    const path = `/groups/${groupId}/invitations?inviter_node_id=${encodeURIComponent(inviterNodeId)}`;
    const init = {
      method: "POST",
      body: JSON.stringify({ invitee_node_id: inviteeNodeId }),
    };
    return controlPlaneUrl
      ? requestAt<{ id: string }>(controlPlaneUrl, path, init)
      : request<{ id: string }>(path, init);
  },

  acceptInvitation(
    invitationId: string,
    body: { node_id: string; public_key: string; display_name?: string },
    controlPlaneUrl?: string,
  ) {
    const base = controlPlaneUrl?.replace(/\/$/, "") ?? getApiBaseUrl();
    return requestAt<{ group_id: string; pk_admin: string }>(
      base,
      `/invitations/${invitationId}/accept`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  rejectInvitation(
    invitationId: string,
    nodeId?: string | null,
    controlPlaneUrl?: string,
  ) {
    const query = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : "";
    const base = controlPlaneUrl?.replace(/\/$/, "") ?? getApiBaseUrl();
    return requestAt<{ ok: boolean }>(base, `/invitations/${invitationId}/reject${query}`, {
      method: "POST",
    });
  },

  getGovernance(groupId: string, callerNodeId: string, controlPlaneUrl?: string) {
    const path = `/groups/${groupId}/governance?caller_node_id=${encodeURIComponent(callerNodeId)}`;
    return controlPlaneUrl
      ? requestAt<GovernancePayload>(controlPlaneUrl, path)
      : request<GovernancePayload>(path);
  },

  updateGovernance(
    groupId: string,
    body: {
      caller_node_id: string;
      default_member_role_id?: string;
      create_child_template?: Record<string, number>;
      assignments?: { node_id: string; role_id: string }[];
      member_roles?: { node_id: string; role_ids: string[] }[];
      create_roles?: { name: string; color?: string; slug?: string }[];
      roles?: { id?: string; name: string; color?: string }[];
      delete_role_ids?: string[];
    },
    controlPlaneUrl?: string,
  ) {
    const path = `/groups/${groupId}/governance`;
    const init = {
      method: "POST",
      body: JSON.stringify(body),
    };
    return controlPlaneUrl
      ? requestAt<{ ok: boolean }>(controlPlaneUrl, path, init)
      : request<{ ok: boolean }>(path, init);
  },

  dissolveGroup(groupId: string, callerNodeId: string, controlPlaneUrl?: string) {
    const path = `/groups/${groupId}/dissolve?caller_node_id=${encodeURIComponent(callerNodeId)}`;
    const init = { method: "POST" };
    return controlPlaneUrl
      ? requestAt<{ ok: boolean }>(controlPlaneUrl, path, init)
      : request<{ ok: boolean }>(path, init);
  },

  getDocRoleAcls(groupId: string, docId: string, callerNodeId: string, controlPlaneUrl?: string) {
    const path = `/groups/${groupId}/docs/${docId}/role-acls?caller_node_id=${encodeURIComponent(callerNodeId)}`;
    return controlPlaneUrl
      ? requestAt<DocRoleAclRow>(controlPlaneUrl, path)
      : request<DocRoleAclRow>(path);
  },

  getTree(groupId: string, nodeId: string, controlPlaneUrl?: string) {
    const path = `/groups/${groupId}/tree?node_id=${encodeURIComponent(nodeId)}`;
    return controlPlaneUrl
      ? requestAt<{ nodes: DocNodeRow[] }>(controlPlaneUrl, path)
      : request<{ nodes: DocNodeRow[] }>(path);
  },

  listMembers(groupId: string, controlPlaneUrl?: string) {
    return controlPlaneUrl
      ? requestAt<{ members: { node_id: string; public_key: string }[] }>(
          controlPlaneUrl,
          `/groups/${groupId}/members`,
        )
      : request<{ members: { node_id: string; public_key: string }[] }>(
          `/groups/${groupId}/members`,
        );
  },

  refreshJwt(groupId: string, nodeId: string | null, docId: string, controlPlaneUrl?: string) {
    const init = {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId ?? undefined, doc_id: docId }),
    };
    return controlPlaneUrl
      ? requestAt<{ jwt: string; key_version: number; role: number }>(
          controlPlaneUrl,
          `/groups/${groupId}/jwt/refresh`,
          init,
        )
      : request<{ jwt: string; key_version: number; role: number }>(
          `/groups/${groupId}/jwt/refresh`,
          init,
        );
  },

  getDocSnapshot(groupId: string, docId: string, nodeId?: string | null, controlPlaneUrl?: string) {
    const query = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : "";
    const path = `/groups/${groupId}/docs/${encodeURIComponent(docId)}/snapshot${query}`;
    return controlPlaneUrl
      ? requestAt<{
          snapshot: {
            state_update_base64: string;
            key_version: number;
            updated_at: string;
            updated_by_node_id: string;
          } | null;
        }>(controlPlaneUrl, path)
      : request<{
      snapshot: {
        state_update_base64: string;
        key_version: number;
        updated_at: string;
        updated_by_node_id: string;
      } | null;
        }>(path);
  },

  putDocSnapshot(
    groupId: string,
    docId: string,
    body: { node_id?: string | null; state_update_base64: string },
    controlPlaneUrl?: string,
  ) {
    const path = `/groups/${groupId}/docs/${encodeURIComponent(docId)}/snapshot`;
    const init = {
      method: "POST",
      body: JSON.stringify({ ...body, node_id: body.node_id ?? undefined }),
    };
    return controlPlaneUrl
      ? requestAt<{ ok: boolean }>(controlPlaneUrl, path, init)
      : request<{ ok: boolean }>(path, init);
  },

  setDocRoleAcl(
    groupId: string,
    callerNodeId: string,
    body: { doc_id: string; group_role_id: string; access_level: number },
    controlPlaneUrl?: string,
  ) {
    const path = `/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(callerNodeId)}`;
    const init = { method: "POST", body: JSON.stringify({ op: "SetDocRoleAcl", ...body }) };
    return controlPlaneUrl
      ? requestAt<{ ok: boolean }>(controlPlaneUrl, path, init)
      : request<{ ok: boolean }>(path, init);
  },

  createChild(
    groupId: string,
    callerNodeId: string,
    body: { parent_doc_id: string; doc_id: string; title?: string; is_folder?: boolean },
    controlPlaneUrl?: string,
  ) {
    const path = `/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(callerNodeId)}`;
    const init = { method: "POST", body: JSON.stringify({ op: "CreateChild", ...body }) };
    return controlPlaneUrl
      ? requestAt<{ ok: boolean; doc_id: string }>(controlPlaneUrl, path, init)
      : request<{ ok: boolean; doc_id: string }>(path, init);
  },

  deleteDoc(groupId: string, callerNodeId: string, docId: string, controlPlaneUrl?: string) {
    const path = `/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(callerNodeId)}`;
    const init = { method: "POST", body: JSON.stringify({ op: "DeleteDoc", doc_id: docId }) };
    return controlPlaneUrl
      ? requestAt<{ ok: boolean }>(controlPlaneUrl, path, init)
      : request<{ ok: boolean }>(path, init);
  },

  renameDoc(groupId: string, callerNodeId: string, docId: string, title: string, controlPlaneUrl?: string) {
    const path = `/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(callerNodeId)}`;
    const init = { method: "POST", body: JSON.stringify({ op: "RenameDoc", doc_id: docId, title }) };
    return controlPlaneUrl
      ? requestAt<{ ok: boolean }>(controlPlaneUrl, path, init)
      : request<{ ok: boolean }>(path, init);
  },
};

export function saveGroupAdminKey(groupId: string, pkAdmin: string) {
  localStorage.setItem(`dpe_group_${groupId}_pk_admin`, pkAdmin);
}

export function loadGroupAdminKey(groupId: string): string | null {
  return localStorage.getItem(`dpe_group_${groupId}_pk_admin`);
}

/** 群主控制平面地址（对等部署时成员须访问群主节点 API） */
export function saveGroupControlPlaneUrl(groupId: string, controlPlaneUrl: string) {
  const url = controlPlaneUrl.trim().replace(/\/$/, "");
  if (!url) return;
  localStorage.setItem(`dpe_group_${groupId}_control_plane`, url);
}

export function loadGroupControlPlaneUrl(groupId: string): string | null {
  const raw = localStorage.getItem(`dpe_group_${groupId}_control_plane`);
  return raw?.trim() ? raw.trim().replace(/\/$/, "") : null;
}

/** 解析群组应使用的控制平面：URL 参数 > 本地缓存 > 本机 API */
export function resolveGroupControlPlaneUrl(
  groupId: string,
  fromQuery?: string | null,
): string | undefined {
  const q = resolveClientControlPlaneUrl(fromQuery);
  if (q) return q;
  return resolveClientControlPlaneUrl(loadGroupControlPlaneUrl(groupId));
}
