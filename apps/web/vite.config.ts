import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
    // Allow ngrok / tunnel Host headers (subdomain changes each session).
    allowedHosts: true,
  },
});
