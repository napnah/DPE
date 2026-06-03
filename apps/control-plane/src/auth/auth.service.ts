import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import * as argon2 from "argon2";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  deriveNodeId,
  generateNodeKeyPair,
} from "@dpe/crypto";
import type { LoginDto, RegisterDto } from "./auth.dto.js";

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

type SessionRecord = {
  userId: string;
  userKeyId: string;
  username: string;
  nodeId: string;
  publicKey: string;
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private validateUsername(raw: string): string {
    const v = raw.trim();
    if (v.length < 3 || v.length > 32) {
      throw new BadRequestException("username must be 3-32 chars");
    }
    if (!/^[a-zA-Z0-9_\-.]+$/.test(v)) {
      throw new BadRequestException("username contains unsupported chars");
    }
    return v.toLowerCase();
  }

  private validatePassword(raw: string): string {
    if (raw.length < 8 || raw.length > 128) {
      throw new BadRequestException("password must be 8-128 chars");
    }
    return raw;
  }

  private normalizeDisplayName(name?: string): string {
    const trimmed = (name ?? "").trim();
    if (trimmed.length === 0) return "未命名用户";
    if (trimmed.length > 32) {
      throw new BadRequestException("display name too long");
    }
    return trimmed;
  }

  private encryptPrivateKey(privateKey: Uint8Array, password: string): {
    cipher: string;
    salt: string;
    iv: string;
    tag: string;
  } {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(password, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(privateKey), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      cipher: bytesToBase64Url(encrypted),
      salt: bytesToBase64Url(salt),
      iv: bytesToBase64Url(iv),
      tag: bytesToBase64Url(tag),
    };
  }

  private decryptPrivateKey(
    cipherB64: string,
    password: string,
    saltB64: string,
    ivB64: string,
    tagB64: string,
  ): string {
    const key = scryptSync(password, base64UrlToBytes(saltB64), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, base64UrlToBytes(ivB64));
    decipher.setAuthTag(Buffer.from(base64UrlToBytes(tagB64)));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(base64UrlToBytes(cipherB64))),
      decipher.final(),
    ]);
    return bytesToBase64Url(new Uint8Array(decrypted));
  }

  private createSessionToken(): { token: string; tokenHash: string; expiresAt: Date } {
    const token = bytesToBase64Url(randomBytes(32));
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    return { token, tokenHash, expiresAt };
  }

  private async issueSession(
    payload: SessionRecord,
  ): Promise<{ token: string; expiresAt: string }> {
    const session = this.createSessionToken();
    await this.prisma.userSession.create({
      data: {
        tokenHash: session.tokenHash,
        userId: payload.userId,
        userKeyId: payload.userKeyId,
        expiresAt: session.expiresAt,
      },
    });
    return { token: session.token, expiresAt: session.expiresAt.toISOString() };
  }

  private async getSessionRecord(sessionToken: string): Promise<SessionRecord> {
    const token = sessionToken.trim();
    if (!token) throw new UnauthorizedException("missing auth token");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash },
      include: {
        user: true,
        key: true,
      },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("session expired");
    }
    return {
      userId: session.userId,
      userKeyId: session.userKeyId,
      username: session.user.username,
      nodeId: session.key.nodeId,
      publicKey: session.key.publicKey,
    };
  }

  async register(dto: RegisterDto): Promise<AuthIdentity> {
    const username = this.validateUsername(dto.username);
    const password = this.validatePassword(dto.password);
    const displayName = this.normalizeDisplayName(dto.display_name);

    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) throw new BadRequestException("username already exists");

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    let nodeId: string;
    let publicKey: string;
    let privateKeyBase64: string;

    if (dto.legacy_identity) {
      const legacyNodeId = dto.legacy_identity.node_id.trim();
      const legacyPk = dto.legacy_identity.public_key.trim();
      const derived = deriveNodeId(base64UrlToBytes(legacyPk));
      if (derived !== legacyNodeId) {
        throw new BadRequestException("legacy identity key mismatch");
      }
      nodeId = legacyNodeId;
      publicKey = legacyPk;
      if (!dto.legacy_identity.private_key_base64) {
        throw new BadRequestException("legacy identity missing private key");
      }
      privateKeyBase64 = dto.legacy_identity.private_key_base64.trim();
    } else {
      const pair = await generateNodeKeyPair();
      nodeId = pair.nodeId;
      publicKey = bytesToBase64Url(pair.publicKey);
      privateKeyBase64 = bytesToBase64Url(pair.privateKey);
    }

    const encrypted = this.encryptPrivateKey(base64UrlToBytes(privateKeyBase64), password);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          passwordHash,
        },
      });
      const key = await tx.userKey.create({
        data: {
          userId: user.id,
          nodeId,
          publicKey,
          privateKeyCipher: encrypted.cipher,
          keyEncryptSalt: encrypted.salt,
          keyEncryptIv: encrypted.iv,
          keyEncryptTag: encrypted.tag,
        },
      });
      return { user, key };
    });

    const session = await this.issueSession({
      userId: created.user.id,
      userKeyId: created.key.id,
      username: created.user.username,
      nodeId: created.key.nodeId,
      publicKey: created.key.publicKey,
    });

    return {
      userId: created.user.id,
      username: created.user.username,
      nodeId,
      publicKey,
      privateKeyBase64,
      displayName,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  async login(dto: LoginDto): Promise<AuthIdentity> {
    const username = this.validateUsername(dto.username);
    const password = this.validatePassword(dto.password);
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { keys: { orderBy: { lastUsedAt: "desc" }, take: 1 } },
    });
    if (!user) throw new UnauthorizedException("invalid username or password");
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException("invalid username or password");
    const key = user.keys[0];
    if (!key) throw new NotFoundException("no identity key for user");

    const privateKeyBase64 = this.decryptPrivateKey(
      key.privateKeyCipher,
      password,
      key.keyEncryptSalt,
      key.keyEncryptIv,
      key.keyEncryptTag,
    );

    await this.prisma.userKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    const session = await this.issueSession({
      userId: user.id,
      userKeyId: key.id,
      username: user.username,
      nodeId: key.nodeId,
      publicKey: key.publicKey,
    });

    return {
      userId: user.id,
      username: user.username,
      nodeId: key.nodeId,
      publicKey: key.publicKey,
      privateKeyBase64,
      displayName: user.username,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  async me(sessionToken: string): Promise<{
    user_id: string;
    username: string;
    node_id: string;
    public_key: string;
  }> {
    const s = await this.getSessionRecord(sessionToken);
    return {
      user_id: s.userId,
      username: s.username,
      node_id: s.nodeId,
      public_key: s.publicKey,
    };
  }

  async resolveNodeIdFromSession(sessionToken?: string): Promise<string | null> {
    if (!sessionToken) return null;
    try {
      const s = await this.getSessionRecord(sessionToken);
      return s.nodeId;
    } catch {
      return null;
    }
  }
}
