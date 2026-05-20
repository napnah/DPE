import { z } from "zod";

export const roleSchema = z.number().int().min(0).max(3);

export const setAclRpcSchema = z.object({
  op: z.literal("SetACL"),
  user_node_id: z.string(),
  doc_id: z.string(),
  role: roleSchema,
});

export const setDocRoleAclRpcSchema = z.object({
  op: z.literal("SetDocRoleAcl"),
  doc_id: z.string(),
  group_role_id: z.string(),
  access_level: roleSchema,
});

export const createChildRpcSchema = z.object({
  op: z.literal("CreateChild"),
  parent_doc_id: z.string(),
  doc_id: z.string(),
  title: z.string().optional(),
  /** When true, creates a folder (no Yjs editor); children may be nested under it. */
  is_folder: z.boolean().optional(),
});

export const deleteDocRpcSchema = z.object({
  op: z.literal("DeleteDoc"),
  doc_id: z.string(),
});

export const operableRpcSchema = z.discriminatedUnion("op", [
  setAclRpcSchema,
  setDocRoleAclRpcSchema,
  createChildRpcSchema,
  deleteDocRpcSchema,
]);

export type OperableRpc = z.infer<typeof operableRpcSchema>;
