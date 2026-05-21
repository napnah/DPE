import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { base64UrlToBytes, bytesToBase64Url, generateDocKey } from "@dpe/crypto";
import { operableRpcSchema } from "@dpe/proto";
import { PrismaService } from "../prisma/prisma.service.js";
import { SigningService } from "../crypto/signing.service.js";
import { ROOT_DOC_ID } from "@dpe/shared";
import {
  canEditDocRoleAcl,
  inheritParentDocAcl,
  resolveAccessLevel,
  resolveMyRolesOnDoc,
  ensureGroupRbac,
  seedGroupRbac,
  syncAllMembersForDocRole,
  syncMemberAllDocs,
  syncMemberDocGrant,
} from "./groups-rbac.js";

function normalizeDisplayName(raw?: string): string {
  const s = (raw ?? "").trim();
  if (s.length < 1 || s.length > 32) {
    throw new BadRequestException("display_name must be 1-32 characters");
  }
  return s;
}

import type {
  CreateGroupDto,
  CreateInvitationDto,
  JoinGroupDto,
  RefreshJwtDto,
  UpdateGovernanceDto,
  UpdateDisplayNameDto,
} from "./groups.dto.js";

@Injectable()
export class GroupsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SigningService) private readonly signing: SigningService,
  ) {}

  async createGroup(dto: CreateGroupDto) {
    const controlMode = dto.control_mode ?? "proxy";
    const issuerPublicKey = this.signing.getIssuerPublicKeyBase64Url();
    const proxyNodeId = controlMode === "proxy" ? this.signing.nodeId : null;
    const proxyPublicKey = controlMode === "proxy" ? issuerPublicKey : null;

    const rootKey = generateDocKey();
    const group = await this.prisma.$transaction(async (tx) => {
      const g = await tx.group.create({
        data: {
          name: dto.name,
          description: dto.description ?? "",
          ownerNodeId: dto.owner_node_id,
          ownerPublicKey: dto.owner_public_key,
          controlMode,
          proxyNodeId,
          proxyPublicKey,
          proxyBaseUrl: dto.proxy_base_url ?? process.env.DPE_PROXY_BASE_URL ?? null,
          issuerNodeId: controlMode === "proxy" ? this.signing.nodeId : dto.owner_node_id,
          issuerPublicKey,
          members: {
            create: {
              nodeId: dto.owner_node_id,
              publicKey: dto.owner_public_key,
              displayName: dto.owner_display_name?.trim()
                ? normalizeDisplayName(dto.owner_display_name)
                : "",
            },
          },
          aclGrants: {
            create: {
              docId: ROOT_DOC_ID,
              nodeId: dto.owner_node_id,
              role: 3,
            },
          },
        },
      });
      await tx.docNode.create({
        data: {
          docId: ROOT_DOC_ID,
          groupId: g.id,
          parentDocId: null,
          title: "根目录",
          isFolder: true,
        },
      });
      await tx.documentKey.create({
        data: {
          groupId: g.id,
          docId: ROOT_DOC_ID,
          keyVersion: 1,
          keyBase64: bytesToBase64Url(rootKey),
        },
      });
      await seedGroupRbac(tx, g.id, dto.owner_node_id);
      return g;
    });

    return {
      group_id: group.id,
      name: group.name,
      control_mode: group.controlMode,
      pk_admin: group.issuerPublicKey,
      issuer_node_id: group.issuerNodeId,
      proxy_base_url: group.proxyBaseUrl,
      invite_code: group.id,
    };
  }

  async joinGroup(groupId: string, dto: JoinGroupDto) {
    const group = await this.requireGroup(groupId);
    const displayName = dto.display_name?.trim()
      ? normalizeDisplayName(dto.display_name)
      : undefined;
    await this.prisma.member.upsert({
      where: { groupId_nodeId: { groupId, nodeId: dto.node_id } },
      create: {
        groupId,
        nodeId: dto.node_id,
        publicKey: dto.public_key,
        displayName: displayName ?? "",
      },
      update: {
        publicKey: dto.public_key,
        leftAt: null,
        ...(displayName ? { displayName } : {}),
      },
    });
    return {
      group_id: group.id,
      pk_admin: group.issuerPublicKey,
      control_mode: group.controlMode,
    };
  }

  async listGroupsForNode(nodeId: string, role: "owner" | "member") {
    if (role === "owner") {
      const rows = await this.prisma.group.findMany({
        where: { ownerNodeId: nodeId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((g) => this.summary(g));
    }
    const memberships = await this.prisma.member.findMany({
      where: { nodeId, leftAt: null },
      include: { group: true },
    });
    return memberships
      .filter((m) => m.group.ownerNodeId !== nodeId)
      .map((m) => this.summary(m.group));
  }

  async createInvitation(groupId: string, inviterNodeId: string, dto: CreateInvitationDto) {
    await this.requireMember(groupId, inviterNodeId);
    const inv = await this.prisma.invitation.create({
      data: {
        groupId,
        inviterNodeId,
        inviteeNodeId: dto.invitee_node_id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    return inv;
  }

  async listInvitations(inviteeNodeId: string) {
    return this.prisma.invitation.findMany({
      where: { inviteeNodeId, status: "pending" },
      include: { group: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async acceptInvitation(invitationId: string, dto: JoinGroupDto) {
    const inv = await this.prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!inv || inv.status !== "pending") throw new NotFoundException("invitation not found");
    if (inv.inviteeNodeId !== dto.node_id) throw new ForbiddenException("not invitee");

    const group = await this.requireGroup(inv.groupId);
    await this.joinGroup(inv.groupId, dto);
    await this.prisma.$transaction((tx) =>
      ensureGroupRbac(tx, inv.groupId, group.ownerNodeId),
    );
    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: "accepted" },
    });
    return { group_id: group.id, pk_admin: group.issuerPublicKey };
  }

  async rejectInvitation(invitationId: string, nodeId: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!inv || inv.status !== "pending") throw new NotFoundException("invitation not found");
    if (inv.inviteeNodeId !== nodeId) throw new ForbiddenException("not invitee");
    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: "rejected" },
    });
    return { ok: true };
  }


  private static readonly MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

  async getDocSnapshot(groupId: string, docId: string, nodeId: string) {
    const group = await this.requireGroup(groupId);
    await this.requireMember(groupId, nodeId);
    const accessLevel = await resolveAccessLevel(
      this.prisma,
      groupId,
      nodeId,
      docId,
      group.ownerNodeId,
    );
    if (accessLevel < 1) {
      throw new ForbiddenException("no access to doc");
    }
    const doc = await this.prisma.docNode.findUnique({
      where: { groupId_docId: { groupId, docId } },
    });
    if (!doc) throw new NotFoundException("doc not found");
    if (doc.isFolder) {
      return { snapshot: null as null };
    }
    const row = await this.prisma.docSnapshot.findUnique({
      where: { groupId_docId: { groupId, docId } },
    });
    if (!row) return { snapshot: null };
    return {
      snapshot: {
        state_update_base64: row.stateBase64,
        key_version: row.keyVersion,
        updated_at: row.updatedAt.toISOString(),
        updated_by_node_id: row.updatedByNodeId,
      },
    };
  }

  async putDocSnapshot(
    groupId: string,
    docId: string,
    nodeId: string,
    stateUpdateBase64: string,
  ) {
    const group = await this.requireGroup(groupId);
    await this.requireMember(groupId, nodeId);
    const accessLevel = await resolveAccessLevel(
      this.prisma,
      groupId,
      nodeId,
      docId,
      group.ownerNodeId,
    );
    if (accessLevel < 2) {
      throw new ForbiddenException("write access required to save snapshot");
    }
    const doc = await this.prisma.docNode.findUnique({
      where: { groupId_docId: { groupId, docId } },
    });
    if (!doc) throw new NotFoundException("doc not found");
    if (doc.isFolder) {
      throw new BadRequestException("folders have no document content");
    }
    let bytes: Uint8Array;
    try {
      bytes = base64UrlToBytes(stateUpdateBase64);
    } catch {
      throw new BadRequestException("invalid state_update_base64");
    }
    if (bytes.length === 0 || bytes.length > GroupsService.MAX_SNAPSHOT_BYTES) {
      throw new BadRequestException("snapshot size out of range");
    }
    await this.prisma.docSnapshot.upsert({
      where: { groupId_docId: { groupId, docId } },
      create: {
        groupId,
        docId,
        keyVersion: doc.keyVersion,
        stateBase64: stateUpdateBase64,
        updatedByNodeId: nodeId,
      },
      update: {
        keyVersion: doc.keyVersion,
        stateBase64: stateUpdateBase64,
        updatedByNodeId: nodeId,
      },
    });
    return { ok: true };
  }

  async refreshJwt(groupId: string, dto: RefreshJwtDto) {
    const group = await this.requireGroup(groupId);
    const member = await this.requireMember(groupId, dto.node_id);

    const accessLevel = await resolveAccessLevel(
      this.prisma,
      groupId,
      dto.node_id,
      dto.doc_id,
      group.ownerNodeId,
    );
    if (accessLevel < 1) {
      throw new ForbiddenException("no access to doc");
    }
    await syncMemberDocGrant(
      this.prisma,
      groupId,
      dto.node_id,
      dto.doc_id,
      accessLevel,
    );

    const doc = await this.prisma.docNode.findUnique({
      where: { groupId_docId: { groupId, docId: dto.doc_id } },
    });
    if (!doc) throw new NotFoundException("doc not found");

    const keyRow = await this.prisma.documentKey.findUnique({
      where: {
        groupId_docId_keyVersion: {
          groupId,
          docId: dto.doc_id,
          keyVersion: doc.keyVersion,
        },
      },
    });
    if (!keyRow) throw new NotFoundException("doc key not found");
    const docKey = base64UrlToBytes(keyRow.keyBase64);
    const docKeyEnc = await this.signing.sealDocKeyForMember(member.publicKey, docKey);

    const token = await this.signing.issueJwt({
      iss: this.signing.resolveIssuer(group),
      sub: dto.node_id,
      aud: groupId,
      doc_id: dto.doc_id,
      role: accessLevel,
      doc_key: docKeyEnc,
      key_version: doc.keyVersion,
    });

    return { jwt: token, key_version: doc.keyVersion, role: accessLevel };
  }

  async rotateDocKey(groupId: string, callerNodeId: string, docId: string) {
    await this.requireOperable(groupId, callerNodeId, docId);
    const doc = await this.prisma.docNode.findUnique({
      where: { groupId_docId: { groupId, docId } },
    });
    if (!doc) throw new NotFoundException("doc not found");

    const newVersion = doc.keyVersion + 1;
    const newKey = generateDocKey();
    await this.prisma.$transaction(async (tx) => {
      await tx.docNode.update({
        where: { groupId_docId: { groupId, docId } },
        data: { keyVersion: newVersion },
      });
      await tx.documentKey.create({
        data: {
          groupId,
          docId,
          keyVersion: newVersion,
          keyBase64: bytesToBase64Url(newKey),
        },
      });
      await tx.keyRotationEvent.create({
        data: {
          groupId,
          docId,
          keyVersion: newVersion,
          payloadJson: JSON.stringify({ doc_id: docId, key_version: newVersion }),
        },
      });
    });
    return { ok: true, doc_id: docId, key_version: newVersion };
  }

  async listMembers(groupId: string) {
    const rows = await this.prisma.member.findMany({
      where: { groupId, leftAt: null },
      orderBy: { joinedAt: "asc" },
    });
    return {
      members: rows.map((m) => ({
        node_id: m.nodeId,
        public_key: m.publicKey,
        display_name: m.displayName,
      })),
    };
  }

  async getTree(groupId: string, nodeId: string) {
    await this.requireMember(groupId, nodeId);
    const group = await this.requireGroup(groupId);
    const allDocs = await this.prisma.docNode.findMany({ where: { groupId } });
    const visible = new Set<string>();
    for (const d of allDocs) {
      const level = await resolveAccessLevel(
        this.prisma,
        groupId,
        nodeId,
        d.docId,
        group.ownerNodeId,
      );
      if (level >= 1) visible.add(d.docId);
    }
    const nodes = await this.prisma.docNode.findMany({
      where: { groupId, docId: { in: [...visible] } },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    });
    return {
      nodes: nodes.map((n) => ({
        docId: n.docId,
        parentDocId: n.parentDocId,
        title: n.title,
        keyVersion: n.keyVersion,
        isFolder: n.isFolder || n.docId === ROOT_DOC_ID,
      })),
    };
  }

  async operableRpc(groupId: string, callerNodeId: string, body: unknown) {
    const rpc = operableRpcSchema.parse(body);

    if (rpc.op === "SetDocRoleAcl") {
      const group = await this.requireGroup(groupId);
      const callerLevel = await resolveAccessLevel(
        this.prisma,
        groupId,
        callerNodeId,
        rpc.doc_id,
        group.ownerNodeId,
      );
      const isOwner = group.ownerNodeId === callerNodeId;
      if (!isOwner && callerLevel < 3) {
        throw new ForbiddenException("operable role required on doc");
      }
      const doc = await this.prisma.docNode.findUnique({
        where: { groupId_docId: { groupId, docId: rpc.doc_id } },
      });
      if (!doc) throw new NotFoundException("doc not found");
      const role = await this.prisma.groupRole.findFirst({
        where: { id: rpc.group_role_id, groupId },
      });
      if (!role) throw new NotFoundException("group role not found");
      const existing = await this.prisma.docRoleAcl.findUnique({
        where: {
          groupId_docId_roleId: {
            groupId,
            docId: rpc.doc_id,
            roleId: rpc.group_role_id,
          },
        },
      });
      const targetLevel = existing?.accessLevel ?? 0;
      if (!canEditDocRoleAcl(isOwner, callerLevel, targetLevel)) {
        throw new ForbiddenException("cannot change ACL for operable-level roles");
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.docRoleAcl.upsert({
          where: {
            groupId_docId_roleId: {
              groupId,
              docId: rpc.doc_id,
              roleId: rpc.group_role_id,
            },
          },
          create: {
            groupId,
            docId: rpc.doc_id,
            roleId: rpc.group_role_id,
            accessLevel: rpc.access_level,
          },
          update: { accessLevel: rpc.access_level },
        });
        await syncAllMembersForDocRole(
          tx,
          groupId,
          rpc.doc_id,
          rpc.group_role_id,
          rpc.access_level,
        );
      });
      return { ok: true };
    }

    if (rpc.op === "SetACL") {
      throw new BadRequestException("use SetDocRoleAcl — document ACL is per group role");
    }

    if (rpc.op === "CreateChild") {
      if (rpc.doc_id === ROOT_DOC_ID) {
        throw new BadRequestException("doc_id cannot be root");
      }
      await this.requireOperable(groupId, callerNodeId, rpc.parent_doc_id);
      const parent = await this.prisma.docNode.findUnique({
        where: { groupId_docId: { groupId, docId: rpc.parent_doc_id } },
      });
      if (!parent) throw new NotFoundException("parent doc not found");
      const parentIsFolder = parent.isFolder || parent.docId === ROOT_DOC_ID;
      if (!parentIsFolder) {
        throw new BadRequestException("parent must be a folder");
      }
      const isFolder = rpc.is_folder ?? false;
      const newKey = generateDocKey();
      await this.prisma.docNode.create({
        data: {
          docId: rpc.doc_id,
          groupId,
          parentDocId: rpc.parent_doc_id,
          title: rpc.title ?? (isFolder ? "未命名目录" : "Untitled"),
          isFolder,
        },
      });
      await this.prisma.documentKey.create({
        data: {
          groupId,
          docId: rpc.doc_id,
          keyVersion: 1,
          keyBase64: bytesToBase64Url(newKey),
        },
      });
      const group = await this.requireGroup(groupId);
      await this.prisma.$transaction(async (tx) => {
        await inheritParentDocAcl(
          tx,
          groupId,
          rpc.parent_doc_id,
          rpc.doc_id,
          group.ownerNodeId,
        );
      });
      return { ok: true, doc_id: rpc.doc_id };
    }

    if (rpc.op === "RenameDoc") {
      if (rpc.doc_id === ROOT_DOC_ID) {
        throw new BadRequestException("cannot rename root folder");
      }
      await this.requireOperable(groupId, callerNodeId, rpc.doc_id);
      const title = rpc.title.trim();
      if (!title) throw new BadRequestException("title required");
      await this.prisma.docNode.update({
        where: { groupId_docId: { groupId, docId: rpc.doc_id } },
        data: { title },
      });
      return { ok: true };
    }

    if (rpc.op === "DeleteDoc") {
      if (rpc.doc_id === ROOT_DOC_ID) {
        throw new BadRequestException("cannot delete root folder");
      }
      await this.requireOperable(groupId, callerNodeId, rpc.doc_id);
      const childCount = await this.prisma.docNode.count({
        where: { groupId, parentDocId: rpc.doc_id },
      });
      if (childCount > 0) {
        throw new BadRequestException("folder is not empty");
      }
      await this.prisma.$transaction([
        this.prisma.docRoleAcl.deleteMany({ where: { groupId, docId: rpc.doc_id } }),
        this.prisma.aclGrant.deleteMany({ where: { groupId, docId: rpc.doc_id } }),
        this.prisma.docNode.delete({
          where: { groupId_docId: { groupId, docId: rpc.doc_id } },
        }),
      ]);
      return { ok: true };
    }

    throw new BadRequestException("unknown rpc");
  }


  async listAllGroupsForNode(nodeId: string) {
    const owned = await this.prisma.group.findMany({
      where: { ownerNodeId: nodeId },
      orderBy: { createdAt: "desc" },
    });
    const memberships = await this.prisma.member.findMany({
      where: { nodeId, leftAt: null },
      include: { group: true },
    });
    const seen = new Set<string>();
    const out: Awaited<ReturnType<typeof this.groupCard>>[] = [];
    for (const g of owned) {
      seen.add(g.id);
      out.push(await this.groupCard(g, nodeId, true));
    }
    for (const m of memberships) {
      if (seen.has(m.groupId) || m.group.ownerNodeId === nodeId) continue;
      seen.add(m.groupId);
      out.push(await this.groupCard(m.group, nodeId, false));
    }
    return out;
  }

  async updateMemberDisplayName(nodeId: string, displayName: string) {
    const name = normalizeDisplayName(displayName);
    await this.prisma.member.updateMany({
      where: { nodeId, leftAt: null },
      data: { displayName: name },
    });
    return { ok: true, display_name: name };
  }

  async getGovernance(groupId: string, callerNodeId: string) {
    const group = await this.requireGroup(groupId);
    await this.prisma.$transaction((tx) => ensureGroupRbac(tx, groupId, group.ownerNodeId));
    await this.requireMember(groupId, callerNodeId);
    if (group.ownerNodeId !== callerNodeId) {
      throw new ForbiddenException("only group owner may view governance settings");
    }
    const roles = await this.prisma.groupRole.findMany({
      where: { groupId },
      orderBy: { sortOrder: "asc" },
    });
    const assignments = await this.prisma.memberRoleAssignment.findMany({
      where: { groupId },
    });
    const rules = await this.prisma.groupDefaultRules.findUnique({ where: { groupId } });
    const members = await this.prisma.member.findMany({
      where: { groupId, leftAt: null },
      orderBy: { joinedAt: "asc" },
    });
    return {
      group_id: groupId,
      name: group.name,
      description: group.description,
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        color: r.color,
        is_builtin: r.isBuiltin,
      })),
      assignments: assignments.map((a) => ({
        node_id: a.nodeId,
        role_id: a.roleId,
      })),
      default_rules: rules
        ? {
            default_member_role_id: rules.defaultMemberRoleId,
            create_child_template: rules.createChildTemplate as Record<string, number>,
          }
        : null,
      members: members.map((m) => ({
        node_id: m.nodeId,
        public_key: m.publicKey,
        display_name: m.displayName,
      })),
    };
  }

  async dissolveGroup(groupId: string, callerNodeId: string) {
    const group = await this.requireGroup(groupId);
    if (group.ownerNodeId !== callerNodeId) {
      throw new ForbiddenException("only group owner may dissolve the group");
    }
    await this.prisma.group.delete({ where: { id: groupId } });
    return { ok: true };
  }

  async updateGovernance(groupId: string, dto: UpdateGovernanceDto) {
    const group = await this.requireGroup(groupId);
    if (group.ownerNodeId !== dto.caller_node_id) {
      throw new ForbiddenException("only group owner may update governance");
    }
    await this.prisma.$transaction(async (tx) => {
      if (dto.default_member_role_id || dto.create_child_template) {
        const rules = await tx.groupDefaultRules.findUnique({ where: { groupId } });
        if (!rules) throw new NotFoundException("default rules not found");
        await tx.groupDefaultRules.update({
          where: { groupId },
          data: {
            ...(dto.default_member_role_id
              ? { defaultMemberRoleId: dto.default_member_role_id }
              : {}),
            ...(dto.create_child_template
              ? { createChildTemplate: dto.create_child_template }
              : {}),
          },
        });
      }
      if (dto.delete_role_ids?.length) {
        for (const roleId of dto.delete_role_ids) {
          const role = await tx.groupRole.findFirst({ where: { id: roleId, groupId } });
          if (!role) throw new NotFoundException(`role not found: ${roleId}`);
          if (role.isBuiltin) {
            throw new BadRequestException(`cannot delete builtin role: ${role.slug}`);
          }

          const affected = await tx.memberRoleAssignment.findMany({
            where: { groupId, roleId },
          });

          await tx.memberRoleAssignment.deleteMany({ where: { groupId, roleId } });
          await tx.docRoleAcl.deleteMany({ where: { groupId, roleId } });

          const rules = await tx.groupDefaultRules.findUnique({ where: { groupId } });
          if (rules) {
            const tpl = { ...(rules.createChildTemplate as Record<string, number>) };
            delete tpl[roleId];
            let defaultMemberRoleId = rules.defaultMemberRoleId;
            if (defaultMemberRoleId === roleId) {
              const reader = await tx.groupRole.findFirst({
                where: { groupId, slug: "reader" },
              });
              if (!reader) {
                throw new BadRequestException("no fallback role for default member");
              }
              defaultMemberRoleId = reader.id;
            }
            await tx.groupDefaultRules.update({
              where: { groupId },
              data: {
                defaultMemberRoleId,
                createChildTemplate: tpl,
              },
            });
          }

          await tx.groupRole.delete({ where: { id: roleId } });

          const seen = new Set<string>();
          for (const a of affected) {
            if (seen.has(a.nodeId)) continue;
            seen.add(a.nodeId);
            if (a.nodeId === group.ownerNodeId) continue;
            const remaining = await tx.memberRoleAssignment.count({
              where: { groupId, nodeId: a.nodeId },
            });
            if (remaining === 0) {
              await tx.aclGrant.deleteMany({ where: { groupId, nodeId: a.nodeId } });
            } else {
              await syncMemberAllDocs(tx, groupId, a.nodeId, group.ownerNodeId);
            }
          }
        }
      }
      if (dto.create_roles?.length) {
        const maxSort = await tx.groupRole.aggregate({
          where: { groupId },
          _max: { sortOrder: true },
        });
        let sort = (maxSort._max.sortOrder ?? 0) + 1;
        for (const cr of dto.create_roles) {
          const base = (cr.slug ?? cr.name)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "");
          const slug = base || `role-${sort}`;
          await tx.groupRole.create({
            data: {
              groupId,
              name: cr.name.trim(),
              slug: `${slug}-${sort}`,
              color: cr.color ?? "#8250df",
              sortOrder: sort++,
              isBuiltin: false,
            },
          });
        }
      }
      const memberRoleUpdates = dto.member_roles?.length
        ? dto.member_roles
        : dto.assignments?.map((a) => ({ node_id: a.node_id, role_ids: [a.role_id] }));
      if (memberRoleUpdates?.length) {
        for (const m of memberRoleUpdates) {
          await tx.memberRoleAssignment.deleteMany({
            where: { groupId, nodeId: m.node_id },
          });
          for (const roleId of m.role_ids) {
            await tx.memberRoleAssignment.create({
              data: { groupId, nodeId: m.node_id, roleId },
            });
          }
          await syncMemberAllDocs(tx, groupId, m.node_id, group.ownerNodeId);
        }
      }
      if (dto.roles) {
        for (const r of dto.roles) {
          if (!r.id) continue;
          await tx.groupRole.update({
            where: { id: r.id },
            data: {
              ...(r.name ? { name: r.name } : {}),
              ...(r.color ? { color: r.color } : {}),
            },
          });
        }
      }
    });
    return { ok: true };
  }

  async getDocRoleAcls(groupId: string, docId: string, callerNodeId: string) {
    const group = await this.requireGroup(groupId);
    await this.requireMember(groupId, callerNodeId);
    const level = await resolveAccessLevel(
      this.prisma,
      groupId,
      callerNodeId,
      docId,
      group.ownerNodeId,
    );
    if (level < 1) throw new ForbiddenException("no access to doc");
    const rows = await this.prisma.docRoleAcl.findMany({
      where: { groupId, docId },
    });
    const roles = await this.prisma.groupRole.findMany({
      where: { groupId },
      orderBy: { sortOrder: "asc" },
    });
    const byRole = Object.fromEntries(rows.map((r) => [r.roleId, r.accessLevel]));
    const isOwner = group.ownerNodeId === callerNodeId;
    const my_roles = await resolveMyRolesOnDoc(
      this.prisma,
      groupId,
      callerNodeId,
      docId,
      group.ownerNodeId,
    );
    return {
      doc_id: docId,
      my_access_level: level,
      my_roles,
      can_manage_acl: isOwner || level >= 3,
      roles: roles.map((r) => {
        const access_level = byRole[r.id] ?? 0;
        return {
          id: r.id,
          name: r.name,
          color: r.color,
          access_level,
          acl_editable: canEditDocRoleAcl(isOwner, level, access_level),
        };
      }),
    };
  }

  private async groupCard(
    g: {
      id: string;
      name: string;
      description: string;
      controlMode: string;
      ownerNodeId: string;
      proxyBaseUrl: string | null;
      createdAt: Date;
    },
    nodeId: string,
    isOwner: boolean,
  ) {
    if (isOwner) {
      return {
        group_id: g.id,
        name: g.name,
        description: g.description,
        control_mode: g.controlMode,
        owner_node_id: g.ownerNodeId,
        proxy_base_url: g.proxyBaseUrl,
        created_at: g.createdAt,
        is_owner: true,
        my_role_name: "群主",
        my_role_color: "#9a6700",
      };
    }
    const assignments = await this.prisma.memberRoleAssignment.findMany({
      where: { groupId: g.id, nodeId },
    });
    const roleRows = assignments.length
      ? await this.prisma.groupRole.findMany({
          where: { id: { in: assignments.map((a) => a.roleId) } },
          orderBy: { sortOrder: "asc" },
        })
      : [];
    const my_role_name = roleRows.length
      ? roleRows.map((r) => r.name).join(" · ")
      : "成员";
    const my_role_color = roleRows[0]?.color ?? "#656d76";
    return {
      group_id: g.id,
      name: g.name,
      description: g.description,
      control_mode: g.controlMode,
      owner_node_id: g.ownerNodeId,
      proxy_base_url: g.proxyBaseUrl,
      created_at: g.createdAt,
      is_owner: false,
      my_role_name,
      my_role_color,
      my_roles: roleRows.map((r) => ({ name: r.name, color: r.color })),
    };
  }

  private summary(g: {
    id: string;
    name: string;
    controlMode: string;
    ownerNodeId: string;
    proxyBaseUrl: string | null;
    createdAt: Date;
  }) {
    return {
      group_id: g.id,
      name: g.name,
      control_mode: g.controlMode,
      owner_node_id: g.ownerNodeId,
      proxy_base_url: g.proxyBaseUrl,
      created_at: g.createdAt,
    };
  }

  private async requireGroup(groupId: string) {
    const g = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!g) throw new NotFoundException("group not found");
    return g;
  }

  private async requireMember(groupId: string, nodeId: string) {
    const m = await this.prisma.member.findUnique({
      where: { groupId_nodeId: { groupId, nodeId } },
    });
    if (!m || m.leftAt) throw new ForbiddenException("not a member");
    return m;
  }

  private async requireOperable(groupId: string, nodeId: string, docId: string) {
    const group = await this.requireGroup(groupId);
    const level = await resolveAccessLevel(
      this.prisma,
      groupId,
      nodeId,
      docId,
      group.ownerNodeId,
    );
    if (level < 3) throw new ForbiddenException("operable role required");
    return { role: level };
  }
}
