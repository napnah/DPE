export const DPE_VERSION = "0.1.0";
export type ControlMode = "owner_direct" | "proxy";
export const ROLE = { INVISIBLE: 0, READONLY: 1, WRITABLE: 2, OPERABLE: 3 } as const;

/** Tree root container — folder only, not a Yjs document. */
export const ROOT_DOC_ID = "root";

/** True for root or any tree node marked as folder (directory). */
export function isFolderDoc(node: { docId: string; isFolder?: boolean }): boolean {
  return node.isFolder === true || node.docId === ROOT_DOC_ID;
}

/** Root folder only — prefer {@link isFolderDoc} when tree metadata is available. */
export function isFolderNode(docId: string): boolean {
  return docId === ROOT_DOC_ID;
}