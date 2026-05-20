#!/usr/bin/env node
/**
 * End-to-end API smoke: group lifecycle, invite, CreateChild, SetACL, JWT, tree.
 * Expects control-plane listening (see verify-p6 --live).
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env") });

/**
 * @param {{ controlPlaneUrl?: string }} [opts]
 */
export async function runE2eSmoke(opts = {}) {
  const base = opts.controlPlaneUrl ?? "http://127.0.0.1:3096";
  const cryptoEntry = path.join(root, "packages", "crypto", "dist", "index.js");
  const { generateNodeKeyPair, bytesToBase64Url, parseJwtPayload } = await import(
    new URL(`file:///${cryptoEntry.replace(/\\/g, "/")}`).href,
  );

  const owner = await generateNodeKeyPair();
  const member = await generateNodeKeyPair();
  const childDocId = crypto.randomUUID();

  const createRes = await fetch(`${base}/groups`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "e2e-p6",
      owner_node_id: owner.nodeId,
      owner_public_key: bytesToBase64Url(owner.publicKey),
      control_mode: "proxy",
    }),
  });
  if (!createRes.ok) throw new Error(`create group: ${createRes.status} ${await createRes.text()}`);
  const created = await createRes.json();
  const groupId = created.group_id;
  if (!groupId || !created.pk_admin) throw new Error("invalid create response");

  const invRes = await fetch(`${base}/groups/${groupId}/invitations?inviter_node_id=${owner.nodeId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invitee_node_id: member.nodeId }),
  });
  if (!invRes.ok) throw new Error(`create invitation: ${invRes.status}`);
  const invitation = await invRes.json();

  const acceptRes = await fetch(`${base}/invitations/${invitation.id}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      node_id: member.nodeId,
      public_key: bytesToBase64Url(member.publicKey),
    }),
  });
  if (!acceptRes.ok) throw new Error(`accept invitation: ${acceptRes.status} ${await acceptRes.text()}`);

  const rpc = (caller, body) =>
    fetch(`${base}/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(caller)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const createChildRes = await rpc(owner.nodeId, {
    op: "CreateChild",
    parent_doc_id: "root",
    doc_id: childDocId,
    title: "E2E Doc",
  });
  if (!createChildRes.ok) throw new Error(`CreateChild: ${createChildRes.status} ${await createChildRes.text()}`);

  const setAclRes = await rpc(owner.nodeId, {
    op: "SetACL",
    doc_id: childDocId,
    user_node_id: member.nodeId,
    role: 2,
  });
  if (!setAclRes.ok) throw new Error(`SetACL: ${setAclRes.status}`);

  const memberJwtRes = await fetch(`${base}/groups/${groupId}/jwt/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ node_id: member.nodeId, doc_id: childDocId }),
  });
  if (!memberJwtRes.ok) throw new Error(`member jwt: ${memberJwtRes.status}`);
  const memberJwtBody = await memberJwtRes.json();
  if (memberJwtBody.role !== 2) throw new Error(`expected member role 2, got ${memberJwtBody.role}`);

  const payload = parseJwtPayload(memberJwtBody.jwt);
  if (!payload.doc_key || payload.doc_key.length < 32) {
    throw new Error("JWT doc_key missing or too short (expect sealed ciphertext)");
  }
  if (/^[A-Za-z0-9_-]{43}$/.test(payload.doc_key)) {
    throw new Error("JWT doc_key looks like raw 32-byte key, not sealed");
  }

  const treeRes = await fetch(
    `${base}/groups/${groupId}/tree?node_id=${encodeURIComponent(member.nodeId)}`,
  );
  if (!treeRes.ok) throw new Error(`member tree: ${treeRes.status}`);
  const tree = await treeRes.json();
  const rootNode = tree.nodes?.find((n) => n.docId === "root");
  const childNode = tree.nodes?.find((n) => n.docId === childDocId);
  if (!rootNode?.isFolder) throw new Error("root must be folder in tree API");
  if (!childNode) throw new Error("member cannot see child doc after SetACL");

  const subFolderId = crypto.randomUUID();
  const subFolderRes = await rpc(owner.nodeId, {
    op: "CreateChild",
    parent_doc_id: "root",
    doc_id: subFolderId,
    title: "E2E Chapter",
    is_folder: true,
  });
  if (!subFolderRes.ok) throw new Error(`CreateChild folder: ${subFolderRes.status} ${await subFolderRes.text()}`);
  const nestedDocId = crypto.randomUUID();
  const nestedRes = await rpc(owner.nodeId, {
    op: "CreateChild",
    parent_doc_id: subFolderId,
    doc_id: nestedDocId,
    title: "Nested Doc",
  });
  if (!nestedRes.ok) throw new Error(`CreateChild nested: ${nestedRes.status}`);
  const ownerTree = await fetch(
    `${base}/groups/${groupId}/tree?node_id=${encodeURIComponent(owner.nodeId)}`,
  ).then((r) => r.json());
  const folderNode = ownerTree.nodes?.find((n) => n.docId === subFolderId);
  if (!folderNode?.isFolder) throw new Error("subfolder must have isFolder=true");
  const nestedNode = ownerTree.nodes?.find((n) => n.docId === nestedDocId);
  if (!nestedNode || nestedNode.parentDocId !== subFolderId) {
    throw new Error("nested doc parent must be subfolder");
  }

  const denyRes = await rpc(member.nodeId, {
    op: "CreateChild",
    parent_doc_id: "root",
    doc_id: crypto.randomUUID(),
    title: "should fail",
  });
  if (denyRes.ok) throw new Error("member without operable on root should not CreateChild");

  const membersRes = await fetch(`${base}/groups/${groupId}/members`);
  if (!membersRes.ok) throw new Error(`members: ${membersRes.status}`);
  const members = await membersRes.json();
  if (members.members?.length < 2) throw new Error("expected owner + member in members list");

  return { groupId, childDocId };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runE2eSmoke()
    .then(() => {
      console.log("OK: E2E API smoke (group → invite → doc → ACL → JWT → tree)");
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
