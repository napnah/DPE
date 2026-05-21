import { afterEach, describe, expect, it, vi } from "vitest";
import { aesGcmDecrypt, aesGcmEncrypt, generateDocKey, generateNonce } from "./aes-gcm.js";

describe("aes-gcm insecure context", () => {
  const subtle = globalThis.crypto.subtle;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (subtle) Object.defineProperty(globalThis.crypto, "subtle", { value: subtle, configurable: true });
  });

  it("decrypts when crypto exists but subtle is undefined (LAN HTTP)", async () => {
    Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
    Object.defineProperty(globalThis.crypto, "subtle", {
      value: undefined,
      configurable: true,
    });

    const key = generateDocKey();
    const nonce = generateNonce();
    const plain = new TextEncoder().encode("dpe-doc");
    const ct = await aesGcmEncrypt(key, nonce, plain);
    const out = await aesGcmDecrypt(key, nonce, ct);
    expect(new TextDecoder().decode(out)).toBe("dpe-doc");
  });
});
