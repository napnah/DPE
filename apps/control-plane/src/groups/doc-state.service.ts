import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { base64UrlToBytes } from "@dpe/crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { resolveAccessLevel } from "./groups-rbac.js";
import { SnapshotCacheService } from "./snapshot-cache.service.js";

@Injectable()
export class DocStateService {
  private static readonly MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: SnapshotCacheService,
  ) {}

  private async requireGroup(groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException("group not found");
    return group;
  }

  private async requireMember(groupId: string, nodeId: string) {
    const member = await this.prisma.member.findUnique({
      where: { groupId_nodeId: { groupId, nodeId } },
    });
    if (!member || member.leftAt) throw new ForbiddenException("not a member");
    return member;
  }

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
    if (accessLevel < 1) throw new ForbiddenException("no access to doc");

    const doc = await this.prisma.docNode.findUnique({
      where: { groupId_docId: { groupId, docId } },
    });
    if (!doc) throw new NotFoundException("doc not found");
    if (doc.isFolder) return { snapshot: null as null };

    const cached = await this.cache.get(groupId, docId);
    if (cached) return { snapshot: cached };

    const row = await this.prisma.docState.findUnique({
      where: { groupId_docId: { groupId, docId } },
    });
    if (!row) return { snapshot: null };
    const payload = {
      state_update_base64: row.stateBase64,
      key_version: row.keyVersion,
      updated_at: row.updatedAt.toISOString(),
      updated_by_node_id: row.updatedByNodeId,
    };
    await this.cache.set(groupId, docId, payload);
    return { snapshot: payload };
  }

  async putDocSnapshot(groupId: string, docId: string, nodeId: string, stateUpdateBase64: string) {
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
    if (doc.isFolder) throw new BadRequestException("folders have no document content");

    let bytes: Uint8Array;
    try {
      bytes = base64UrlToBytes(stateUpdateBase64);
    } catch {
      throw new BadRequestException("invalid state_update_base64");
    }
    if (bytes.length === 0 || bytes.length > DocStateService.MAX_SNAPSHOT_BYTES) {
      throw new BadRequestException("snapshot size out of range");
    }

    await this.prisma.docState.upsert({
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
    await this.cache.del(groupId, docId);
    return { ok: true };
  }
}
