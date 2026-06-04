#!/usr/bin/env python3
"""Fix doc key open + RenameDoc backend + GroupPage delete/rename UI."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch_doc_inline_editor() -> None:
    p = ROOT / "apps/web/src/components/DocInlineEditor.tsx"
    t = p.read_text(encoding="utf-8")
    t = t.replace(
        "import { openDocKey, parseJwtPayload, importPublicKeyBase64Url } from \"@dpe/crypto\";",
        "import {\n  openDocKeyForEd25519,\n  parseJwtPayload,\n  importPublicKeyBase64Url,\n} from \"@dpe/crypto\";",
    )
    t = t.replace(
        "const docKey = await openDocKey(sk, payload.doc_key);",
        "const docKey = await openDocKeyForEd25519(sk, payload.doc_key);",
    )
    p.write_text(t, encoding="utf-8")
    print("DocInlineEditor.tsx ok")


def patch_groups_service() -> None:
    p = ROOT / "apps/control-plane/src/groups/groups.service.ts"
    t = p.read_text(encoding="utf-8")
    old = """    if (rpc.op === "DeleteDoc") {
      if (rpc.doc_id === ROOT_DOC_ID) {
        throw new BadRequestException("cannot delete root folder");
      }
      await this.requireOperable(groupId, callerNodeId, rpc.doc_id);
      const childCount = await this.prisma.docNode.count({
        where: { groupId, parentDocId: rpc.doc_id },
      });
      if (childCount > 0) {
        throw new BadRequestException("folder is not empty");
      }
      await this.prisma.docNode.delete({
        where: { groupId_docId: { groupId, docId: rpc.doc_id } },
      });
      await this.prisma.aclGrant.deleteMany({ where: { groupId, docId: rpc.doc_id } });
      return { ok: true };
    }

    throw new BadRequestException("unknown rpc");"""
    new = """    if (rpc.op === "RenameDoc") {
      if (rpc.doc_id === ROOT_DOC_ID) {
        throw new BadRequestException("cannot rename root folder");
      }
      await this.requireOperable(groupId, callerNodeId, rpc.doc_id);
      const title = rpc.title.trim();
      if (!title) throw new BadRequestException("title required");
      await this.prisma.docNode.update({
        where: { groupId_docId: { groupId, docId: rpc.doc_id } },
        data: { title },
      });
      return { ok: true };
    }

    if (rpc.op === "DeleteDoc") {
      if (rpc.doc_id === ROOT_DOC_ID) {
        throw new BadRequestException("cannot delete root folder");
      }
      await this.requireOperable(groupId, callerNodeId, rpc.doc_id);
      const childCount = await this.prisma.docNode.count({
        where: { groupId, parentDocId: rpc.doc_id },
      });
      if (childCount > 0) {
        throw new BadRequestException("folder is not empty");
      }
      await this.prisma.$transaction([
        this.prisma.docRoleAcl.deleteMany({ where: { groupId, docId: rpc.doc_id } }),
        this.prisma.aclGrant.deleteMany({ where: { groupId, docId: rpc.doc_id } }),
        this.prisma.docNode.delete({
          where: { groupId_docId: { groupId, docId: rpc.doc_id } },
        }),
      ]);
      return { ok: true };
    }

    throw new BadRequestException("unknown rpc");"""
    if old not in t:
        raise SystemExit("groups.service DeleteDoc block not found")
    p.write_text(t.replace(old, new), encoding="utf-8")
    print("groups.service.ts ok")


def patch_group_page() -> None:
    p = ROOT / "apps/web/src/pages/GroupPage.tsx"
    t = p.read_text(encoding="utf-8")

    if "renameTitle" not in t:
        t = t.replace(
            '  const [newItemTitle, setNewItemTitle] = useState("");',
            '  const [newItemTitle, setNewItemTitle] = useState("");\n'
            '  const [renameTitle, setRenameTitle] = useState("");',
        )

    if "useEffect(() => {\n    setRenameTitle" not in t:
        insert_after = "  const selectedIsFolder = selectedNode ? isFolder(selectedNode) : true;\n\n"
        block = """  const selectedIsFolder = selectedNode ? isFolder(selectedNode) : true;

  useEffect(() => {
    setRenameTitle(selectedNode?.title ?? "");
  }, [selectedId, selectedNode?.title]);

"""
        if insert_after not in t:
            raise SystemExit("GroupPage selectedIsFolder anchor not found")
        t = t.replace(insert_after, block)

    if "async function renameSelected" not in t:
        t = t.replace(
            """  async function createChild(is_folder: boolean) {
    if (!nodeId || !parentIsFolder) return;
""",
            """  async function renameSelected() {
    if (!nodeId || selectedId === ROOT_DOC_ID) return;
    const title = renameTitle.trim();
    if (!title) {
      setError("名称不能为空");
      return;
    }
    try {
      await api.renameDoc(gid, nodeId, selectedId, title);
      await refreshTree();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "重命名失败");
    }
  }

  async function deleteSelected() {
    if (!nodeId || selectedId === ROOT_DOC_ID) return;
    const label = selectedNode?.title ?? selectedId;
    const hint = selectedIsFolder
      ? "仅可删除空目录，且无法恢复。"
      : "删除后无法恢复。";
    if (!window.confirm(`确定删除「${label}」？${hint}`)) return;
    try {
      await api.deleteDoc(gid, nodeId, selectedId);
      localStorage.removeItem(`dpe_doc_${gid}_${selectedId}`);
      const parentId = selectedNode?.parentDocId ?? ROOT_DOC_ID;
      await refreshTree();
      selectNode(parentId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function createChild(is_folder: boolean) {
    if (!nodeId || !parentIsFolder) return;
""",
        )

    sidebar_marker = '          </div>\n        </aside>'
    manage_ui = """          </div>
          {selectedId !== ROOT_DOC_ID && (
            <div className="app-group-sidebar__manage">
              <h3>当前项</h3>
              <label className="app-muted" htmlFor="rename-doc-title">
                名称
              </label>
              <input
                id="rename-doc-title"
                className="app-input"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void renameSelected();
                }}
              />
              <div className="app-form-row">
                <button type="button" className="app-btn" onClick={() => void renameSelected()}>
                  重命名
                </button>
                <button
                  type="button"
                  className="app-btn app-btn--danger"
                  onClick={() => void deleteSelected()}
                >
                  删除
                </button>
              </div>
              <p className="app-muted app-group-sidebar__hint">
                需要对该节点具备可治理权限（角色 ≥ 3）。目录须为空才能删除。
              </p>
            </div>
          )}
        </aside>"""
    if "app-group-sidebar__manage" not in t:
        if sidebar_marker not in t:
            raise SystemExit("GroupPage sidebar end marker not found")
        t = t.replace(sidebar_marker, manage_ui)

    p.write_text(t, encoding="utf-8")
    print("GroupPage.tsx ok")


if __name__ == "__main__":
    patch_doc_inline_editor()
    patch_groups_service()
    patch_group_page()
