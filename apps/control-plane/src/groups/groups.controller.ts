import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { GroupsService } from "./groups.service.js";
import type {
  CreateGroupDto,
  CreateInvitationDto,
  JoinGroupDto,
  RefreshJwtDto,
  UpdateGovernanceDto,
  UpdateDisplayNameDto,
  PutDocSnapshotDto,
} from "./groups.dto.js";
import { AuthService } from "../auth/auth.service.js";
import { extractToken } from "../auth/auth.controller.js";
import { DocStateService } from "./doc-state.service.js";

@Controller()
export class GroupsController {
  constructor(
    @Inject(GroupsService) private readonly groups: GroupsService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DocStateService) private readonly docState: DocStateService,
  ) {}

  private async resolveNodeId(
    headers: Record<string, string | string[] | undefined>,
    queryNodeId?: string,
  ): Promise<string> {
    if (queryNodeId?.trim()) return queryNodeId.trim();
    const token = extractToken(headers);
    const nodeId = await this.auth.resolveNodeIdFromSession(token);
    if (!nodeId) throw new UnauthorizedException("missing node_id or auth session");
    return nodeId;
  }

  @Post("groups")
  createGroup(@Body() body: CreateGroupDto) {
    return this.groups.createGroup(body);
  }

  @Post("users/me/display-name")
  async updateDisplayName(
    @Body() body: UpdateDisplayNameDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const token = extractToken(headers);
    const nodeId = await this.resolveNodeId(headers, body.node_id);
    const accountDisplayName = await this.auth.updateDisplayName(token, body.display_name);
    return this.groups.updateMemberDisplayName(nodeId, accountDisplayName ?? body.display_name);
  }

  @Get("users/me/groups")
  async listMyGroups(
    @Query("node_id") queryNodeId: string,
    @Query("role") role: "owner" | "member",
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const nodeId = await this.resolveNodeId(headers, queryNodeId);
    return this.groups.listGroupsForNode(nodeId, role ?? "member");
  }

  @Get("users/me/groups/all")
  async listAllGroups(
    @Query("node_id") queryNodeId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const nodeId = await this.resolveNodeId(headers, queryNodeId);
    return this.groups.listAllGroupsForNode(nodeId);
  }

  @Get("groups/:id/governance")
  async governance(
    @Param("id") id: string,
    @Query("caller_node_id") queryNodeId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const callerNodeId = await this.resolveNodeId(headers, queryNodeId);
    return this.groups.getGovernance(id, callerNodeId);
  }

  @Post("groups/:id/governance")
  updateGovernance(@Param("id") id: string, @Body() body: UpdateGovernanceDto) {
    return this.groups.updateGovernance(id, body);
  }

  @Post("groups/:id/dissolve")
  async dissolve(
    @Param("id") id: string,
    @Query("caller_node_id") queryNodeId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const callerNodeId = await this.resolveNodeId(headers, queryNodeId);
    return this.groups.dissolveGroup(id, callerNodeId);
  }

  @Get("groups/:id/docs/:docId/role-acls")
  async docRoleAcls(
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Query("caller_node_id") queryNodeId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const callerNodeId = await this.resolveNodeId(headers, queryNodeId);
    return this.groups.getDocRoleAcls(id, docId, callerNodeId);
  }

  @Post("groups/:id/join")
  join(@Param("id") id: string, @Body() body: JoinGroupDto) {
    return this.groups.joinGroup(id, body);
  }

  @Post("groups/:id/invitations")
  invite(
    @Param("id") id: string,
    @Query("inviter_node_id") inviterNodeId: string,
    @Body() body: CreateInvitationDto,
  ) {
    return this.groups.createInvitation(id, inviterNodeId, body);
  }

  @Get("users/me/invitations")
  async listInvitations(
    @Query("node_id") queryNodeId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const nodeId = await this.resolveNodeId(headers, queryNodeId);
    return this.groups.listInvitations(nodeId);
  }

  @Post("invitations/:invitationId/accept")
  accept(@Param("invitationId") invitationId: string, @Body() body: JoinGroupDto) {
    return this.groups.acceptInvitation(invitationId, body);
  }

  @Post("invitations/:invitationId/reject")
  async reject(
    @Param("invitationId") invitationId: string,
    @Query("node_id") queryNodeId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const nodeId = await this.resolveNodeId(headers, queryNodeId);
    return this.groups.rejectInvitation(invitationId, nodeId);
  }


  @Get("groups/:id/docs/:docId/snapshot")
  async getDocSnapshot(
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Query("node_id") queryNodeId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const nodeId = await this.resolveNodeId(headers, queryNodeId);
    return this.docState.getDocSnapshot(id, docId, nodeId);
  }

  @Post("groups/:id/docs/:docId/snapshot")
  async putDocSnapshot(
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Body() body: PutDocSnapshotDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const nodeId = await this.resolveNodeId(headers, body.node_id);
    return this.docState.putDocSnapshot(id, docId, nodeId, body.state_update_base64);
  }

  @Post("groups/:id/jwt/refresh")
  async refreshJwt(
    @Param("id") id: string,
    @Body() body: RefreshJwtDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const nodeId = await this.resolveNodeId(headers, body.node_id);
    return this.groups.refreshJwt(id, { ...body, node_id: nodeId });
  }

  @Post("groups/:id/docs/:docId/rotate-key")
  async rotateKey(
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Query("caller_node_id") queryNodeId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const callerNodeId = await this.resolveNodeId(headers, queryNodeId);
    return this.groups.rotateDocKey(id, callerNodeId, docId);
  }

  @Get("groups/:id/members")
  members(@Param("id") id: string) {
    return this.groups.listMembers(id);
  }

  @Get("groups/:id/tree")
  async tree(
    @Param("id") id: string,
    @Query("node_id") queryNodeId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const nodeId = await this.resolveNodeId(headers, queryNodeId);
    return this.groups.getTree(id, nodeId);
  }

  @Post("groups/:id/rpc")
  async rpc(
    @Param("id") id: string,
    @Query("caller_node_id") queryNodeId: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const callerNodeId = await this.resolveNodeId(headers, queryNodeId);
    return this.groups.operableRpc(id, callerNodeId, body);
  }
}
