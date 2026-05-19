import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { base64UrlToBytes, utf8ToBytes, verify } from "@dpe/crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { SigningService } from "../crypto/signing.service.js";

@Injectable()
export class GovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: SigningService,
  ) {}

  async enableProxy(
    groupId: string,
    ownerNodeId: string,
    ownerProof: string,
    proxyBaseUrl?: string,
  ) {
    await this.verifyOwner(groupId, ownerNodeId, ownerProof, "enable-proxy");
    const issuerPublicKey = this.signing.getIssuerPublicKeyBase64Url();
    return this.prisma.group.update({
      where: { id: groupId },
      data: {
        controlMode: "proxy",
        proxyNodeId: this.signing.nodeId,
        proxyPublicKey: issuerPublicKey,
        issuerNodeId: this.signing.nodeId,
        issuerPublicKey,
        proxyBaseUrl: proxyBaseUrl ?? undefined,
      },
    });
  }

  async disableProxy(groupId: string, ownerNodeId: string, ownerProof: string) {
    await this.verifyOwner(groupId, ownerNodeId, ownerProof, "disable-proxy");
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    return this.prisma.group.update({
      where: { id: groupId },
      data: {
        controlMode: "owner_direct",
        proxyNodeId: null,
        proxyPublicKey: null,
        issuerNodeId: group.ownerNodeId,
        issuerPublicKey: group.ownerPublicKey,
      },
    });
  }

  private async verifyOwner(
    groupId: string,
    ownerNodeId: string,
    proofBase64Url: string,
    action: string,
  ) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException("group not found");
    if (group.ownerNodeId !== ownerNodeId) throw new ForbiddenException("not owner");
    const message = utf8ToBytes(`${action}||${groupId}||${ownerNodeId}`);
    const pk = base64UrlToBytes(group.ownerPublicKey);
    const sig = base64UrlToBytes(proofBase64Url);
    if (!verify(pk, message, sig)) throw new ForbiddenException("invalid owner proof");
  }
}
