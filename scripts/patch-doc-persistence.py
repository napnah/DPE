#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch_schema() -> None:
    p = ROOT / "apps/control-plane/prisma/schema.prisma"
    t = p.read_text(encoding="utf-8")
    if "DocSnapshot" in t:
        print("schema DocSnapshot exists")
        return
    t = t.replace(
        """  group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  keys  DocumentKey[]

  @@id([groupId, docId])
  @@index([groupId, parentDocId])
  @@map("doc_nodes")
}

/// DEV: server-side doc key material""",
        """  group    Group        @relation(fields: [groupId], references: [id], onDelete: Cascade)
  keys     DocumentKey[]
  snapshot DocSnapshot?

  @@id([groupId, docId])
  @@index([groupId, parentDocId])
  @@map("doc_nodes")
}

/// DEV: latest Yjs encoded state for reload (live merge still via P2P SignedUpdate).
model DocSnapshot {
  groupId         String   @map("group_id")
  docId           String   @map("doc_id")
  keyVersion      Int      @map("key_version")
  stateBase64     String   @map("state_base64") @db.Text
  updatedByNodeId String   @map("updated_by_node_id")
  updatedAt       DateTime @updatedAt @map("updated_at")

  doc DocNode @relation(fields: [groupId, docId], references: [groupId, docId], onDelete: Cascade)

  @@id([groupId, docId])
  @@map("doc_snapshots")
}

/// DEV: server-side doc key material""",
    )
    p.write_text(t, encoding="utf-8")
    print("schema.prisma ok")


def patch_dto() -> None:
    p = ROOT / "apps/control-plane/src/groups/groups.dto.ts"
    t = p.read_text(encoding="utf-8")
    if "PutDocSnapshotDto" in t:
        print("dto exists")
        return
    t = t.replace(
        """export interface RefreshJwtDto {
  node_id: string;
  doc_id: string;
}

export interface UpdateGovernanceDto""",
        """export interface RefreshJwtDto {
  node_id: string;
  doc_id: string;
}

export interface PutDocSnapshotDto {
  node_id: string;
  state_update_base64: string;
}

export interface UpdateGovernanceDto""",
    )
    p.write_text(t, encoding="utf-8")
    print("groups.dto.ts ok")


def patch_service() -> None:
    p = ROOT / "apps/control-plane/src/groups/groups.service.ts"
    t = p.read_text(encoding="utf-8")
    if "getDocSnapshot" in t:
        print("service snapshot exists")
        return
    insert = """
  private static readonly MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

  async getDocSnapshot(groupId: string, docId: string, nodeId: string) {
    const group = await this.requireGroup(groupId);
    await this.requireMember(groupId, nodeId);
    const accessLevel = await resolveAccessLevel(
      this.prisma,
      groupId,
      nodeId,
      docId,
      group.ownerNodeId,
    );
    if (accessLevel < 1) {
      throw new ForbiddenException("no access to doc");
    }
    const doc = await this.prisma.docNode.findUnique({
      where: { groupId_docId: { groupId, docId } },
    });
    if (!doc) throw new NotFoundException("doc not found");
    if (doc.isFolder) {
      return { snapshot: null as null };
    }
    const row = await this.prisma.docSnapshot.findUnique({
      where: { groupId_docId: { groupId, docId } },
    });
    if (!row) return { snapshot: null };
    return {
      snapshot: {
        state_update_base64: row.stateBase64,
        key_version: row.keyVersion,
        updated_at: row.updatedAt.toISOString(),
        updated_by_node_id: row.updatedByNodeId,
      },
    };
  }

  async putDocSnapshot(
    groupId: string,
    docId: string,
    nodeId: string,
    stateUpdateBase64: string,
  ) {
    const group = await this.requireGroup(groupId);
    await this.requireMember(groupId, nodeId);
    const accessLevel = await resolveAccessLevel(
      this.prisma,
      groupId,
      nodeId,
      docId,
      group.ownerNodeId,
    );
    if (accessLevel < 2) {
      throw new ForbiddenException("write access required to save snapshot");
    }
    const doc = await this.prisma.docNode.findUnique({
      where: { groupId_docId: { groupId, docId } },
    });
    if (!doc) throw new NotFoundException("doc not found");
    if (doc.isFolder) {
      throw new BadRequestException("folders have no document content");
    }
    let bytes: Uint8Array;
    try {
      bytes = base64UrlToBytes(stateUpdateBase64);
    } catch {
      throw new BadRequestException("invalid state_update_base64");
    }
    if (bytes.length === 0 || bytes.length > GroupsService.MAX_SNAPSHOT_BYTES) {
      throw new BadRequestException("snapshot size out of range");
    }
    await this.prisma.docSnapshot.upsert({
      where: { groupId_docId: { groupId, docId } },
      create: {
        groupId,
        docId,
        keyVersion: doc.keyVersion,
        stateBase64: stateUpdateBase64,
        updatedByNodeId: nodeId,
      },
      update: {
        keyVersion: doc.keyVersion,
        stateBase64: stateUpdateBase64,
        updatedByNodeId: nodeId,
      },
    });
    return { ok: true };
  }

"""
    anchor = "  async refreshJwt(groupId: string, dto: RefreshJwtDto) {"
    if anchor not in t:
        raise SystemExit("refreshJwt anchor missing")
    p.write_text(t.replace(anchor, insert + anchor), encoding="utf-8")
    print("groups.service.ts ok")


def patch_controller() -> None:
    p = ROOT / "apps/control-plane/src/groups/groups.controller.ts"
    t = p.read_text(encoding="utf-8")
    if "doc-snapshot" in t:
        print("controller snapshot exists")
        return
    t = t.replace(
        '  UpdateGovernanceDto,\n  UpdateDisplayNameDto,\n} from "./groups.dto.js";',
        '  UpdateGovernanceDto,\n  UpdateDisplayNameDto,\n  PutDocSnapshotDto,\n} from "./groups.dto.js";',
    )
    block = """
  @Get("groups/:id/docs/:docId/snapshot")
  getDocSnapshot(
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Query("node_id") nodeId: string,
  ) {
    return this.groups.getDocSnapshot(id, docId, nodeId);
  }

  @Post("groups/:id/docs/:docId/snapshot")
  putDocSnapshot(
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Body() body: PutDocSnapshotDto,
  ) {
    return this.groups.putDocSnapshot(id, docId, body.node_id, body.state_update_base64);
  }

"""
    t = t.replace("  @Post(\"groups/:id/jwt/refresh\")", block + "  @Post(\"groups/:id/jwt/refresh\")")
    p.write_text(t, encoding="utf-8")
    print("groups.controller.ts ok")


def patch_api() -> None:
    p = ROOT / "apps/web/src/lib/api.ts"
    t = p.read_text(encoding="utf-8")
    if "getDocSnapshot" in t:
        print("api snapshot exists")
        return
    t = t.replace(
        """  refreshJwt(groupId: string, nodeId: string, docId: string) {
    return request<{ jwt: string; key_version: number; role: number }>(
      `/groups/${groupId}/jwt/refresh`,
      {
        method: "POST",
        body: JSON.stringify({ node_id: nodeId, doc_id: docId }),
      },
    );
  },
""",
        """  refreshJwt(groupId: string, nodeId: string, docId: string) {
    return request<{ jwt: string; key_version: number; role: number }>(
      `/groups/${groupId}/jwt/refresh`,
      {
        method: "POST",
        body: JSON.stringify({ node_id: nodeId, doc_id: docId }),
      },
    );
  },

  getDocSnapshot(groupId: string, docId: string, nodeId: string) {
    return request<{
      snapshot: {
        state_update_base64: string;
        key_version: number;
        updated_at: string;
        updated_by_node_id: string;
      } | null;
    }>(
      `/groups/${groupId}/docs/${encodeURIComponent(docId)}/snapshot?node_id=${encodeURIComponent(nodeId)}`,
    );
  },

  putDocSnapshot(
    groupId: string,
    docId: string,
    body: { node_id: string; state_update_base64: string },
  ) {
    return request<{ ok: boolean }>(
      `/groups/${groupId}/docs/${encodeURIComponent(docId)}/snapshot`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
""",
    )
    p.write_text(t, encoding="utf-8")
    print("api.ts ok")


def patch_editor() -> None:
    p = ROOT / "apps/web/src/components/DocInlineEditor.tsx"
    t = p.read_text(encoding="utf-8")
    if "saveDocStateToLocalStorage" in t:
        print("editor already patched")
        return

    t = t.replace(
        'import { api } from "../lib/api";',
        """import { api } from "../lib/api";
import {
  applyPersistedDocState,
  docStateFromBase64Url,
  docStateToBase64Url,
  loadDocStateFromLocalStorage,
  saveDocStateToLocalStorage,
} from "../lib/doc-persistence";""",
    )

    old_block = """        const doc = new Y.Doc();
        const ytext = doc.getText("content");
        const storageKey = `dpe_doc_${groupId}_${docId}`;

        const saved = localStorage.getItem(storageKey);
        if (saved) {
          Y.applyUpdate(doc, Uint8Array.from(JSON.parse(saved) as number[]), DPE_PROVIDER_ORIGIN);
        }

        const provider = new SecureYjsProvider({"""

    new_block = """        const doc = new Y.Doc();
        const ytext = doc.getText("content");
        const storageKey = `dpe_doc_${groupId}_${docId}`;

        const localState = loadDocStateFromLocalStorage(storageKey);
        if (localState) {
          applyPersistedDocState(doc, localState, DPE_PROVIDER_ORIGIN);
        }

        try {
          const remote = await api.getDocSnapshot(groupId, docId, nodeId);
          if (!cancelled && remote.snapshot?.state_update_base64) {
            applyPersistedDocState(
              doc,
              docStateFromBase64Url(remote.snapshot.state_update_base64),
              DPE_PROVIDER_ORIGIN,
            );
          }
        } catch {
          /* snapshot API optional while offline */
        }

        const provider = new SecureYjsProvider({"""

    if old_block not in t:
        raise SystemExit("editor load block not found")
    t = t.replace(old_block, new_block)

    t = t.replace(
        """        const onDocUpdate = (update: Uint8Array, origin: unknown) => {
          if (origin === DPE_PROVIDER_ORIGIN) return;
          localStorage.setItem(storageKey, JSON.stringify([...update]));
          setSavedAt(new Date().toLocaleTimeString());
        };
        doc.on("update", onDocUpdate);""",
        """        let remoteSaveTimer: ReturnType<typeof setTimeout> | null = null;

        const persistDoc = () => {
          saveDocStateToLocalStorage(storageKey, doc);
          setSavedAt(new Date().toLocaleTimeString());
          if (!writable) return;
          if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
          remoteSaveTimer = setTimeout(() => {
            void api
              .putDocSnapshot(groupId, docId, {
                node_id: nodeId,
                state_update_base64: docStateToBase64Url(
                  Y.encodeStateAsUpdate(doc),
                ),
              })
              .catch(() => {
                /* keep local draft if server unavailable */
              });
          }, 800);
        };

        const onDocUpdate = (_update: Uint8Array, origin: unknown) => {
          if (origin === DPE_PROVIDER_ORIGIN) return;
          persistDoc();
        };
        doc.on("update", onDocUpdate);""",
    )

    t = t.replace(
        """        engineRef.current = {
          doc,
          ytext,
          provider,
          storageKey,
          writable,
          onDocUpdate,
        };""",
        """        engineRef.current = {
          doc,
          ytext,
          provider,
          storageKey,
          writable,
          onDocUpdate,
          remoteSaveTimer,
        };""",
    )

    t = t.replace(
        """type EditorEngine = {
  doc: Y.Doc;
  ytext: Y.Text;
  provider: SecureYjsProvider;
  storageKey: string;
  writable: boolean;
  onDocUpdate: (update: Uint8Array, origin: unknown) => void;
};""",
        """type EditorEngine = {
  doc: Y.Doc;
  ytext: Y.Text;
  provider: SecureYjsProvider;
  storageKey: string;
  writable: boolean;
  onDocUpdate: (update: Uint8Array, origin: unknown) => void;
  remoteSaveTimer: ReturnType<typeof setTimeout> | null;
};""",
    )

    t = t.replace(
        """      const eng = engineRef.current;
      if (eng) {
        getActiveMesh()?.detachProvider(eng.provider);
        eng.doc.off("update", eng.onDocUpdate);
        eng.provider.destroy();
        eng.doc.destroy();
        engineRef.current = null;
      }""",
        """      const eng = engineRef.current;
      if (eng) {
        if (eng.remoteSaveTimer) clearTimeout(eng.remoteSaveTimer);
        saveDocStateToLocalStorage(eng.storageKey, eng.doc);
        getActiveMesh()?.detachProvider(eng.provider);
        eng.doc.off("update", eng.onDocUpdate);
        eng.provider.destroy();
        eng.doc.destroy();
        engineRef.current = null;
      }""",
    )

    p.write_text(t, encoding="utf-8")
    print("DocInlineEditor.tsx ok")


def patch_editor_cancelled_save() -> None:
    p = ROOT / "apps/web/src/components/DocInlineEditor.tsx"
    t = p.read_text(encoding="utf-8")
    old = """        if (cancelled) {
          getActiveMesh()?.detachProvider(provider);
          doc.off("update", onDocUpdate);
          provider.destroy();
          doc.destroy();
          engineRef.current = null;
          return;
        }"""
    new = """        if (cancelled) {
          if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
          saveDocStateToLocalStorage(storageKey, doc);
          getActiveMesh()?.detachProvider(provider);
          doc.off("update", onDocUpdate);
          provider.destroy();
          doc.destroy();
          engineRef.current = null;
          return;
        }"""
    if old in t:
        p.write_text(t.replace(old, new), encoding="utf-8")
        print("editor cancelled-save ok")


if __name__ == "__main__":
    patch_schema()
    patch_dto()
    patch_service()
    patch_controller()
    patch_api()
    patch_editor()
    patch_editor_cancelled_save()
