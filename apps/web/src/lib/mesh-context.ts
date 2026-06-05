import type { SecureYjsProvider } from "@dpe/yjs-provider";
import { GroupP2pMesh, type MeshConfig } from "./p2p-mesh";

let active: GroupP2pMesh | null = null;
let activeToken = 0;
let activeKey = "";
/** Providers registered by editors; re-attached whenever mesh restarts. */
const registeredProviders = new Set<SecureYjsProvider>();

function reattachProviders(mesh: GroupP2pMesh): void {
  for (const provider of registeredProviders) {
    mesh.attachProvider(provider);
  }
}

export function getActiveMesh(): GroupP2pMesh | null {
  return active;
}

export function registerMeshProvider(provider: SecureYjsProvider): void {
  registeredProviders.add(provider);
  active?.attachProvider(provider);
  void active?.reauthAllChannels();
}

export function unregisterMeshProvider(provider: SecureYjsProvider): void {
  registeredProviders.delete(provider);
  active?.detachProvider(provider);
}

export type StartedMesh = {
  mesh: GroupP2pMesh;
  token: number;
  owned: boolean;
};

function normalizeSignalingUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.endsWith("/ws") ? trimmed : `${trimmed}/ws`;
}

function meshConfigKey(config: MeshConfig): string {
  // NOTE: signalingUrls are intentionally NOT part of the restart key. Discovery is
  // volatile and the URL set grows over time; restarting the mesh on every change would
  // tear down live WebRTC channels. New URLs are pushed into the running mesh instead.
  return JSON.stringify({
    groupId: config.groupId,
    nodeId: config.nodeId,
    adminPublicKeyBase64Url: config.adminPublicKeyBase64Url,
    members: [...config.memberPublicKeys.entries()].sort(([a], [b]) => a.localeCompare(b)),
  });
}

export async function startGroupMesh(config: MeshConfig): Promise<StartedMesh> {
  const key = meshConfigKey(config);
  if (active && activeKey === key) {
    active.addSignalingUrls(config.signalingUrls?.map(normalizeSignalingUrl) ?? []);
    reattachProviders(active);
    return { mesh: active, token: activeToken, owned: false };
  }

  active?.stop();
  active = null;
  activeKey = "";
  activeToken += 1;

  const mesh = new GroupP2pMesh(config);
  const token = ++activeToken;
  try {
    await mesh.start();
  } catch (e) {
    if (activeToken === token) {
      activeKey = "";
      activeToken += 1;
    }
    throw e;
  }
  if (activeToken !== token) {
    mesh.stop();
    return { mesh, token, owned: false };
  }
  active = mesh;
  activeKey = key;
  reattachProviders(mesh);
  return { mesh, token, owned: true };
}

export async function stopGroupMesh(token?: number): Promise<void> {
  if (typeof token === "number" && token !== activeToken) return;
  active?.stop();
  active = null;
  activeKey = "";
  activeToken += 1;
}
