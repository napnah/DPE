import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/hashes/utils";
import { bytesToBase64Url, base64UrlToBytes } from "./encoding.js";

const NONCE_LENGTH = 12;
const KEY_LENGTH = 32;

export function generateDocKey(): Uint8Array {
  return randomBytes(KEY_LENGTH);
}

export function generateNonce(): Uint8Array {
  return randomBytes(NONCE_LENGTH);
}

/** True only when SubtleCrypto is actually usable (not merely `undefined != null`). */
function hasWebCryptoSubtle(): boolean {
  return typeof globalThis.crypto?.subtle?.importKey === "function";
}

function isBrowserRuntime(): boolean {
  return typeof globalThis.window !== "undefined" || typeof globalThis.document !== "undefined";
}

function useNobleAes(): boolean {
  // LAN http://192.168.x.x often has crypto but no subtle; always noble in browsers.
  if (isBrowserRuntime()) return true;
  return !hasWebCryptoSubtle();
}

function aesGcmEncryptNoble(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array {
  if (key.length !== KEY_LENGTH) throw new Error("AES-256-GCM requires 32-byte key");
  if (nonce.length !== NONCE_LENGTH) throw new Error("AES-GCM requires 12-byte nonce");
  return gcm(key, nonce).encrypt(plaintext);
}

function aesGcmDecryptNoble(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  if (key.length !== KEY_LENGTH) throw new Error("AES-256-GCM requires 32-byte key");
  if (nonce.length !== NONCE_LENGTH) throw new Error("AES-GCM requires 12-byte nonce");
  return gcm(key, nonce).decrypt(ciphertext);
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  return subtle.importKey("raw", asBufferSource(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function aesGcmEncrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  if (useNobleAes()) return aesGcmEncryptNoble(key, nonce, plaintext);
  const cryptoKey = await importAesKey(key);
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(nonce) },
    cryptoKey,
    asBufferSource(plaintext),
  );
  return new Uint8Array(ct);
}

export async function aesGcmDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  if (useNobleAes()) return aesGcmDecryptNoble(key, nonce, ciphertext);
  const cryptoKey = await importAesKey(key);
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(nonce) },
    cryptoKey,
    asBufferSource(ciphertext),
  );
  return new Uint8Array(pt);
}

export async function encryptToBase64Url(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
): Promise<string> {
  return bytesToBase64Url(await aesGcmEncrypt(key, nonce, plaintext));
}

export async function decryptFromBase64Url(
  key: Uint8Array,
  nonceBase64Url: string,
  ciphertextBase64Url: string,
): Promise<Uint8Array> {
  return aesGcmDecrypt(key, base64UrlToBytes(nonceBase64Url), base64UrlToBytes(ciphertextBase64Url));
}
