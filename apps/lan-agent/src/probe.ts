export type ProbePeer = {
  uid: string;
  host: string;
  port: number;
  name?: string;
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
      const url = `http://${host}:${port}/network`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) return;
        const net = (await res.json()) as {
          node_id?: string;
          hostname?: string;
          agentHost?: string;
        };
        const uid = net.node_id?.trim();
        if (!uid || uid.toLowerCase() === selfUid.toLowerCase()) return;
        found.push({
          uid,
          host: net.agentHost?.trim() || host,
          port,
          name: net.hostname,
        });
      } catch {
        /* peer offline or firewall */
      }
    }),
  );
  return found;
}
