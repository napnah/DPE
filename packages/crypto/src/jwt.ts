import { SignJWT, decodeJwt, importJWK, type JWK } from "jose";
import type { JwtPayload } from "@dpe/proto";
import { jwtPayloadSchema } from "@dpe/proto";
import { ed25519 } from "./noble-ed25519.js";
import { base64UrlToBytes, bytesToBase64Url } from "./encoding.js";

function ed25519ToJwk(publicKey: Uint8Array, privateKey?: Uint8Array): JWK {
  const jwk: JWK = {
    kty: "OKP",
    crv: "Ed25519",
    x: bytesToBase64Url(publicKey),
  };
  if (privateKey) jwk.d = bytesToBase64Url(privateKey);
  return jwk;
}

export async function signJwt(
  payload: JwtPayload,
  adminPrivateKey: Uint8Array,
  adminPublicKey: Uint8Array,
): Promise<string> {
  const parsed = jwtPayloadSchema.parse(payload);
  const key = await importJWK(ed25519ToJwk(adminPublicKey, adminPrivateKey), "EdDSA");
  return new SignJWT({ ...parsed })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .sign(key);
}

/** Decode JWT from control-plane (already authorized via refresh); no signature verify. */
export function parseJwtPayload(token: string): JwtPayload {
  return jwtPayloadSchema.parse(decodeJwt(token));
}

class JwtVerifyError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "JwtVerifyError";
  }
}

/**
 * Pure-JS JWT verification using @noble/curves. Avoids `crypto.subtle`,
 * which is unavailable on non-secure origins (e.g. LAN HTTP), so this works
 * in browser contexts where jose's WebCrypto-backed verify fails.
 */
export async function verifyJwt(
  token: string,
  adminPublicKey: Uint8Array,
  options?: { audience?: string; issuer?: string },
): Promise<JwtPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtVerifyError("malformed jwt");
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(headerB64)),
    ) as { alg?: string; typ?: string };
  } catch {
    throw new JwtVerifyError("bad header");
  }
  if (header.alg !== "EdDSA") {
    throw new JwtVerifyError(`unexpected alg=${header.alg ?? "<none>"}`);
  }

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = base64UrlToBytes(sigB64);
  const ok = ed25519.verify(sig, signingInput, adminPublicKey);
  if (!ok) throw new JwtVerifyError("invalid signature");

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payloadB64)),
    );
  } catch {
    throw new JwtVerifyError("bad payload");
  }

  const payload = jwtPayloadSchema.parse(payloadJson);

  if (options?.audience != null && payload.aud !== options.audience) {
    throw new JwtVerifyError(
      `aud mismatch: got ${payload.aud}, expected ${options.audience}`,
    );
  }
  if (options?.issuer != null && payload.iss !== options.issuer) {
    throw new JwtVerifyError(
      `iss mismatch: got ${payload.iss}, expected ${options.issuer}`,
    );
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < nowSec) {
    throw new JwtVerifyError("expired");
  }

  return payload;
}
