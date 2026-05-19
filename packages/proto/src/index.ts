import { z } from "zod";

export const authEnvelopeSchema = z.object({
  type: z.literal("auth"),
  node_id: z.string(),
  jwt: z.string(),
  proof: z.string().optional(),
});

export type AuthEnvelope = z.infer<typeof authEnvelopeSchema>;