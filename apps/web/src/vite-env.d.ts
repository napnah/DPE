/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SIGNALING_URL?: string;
  readonly VITE_LAN_AGENT_URL?: string;
  readonly VITE_DEMO_TUNNEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
