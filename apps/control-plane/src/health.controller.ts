import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return { status: "ok", service: "control-plane" };
  }

  /** Diagnostic: returns whether the control-plane is configured with persistent signing keys. */
  @Get("signer/public-key")
  signerPublicKey() {
    const pub = process.env.DPE_SIGNING_PUBLIC_KEY?.trim() || null;
    const priv = process.env.DPE_SIGNING_PRIVATE_KEY?.trim() || null;
    return {
      public_key: pub,
      from_env: Boolean(pub && priv),
      has_private: Boolean(priv),
      cwd: process.cwd(),
    };
  }
}
