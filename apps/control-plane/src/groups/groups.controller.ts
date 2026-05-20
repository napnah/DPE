import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { GroupsService } from "./groups.service.js";
import type { CreateGroupDto, CreateInvitationDto, JoinGroupDto, RefreshJwtDto } from "./groups.dto.js";

@Controller()
export class GroupsController {
  constructor(@Inject(GroupsService) private readonly groups: GroupsService) {}

  @Post("groups")
  createGroup(@Body() body: CreateGroupDto) {
    return this.groups.createGroup(body);
  }

  @Get("users/me/groups")
  listMyGroups(
    @Query("node_id") nodeId: string,
    @Query("role") role: "owner" | "member",
  ) {
    return this.groups.listGroupsForNode(nodeId, role ?? "member");
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
  listInvitations(@Query("node_id") nodeId: string) {
    return this.groups.listInvitations(nodeId);
  }

  @Post("invitations/:invitationId/accept")
  accept(@Param("invitationId") invitationId: string, @Body() body: JoinGroupDto) {
    return this.groups.acceptInvitation(invitationId, body);
  }

  @Post("invitations/:invitationId/reject")
  reject(
    @Param("invitationId") invitationId: string,
    @Query("node_id") nodeId: string,
  ) {
    return this.groups.rejectInvitation(invitationId, nodeId);
  }

  @Post("groups/:id/jwt/refresh")
  refreshJwt(@Param("id") id: string, @Body() body: RefreshJwtDto) {
    return this.groups.refreshJwt(id, body);
  }

  @Post("groups/:id/docs/:docId/rotate-key")
  rotateKey(
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Query("caller_node_id") callerNodeId: string,
  ) {
    return this.groups.rotateDocKey(id, callerNodeId, docId);
  }

  @Get("groups/:id/members")
  members(@Param("id") id: string) {
    return this.groups.listMembers(id);
  }

  @Get("groups/:id/tree")
  tree(@Param("id") id: string, @Query("node_id") nodeId: string) {
    return this.groups.getTree(id, nodeId);
  }

  @Post("groups/:id/rpc")
  rpc(
    @Param("id") id: string,
    @Query("caller_node_id") callerNodeId: string,
    @Body() body: unknown,
  ) {
    return this.groups.operableRpc(id, callerNodeId, body);
  }
}
