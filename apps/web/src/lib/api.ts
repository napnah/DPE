const API = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

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
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
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
  control_mode: string;
  owner_node_id: string;
  proxy_base_url: string | null;
  created_at: string;
};

export type DocNodeRow = {
  docId: string;
  parentDocId: string | null;
  title: string;
  keyVersion: number;
};

export type InvitationRow = {
  id: string;
  groupId: string;
  inviterNodeId: string;
  inviteeNodeId: string;
  status: string;
  group: { id: string; name: string; issuerPublicKey: string };
};

export const api = {
  createGroup(body: {
    name: string;
    owner_node_id: string;
    owner_public_key: string;
    control_mode?: "owner_direct" | "proxy";
  }) {
    return request<{
      group_id: string;
      pk_admin: string;
      name: string;
    }>("/groups", { method: "POST", body: JSON.stringify(body) });
  },

  listGroups(nodeId: string, role: "owner" | "member") {
    return request<GroupSummary[]>(
      `/users/me/groups?node_id=${encodeURIComponent(nodeId)}&role=${role}`,
    );
  },

  listInvitations(nodeId: string) {
    return request<InvitationRow[]>(
      `/users/me/invitations?node_id=${encodeURIComponent(nodeId)}`,
    );
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

  acceptInvitation(invitationId: string, body: { node_id: string; public_key: string }) {
    return request<{ group_id: string; pk_admin: string }>(
      `/invitations/${invitationId}/accept`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  rejectInvitation(invitationId: string, nodeId: string) {
    return request<{ ok: boolean }>(
      `/invitations/${invitationId}/reject?node_id=${encodeURIComponent(nodeId)}`,
      { method: "POST" },
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

  refreshJwt(groupId: string, nodeId: string, docId: string) {
    return request<{ jwt: string; key_version: number; role: number }>(
      `/groups/${groupId}/jwt/refresh`,
      {
        method: "POST",
        body: JSON.stringify({ node_id: nodeId, doc_id: docId }),
      },
    );
  },

  setAcl(
    groupId: string,
    callerNodeId: string,
    body: { op: "SetACL"; doc_id: string; user_node_id: string; role: number },
  ) {
    return request<{ ok: boolean }>(
      `/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(callerNodeId)}`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
};

export function saveGroupAdminKey(groupId: string, pkAdmin: string) {
  localStorage.setItem(`dpe_group_${groupId}_pk_admin`, pkAdmin);
}

export function loadGroupAdminKey(groupId: string): string | null {
  return localStorage.getItem(`dpe_group_${groupId}_pk_admin`);
}
