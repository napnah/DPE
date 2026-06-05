export type ProbePeer = {
  uid: string;
  host: string;
  port: number;
  name?: string;
  agentUrl?: string;
  controlUrl?: string;
  signalingUrl?: string;
  webUrl?: string;
};

/** Unicast fallback when mDNS from host → VM is blocked (common on NAT virtual NICs). */
export async function probeLanAgents(
  hosts: string[],
  port: number,
  selfUid: string,
): Promise<ProbePeer[]> {
  const found: ProbePeer[] = [];
  await Promise.all(
    hosts.map(async (host) => {
      if (!host || host === "127.0.0.1" || host === "localhost") return;
      const url = `http://${host}:${port}/manifest`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) return;
        const manifest = (await res.json()) as {
          node_id?: string;
          uid?: string;
          hostname?: string;
          display_name?: string;
          agentHost?: string;
          host?: string;
          port?: number;
          agent_url?: string;
          control_url?: string;
          signaling_url?: string;
          web_url?: string;
        };
        const uid = (manifest.node_id ?? manifest.uid)?.trim();
        if (!uid || uid.toLowerCase() === selfUid.toLowerCase()) return;
        const peerHost = manifest.host?.trim() || manifest.agentHost?.trim() || host;
        const peerPort = Number.isFinite(manifest.port) ? Number(manifest.port) : port;
        found.push({
          uid,
          host: peerHost,
          port: peerPort,
          name: manifest.display_name ?? manifest.hostname,
          agentUrl: manifest.agent_url,
          controlUrl: manifest.control_url,
          signalingUrl: manifest.signaling_url,
          webUrl: manifest.web_url,
        });
      } catch {
        /* peer offline or firewall */
      }
    }),
  );
  return found;
}
