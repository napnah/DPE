import { createRequire } from "node:module";
import WebSocket from "ws";

const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const SimplePeer = requireFromWeb("simple-peer");
let wrtc;
try {
  wrtc = createRequire(import.meta.url)("@roamhq/wrtc");
} catch (err) {
  throw new Error(
    "Missing @roamhq/wrtc. Run pnpm install with registry access, or run this verifier on a machine where Node WebRTC deps are installed.",
    { cause: err },
  );
}

const signalingUrl = process.env.DPE_VERIFY_SIGNALING_URL ?? "ws://localhost:3002/ws";
const room = `dpe-verify-simple-peer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const timeoutMs = Number(process.env.DPE_VERIFY_TIMEOUT_MS ?? 15000);

function waitFor(label, predicate) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`${label} timeout after ${timeoutMs}ms`));
      }
    }, 25);
  });
}

function openSocket(nodeId, onSignal) {
  const ws = new WebSocket(signalingUrl);
  const peers = new Set();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ws open timeout: ${nodeId}`)), timeoutMs);

    ws.on("open", () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ type: "join", room, node_id: nodeId }));
      resolve({
        nodeId,
        peers,
        sendSignal(to, signal) {
          ws.send(JSON.stringify({ type: "signal", room, to, payload: { signal } }));
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
        for (const peer of msg.peers) peers.add(peer);
      } else if (msg.type === "signal") {
        onSignal(msg.payload?.from, msg.payload?.signal);
      }
    });

    ws.on("error", reject);
  });
}

function createPeer({ initiator, from, to, sendSignal, onData }) {
  const peer = new SimplePeer({
    initiator,
    trickle: false,
    iceCompleteTimeout: 3000,
    channelName: "dpe",
    channelConfig: { ordered: true },
    objectMode: true,
    wrtc,
  });

  peer.on("signal", (signal) => sendSignal(to, signal));
  peer.on("data", (data) => onData(String(data)));
  peer.on("error", (err) => {
    console.error(`[${from}] peer error`, err.message);
  });

  return peer;
}

let peerA;
let peerB;
const received = [];

const socketA = await openSocket("verify-a", (from, signal) => {
  if (from === "verify-b" && signal) peerA.signal(signal);
});
const socketB = await openSocket("verify-b", (from, signal) => {
  if (from === "verify-a" && signal) peerB.signal(signal);
});

await waitFor("signaling peers", () => socketA.peers.has("verify-b") && socketB.peers.has("verify-a"));

peerA = createPeer({
  initiator: true,
  from: "verify-a",
  to: "verify-b",
  sendSignal: socketA.sendSignal,
  onData: (text) => received.push(["a", text]),
});
peerB = createPeer({
  initiator: false,
  from: "verify-b",
  to: "verify-a",
  sendSignal: socketB.sendSignal,
  onData: (text) => received.push(["b", text]),
});

await Promise.all([
  new Promise((resolve) => peerA.once("connect", resolve)),
  new Promise((resolve) => peerB.once("connect", resolve)),
]);

peerA.send("hello-from-a");
peerB.send("hello-from-b");

await waitFor(
  "datachannel echo",
  () => received.some(([side, text]) => side === "b" && text === "hello-from-a") &&
    received.some(([side, text]) => side === "a" && text === "hello-from-b"),
);

peerA.destroy();
peerB.destroy();
socketA.close();
socketB.close();

console.log(`OK: simple-peer datachannel via ${signalingUrl}`);
