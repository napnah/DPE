#!/usr/bin/env node
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import { config as loadDotenv } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: path.join(root, ".env") });

const requireFromRoot = createRequire(import.meta.url);
const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
let SimplePeer = null;
let wrtc = null;
try {
  wrtc = requireFromRoot("@roamhq/wrtc");
} catch {
  // Signal-only peer mode still works without Node WebRTC.
}

function loadSimplePeer() {
  if (!SimplePeer) SimplePeer = requireFromWeb("simple-peer");
  return SimplePeer;
}

const cryptoEntry = path.join(root, "packages", "crypto", "dist", "index.js");
const p2pEntry = path.join(root, "packages", "p2p", "dist", "index.js");
const cryptoUrl = new URL(`file:///${cryptoEntry.replace(/\\/g, "/")}`).href;
const p2pUrl = new URL(`file:///${p2pEntry.replace(/\\/g, "/")}`).href;
const {
  bytesToBase64Url,
  generateNodeKeyPair,
  validateAuthEnvelopeWithPeerKey,
} = await import(cryptoUrl).then(async (cryptoMod) => {
  const p2pMod = await import(p2pUrl);
  return { ...cryptoMod, ...p2pMod };
});

const {
  serializeAuthEnvelope,
} = await import(p2pUrl);

const args = parseArgs(process.argv.slice(2));
const mode = args.mode ?? "orchestrator";
const hostControl = trimSlash(args.hostControl ?? process.env.DPE_DEBUG_HOST_CONTROL ?? "http://127.0.0.1:3001");
const vmControl = trimSlash(args.vmControl ?? process.env.DPE_DEBUG_VM_CONTROL ?? "http://192.168.18.128:3001");
const signalingUrls = (args.signaling ?? process.env.DPE_DEBUG_SIGNALING ?? "ws://127.0.0.1:3002/ws,ws://192.168.18.128:3002/ws")
  .split(",")
  .map((s) => normalizeWs(s))
  .filter(Boolean);
const timeoutMs = Number(args.timeoutMs ?? process.env.DPE_DEBUG_TIMEOUT_MS ?? 25000);

if (mode === "peer") {
  await runPeerMode();
} else {
  await runOrchestrator();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq > 0) {
      out[raw.slice(2, eq)] = raw.slice(eq + 1);
    } else {
      out[raw.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
    }
  }
  return out;
}

function log(event, data = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

function trimSlash(raw) {
  return String(raw).trim().replace(/\/$/, "");
}

function normalizeWs(raw) {
  const s = String(raw).trim().replace(/\/$/, "");
  if (!s) return "";
  return s.endsWith("/ws") ? s : `${s}/ws`;
}

function signalKind(signal) {
  if (!signal || typeof signal !== "object") return "unknown";
  if (typeof signal.type === "string") return signal.type;
  if ("candidate" in signal) return "candidate";
  return "unknown";
}

function short(id) {
  return String(id ?? "").slice(0, 12);
}

async function requestJson(base, pathName, init = {}) {
  const res = await fetch(`${trimSlash(base)}${pathName}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { text };
    }
  }
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body ? body.message : text || res.statusText;
    throw new Error(`${init.method ?? "GET"} ${base}${pathName} -> ${res.status}: ${message}`);
  }
  return body;
}

async function health(base) {
  try {
    const body = await requestJson(base, "/health");
    log("health_ok", { base, body });
  } catch (err) {
    log("health_failed", { base, error: String(err.message ?? err) });
    throw err;
  }
}

async function register(base, label) {
  const username = `debug_${label}_${Date.now()}_${randomBytes(3).toString("hex")}`;
  const password = `Debug_${randomBytes(8).toString("hex")}`;
  const body = await requestJson(base, "/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      display_name: `Debug ${label}`,
    }),
  });
  log("account_created", { base, label, username, nodeId: short(body.nodeId) });
  return { ...body, password };
}

async function createBusinessFlow() {
  await health(hostControl);
  await health(vmControl);

  const alice = await register(hostControl, "alice");
  const bob = await register(vmControl, "bob");

  const group = await requestJson(hostControl, "/groups", {
    method: "POST",
    body: JSON.stringify({
      name: `debug-p2p-${new Date().toISOString()}`,
      description: "automated p2p user-flow debug",
      owner_node_id: alice.nodeId,
      owner_public_key: alice.publicKey,
      owner_display_name: alice.displayName,
      control_mode: "proxy",
    }),
  });
  const groupId = group.group_id;
  log("group_created", { groupId, pkAdmin: short(group.pk_admin), owner: short(alice.nodeId) });

  const invitation = await requestJson(
    hostControl,
    `/groups/${groupId}/invitations?inviter_node_id=${encodeURIComponent(alice.nodeId)}`,
    {
      method: "POST",
      body: JSON.stringify({ invitee_node_id: bob.nodeId }),
    },
  );
  log("invitation_created", { invitationId: invitation.id, invitee: short(bob.nodeId) });

  const joined = await requestJson(hostControl, `/invitations/${invitation.id}/accept`, {
    method: "POST",
    body: JSON.stringify({
      node_id: bob.nodeId,
      public_key: bob.publicKey,
      display_name: bob.displayName,
    }),
  });
  log("invitation_accepted", { groupId: joined.group_id, bob: short(bob.nodeId) });

  const docId = randomUUID();
  const createdDoc = await requestJson(
    hostControl,
    `/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(alice.nodeId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        op: "CreateChild",
        parent_doc_id: "root",
        doc_id: docId,
        title: "Debug document",
        is_folder: false,
      }),
    },
  );
  log("document_created", { docId, response: createdDoc });

  const governance = await requestJson(
    hostControl,
    `/groups/${groupId}/governance?caller_node_id=${encodeURIComponent(alice.nodeId)}`,
  );
  const writerRole =
    governance.roles?.find((r) => r.slug === "editor") ??
    governance.roles?.find((r) => r.slug === "writer") ??
    governance.roles?.find((r) => r.slug === "reader") ??
    governance.roles?.find((r) => !r.is_builtin);
  if (writerRole?.id) {
    await requestJson(hostControl, `/groups/${groupId}/rpc?caller_node_id=${encodeURIComponent(alice.nodeId)}`, {
      method: "POST",
      body: JSON.stringify({
        op: "SetDocRoleAcl",
        doc_id: docId,
        group_role_id: writerRole.id,
        access_level: 2,
      }),
    });
    log("member_doc_acl_set", { docId, role: writerRole.slug ?? writerRole.name, accessLevel: 2 });
  }

  const snapshot = bytesToBase64Url(new TextEncoder().encode(`debug write ${new Date().toISOString()}`));
  await requestJson(hostControl, `/groups/${groupId}/docs/${encodeURIComponent(docId)}/snapshot`, {
    method: "POST",
    body: JSON.stringify({ node_id: alice.nodeId, state_update_base64: snapshot }),
  });
  const bobSnapshot = await requestJson(
    hostControl,
    `/groups/${groupId}/docs/${encodeURIComponent(docId)}/snapshot?node_id=${encodeURIComponent(bob.nodeId)}`,
  );
  log("snapshot_written_and_read", {
    docId,
    by: short(alice.nodeId),
    bobCanRead: Boolean(bobSnapshot.snapshot),
  });

  const members = await requestJson(hostControl, `/groups/${groupId}/members`);
  const aliceJwt = await refreshJwt(alice.nodeId, groupId, docId);
  const bobJwt = await refreshJwt(bob.nodeId, groupId, docId);
  log("jwt_refreshed", {
    aliceRole: aliceJwt.role,
    bobRole: bobJwt.role,
    members: members.members?.map((m) => short(m.node_id)),
  });

  return {
    alice,
    bob,
    groupId,
    docId,
    pkAdmin: group.pk_admin,
    members: members.members,
    aliceJwt: aliceJwt.jwt,
    bobJwt: bobJwt.jwt,
  };
}

async function refreshJwt(nodeId, groupId, docId) {
  return requestJson(hostControl, `/groups/${groupId}/jwt/refresh`, {
    method: "POST",
    body: JSON.stringify({ node_id: nodeId, doc_id: docId }),
  });
}

function openSignalSocket({ label, url, room, nodeId, onPeers, onSignal }) {
  const ws = new WebSocket(url);
  const peers = new Set();
  let opened = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} ws open timeout: ${url}`)), timeoutMs);
    ws.on("open", () => {
      opened = true;
      clearTimeout(timer);
      ws.send(JSON.stringify({ type: "join", room, node_id: nodeId }));
      log("signal_ws_open", { label, url, nodeId: short(nodeId) });
      resolve({
        label,
        url,
        ws,
        peers,
        send(to, signal, signalId) {
          log("signal_send", { label, url, to: short(to), kind: signalKind(signal), signalId });
          ws.send(JSON.stringify({
            type: "signal",
            room,
            to,
            payload: { signal, signal_id: signalId },
          }));
        },
        close() {
          ws.close();
        },
      });
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "peers") {
        peers.clear();
        for (const peer of msg.peers ?? []) peers.add(peer);
        log("signal_peers", { label, url, count: peers.size, peers: [...peers].map(short) });
        onPeers?.(url, peers);
      } else if (msg.type === "signal") {
        const from = msg.payload?.from;
        const signal = msg.payload?.signal;
        log("signal_rx", {
          label,
          url,
          from: short(from),
          to: short(msg.to),
          kind: signalKind(signal),
          signalId: msg.payload?.signal_id,
        });
        onSignal?.(from, signal, msg.payload, url);
      } else if (msg.type === "error") {
        log("signal_error", { label, url, message: msg.message, code: msg.code });
      }
    });
    ws.on("error", (err) => {
      log("signal_ws_error", { label, url, error: err.message });
      if (!opened) reject(err);
    });
    ws.on("close", () => log("signal_ws_close", { label, url }));
  });
}

async function waitFor(label, predicate) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} timeout after ${timeoutMs}ms`);
}

function buildPeer({ label, initiator, node, remote, groupId, pkAdmin, jwt, remotePublicKey, sendSignal, onAuthed }) {
  if (!wrtc) throw new Error("@roamhq/wrtc is required for Node WebRTC transport verification");
  const Peer = loadSimplePeer();
  const peer = new Peer({
    initiator,
    trickle: false,
    iceCompleteTimeout: 3000,
    channelName: "dpe",
    channelConfig: { ordered: true },
    objectMode: true,
    wrtc,
  });

  peer.on("signal", (signal) => sendSignal(remote.nodeId, signal));
  peer.on("connect", () => {
    log("channel_open", { label, peer: short(remote.nodeId), initiator });
    peer.send(serializeAuthEnvelope({ type: "auth", node_id: node.nodeId, jwt }));
    peer.send(JSON.stringify({ type: "debug_write", from: node.nodeId, at: new Date().toISOString() }));
  });
  peer.on("data", async (data) => {
    const text = String(data);
    log("channel_data", { label, from: short(remote.nodeId), text: text.slice(0, 120) });
    try {
      const json = JSON.parse(text);
      if (json?.type === "auth") {
        const authed = await validateAuthEnvelopeWithPeerKey(json, {
          adminPublicKeyBase64Url: pkAdmin,
          audience: groupId,
          peerPublicKeyBase64Url: remotePublicKey,
        });
        log("auth_ok", { label, peer: short(authed.nodeId), role: authed.payload.role, docId: authed.payload.doc_id });
        onAuthed?.(authed.nodeId);
      }
    } catch (err) {
      if (text.includes("\"type\":\"auth\"")) {
        log("auth_failed", { label, peer: short(remote.nodeId), error: String(err.message ?? err) });
      }
    }
  });
  peer.on("close", () => log("channel_close", { label, peer: short(remote.nodeId) }));
  peer.on("error", (err) => log("channel_error", { label, peer: short(remote.nodeId), error: err.message }));
  return peer;
}

async function runTransportProbe(flow) {
  if (!wrtc) {
    log("transport_skipped", { reason: "missing @roamhq/wrtc on this machine" });
    return { ok: false, skipped: true };
  }
  const sockets = [];
  const authed = new Set();
  const seenSignals = new Set();
  const signalIds = { alice: 0, bob: 0 };
  let alicePeer = null;
  let bobPeer = null;

  const aliceSockets = [];
  const bobSockets = [];

  const sendFromAlice = (to, signal) => {
    const signalId = `${flow.alice.nodeId.slice(0, 12)}-${++signalIds.alice}`;
    for (const socket of aliceSockets) {
      if (socket.ws.readyState === WebSocket.OPEN && (socket.peers.has(to) || aliceSockets.length === 1)) {
        socket.send(to, signal, signalId);
      }
    }
  };
  const sendFromBob = (to, signal) => {
    const signalId = `${flow.bob.nodeId.slice(0, 12)}-${++signalIds.bob}`;
    for (const socket of bobSockets) {
      if (socket.ws.readyState === WebSocket.OPEN && (socket.peers.has(to) || bobSockets.length === 1)) {
        socket.send(to, signal, signalId);
      }
    }
  };

  for (const url of signalingUrls) {
    aliceSockets.push(await openSignalSocket({
      label: "alice",
      url,
      room: flow.groupId,
      nodeId: flow.alice.nodeId,
      onSignal(from, signal, payload) {
        if (!shouldApplySignal("alice", from, signal, payload)) return;
        if (from === flow.bob.nodeId && signal && alicePeer && !alicePeer.destroyed) {
          try {
            alicePeer.signal(signal);
          } catch (err) {
            log("signal_apply_failed", { label: "alice", from: short(from), error: String(err.message ?? err) });
          }
        }
      },
    }));
    bobSockets.push(await openSignalSocket({
      label: "bob",
      url,
      room: flow.groupId,
      nodeId: flow.bob.nodeId,
      onSignal(from, signal, payload) {
        if (!shouldApplySignal("bob", from, signal, payload)) return;
        if (from === flow.alice.nodeId && signal && bobPeer && !bobPeer.destroyed) {
          try {
            bobPeer.signal(signal);
          } catch (err) {
            log("signal_apply_failed", { label: "bob", from: short(from), error: String(err.message ?? err) });
          }
        }
      },
    }));
  }
  sockets.push(...aliceSockets, ...bobSockets);

  await waitFor("signaling room peers", () =>
    aliceSockets.some((s) => s.peers.has(flow.bob.nodeId)) &&
    bobSockets.some((s) => s.peers.has(flow.alice.nodeId)),
  );

  const aliceInitiates = flow.alice.nodeId < flow.bob.nodeId;
  alicePeer = buildPeer({
    label: "alice",
    initiator: aliceInitiates,
    node: flow.alice,
    remote: flow.bob,
    groupId: flow.groupId,
    pkAdmin: flow.pkAdmin,
    jwt: flow.aliceJwt,
    remotePublicKey: flow.bob.publicKey,
    sendSignal: sendFromAlice,
    onAuthed: (nodeId) => authed.add(`alice:${nodeId}`),
  });
  bobPeer = buildPeer({
    label: "bob",
    initiator: !aliceInitiates,
    node: flow.bob,
    remote: flow.alice,
    groupId: flow.groupId,
    pkAdmin: flow.pkAdmin,
    jwt: flow.bobJwt,
    remotePublicKey: flow.alice.publicKey,
    sendSignal: sendFromBob,
    onAuthed: (nodeId) => authed.add(`bob:${nodeId}`),
  });

  await waitFor("transport authenticated both ways", () =>
    authed.has(`alice:${flow.bob.nodeId}`) && authed.has(`bob:${flow.alice.nodeId}`),
  );

  alicePeer.destroy();
  bobPeer.destroy();
  for (const socket of sockets) socket.close();

  const debug = await collectSignalDebug(flow.groupId);
  const kinds = debug.flatMap((d) => d.relayEvents).filter((e) => e.room === flow.groupId).map((e) => e.kind);
  const ok = kinds.includes("offer") && kinds.includes("answer");
  log("transport_probe_done", { ok, relayKinds: kinds });
  if (!ok) throw new Error(`expected offer and answer in signaling debug, got ${kinds.join(",")}`);
  return { ok: true, debug };

  function shouldApplySignal(label, from, signal, payload) {
    if (!from || !signal) return false;
    const signalId = typeof payload?.signal_id === "string" ? payload.signal_id : "";
    const stableSignal = signalId || JSON.stringify(signal);
    const key = `${label}:${from}:${stableSignal}`;
    if (seenSignals.has(key)) {
      log("signal_rx_duplicate", { label, from: short(from), kind: signalKind(signal) });
      return false;
    }
    seenSignals.add(key);
    return true;
  }
}

async function collectSignalDebug(room) {
  const out = [];
  for (const wsUrl of signalingUrls) {
    const httpUrl = wsUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:").replace(/\/ws$/, "/debug");
    try {
      const body = await requestJson(httpUrl.replace(/\/debug$/, ""), "/debug");
      const roomRows = body.rooms?.filter((r) => r.room === room) ?? [];
      const relayEvents = body.relayEvents?.filter((e) => e.room === room) ?? [];
      log("signaling_debug", {
        url: httpUrl,
        rooms: roomRows.map((r) => ({ room: r.room, members: r.members?.map?.(short) ?? r.members })),
        relayEvents: relayEvents.map((e) => ({
          from: short(e.from),
          to: short(e.to),
          kind: e.kind,
          delivered: e.delivered,
          members: e.members?.map?.(short) ?? e.members,
        })),
      });
      out.push({ url: httpUrl, rooms: roomRows, relayEvents });
    } catch (err) {
      log("signaling_debug_failed", { url: httpUrl, error: String(err.message ?? err) });
    }
  }
  return out;
}

async function runOrchestrator() {
  log("debug_flow_start", { mode, hostControl, vmControl, signalingUrls, hasWrtc: Boolean(wrtc) });
  const flow = await createBusinessFlow();
  await runTransportProbe(flow);
  await collectSignalDebug(flow.groupId);
  log("debug_flow_ok", {
    groupId: flow.groupId,
    docId: flow.docId,
    alice: short(flow.alice.nodeId),
    bob: short(flow.bob.nodeId),
  });
}

async function runPeerMode() {
  log("peer_mode_start", { signalingUrls, hasWrtc: Boolean(wrtc) });
  const room = args.room;
  const nodeId = args.nodeId;
  if (!room || !nodeId) throw new Error("--room and --nodeId are required for --mode peer");
  const sockets = [];
  for (const url of signalingUrls) {
    sockets.push(await openSignalSocket({ label: args.label ?? "peer", url, room, nodeId }));
  }
  await new Promise((resolve) => setTimeout(resolve, Number(args.holdMs ?? 30000)));
  for (const socket of sockets) socket.close();
  log("peer_mode_done", { room, nodeId: short(nodeId) });
}
