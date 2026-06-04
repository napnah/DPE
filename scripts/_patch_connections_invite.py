from pathlib import Path

path = Path(__file__).resolve().parents[1] / "apps/web/src/pages/ConnectionsPage.tsx"
text = path.read_text(encoding="utf-8")

old_refresh = """      const [net, disc, inv] = await Promise.all([
        fetchNetwork().catch((e) => {
          setLanError(e instanceof Error ? e.message : "lan-agent 不可用");
          return null;
        }),
        fetchDiscovery().catch(() => ({ peers: [] })),
        api.listInvitations(),
      ]);
      setNetwork(net);
      setPeers(disc.peers ?? []);
      setInvitations(inv);"""

new_refresh = """      const [net, disc] = await Promise.all([
        fetchNetwork().catch((e) => {
          setLanError(e instanceof Error ? e.message : "lan-agent 不可用");
          return null;
        }),
        fetchDiscovery().catch(() => ({ peers: [] })),
      ]);
      setNetwork(net);
      const peerList = disc.peers ?? [];
      setPeers(peerList);
      const inv = await api.listInvitationsFederated(
        identity.nodeId,
        peerList.map((p) => p.host),
      );
      setInvitations(inv);"""

if old_refresh not in text:
    raise SystemExit("refresh block not found")
text = text.replace(old_refresh, new_refresh)

text = text.replace(
    """      const res = await api.acceptInvitation(inv.id, {
        node_id: identity.nodeId,
        public_key: exportPublicKeyBase64Url(pk),
        display_name: identity.displayName,
      });""",
    """      const res = await api.acceptInvitation(
        inv.id,
        {
          node_id: identity.nodeId,
          public_key: exportPublicKeyBase64Url(pk),
          display_name: identity.displayName,
        },
        inv.control_plane_url,
      );""",
)

text = text.replace(
    "      await api.rejectInvitation(inv.id);",
    "      await api.rejectInvitation(inv.id, identity.nodeId, inv.control_plane_url);",
)

text = text.replace(
    '                  <p className="app-muted">来自群组邀请</p>',
    """                  <p className="app-muted">
                    来自群组邀请
                    {inv.control_plane_url && inv.control_plane_url !== api.getApiBaseUrl()
                      ? ` · 群主节点 ${new URL(inv.control_plane_url).host}`
                      : ""}
                  </p>""",
)

text = text.replace(
    """              <span className="app-muted">
                {p.host}:{p.port} · {p.source}
              </span>""",
    """              <span className="app-muted">
                节点 ID：<code>{p.uid}</code> · {p.host}:{p.port} · {p.source}
              </span>""",
)

path.write_text(text, encoding="utf-8")
print("patched", path)
