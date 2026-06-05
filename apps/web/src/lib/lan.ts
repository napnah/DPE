const LAN = import.meta.env.VITE_LAN_AGENT_URL ?? "http://localhost:3003";

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
