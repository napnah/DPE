# -*- coding: utf-8 -*-
"""One-off patch for groups.service.ts — run from repo root."""
from __future__ import annotations

import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
P = ROOT / "apps/control-plane/src/groups/groups.service.ts"

NEW_METHODS = r'''
  async listAllGroupsForNode(nodeId: string) {
    const owned = await this.prisma.group.findMany({
      where: { ownerNodeId: nodeId },
      orderBy: { createdAt: "desc" },
    });
    const memberships = await this.prisma.member.findMany({
      where: { nodeId, leftAt: null },
      include: { group: true },
    });
    const seen = set<string>();
    const out: Array<ReturnType<typeof this.groupCard>> = [];
    for (const g of owned) {
      seen.add(g.id);
      out.push(await this.groupCard(g, nodeId, true));
    }
    for (const m of memberships) {
      if (seen.has(m.groupId) || m.group.ownerNodeId === nodeId) continue;
      seen.add(m.groupId);
      out.push(await this.groupCard(m.group, nodeId, false));
    }
    return out;
  }

  async getGovernance(groupId: string, callerNodeId: string) {
    const group = await this.requireGroup(groupId);
    await this.requireMember(groupId, callerNodeId);
    if (group.ownerNodeId !== callerNodeId) {
      throw new ForbiddenException("only group owner may view governance settings");
    }
    const roles = await this.prisma.groupRole.findMany({
      where: { groupId },
      orderBy: { sortOrder: "asc" },
    });
    const assignments = await this.prisma.memberRoleAssignment.findMany({
      where: { groupId },
    });
    const rules = await this.prisma.groupDefaultRules.findUnique({ where: { groupId } });
    const members = await this.prisma.member.findMany({
      where: { groupId, leftAt: null },
      orderBy: { joinedAt: "asc" },
    });
    return {
      group_id: groupId,
      name: group.name,
      description: group.description,
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        color: r.color,
        is_builtin: r.isBuiltin,
      })),
      assignments: assignments.map((a) => ({
        node_id: a.nodeId,
        role_id: a.roleId,
      })),
      default_rules: rules
        ? {
            default_member_role_id: rules.defaultMemberRoleId,
            create_child_template: rules.createChildTemplate as Record<string, number>,
          }
        : null,
      members: members.map((m) => ({ node_id: m.nodeId, public_key: m.publicKey })),
    };
  }

  async updateGovernance(groupId: string, dto: UpdateGovernanceDto) {
    const group = await this.requireGroup(groupId);
    if (group.ownerNodeId !== dto.caller_node_id) {
      throw new ForbiddenException("only group owner may update governance");
    }
    await this.prisma.$transaction(async (tx) => {
      if (dto.default_member_role_id || dto.create_child_template) {
        const rules = await tx.groupDefaultRules.findUnique({ where: { groupId } });
        if (!rules) throw new NotFoundException("default rules not found");
        await tx.groupDefaultRules.update({
          where: { groupId },
          data: {
            ...(dto.default_member_role_id
              ? { defaultMemberRoleId: dto.default_member_role_id }
              : {}),
            ...(dto.create_child_template
              ? { createChildTemplate: dto.create_child_template }
              : {}),
          },
        });
      }
      if (dto.assignments) {
        for (const a of dto.assignments) {
          await tx.memberRoleAssignment.upsert({
            where: { groupId_nodeId: { groupId, nodeId: a.node_id } },
            create: { groupId, nodeId: a.node_id, roleId: a.role_id },
            update: { roleId: a.role_id },
          });
          await syncMemberAllDocs(tx, groupId, a.node_id, group.ownerNodeId);
        }
      }
      if (dto.roles) {
        for (const r of dto.roles) {
          if (!r.id) continue;
          await tx.groupRole.update({
            where: { id: r.id },
            data: {
              ...(r.name ? { name: r.name } : {}),
              ...(r.color ? { color: r.color } : {}),
            },
          });
        }
      }
    });
    return { ok: true };
  }

  async getDocRoleAcls(groupId: string, docId: string, callerNodeId: string) {
    const group = await this.requireGroup(groupId);
    await this.requireMember(groupId, callerNodeId);
    const level = await resolveAccessLevel(
      this.prisma,
      groupId,
      callerNodeId,
      docId,
      group.ownerNodeId,
    );
    if (level < 1) throw new ForbiddenException("no access to doc");
    const rows = await this.prisma.docRoleAcl.findMany({
      where: { groupId, docId },
    });
    const roles = await this.prisma.groupRole.findMany({
      where: { groupId },
      orderBy: { sortOrder: "asc" },
    });
    const byRole = Object.fromEntries(rows.map((r) => [r.roleId, r.accessLevel]));
    return {
      doc_id: docId,
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        access_level: byRole[r.id] ?? 0,
      })),
    };
  }

  private async groupCard(
    g: {
      id: string;
      name: string;
      description: string;
      controlMode: string;
      ownerNodeId: string;
      proxyBaseUrl: string | null;
      createdAt: Date;
    },
    nodeId: string,
    isOwner: boolean,
  ) {
    if (isOwner) {
      return {
        group_id: g.id,
        name: g.name,
        description: g.description,
        control_mode: g.controlMode,
        owner_node_id: g.ownerNodeId,
        proxy_base_url: g.proxyBaseUrl,
        created_at: g.createdAt,
        is_owner: true,
        my_role_name: "群主",
        my_role_color: "#9a6700",
      };
    }
    const assignment = await this.prisma.memberRoleAssignment.findUnique({
      where: { groupId_nodeId: { groupId: g.id, nodeId } },
    });
    const role = assignment
      ? await this.prisma.groupRole.findUnique({ where: { id: assignment.roleId } })
      : null;
    return {
      group_id: g.id,
      name: g.name,
      description: g.description,
      control_mode: g.controlMode,
      owner_node_id: g.ownerNodeId,
      proxy_base_url: g.proxyBaseUrl,
      created_at: g.createdAt,
      is_owner: false,
      my_role_name: role?.name ?? "成员",
      my_role_color: role?.color ?? "#656d76",
    };
  }
'''

def main() -> None:
    text = P.read_text(encoding="utf-8")

    if "from \"./groups-rbac.js\"" not in text:
        text = text.replace(
            'import type { CreateGroupDto, CreateInvitationDto, JoinGroupDto, RefreshJwtDto } from "./groups.dto.js";',
            '''import {
  applyCreateChildTemplate,
  resolveAccessLevel,
  seedGroupRbac,
  syncAllMembersForDocRole,
  syncMemberAllDocs,
  syncMemberDocGrant,
} from "./groups-rbac.js";
import type {
  CreateGroupDto,
  CreateInvitationDto,
  JoinGroupDto,
  RefreshJwtDto,
  UpdateGovernanceDto,
} from "./groups.dto.js";''',
        )

    if "description: dto.description" not in text:
        text = text.replace(
            "name: dto.name,\n          ownerNodeId:",
            'name: dto.name,\n          description: dto.description ?? "",\n          ownerNodeId:',
            1,
        )

    if "seedGroupRbac" not in text:
        text = text.replace(
            """      await tx.documentKey.create({
        data: {
          groupId: g.id,
          docId: ROOT_DOC_ID,
          keyVersion: 1,
          keyBase64: bytesToBase64Url(rootKey),
        },
      });
      return g;""",
            """      await tx.documentKey.create({
        data: {
          groupId: g.id,
          docId: ROOT_DOC_ID,
          keyVersion: 1,
          keyBase64: bytesToBase64Url(rootKey),
        },
      });
      const { template } = await seedGroupRbac(tx, g.id, dto.owner_node_id);
      await applyCreateChildTemplate(tx, g.id, ROOT_DOC_ID, template);
      await syncMemberDocGrant(tx, g.id, dto.owner_node_id, ROOT_DOC_ID, 3);
      return g;""",
        )

    if "listAllGroupsForNode" not in text:
        text = text.replace(
            "  private summary(g: {",
            NEW_METHODS + "\n  private summary(g: {",
        )

    if "SetDocRoleAcl" not in text:
        set_acl_block = '''    if (rpc.op === "SetACL") {
      await this.requireOperable(groupId, callerNodeId, rpc.doc_id);
      const parent = await this.prisma.docNode.findUnique({
        where: { groupId_docId: { groupId, docId: rpc.doc_id } },
      });
      if (!parent) throw new NotFoundException("doc not found");
      await this.prisma.aclGrant.upsert({
        where: {
          groupId_docId_nodeId: {
            groupId,
            docId: rpc.doc_id,
            nodeId: rpc.user_node_id,
          },
        },
        create: {
          groupId,
          docId: rpc.doc_id,
          nodeId: rpc.user_node_id,
          role: rpc.role,
        },
        update: { role: rpc.role },
      });
      return { ok: true };
    }'''
        set_role_block = '''    if (rpc.op === "SetDocRoleAcl") {
      await this.requireOperable(groupId, callerNodeId, rpc.doc_id);
      const doc = await this.prisma.docNode.findUnique({
        where: { groupId_docId: { groupId, docId: rpc.doc_id } },
      });
      if (!doc) throw new NotFoundException("doc not found");
      const role = await this.prisma.groupRole.findFirst({
        where: { id: rpc.group_role_id, groupId },
      });
      if (!role) throw new NotFoundException("group role not found");
      await this.prisma.$transaction(async (tx) => {
        await tx.docRoleAcl.upsert({
          where: {
            groupId_docId_roleId: {
              groupId,
              docId: rpc.doc_id,
              roleId: rpc.group_role_id,
            },
          },
          create: {
            groupId,
            docId: rpc.doc_id,
            roleId: rpc.group_role_id,
            accessLevel: rpc.access_level,
          },
          update: { accessLevel: rpc.access_level },
        });
        await syncAllMembersForDocRole(
          tx,
          groupId,
          rpc.doc_id,
          rpc.group_role_id,
          rpc.access_level,
        );
      });
      return { ok: true };
    }

    if (rpc.op === "SetACL") {
      throw new BadRequestException("use SetDocRoleAcl — document ACL is per group role");
    }'''
        text = text.replace(set_acl_block, set_role_block)

    # acceptInvitation
    old_accept = """    await this.joinGroup(inv.groupId, dto);
    await this.prisma.aclGrant.upsert({
      where: {
        groupId_docId_nodeId: {
          groupId: inv.groupId,
          docId: ROOT_DOC_ID,
          nodeId: dto.node_id,
        },
      },
      create: {
        groupId: inv.groupId,
        docId: ROOT_DOC_ID,
        nodeId: dto.node_id,
        role: 1,
      },
      update: {},
    });"""
    new_accept = """    const group = await this.requireGroup(inv.groupId);
    await this.joinGroup(inv.groupId, dto);
    const rules = await this.prisma.groupDefaultRules.findUnique({
      where: { groupId: inv.groupId },
    });
    if (rules) {
      await this.prisma.memberRoleAssignment.upsert({
        where: { groupId_nodeId: { groupId: inv.groupId, nodeId: dto.node_id } },
        create: {
          groupId: inv.groupId,
          nodeId: dto.node_id,
          roleId: rules.defaultMemberRoleId,
        },
        update: { roleId: rules.defaultMemberRoleId },
      });
      await syncMemberAllDocs(this.prisma, inv.groupId, dto.node_id, group.ownerNodeId);
    }"""
    if old_accept in text:
        text = text.replace(old_accept, new_accept)
        text = text.replace(
            "    const group = await this.requireGroup(inv.groupId);\n    return { group_id: group.id, pk_admin: group.issuerPublicKey };",
            "    return { group_id: group.id, pk_admin: group.issuerPublicKey };",
        )

    # refreshJwt
    old_refresh = """    const grant = await this.prisma.aclGrant.findUnique({
      where: {
        groupId_docId_nodeId: {
          groupId,
          docId: dto.doc_id,
          nodeId: dto.node_id,
        },
      },
    });
    if (!grant || grant.role === 0) {
      throw new ForbiddenException("no access to doc");
    }"""
    new_refresh = """    const accessLevel = await resolveAccessLevel(
      this.prisma,
      groupId,
      dto.node_id,
      dto.doc_id,
      group.ownerNodeId,
    );
    if (accessLevel < 1) {
      throw new ForbiddenException("no access to doc");
    }
    await syncMemberDocGrant(
      this.prisma,
      groupId,
      dto.node_id,
      dto.doc_id,
      accessLevel,
    );"""
    if old_refresh in text:
        text = text.replace(old_refresh, new_refresh)
        text = text.replace("role: grant.role,", "role: accessLevel,")
        text = text.replace("role: grant.role }", "role: accessLevel }")

    # getTree
    old_tree = """    const grants = await this.prisma.aclGrant.findMany({ where: { groupId, nodeId } });
    const visible = new Set(
      grants.filter((g) => g.role >= 1).map((g) => g.docId),
    );"""
    new_tree = """    const group = await this.requireGroup(groupId);
    const allDocs = await this.prisma.docNode.findMany({ where: { groupId } });
    const visible = new Set<string>();
    for (const d of allDocs) {
      const level = await resolveAccessLevel(
        this.prisma,
        groupId,
        nodeId,
        d.docId,
        group.ownerNodeId,
      );
      if (level >= 1) visible.add(d.docId);
    }"""
    if old_tree in text:
        text = text.replace(old_tree, new_tree)

    # CreateChild template
    if "applyCreateChildTemplate" not in text.split("CreateChild")[1][:800]:
        text = text.replace(
            """      await this.prisma.documentKey.create({
        data: {
          groupId,
          docId: rpc.doc_id,
          keyVersion: 1,
          keyBase64: bytesToBase64Url(newKey),
        },
      });
      await this.prisma.aclGrant.create({
        data: {
          groupId,
          docId: rpc.doc_id,
          nodeId: callerNodeId,
          role: 3,
        },
      });
      return { ok: true, doc_id: rpc.doc_id };""",
            """      await this.prisma.documentKey.create({
        data: {
          groupId,
          docId: rpc.doc_id,
          keyVersion: 1,
          keyBase64: bytesToBase64Url(newKey),
        },
      });
      const rules = await this.prisma.groupDefaultRules.findUnique({ where: { groupId } });
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
      return { ok: true, doc_id: rpc.doc_id };""",
        )

    # requireOperable
    text = text.replace(
        """  private async requireOperable(groupId: string, nodeId: string, docId: string) {
    const g = await this.prisma.aclGrant.findUnique({
      where: { groupId_docId_nodeId: { groupId, docId, nodeId } },
    });
    if (!g || g.role < 3) throw new ForbiddenException("operable role required");
    return g;
  }""",
        """  private async requireOperable(groupId: string, nodeId: string, docId: string) {
    const group = await this.requireGroup(groupId);
    const level = await resolveAccessLevel(
      this.prisma,
      groupId,
      nodeId,
      docId,
      group.ownerNodeId,
    );
    if (level < 3) throw new ForbiddenException("operable role required");
    return { role: level };
  }""",
    )

    # summary description
    if "description: g.description" not in text:
        text = text.replace(
            "name: g.name,\n      control_mode:",
            "name: g.name,\n      description: g.description,\n      control_mode:",
        )

    P.write_text(text, encoding="utf-8")
    print("patched", P)


if __name__ == "__main__":
    main()
