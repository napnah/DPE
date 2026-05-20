import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { assertMonotonicAcl } from "@dpe/acl";
import { base64UrlToBytes, bytesToBase64Url, generateDocKey } from "@dpe/crypto";
import { operableRpcSchema } from "@dpe/proto";
import { PrismaService } from "../prisma/prisma.service.js";
import { SigningService } from "../crypto/signing.service.js";
import type { CreateGroupDto, CreateInvitationDto, JoinGroupDto, RefreshJwtDto } from "./groups.dto.js";

const ROOT_DOC_ID = "root";

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
          title: "Root",
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
    await this.prisma.member.upsert({
      where: { groupId_nodeId: { groupId, nodeId: dto.node_id } },
      create: { groupId, nodeId: dto.node_id, publicKey: dto.public_key },
      update: { publicKey: dto.public_key, leftAt: null },
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

    await this.joinGroup(inv.groupId, dto);
    await this.prisma.aclGrant.upsert({
      where: {
        groupId_docId_nodeId: {
          groupId: inv.groupId,
          docId: ROOT_DOC_ID,
          nodeId: dto.node_id,
        },
      },
      create: {
        groupId: inv.groupId,
        docId: ROOT_DOC_ID,
        nodeId: dto.node_id,
        role: 1,
      },
      update: {},
    });
    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: "accepted" },
    });
    const group = await this.requireGroup(inv.groupId);
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

  async refreshJwt(groupId: string, dto: RefreshJwtDto) {
    const group = await this.requireGroup(groupId);
    const member = await this.requireMember(groupId, dto.node_id);

    const grant = await this.prisma.aclGrant.findUnique({
      where: {
        groupId_docId_nodeId: {
          groupId,
          docId: dto.doc_id,
          nodeId: dto.node_id,
        },
      },
    });
    if (!grant || grant.role === 0) {
      throw new ForbiddenException("no access to doc");
    }

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
      role: grant.role,
      doc_key: docKeyEnc,
      key_version: doc.keyVersion,
    });

    return { jwt: token, key_version: doc.keyVersion, role: grant.role };
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
      })),
    };
  }

  async getTree(groupId: string, nodeId: string) {
    await this.requireMember(groupId, nodeId);
    const grants = await this.prisma.aclGrant.findMany({ where: { groupId, nodeId } });
    const visible = new Set(
      grants.filter((g) => g.role >= 1).map((g) => g.docId),
    );
    const nodes = await this.prisma.docNode.findMany({
      where: { groupId, docId: { in: [...visible] } },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    });
    return { nodes };
  }

  async operableRpc(groupId: string, callerNodeId: string, body: unknown) {
    const rpc = operableRpcSchema.parse(body);

    if (rpc.op === "SetACL") {
      await this.requireOperable(groupId, callerNodeId, rpc.doc_id);
      const parent = await this.prisma.docNode.findUnique({
        where: { groupId_docId: { groupId, docId: rpc.doc_id } },
      });
      if (!parent) throw new NotFoundException("doc not found");
      if (parent.parentDocId) {
        const existing = await this.prisma.aclGrant.findMany({
          where: { groupId, nodeId: rpc.user_node_id },
        });
        const next = existing.filter((g) => g.docId !== rpc.doc_id);
        next.push({
          groupId,
          docId: rpc.doc_id,
          nodeId: rpc.user_node_id,
          role: rpc.role,
          updatedAt: new Date(),
        });
        try {
          assertMonotonicAcl(
            next.map((g) => ({ nodeId: g.nodeId, docId: g.docId, role: g.role as 0 | 1 | 2 | 3 })),
            parent.parentDocId,
            rpc.doc_id,
          );
        } catch (e) {
          throw new BadRequestException(String(e));
        }
      }
      await this.prisma.aclGrant.upsert({
        where: {
          groupId_docId_nodeId: {
            groupId,
            docId: rpc.doc_id,
            nodeId: rpc.user_node_id,
          },
        },
        create: {
          groupId,
          docId: rpc.doc_id,
          nodeId: rpc.user_node_id,
          role: rpc.role,
        },
        update: { role: rpc.role },
      });
      return { ok: true };
    }

    if (rpc.op === "CreateChild") {
      await this.requireOperable(groupId, callerNodeId, rpc.parent_doc_id);
      const newKey = generateDocKey();
      await this.prisma.docNode.create({
        data: {
          docId: rpc.doc_id,
          groupId,
          parentDocId: rpc.parent_doc_id,
          title: rpc.title ?? "Untitled",
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
      await this.prisma.aclGrant.create({
        data: {
          groupId,
          docId: rpc.doc_id,
          nodeId: callerNodeId,
          role: 3,
        },
      });
      return { ok: true, doc_id: rpc.doc_id };
    }

    if (rpc.op === "DeleteDoc") {
      await this.requireOperable(groupId, callerNodeId, rpc.doc_id);
      await this.prisma.docNode.delete({
        where: { groupId_docId: { groupId, docId: rpc.doc_id } },
      });
      await this.prisma.aclGrant.deleteMany({ where: { groupId, docId: rpc.doc_id } });
      return { ok: true };
    }

    throw new BadRequestException("unknown rpc");
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
    const g = await this.prisma.aclGrant.findUnique({
      where: { groupId_docId_nodeId: { groupId, docId, nodeId } },
    });
    if (!g || g.role < 3) throw new ForbiddenException("operable role required");
    return g;
  }
}
