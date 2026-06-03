import type { SecureYjsProvider } from "@dpe/yjs-provider";
import { GroupP2pMesh, type MeshConfig } from "./p2p-mesh";

let active: GroupP2pMesh | null = null;
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
}

export function unregisterMeshProvider(provider: SecureYjsProvider): void {
  registeredProviders.delete(provider);
  active?.detachProvider(provider);
}

export async function startGroupMesh(config: MeshConfig): Promise<GroupP2pMesh> {
  await stopGroupMesh();
  const mesh = new GroupP2pMesh(config);
  await mesh.start();
  active = mesh;
  reattachProviders(mesh);
  return mesh;
}

export async function stopGroupMesh(): Promise<void> {
  active?.stop();
  active = null;
}
