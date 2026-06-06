/** Remote demo via ngrok: one tunnel to Vite; API/LAN proxied on the host. */

function envDemoTunnelEnabled(): boolean {
  const flag = import.meta.env.VITE_DEMO_TUNNEL;
  return flag === "1" || flag === "true";
}

export function isPrivateNetworkHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    /^192\.168\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function isLocalBrowserHost(hostname: string): boolean {
  return isPrivateNetworkHost(hostname);
}

/** Use Vite same-origin proxy paths (set VITE_DEMO_TUNNEL=1 when exposing :5173 via ngrok). */
export function useDemoTunnelProxy(): boolean {
  return envDemoTunnelEnabled();
}

/** Remote ngrok viewer: HTTP via proxy works; skip P2P (stays on host LAN only). */
export function isRemoteDemoViewer(): boolean {
  if (!envDemoTunnelEnabled()) return false;
  if (typeof location === "undefined") return false;
  return !isLocalBrowserHost(location.hostname);
}

export function resolveControlPlaneBaseUrl(envUrl?: string): string {
  if (useDemoTunnelProxy()) return "/__dpe/api";
  return (envUrl ?? import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

export function resolveLanAgentBaseUrl(envUrl?: string): string {
  if (useDemoTunnelProxy()) return "/__dpe/lan";
  return (envUrl ?? import.meta.env.VITE_LAN_AGENT_URL ?? "http://localhost:3003").replace(/\/$/, "");
}

/**
 * Remote demo viewers cannot reach LAN control-plane URLs; map them to the Vite proxy.
 */
export function resolveClientControlPlaneUrl(url: string | undefined | null): string | undefined {
  const trimmed = url?.trim().replace(/\/$/, "");
  if (!trimmed) return undefined;
  if (!isRemoteDemoViewer()) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  try {
    if (isPrivateNetworkHost(new URL(trimmed).hostname)) {
      return resolveControlPlaneBaseUrl().replace(/\/$/, "");
    }
  } catch {
    /* keep trimmed */
  }
  return trimmed;
}

export function resolveSignalingWebSocketUrl(envUrl?: string): string {
  if (useDemoTunnelProxy()) {
    if (typeof location === "undefined") return "ws://127.0.0.1:3002/ws";
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/__dpe/signal/ws`;
  }
  const raw = envUrl ?? import.meta.env.VITE_SIGNALING_URL ?? "ws://localhost:3002/ws";
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.endsWith("/ws") ? trimmed : `${trimmed}/ws`;
}
