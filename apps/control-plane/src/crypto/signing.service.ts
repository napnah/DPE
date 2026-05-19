import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  deriveNodeId,
  generateNodeKeyPair,
  sealDocKeyForEd25519,
  signJwt,
} from "@dpe/crypto";
import type { JwtPayload } from "@dpe/proto";

@Injectable()
export class SigningService implements OnModuleInit {
  private privateKey!: Uint8Array;
  private publicKey!: Uint8Array;
  nodeId!: string;

  async onModuleInit() {
    const priv = process.env.DPE_SIGNING_PRIVATE_KEY;
    const pub = process.env.DPE_SIGNING_PUBLIC_KEY;
    if (priv && pub) {
      this.privateKey = base64UrlToBytes(priv);
      this.publicKey = base64UrlToBytes(pub);
    } else {
      const pair = await generateNodeKeyPair();
      this.privateKey = pair.privateKey;
      this.publicKey = pair.publicKey;
      console.warn(
        "[control-plane] DPE_SIGNING_* not set; generated ephemeral issuer keys. NodeID:",
        pair.nodeId,
      );
    }
    this.nodeId = deriveNodeId(this.publicKey);
  }

  getIssuerPublicKeyBase64Url(): string {
    return bytesToBase64Url(this.publicKey);
  }

  resolveIssuer(group: {
    controlMode: string;
    ownerNodeId: string;
    proxyNodeId: string | null;
    issuerNodeId: string;
  }): string {
    if (group.controlMode === "proxy" && group.proxyNodeId) {
      return group.proxyNodeId;
    }
    return group.ownerNodeId;
  }

  pinnedAdminPublicKey(group: {
    controlMode: string;
    ownerPublicKey: string;
    proxyPublicKey: string | null;
  }): string {
    if (group.controlMode === "proxy" && group.proxyPublicKey) {
      return group.proxyPublicKey;
    }
    return group.ownerPublicKey;
  }

  async issueJwt(
    payload: Omit<JwtPayload, "iat" | "exp" | "jti"> & { ttlSec?: number },
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const ttl = payload.ttlSec ?? 3600;
    const full: JwtPayload = {
      iss: payload.iss,
      sub: payload.sub,
      aud: payload.aud,
      doc_id: payload.doc_id,
      role: payload.role,
      doc_key: payload.doc_key,
      key_version: payload.key_version,
      iat: now,
      exp: now + ttl,
      jti: crypto.randomUUID(),
    };
    return signJwt(full, this.privateKey, this.publicKey);
  }

  async sealDocKeyForMember(
    recipientPublicKeyBase64Url: string,
    docKey: Uint8Array,
  ): Promise<string> {
    const pk = base64UrlToBytes(recipientPublicKeyBase64Url);
    return sealDocKeyForEd25519(pk, docKey);
  }
}
