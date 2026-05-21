import os from "node:os";

export type Ipv4Entry = { iface: string; address: string };

export function listIpv4Addresses(): Ipv4Entry[] {
  const out: Ipv4Entry[] = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a && a.family === "IPv4" && !a.internal) {
        out.push({ iface, address: a.address });
      }
    }
  }
  return out;
}

function isVirtualIfaceName(name: string): boolean {
  return /vmware|virtualbox|vbox|hyper-v|vethernet|wsl|docker|npcap|loopback/i.test(name);
}

/** Prefer DPE_AGENT_HOST / DPE_LAN_HOST, then 192.168.x on a non-virtual NIC. */
export function pickLanAddress(): string {
  const entries = listIpv4Addresses();
  const prefer = process.env.DPE_AGENT_HOST?.trim() || process.env.DPE_LAN_HOST?.trim();
  if (prefer && entries.some((e) => e.address === prefer)) return prefer;

  const physical = entries.filter((e) => !isVirtualIfaceName(e.iface));
  const pool = physical.length > 0 ? physical : entries;

  const lan192 = pool.find((e) => e.address.startsWith("192.168."));
  if (lan192) return lan192.address;

  const lan10 = pool.find((e) => e.address.startsWith("10."));
  if (lan10) return lan10.address;

  return pool[0]?.address ?? "127.0.0.1";
}

export function resolveMdnsInterface(agentHost: string): string | undefined {
  const explicit = process.env.DPE_MDNS_INTERFACE?.trim();
  if (explicit) return explicit;

  const entries = listIpv4Addresses();
  if (entries.some((e) => e.address === agentHost)) return agentHost;

  return undefined;
}

export function parseProbeHosts(raw: string | undefined, defaultPort: number): string[] {
  if (!raw?.trim()) return [];
  const hosts = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const t = part.trim();
    if (!t) continue;
    try {
      if (t.includes("://")) {
        hosts.add(new URL(t).hostname);
        continue;
      }
      if (t.includes(":")) {
        hosts.add(t.slice(0, t.lastIndexOf(":")));
        continue;
      }
      hosts.add(t);
    } catch {
      hosts.add(t);
    }
  }
  return [...hosts];
}
