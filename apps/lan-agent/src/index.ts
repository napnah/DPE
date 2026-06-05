import "./load-env.js";
import os from "node:os";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { createDiscovery, type LanPeer } from "./discovery.js";
import { registerCors } from "./cors.js";
import { pickLanAddress, resolveMdnsInterface } from "./network.js";

async function main() {
  const port = Number(process.env.LAN_AGENT_PORT ?? 3003);
  const uid = process.env.DPE_NODE_ID?.trim() || `local-${os.hostname()}`;
  const displayName = process.env.DPE_AGENT_NAME ?? os.hostname();
  const host = pickLanAddress();
  const mdnsInterface = resolveMdnsInterface(host);
  const agentHost = process.env.DPE_AGENT_HOST?.trim() || host;
  const controlPlanePort = Number(process.env.CONTROL_PLANE_PORT ?? 3001);
  const signalingPort = Number(process.env.SIGNALING_PORT ?? 3002);
  const webPort = Number(process.env.WEB_PORT ?? process.env.VITE_PORT ?? 5173);
  const agentUrl = process.env.DPE_AGENT_URL?.trim() || `http://${agentHost}:${port}`;
  const controlUrl =
    process.env.DPE_CONTROL_URL?.trim() || `http://${agentHost}:${controlPlanePort}`;
  const signalingUrl =
    process.env.DPE_SIGNALING_URL?.trim() || `ws://${agentHost}:${signalingPort}/ws`;
  const webUrl = process.env.DPE_WEB_URL?.trim() || `http://${agentHost}:${webPort}`;

  const discovery = createDiscovery(
    {
      uid,
      displayName,
      port,
      host: agentHost,
      agentUrl,
      controlUrl,
      signalingUrl,
      webUrl,
    },
    { mdnsInterface },
  );
  discovery.start();

  console.log(
    `[lan-agent] listening 0.0.0.0:${port} node_id=${uid} agentHost=${agentHost} mdnsInterface=${mdnsInterface ?? "all"}`,
  );
  if (process.env.DPE_DISCOVERY_PROBE_HOSTS?.trim()) {
    console.log(`[lan-agent] probe hosts: ${process.env.DPE_DISCOVERY_PROBE_HOSTS}`);
  }

  let peers: LanPeer[] = discovery.getPeers();
  const wsClients = new Set<{ send: (s: string) => void }>();

  const broadcastDiscovery = () => {
    peers = discovery.getPeers();
    const payload = JSON.stringify({ type: "discovery", peers });
    for (const c of wsClients) {
      try {
        c.send(payload);
      } catch {
        /* ignore */
      }
    }
  };

  discovery.onUpdate((list) => {
    peers = list;
    broadcastDiscovery();
  });

  const app = Fastify({ logger: false });
  await registerCors(app);
  await app.register(websocket);

  app.get("/", async () => ({
    service: "lan-agent",
    status: "ok",
    node_id: uid,
    agent_host: agentHost,
    mdns_interface: mdnsInterface ?? null,
    agent_url: agentUrl,
    control_url: controlUrl,
    signaling_url: signalingUrl,
    web_url: webUrl,
    endpoints: {
      health: "/health",
      network: "/network",
      discovery: "/discovery",
      peers: "/peers?uid=<prefix>",
      manual_peer: "POST /peers/manual",
      websocket: "/ws",
    },
    hint: "Set DPE_DISCOVERY_PROBE_HOSTS=ip,... when mDNS is one-way (VM NAT). DPE_MANUAL_PEERS=uid@host:port for static peers.",
  }));

  app.get("/manifest", async () => ({
    uid,
    node_id: uid,
    display_name: displayName,
    host: agentHost,
    port,
    agent_url: agentUrl,
    control_url: controlUrl,
    signaling_url: signalingUrl,
    web_url: webUrl,
    capabilities: ["control-plane", "signaling", "lan-discovery"],
    updated_at: new Date().toISOString(),
  }));

  app.get("/health", async () => ({
    status: "ok",
    service: "lan-agent",
    node_id: uid,
    peer_count: peers.length,
  }));

  app.get("/network", async () => ({
    hostname: os.hostname(),
    node_id: uid,
    agentPort: port,
    agentHost,
    agentUrl,
    controlUrl,
    mdnsInterface: mdnsInterface ?? null,
    signalingUrl,
    webUrl,
    interfaces: Object.values(os.networkInterfaces())
      .flat()
      .filter((i): i is NonNullable<typeof i> => i != null)
      .map((i) => ({ address: i.address, family: i.family, internal: i.internal })),
  }));

  app.get("/discovery", async () => ({ peers }));
  app.get("/peers", async (req) => {
    const q = (req.query as { uid?: string }).uid?.toLowerCase() ?? "";
    const all = peers;
    return {
      peers: q ? all.filter((p) => p.uid.toLowerCase().includes(q)) : all,
    };
  });

  app.post<{ Body: { node_id?: string } }>("/identity", async (req, reply) => {
    const nodeId = req.body?.node_id?.trim();
    if (!nodeId) {
      return reply.status(400).send({ error: "node_id required" });
    }
    discovery.setLocalNodeId(nodeId);
    return { ok: true, node_id: nodeId };
  });

  app.post<{ Body: { uid: string; host: string; port: number; name?: string } }>(
    "/peers/manual",
    async (req, reply) => {
      const { uid, host, port, name } = req.body ?? {};
      if (!uid || !host || !Number.isFinite(port)) {
        return reply.status(400).send({ error: "uid, host, port required" });
      }
      const peerPort = Number(port);
      const manualPeer = {
        uid,
        host,
        port: peerPort,
        name,
        agentUrl: `http://${host}:${peerPort}`,
        controlUrl: `http://${host}:${controlPlanePort}`,
        signalingUrl: `ws://${host}:${signalingPort}/ws`,
        webUrl: `http://${host}:${webPort}`,
      };
      discovery.registerManual(manualPeer);
      const peer = peers.find((p) => p.uid === uid) ?? {
        ...manualPeer,
        source: "manual" as const,
        lastSeen: Date.now(),
      };
      return { ok: true, peer };
    },
  );

  app.register(async (f) => {
    f.get("/ws", { websocket: true }, (socket) => {
      const client = {
        send: (s: string) => {
          if (socket.readyState === socket.OPEN) socket.send(s);
        },
      };
      wsClients.add(client);
      socket.on("close", () => wsClients.delete(client));
      socket.on("message", (raw) => {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        try {
          const msg = JSON.parse(text) as { type?: string };
          if (msg.type === "ping") {
            client.send(JSON.stringify({ type: "pong", node_id: uid }));
          }
        } catch {
          socket.send(text);
        }
      });
      client.send(JSON.stringify({ type: "discovery", peers }));
    });
  });

  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
