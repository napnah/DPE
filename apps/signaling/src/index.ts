import "./load-env.js";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { SignalingRooms } from "./rooms.js";

async function main() {
  // Do not fall back to PORT — Turbo/other tools may set it and break ws://localhost:3002/ws.
  const port = Number(process.env.SIGNALING_PORT ?? 3002);
  const app = Fastify({ logger: false });
  await app.register(websocket);

  const rooms = new SignalingRooms();

  app.get("/health", async () => ({ status: "ok", service: "signaling" }));
  app.get("/debug", async () => rooms.snapshot());

  app.get("/", async () => ({
    service: "signaling",
    status: "ok",
    websocket: "/ws",
    protocol: "join | leave | signal → peers | signal | error",
  }));

  app.register(async (f) => {
    f.get("/ws", { websocket: true }, (socket) => {
      rooms.handleConnection(socket);
    });
  });

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`signaling on ${port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
