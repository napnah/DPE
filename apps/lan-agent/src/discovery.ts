import { Bonjour, type Service } from "bonjour-service";
import { DPE_MDNS_SERVICE_TYPE } from "@dpe/p2p";
import { probeLanAgents } from "./probe.js";
import { parseProbeHosts } from "./network.js";

export type LanPeer = {
  uid: string;
  host: string;
  port: number;
  name?: string;
  source: "mdns" | "manual" | "probe";
  lastSeen: number;
};

export type DiscoveryAdapter = {
  start(): void;
  stop(): void;
  getPeers(): LanPeer[];
  registerManual(peer: Omit<LanPeer, "source" | "lastSeen">): void;
  onUpdate(handler: (peers: LanPeer[]) => void): () => void;
};

export type LocalAgentIdentity = {
  uid: string;
  displayName: string;
  port: number;
  host: string;
};

function parseManualPeers(raw: string | undefined): LanPeer[] {
  if (!raw?.trim()) return [];
  const now = Date.now();
  const out: LanPeer[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf("@");
    let uid: string;
    let hostPort: string;
    if (at >= 0) {
      uid = trimmed.slice(0, at);
      hostPort = trimmed.slice(at + 1);
    } else {
      hostPort = trimmed;
      uid = hostPort.split(":")[0] ?? trimmed;
    }
    const colon = hostPort.lastIndexOf(":");
    if (colon < 0) continue;
    const host = hostPort.slice(0, colon);
    const port = Number(hostPort.slice(colon + 1));
    if (!host || !Number.isFinite(port)) continue;
    out.push({ uid, host, port, source: "manual", lastSeen: now });
  }
  return out;
}

export function createDiscovery(
  identity: LocalAgentIdentity,
  options?: {
    manualPeersEnv?: string;
    probeHostsEnv?: string;
    enableMdns?: boolean;
    mdnsInterface?: string;
  },
): DiscoveryAdapter {
  const enableMdns = options?.enableMdns ?? process.env.DPE_DISABLE_MDNS !== "1";
  const manual = parseManualPeers(
    options?.manualPeersEnv ?? process.env.DPE_MANUAL_PEERS,
  );
  const probeHosts = parseProbeHosts(
    options?.probeHostsEnv ?? process.env.DPE_DISCOVERY_PROBE_HOSTS,
    identity.port,
  );
  const mdnsInterface = options?.mdnsInterface;

  const byUid = new Map<string, LanPeer>();
  for (const p of manual) byUid.set(p.uid.toLowerCase(), p);

  const handlers = new Set<(peers: LanPeer[]) => void>();
  let bonjour: Bonjour | null = null;
  let publish: Service | null = null;
  let browser: ReturnType<Bonjour["find"]> | null = null;
  let probeTimer: ReturnType<typeof setInterval> | null = null;

  const emit = () => {
    const peers = [...byUid.values()].sort((a, b) => a.uid.localeCompare(b.uid));
    for (const h of handlers) h(peers);
  };

  const upsert = (peer: LanPeer, preferSource?: LanPeer["source"]) => {
    const key = peer.uid.toLowerCase();
    const existing = byUid.get(key);
    if (existing && existing.source === "manual" && preferSource !== "manual") {
      return;
    }
    byUid.set(key, { ...peer, lastSeen: Date.now() });
    emit();
  };

  const runProbe = async () => {
    if (probeHosts.length === 0) return;
    const found = await probeLanAgents(probeHosts, identity.port, identity.uid);
    for (const p of found) {
      upsert({ ...p, source: "probe", lastSeen: Date.now() });
    }
  };

  return {
    start() {
      if (enableMdns) {
        try {
          // multicast-dns accepts `interface`; types on bonjour-service omit it.
          bonjour = new Bonjour(
            (mdnsInterface ? { interface: mdnsInterface } : undefined) as ConstructorParameters<
              typeof Bonjour
            >[0],
          );
          publish = bonjour.publish({
            name: identity.displayName,
            type: DPE_MDNS_SERVICE_TYPE,
            port: identity.port,
            txt: { uid: identity.uid, host: identity.host },
          });
          browser = bonjour.find({ type: DPE_MDNS_SERVICE_TYPE });
          browser.on("up", (svc: Service) => {
            const uid = svc.txt?.uid ?? svc.name;
            if (!uid || uid === identity.uid) return;
            const host =
              (svc.referer?.address as string | undefined) ??
              svc.txt?.host ??
              svc.host ??
              svc.addresses?.[0];
            if (!host) return;
            upsert({
              uid,
              host,
              port: svc.port,
              name: svc.name,
              source: "mdns",
              lastSeen: Date.now(),
            });
          });
          browser.on("down", (svc: Service) => {
            const uid = svc.txt?.uid ?? svc.name;
            if (!uid) return;
            const key = uid.toLowerCase();
            const existing = byUid.get(key);
            if (existing?.source === "mdns") {
              byUid.delete(key);
              emit();
            }
          });
        } catch (e) {
          console.warn("[lan-agent] mDNS unavailable:", e);
        }
      }

      if (probeHosts.length > 0) {
        void runProbe();
        probeTimer = setInterval(() => void runProbe(), 15_000);
      }

      emit();
    },
    stop() {
      if (probeTimer) clearInterval(probeTimer);
      probeTimer = null;
      browser?.stop();
      publish?.stop?.();
      bonjour?.destroy();
      browser = null;
      publish = null;
      bonjour = null;
    },
    getPeers: () => [...byUid.values()],
    registerManual(peer) {
      upsert(
        {
          ...peer,
          source: "manual",
          lastSeen: Date.now(),
        },
        "manual",
      );
    },
    onUpdate(handler) {
      handlers.add(handler);
      handler(this.getPeers());
      return () => handlers.delete(handler);
    },
  };
}
