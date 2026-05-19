import os from "node:os";
import Fastify from "fastify";
import websocket from "@fastify/websocket";

async function main() {
  const port = Number(process.env.LAN_AGENT_PORT ?? 3003);
  const peers = new Map<string, { uid: string; host: string; port: number; lastSeen: number }>();
  const app = Fastify();
  await app.register(websocket);
  app.get("/health", async () => ({ status: "ok", service: "lan-agent" }));
  app.get("/network", async () => ({
    hostname: os.hostname(),
    agentPort: port,
    interfaces: Object.values(os.networkInterfaces())
      .flat()
      .filter((i): i is NonNullable<typeof i> => i != null)
      .map((i) => ({ address: i.address, family: i.family, internal: i.internal })),
  }));
  app.get("/discovery", async () => ({ peers: [...peers.values()] }));
  app.get("/peers", async (req) => {
    const q = (req.query as { uid?: string }).uid?.toLowerCase() ?? "";
    const all = [...peers.values()];
    return { peers: q ? all.filter((p) => p.uid.toLowerCase().includes(q)) : all };
  });
  app.register(async (f) => {
    f.get("/ws", { websocket: true }, (socket) => {
      socket.on("message", (msg) => socket.send(msg));
    });
  });
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`lan-agent on ${port}`);
}
main().catch((e) => { console.error(e); process.exit(1); });