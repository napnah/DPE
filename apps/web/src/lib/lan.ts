import { resolveLanAgentBaseUrl, resolveSignalingWebSocketUrl } from "./dev-tunnel";

const LAN = resolveLanAgentBaseUrl();

export type LanPeer = {
  uid: string;
  host: string;
  port: number;
  name?: string;
  agentUrl: string;
  controlUrl: string;
  signalingUrl: string;
  webUrl: string;
  source: string;
  lastSeen: number;
};

async function lanFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${LAN}${path}`, init);
  } catch {
    throw new Error(
      `无法连接 lan-agent (${LAN})。请在本机运行: pnpm dev 或 pnpm --filter @dpe/lan-agent dev`,
    );
  }
}

export async function fetchNetwork(): Promise<Record<string, unknown>> {
  const res = await lanFetch("/network");
  if (!res.ok) throw new Error(`lan-agent /network 返回 ${res.status}`);
  return res.json();
}

export async function fetchDiscovery(): Promise<{ peers: LanPeer[] }> {
  const res = await lanFetch("/discovery");
  if (!res.ok) throw new Error(`lan-agent /discovery 返回 ${res.status}`);
  return res.json();
}

export async function searchPeers(uidPrefix: string): Promise<{ peers: LanPeer[] }> {
  const q = uidPrefix.trim();
  const res = await lanFetch(`/peers?uid=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`lan-agent /peers 返回 ${res.status}`);
  return res.json();
}

export function getLanAgentBaseUrl(): string {
  return LAN;
}

function normalizeSignalingUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.endsWith("/ws") ? trimmed : `${trimmed}/ws`;
}

/** Derive ws://<control-host>:3002/ws from the group's control-plane base URL. */
export function deriveSignalingUrlFromControlPlane(controlPlaneUrl: string): string | null {
  try {
    const host = new URL(controlPlaneUrl.trim()).hostname;
    if (!host) return null;
    return normalizeSignalingUrl(`ws://${host}:3002`);
  } catch {
    return null;
  }
}

/**
 * Symmetric P2P rendezvous: each node runs signaling; mesh joins
 * local + every discovered neighbor (+ env/CP fallbacks).
 */
export function buildMeshSignalingUrls(opts: {
  localSignalingUrl?: string;
  peerSignalingUrls?: string[];
  /** Additive fallback when joining via remote group control URL */
  controlPlaneUrl?: string;
}): string[] {
  const urls = new Set<string>();
  if (opts.localSignalingUrl?.trim()) {
    urls.add(normalizeSignalingUrl(opts.localSignalingUrl));
  }
  for (const raw of opts.peerSignalingUrls ?? []) {
    if (raw.trim()) urls.add(normalizeSignalingUrl(raw));
  }
  const envDefault = resolveSignalingWebSocketUrl();
  urls.add(normalizeSignalingUrl(envDefault));
  if (opts.controlPlaneUrl) {
    const derived = deriveSignalingUrlFromControlPlane(opts.controlPlaneUrl);
    if (derived) urls.add(derived);
  }
  return [...urls].sort();
}

/** This node's LAN-advertised signaling URL (from lan-agent /network). */
export async function fetchLocalSignalingUrl(): Promise<string | undefined> {
  try {
    const net = await fetchNetwork();
    const url = net.signalingUrl;
    return typeof url === "string" && url.trim() ? url.trim() : undefined;
  } catch {
    return undefined;
  }
}

function lanAgentWsUrl(): string {
  const base = LAN.trim().replace(/\/$/, "");
  if (base.startsWith("https://")) return `wss://${base.slice(8)}/ws`;
  if (base.startsWith("http://")) return `ws://${base.slice(7)}/ws`;
  return `ws://${base}/ws`;
}

/** Live neighbor updates from lan-agent (mDNS / probe / manual). */
export function subscribeDiscovery(onPeers: (peers: LanPeer[]) => void): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(lanAgentWsUrl());
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type?: string; peers?: LanPeer[] };
        if (msg.type === "discovery" && Array.isArray(msg.peers)) onPeers(msg.peers);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      ws = null;
      if (!closed) retryTimer = setTimeout(connect, 2000);
    };
    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();
  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    ws?.close();
  };
}

/** 将登录后的 nodeId 同步到 lan-agent/mDNS，避免邻居列表显示错误的 DPE_NODE_ID */
export async function syncLanAgentNodeId(nodeId: string): Promise<void> {
  const id = nodeId.trim();
  if (!id) return;
  try {
    await lanFetch("/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ node_id: id }),
    });
  } catch {
    /* lan-agent 未启动时忽略 */
  }
}
