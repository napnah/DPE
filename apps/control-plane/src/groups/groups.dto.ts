/** JSON bodies use snake_case per API docs. */
export interface CreateGroupDto {
  name: string;
  description?: string;
  owner_node_id: string;
  owner_public_key: string;
  control_mode?: "owner_direct" | "proxy";
  proxy_base_url?: string;
}

export interface JoinGroupDto {
  node_id: string;
  public_key: string;
}

export interface CreateInvitationDto {
  invitee_node_id: string;
}

export interface RefreshJwtDto {
  node_id: string;
  doc_id: string;
}

export interface UpdateGovernanceDto {
  caller_node_id: string;
  default_member_role_id?: string;
  create_child_template?: Record<string, number>;
  /** @deprecated use member_roles */
  assignments?: { node_id: string; role_id: string }[];
  /** Replace all roles for listed members */
  member_roles?: { node_id: string; role_ids: string[] }[];
  create_roles?: { name: string; color?: string; slug?: string }[];
  roles?: { id?: string; name: string; color?: string }[];
}
