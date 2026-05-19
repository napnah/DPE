import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function w(rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

w("docker-compose.yml", [
  "services:",
  "  postgres:",
  "    image: postgres:16-alpine",
  "    environment:",
  "      POSTGRES_USER: dpe",
  "      POSTGRES_PASSWORD: dpe",
  "      POSTGRES_DB: dpe",
  "    ports:",
  "      - \"5432:5432\"",
  "    volumes:",
  "      - dpe_pg:/var/lib/postgresql/data",
  "  redis:",
  "    image: redis:7-alpine",
  "    ports:",
  "      - \"6379:6379\"",
  "  control-plane:",
  "    build:",
  "      context: .",
  "      dockerfile: infra/docker/control-plane.Dockerfile",
  "    ports:",
  "      - \"3001:3001\"",
  "    environment:",
  "      DATABASE_URL: postgresql://dpe:dpe@postgres:5432/dpe",
  "      REDIS_URL: redis://redis:6379",
  "      PORT: \"3001\"",
  "    depends_on:",
  "      - postgres",
  "      - redis",
  "  signaling:",
  "    build:",
  "      context: .",
  "      dockerfile: infra/docker/signaling.Dockerfile",
  "    ports:",
  "      - \"3002:3002\"",
  "    environment:",
  "      PORT: \"3002\"",
  "volumes:",
  "  dpe_pg:",
  ""].join("\n"));

w("infra/docker/control-plane.Dockerfile", [
  "FROM node:22-alpine AS base",
  "WORKDIR /app",
  "RUN corepack enable",
  "COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./",
  "COPY apps/control-plane/package.json apps/control-plane/",
  "COPY packages ./packages",
  "RUN pnpm install --frozen-lockfile || pnpm install",
  "COPY . .",
  "RUN pnpm --filter @dpe/control-plane build",
  "CMD [\"node\", \"apps/control-plane/dist/main.js\"]",
  ""].join("\n"));

w("infra/docker/signaling.Dockerfile", [
  "FROM node:22-alpine",
  "WORKDIR /app",
  "RUN corepack enable",
  "COPY package.json pnpm-workspace.yaml ./",
  "COPY apps/signaling ./apps/signaling",
  "RUN cd apps/signaling && npm install && npm run build",
  "CMD [\"node\", \"apps/signaling/dist/index.js\"]",
  ""].join("\n"));

// control-plane
w("apps/control-plane/package.json", JSON.stringify({
  name: "@dpe/control-plane",
  version: "0.1.0",
  private: true,
  type: "module",
  scripts: {
    build: "tsc",
    dev: "tsx watch src/main.ts",
    start: "node dist/main.js",
    lint: "tsc --noEmit",
    test: "vitest run"
  },
  dependencies: {
    "@dpe/shared": "workspace:*",
    "@dpe/proto": "workspace:*",
    "@dpe/crypto": "workspace:*",
    "@dpe/acl": "workspace:*",
    "@nestjs/common": "^10.4.15",
    "@nestjs/core": "^10.4.15",
    "@nestjs/platform-express": "^10.4.15",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  devDependencies: {
    "@types/node": "^22.10.0",
    "@types/express": "^5.0.0",
    typescript: "^5.7.2",
    tsx: "^4.19.2",
    vitest: "^2.1.8"
  }
}, null, 2) + "\n");

w("apps/control-plane/tsconfig.json", JSON.stringify({
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    outDir: "dist",
    rootDir: "src",
    experimentalDecorators: true,
    emitDecoratorMetadata: true
  },
  include: ["src"]
}, null, 2) + "\n");

w("apps/control-plane/src/main.ts", [
  'import "reflect-metadata";',
  'import { NestFactory } from "@nestjs/core";',
  'import { AppModule } from "./app.module.js";',
  '',
  'async function bootstrap() {',
  '  const port = Number(process.env.PORT ?? 3001);',
  '  const app = await NestFactory.create(AppModule);',
  '  app.enableCors();',
  '  await app.listen(port);',
  '  console.log(`control-plane listening on ${port}`);',
  '}',
  'bootstrap();',
  ""].join("\n"));

w("apps/control-plane/src/app.module.ts", [
  'import { Module } from "@nestjs/common";',
  'import { HealthController } from "./health.controller.js";',
  '',
  '@Module({ controllers: [HealthController] })',
  'export class AppModule {}',
  ""].join("\n"));

w("apps/control-plane/src/health.controller.ts", [
  'import { Controller, Get } from "@nestjs/common";',
  '',
  '@Controller()',
  'export class HealthController {',
  '  @Get("health")',
  '  health() {',
  '    return { status: "ok", service: "control-plane" };',
  '  }',
  '}',
  ""].join("\n"));

// signaling
w("apps/signaling/package.json", JSON.stringify({
  name: "@dpe/signaling",
  version: "0.1.0",
  private: true,
  type: "module",
  scripts: { build: "tsc", dev: "tsx watch src/index.ts", start: "node dist/index.js", lint: "tsc --noEmit" },
  dependencies: { fastify: "^5.2.0", "@fastify/websocket": "^11.0.1", ws: "^8.18.0" },
  devDependencies: { "@types/node": "^22.10.0", "@types/ws": "^8.5.13", typescript: "^5.7.2", tsx: "^4.19.2" }
}, null, 2) + "\n");

w("apps/signaling/tsconfig.json", JSON.stringify({ extends: "../../tsconfig.base.json", compilerOptions: { outDir: "dist", rootDir: "src" }, include: ["src"] }, null, 2) + "\n");

w("apps/signaling/src/index.ts", [
  'import Fastify from "fastify";',
  'import websocket from "@fastify/websocket";',
  '',
  'const port = Number(process.env.PORT ?? 3002);',
  'const app = Fastify();',
  'await app.register(websocket);',
  '',
  'app.get("/health", async () => ({ status: "ok", service: "signaling" }));',
  '',
  'app.register(async (f) => {',
  '  f.get("/ws", { websocket: true }, (socket) => {',
  '    socket.on("message", (raw) => {',
  '      socket.send(raw);',
  '    });',
  '  });',
  '});',
  '',
  'await app.listen({ port, host: "0.0.0.0" });',
  'console.log(`signaling on ${port}`);',
  ""].join("\n"));

// lan-agent
w("apps/lan-agent/package.json", JSON.stringify({
  name: "@dpe/lan-agent",
  version: "0.1.0",
  private: true,
  type: "module",
  scripts: { build: "tsc", dev: "tsx watch src/index.ts", start: "node dist/index.js", lint: "tsc --noEmit" },
  dependencies: {
    "@dpe/shared": "workspace:*",
    fastify: "^5.2.0",
    "@fastify/websocket": "^11.0.1",
    "bonjour-service": "^1.3.0"
  },
  devDependencies: { "@types/node": "^22.10.0", typescript: "^5.7.2", tsx: "^4.19.2" }
}, null, 2) + "\n");

w("apps/lan-agent/tsconfig.json", JSON.stringify({ extends: "../../tsconfig.base.json", compilerOptions: { outDir: "dist", rootDir: "src" }, include: ["src"] }, null, 2) + "\n");

w("apps/lan-agent/src/index.ts", [
  'import os from "node:os";',
  'import Fastify from "fastify";',
  'import websocket from "@fastify/websocket";',
  '',
  'const port = Number(process.env.LAN_AGENT_PORT ?? 3003);',
  'const peers = new Map<string, { uid: string; host: string; port: number; lastSeen: number }>();',
  '',
  'const app = Fastify();',
  'await app.register(websocket);',
  '',
  'app.get("/health", async () => ({ status: "ok", service: "lan-agent" }));',
  '',
  'app.get("/network", async () => ({',
  '  hostname: os.hostname(),',
  '  interfaces: Object.values(os.networkInterfaces()).flat().filter(Boolean).map((i) => ({',
  '    address: i?.address, family: i?.family, internal: i?.internal',
  '  })),',
  '  agentPort: port,',
  '}));',
  '',
  'app.get("/discovery", async () => ({ peers: [...peers.values()] }));',
  '',
  'app.get("/peers", async (req) => {',
  '  const q = (req.query as { uid?: string }).uid?.toLowerCase() ?? "";',
  '  const all = [...peers.values()];',
  '  if (!q) return { peers: all };',
  '  return { peers: all.filter((p) => p.uid.toLowerCase().includes(q)) };',
  '});',
  '',
  'app.register(async (f) => {',
  '  f.get("/ws", { websocket: true }, (socket) => {',
  '    socket.on("message", (msg) => socket.send(msg));',
  '  });',
  '});',
  '',
  'await app.listen({ port, host: "0.0.0.0" });',
  'console.log(`lan-agent on ${port}`);',
  ""].join("\n"));

console.log("scaffold apps part2 done");