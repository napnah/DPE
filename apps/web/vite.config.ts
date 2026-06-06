import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cp = "http://127.0.0.1:3001";
const signal = "http://127.0.0.1:3002";
const lan = "http://127.0.0.1:3003";

/** Same-origin paths used when VITE_DEMO_TUNNEL=1 (remote ngrok → local services on host). */
const demoProxy = {
  "/__dpe/api": { target: cp, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/__dpe\/api/, "") },
  "/__dpe/lan": { target: lan, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/__dpe\/lan/, "") },
  "/__dpe/signal": {
    target: signal,
    changeOrigin: true,
    ws: true,
    rewrite: (p: string) => p.replace(/^\/__dpe\/signal/, ""),
  },
} as const;

export default defineConfig({
  plugins: [react()],
  envDir: repoRoot,
  resolve: {
    alias: {
      "@dpe/crypto": path.join(repoRoot, "packages/crypto/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: demoProxy,
  },
});
