#!/usr/bin/env node
/**
 * P3 acceptance: P2 baseline + @dpe/p2p tests + signaling/lan-agent smoke.
 *   pnpm verify:p3
 *   pnpm verify:p3 --live   # spawn signaling + lan-agent WS/API checks
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, label, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true, env: process.env });
  if (r.status !== 0) {
    console.error(`FAIL: ${label}`);
    process.exit(r.status ?? 1);
  }
  console.log(`OK: ${label}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (body.status === "ok") return;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error(`health timeout: ${url}`);
}

function wsOnce(url, handlers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("ws timeout"));
    }, 10_000);
    ws.on("open", () => handlers.onOpen?.(ws));
    ws.on("message", (raw) => {
      const text = raw.toString();
      const done = handlers.onMessage?.(ws, text);
      if (done) {
        clearTimeout(timer);
        ws.close();
        resolve(text);
      }
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function signalingSmoke() {
  const base = "ws://127.0.0.1:3098/ws";
  let sawPeers = false;

  await wsOnce(base, {
    onOpen(ws) {
      ws.send(JSON.stringify({ type: "join", room: "verify-p3", node_id: "node-a" }));
    },
    onMessage(ws, text) {
      const msg = JSON.parse(text);
      if (msg.type === "peers" && msg.peers?.includes("node-a")) {
        ws.send(
          JSON.stringify({
            type: "signal",
            room: "verify-p3",
            payload: { kind: "offer", sdp: "test" },
          }),
        );
        sawPeers = true;
        return true;
      }
      return false;
    },
  });

  if (!sawPeers) throw new Error("signaling peers not received");
  console.log("OK: signaling join + peers");
}

async function lanAgentSmoke() {
  const base = "http://127.0.0.1:3097";
  await waitHealth(`${base}/health`);

  const reg = await fetch(`${base}/peers/manual`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      uid: "peer-verify-001",
      host: "192.168.1.50",
      port: 3003,
    }),
  });
  if (!reg.ok) throw new Error(`manual peer: ${reg.status}`);

  const search = await fetch(`${base}/peers?uid=peer-verify`);
  const body = await search.json();
  if (!body.peers?.some((p) => p.uid === "peer-verify-001")) {
    throw new Error("peer search failed");
  }
  console.log("OK: lan-agent manual peer + search");
}

async function main() {
  run("node", ["scripts/verify-p2.mjs"], "P2 baseline");

  run("pnpm", ["turbo", "run", "build", "--filter", "@dpe/p2p"], "p2p build");
  run("pnpm", ["turbo", "run", "test", "--filter", "@dpe/p2p"], "p2p tests");
  run("pnpm", ["--filter", "@dpe/signaling", "build"], "signaling build");
  run("pnpm", ["--filter", "@dpe/lan-agent", "build"], "lan-agent build");

  if (!process.argv.includes("--live")) {
    console.log("\nP3 verification passed (build + unit). Run with --live for WS smoke.");
    return;
  }

  const children = [];
  const spawnService = (name, cwd, portEnv, port) => {
    const child = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
      cwd: path.join(root, "apps", cwd),
      env: { ...process.env, [portEnv]: String(port), DPE_DISABLE_MDNS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    children.push(child);
    return child;
  };

  spawnService("signaling", "signaling", "SIGNALING_PORT", 3098);
  spawnService("lan-agent", "lan-agent", "LAN_AGENT_PORT", 3097);

  try {
    await waitHealth("http://127.0.0.1:3098/health");
    await waitHealth("http://127.0.0.1:3097/health");
    await signalingSmoke();
    await lanAgentSmoke();
    console.log("\nP3 verification passed (with live smoke).");
  } finally {
    for (const c of children) c.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
