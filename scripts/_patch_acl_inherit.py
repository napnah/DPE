"""Patch ACL inherit + operable fixes."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch_rbac():
    p = ROOT / "apps/control-plane/src/groups/groups-rbac.ts"
    text = p.read_text(encoding="utf-8")
    insert = """
/** Copy parent doc role ACL rows onto a newly created child doc. */
export async function inheritParentDocAcl(
  tx: Tx,
  groupId: string,
  parentDocId: string,
  childDocId: string,
  ownerNodeId: string,
) {
  const parentAcls = await tx.docRoleAcl.findMany({
    where: { groupId, docId: parentDocId },
  });
  for (const row of parentAcls) {
    await tx.docRoleAcl.create({
      data: {
        groupId,
        docId: childDocId,
        roleId: row.roleId,
        accessLevel: row.accessLevel,
      },
    });
  }
  const members = await tx.memberRoleAssignment.findMany({ where: { groupId } });
  for (const m of members) {
    await syncMemberAllDocs(tx, groupId, m.nodeId, ownerNodeId);
  }
}

/** Operable (level 3) callers may only change ACL for roles currently below operable on this doc. */
export function canEditDocRoleAcl(
  callerIsOwner: boolean,
  callerLevel: number,
  targetRoleLevel: number,
): boolean {
  if (callerIsOwner) return true;
  if (callerLevel < 3) return false;
  return targetRoleLevel < 3;
}

"""
    marker = "export async function syncMemberDocGrant"
    if "inheritParentDocAcl" not in text:
        text = text.replace(marker, insert + marker)
        p.write_text(text, encoding="utf-8")
        print("rbac: ok")
    else:
        print("rbac: skip")


def patch_service():
    p = ROOT / "apps/control-plane/src/groups/groups.service.ts"
    text = p.read_text(encoding="utf-8")

    old_import = """import {
  applyCreateChildTemplate,
  resolveAccessLevel,
  resolveMyRolesOnDoc,
  ensureGroupRbac,
  seedGroupRbac,
  syncAllMembersForDocRole,
  syncMemberAllDocs,
  syncMemberDocGrant,
} from "./groups-rbac.js";"""
    new_import = """import {
  canEditDocRoleAcl,
  inheritParentDocAcl,
  resolveAccessLevel,
  resolveMyRolesOnDoc,
  ensureGroupRbac,
  seedGroupRbac,
  syncAllMembersForDocRole,
  syncMemberAllDocs,
} from "./groups-rbac.js";"""
    if old_import in text:
        text = text.replace(old_import, new_import)

    old_set_acl = """    if (rpc.op === "SetDocRoleAcl") {
      await this.requireOperable(groupId, callerNodeId, rpc.doc_id);
      const doc = await this.prisma.docNode.findUnique({
        where: { groupId_docId: { groupId, docId: rpc.doc_id } },
      });
      if (!doc) throw new NotFoundException("doc not found");
      const role = await this.prisma.groupRole.findFirst({
        where: { id: rpc.group_role_id, groupId },
      });
      if (!role) throw new NotFoundException("group role not found");
      await this.prisma.$transaction(async (tx) => {"""
    new_set_acl = """    if (rpc.op === "SetDocRoleAcl") {
      const group = await this.requireGroup(groupId);
      const callerLevel = await resolveAccessLevel(
        this.prisma,
        groupId,
        callerNodeId,
        rpc.doc_id,
        group.ownerNodeId,
      );
      const isOwner = group.ownerNodeId === callerNodeId;
      if (!isOwner && callerLevel < 3) {
        throw new ForbiddenException("operable role required on doc");
      }
      const doc = await this.prisma.docNode.findUnique({
        where: { groupId_docId: { groupId, docId: rpc.doc_id } },
      });
      if (!doc) throw new NotFoundException("doc not found");
      const role = await this.prisma.groupRole.findFirst({
        where: { id: rpc.group_role_id, groupId },
      });
      if (!role) throw new NotFoundException("group role not found");
      const existing = await this.prisma.docRoleAcl.findUnique({
        where: {
          groupId_docId_roleId: {
            groupId,
            docId: rpc.doc_id,
            roleId: rpc.group_role_id,
          },
        },
      });
      const targetLevel = existing?.accessLevel ?? 0;
      if (!canEditDocRoleAcl(isOwner, callerLevel, targetLevel)) {
        throw new ForbiddenException("cannot change ACL for operable-level roles");
      }
      await this.prisma.$transaction(async (tx) => {"""
    if old_set_acl in text:
        text = text.replace(old_set_acl, new_set_acl)

    old_create = """      const rules = await this.prisma.groupDefaultRules.findUnique({ where: { groupId } });
      const group = await this.requireGroup(groupId);
      if (rules) {
        const template = rules.createChildTemplate as Record<string, number>;
        await this.prisma.$transaction(async (tx) => {
          await applyCreateChildTemplate(tx, groupId, rpc.doc_id, template);
          await syncMemberDocGrant(tx, groupId, callerNodeId, rpc.doc_id, 3);
          const members = await tx.memberRoleAssignment.findMany({ where: { groupId } });
          for (const m of members) {
            await syncMemberAllDocs(tx, groupId, m.nodeId, group.ownerNodeId);
          }
        });
      }
      return { ok: true, doc_id: rpc.doc_id };"""
    new_create = """      const group = await this.requireGroup(groupId);
      await this.prisma.$transaction(async (tx) => {
        await inheritParentDocAcl(
          tx,
          groupId,
          rpc.parent_doc_id,
          rpc.doc_id,
          group.ownerNodeId,
        );
      });
      return { ok: true, doc_id: rpc.doc_id };"""
    if old_create in text:
        text = text.replace(old_create, new_create)

    old_get_acl = """    return {
      doc_id: docId,
      my_access_level: level,
      my_roles,
      can_manage_acl: isOwner || level >= 3,
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        access_level: byRole[r.id] ?? 0,
      })),
    };"""
    new_get_acl = """    return {
      doc_id: docId,
      my_access_level: level,
      my_roles,
      can_manage_acl: isOwner || level >= 3,
      roles: roles.map((r) => {
        const access_level = byRole[r.id] ?? 0;
        return {
          id: r.id,
          name: r.name,
          color: r.color,
          access_level,
          acl_editable: canEditDocRoleAcl(isOwner, level, access_level),
        };
      }),
    };"""
    if old_get_acl in text:
        text = text.replace(old_get_acl, new_get_acl)

    p.write_text(text, encoding="utf-8")
    print("service: ok")


def patch_group_page():
    p = ROOT / "apps/web/src/pages/GroupPage.tsx"
    text = p.read_text(encoding="utf-8")
    text = text.replace(
        "  async function createChild(is_folder: boolean) {\n"
        "    if (!nodeId || !parentIsFolder) return;\n"
        "    const parentId = selectedIsFolder ? selectedId : (selectedNode?.parentDocId ?? ROOT_DOC_ID);\n",
        "  async function createChild(is_folder: boolean) {\n"
        "    if (!nodeId) return;\n"
        "    const parentId = selectedIsFolder\n"
        "      ? selectedId\n"
        "      : (selectedNode?.parentDocId ?? ROOT_DOC_ID);\n"
        "    const parent = nodes.find((n) => n.docId === parentId);\n"
        "    if (!parent || !isFolder(parent)) return;\n",
    )
    # remove unused parentIsFolder if only used in createChild
    if "parentIsFolder" in text:
        lines = [ln for ln in text.splitlines() if "parentIsFolder" not in ln]
        text = "\n".join(lines) + "\n"
    p.write_text(text, encoding="utf-8")
    print("GroupPage: ok")


def patch_permissions_panel():
    p = ROOT / "apps/web/src/components/DocNodePermissionsPanel.tsx"
    text = p.read_text(encoding="utf-8")
    old = """                      <select
                        className="app-select"
                        value={r.access_level}
                        disabled={loading}
                        onChange={(e) => void setDocRoleAcl(r.id, Number(e.target.value))}
                      >"""
    new = """                      <select
                        className="app-select"
                        value={r.access_level}
                        disabled={loading || r.acl_editable === false}
                        title={
                          r.acl_editable === false
                            ? "可操作级别角色不可被非群主修改"
                            : undefined
                        }
                        onChange={(e) => void setDocRoleAcl(r.id, Number(e.target.value))}
                      >"""
    if old in text:
        text = text.replace(old, new)
    p.write_text(text, encoding="utf-8")
    print("DocNodePermissionsPanel: ok")


def patch_api():
    p = ROOT / "apps/web/src/lib/api.ts"
    text = p.read_text(encoding="utf-8")
    text = text.replace(
        "  roles: { id: string; name: string; color: string; access_level: number }[];\n",
        "  roles: {\n"
        "    id: string;\n"
        "    name: string;\n"
        "    color: string;\n"
        "    access_level: number;\n"
        "    acl_editable?: boolean;\n"
        "  }[];\n",
    )
    p.write_text(text, encoding="utf-8")
    print("api: ok")


def patch_settings():
    p = ROOT / "apps/web/src/pages/GroupSettingsPage.tsx"
    text = p.read_text(encoding="utf-8")
    text = text.replace(
        "          <p className=\"app-muted\">角色定义、成员多角色、新建子项默认权限模板、邀请成员</p>\n",
        "          <p className=\"app-muted\">角色定义、成员多角色、新成员默认角色、邀请成员</p>\n",
    )
    # saveRules without template
    text = text.replace(
        """      await api.updateGovernance(gid, {
        caller_node_id: nodeId,
        default_member_role_id: gov.default_rules.default_member_role_id,
        create_child_template: gov.default_rules.create_child_template,
      });""",
        """      await api.updateGovernance(gid, {
        caller_node_id: nodeId,
        default_member_role_id: gov.default_rules.default_member_role_id,
      });""",
    )
    # Remove template section - from second app-panel h2 新建子项 through save button
    start = '          <section className="app-panel">\n            <h2>新建子项默认权限模板</h2>'
    end = '            <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={() => void saveRules()}>\n              保存默认模板\n            </button>\n          </section>\n\n'
    if start in text:
        i = text.index(start)
        j = text.index(end, i) + len(end)
        replacement = """          <section className="app-panel">
            <h2>新成员默认角色</h2>
            <p className="app-muted">入群时自动分配的角色；新建目录/文档将继承父节点 ACL。</p>
            <label className="app-field">
              <span>默认角色</span>
              <select
                className="app-select"
                disabled={busy || !gov.default_rules}
                value={gov.default_rules?.default_member_role_id ?? ""}
                onChange={(e) =>
                  setGov({
                    ...gov,
                    default_rules: gov.default_rules
                      ? { ...gov.default_rules, default_member_role_id: e.target.value }
                      : null,
                  })
                }
              >
                {gov.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={() => void saveRules()}>
              保存
            </button>
          </section>

"""
        text = text[:i] + replacement + text[j:]
    p.write_text(text, encoding="utf-8")
    print("GroupSettingsPage: ok")


if __name__ == "__main__":
    patch_rbac()
    patch_service()
    patch_group_page()
    patch_permissions_panel()
    patch_api()
    patch_settings()
