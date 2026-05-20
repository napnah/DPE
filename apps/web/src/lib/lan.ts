const LAN = import.meta.env.VITE_LAN_AGENT_URL ?? "http://localhost:3003";

export type LanPeer = {
  uid: string;
  host: string;
  port: number;
  name?: string;
  source: string;
  lastSeen: number;
};

export async function fetchNetwork() {
  return fetch(`${LAN}/network`).then((r) => r.json());
}

export async function fetchDiscovery(): Promise<{ peers: LanPeer[] }> {
  const res = await fetch(`${LAN}/discovery`);
  if (!res.ok) throw new Error(`lan-agent ${res.status}`);
  return res.json();
}

export async function searchPeers(uidPrefix: string): Promise<{ peers: LanPeer[] }> {
  const q = uidPrefix.trim();
  const res = await fetch(`${LAN}/peers?uid=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`lan-agent ${res.status}`);
  return res.json();
}
