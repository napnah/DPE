import { GroupP2pMesh, type MeshConfig } from "./p2p-mesh";

let active: GroupP2pMesh | null = null;

export function getActiveMesh(): GroupP2pMesh | null {
  return active;
}

export async function startGroupMesh(config: MeshConfig): Promise<GroupP2pMesh> {
  await stopGroupMesh();
  const mesh = new GroupP2pMesh(config);
  await mesh.start();
  active = mesh;
  return mesh;
}

export async function stopGroupMesh(): Promise<void> {
  active?.stop();
  active = null;
}
