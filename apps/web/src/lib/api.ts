const API = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const CONTROL_PLANE_PORT = Number(import.meta.env.VITE_CONTROL_PLANE_PORT ?? 3001);

export function getApiBaseUrl(): string {
  return API.replace(/\/$/, "");
}

function peerControlPlaneUrl(host: string): string {
  const h = host.trim();
  if (!h || h === "127.0.0.1" || h === "localhost") return getApiBaseUrl();
  return `http://${h}:${CONTROL_PLANE_PORT}`;
}

async function requestAt<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const root = base.replace(/\/$/, "");
  const session = loadSessionToken();
  const res = await fetch(`${root}${path}`, {
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
  async listInvitationsFederated(nodeId: string, peerHosts: string[]) {
    const bases = new Set<string>([getApiBaseUrl()]);
    for (const host of peerHosts) bases.add(peerControlPlaneUrl(host));
    const chunks = await Promise.all(
      [...bases].map(async (base) => {
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

  createInvitation(groupId: string, inviterNodeId: string, inviteeNodeId: string) {
    return request<{ id: string }>(
      `/groups/${groupId}/invitations?inviter_node_id=${encodeURIComponent(inviterNodeId)}`,
      {
        method: "POST",
        body: JSON.stringify({ invitee_node_id: inviteeNodeId }),
      },
    );
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

  getGovernance(groupId: string, callerNodeId: string) {
    return request<GovernancePayload>(
      `/groups/${groupId}/governance?caller_node_id=${encodeURIComponent(callerNodeId)}`,
    );
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
  ) {
    return request<{ ok: boolean }>(`/groups/${groupId}/governance`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  dissolveGroup(groupId: string, callerNodeId: string) {
    return request<{ ok: boolean }>(
      `/groups/${groupId}/dissolve?caller_node_id=${encodeURIComponent(callerNodeId)}`,
      { method: "POST" },
    );
  },

  getDocRoleAcls(groupId: string, docId: string, callerNodeId: string) {
    return request<DocRoleAclRow>(
      `/groups/${groupId}/docs/${docId}/role-acls?caller_node_id=${encodeURIComponent(callerNodeId)}`,
    );
  },

  getTree(groupId: string, nodeId: string) {
    return request<{ nodes: DocNodeRow[] }>(
      `/groups/${groupId}/tree?node_id=${encodeURIComponent(nodeId)}`,
    );
  },

  listMembers(groupId: string) {
    return request<{ members: { node_id: string; public_key: string }[] }>(
      `/groups/${groupId}/members`,
    );
  },

  refreshJwt(groupId: string, nodeId: string | null, docId: string) {
    return request<{ jwt: string; key_version: number; role: number }>(
      `/groups/${groupId}/jwt/refresh`,
      {
        method: "POST",
        body: JSON.stringify({ node_id: nodeId ?? undefined, doc_id: docId }),
      },
    );
  },

  getDocSnapshot(groupId: string, docId: string, nodeId?: string | null) {
    const query = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : "";
    return request<{
      snapshot: {
        state_update_base64: string;
        key_version: number;
        updated_at: string;
        updated_by_node_id: string;
      } | null;
    }>(
      `/groups/${groupId}/docs/${encodeURIComponent(docId)}/snapshot${query}`,
    );
  },

  putDocSnapshot(
    groupId: string,
    docId: string,
    body: { node_id?: string | null; state_update_base64: string },
  ) {
    return request<{ ok: boolean }>(
      `/groups/${groupId}/docs/${encodeURIComponent(docId)}/snapshot`,
      { method: "POST", body: JSON.stringify({ ...body, node_id: body.node_id ?? undefined }) },
    );
  },

  setDocRoleAcl(
    groupId: string,
    callerNodeId: string,
    body: { doc_id: string; group_role_id: string; access_level: number },
  ) {
    return request<{ ok: boolean }>(
      `/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(callerNodeId)}`,
      {
        method: "POST",
        body: JSON.stringify({ op: "SetDocRoleAcl", ...body }),
      },
    );
  },

  createChild(
    groupId: string,
    callerNodeId: string,
    body: { parent_doc_id: string; doc_id: string; title?: string; is_folder?: boolean },
  ) {
    return request<{ ok: boolean; doc_id: string }>(
      `/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(callerNodeId)}`,
      {
        method: "POST",
        body: JSON.stringify({ op: "CreateChild", ...body }),
      },
    );
  },

  deleteDoc(groupId: string, callerNodeId: string, docId: string) {
    return request<{ ok: boolean }>(
      `/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(callerNodeId)}`,
      {
        method: "POST",
        body: JSON.stringify({ op: "DeleteDoc", doc_id: docId }),
      },
    );
  },

  renameDoc(groupId: string, callerNodeId: string, docId: string, title: string) {
    return request<{ ok: boolean }>(
      `/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(callerNodeId)}`,
      {
        method: "POST",
        body: JSON.stringify({ op: "RenameDoc", doc_id: docId, title }),
      },
    );
  },
};

export function saveGroupAdminKey(groupId: string, pkAdmin: string) {
  localStorage.setItem(`dpe_group_${groupId}_pk_admin`, pkAdmin);
}

export function loadGroupAdminKey(groupId: string): string | null {
  return localStorage.getItem(`dpe_group_${groupId}_pk_admin`);
}
