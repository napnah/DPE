import Fastify from "fastify";
import websocket from "@fastify/websocket";

async function main() {
  const port = Number(process.env.PORT ?? 3002);
  const app = Fastify();
  await app.register(websocket);
  app.get("/health", async () => ({ status: "ok", service: "signaling" }));
  app.register(async (f) => {
    f.get("/ws", { websocket: true }, (socket) => {
      socket.on("message", (raw) => socket.send(raw));
    });
  });
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`signaling on ${port}`);
}
main().catch((e) => { console.error(e); process.exit(1); });