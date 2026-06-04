# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(rel: str, old: str, new: str) -> None:
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"missing anchor in {rel}")
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("ok", rel)


# Prisma + DTO (inline)
patch(
    "apps/control-plane/prisma/schema.prisma",
    "  publicKey String    @map(\"public_key\")\n  joinedAt",
    "  publicKey   String    @map(\"public_key\")\n  displayName String    @default(\"\") @map(\"display_name\")\n  joinedAt",
)

dto = ROOT / "apps/control-plane/src/groups/groups.dto.ts"
t = dto.read_text(encoding="utf-8")
if "owner_display_name" not in t:
    t = t.replace(
        "  owner_public_key: string;\n  control_mode",
        "  owner_public_key: string;\n  owner_display_name?: string;\n  control_mode",
    )
    t = t.replace(
        "export interface JoinGroupDto {\n  node_id: string;\n  public_key: string;\n}",
        "export interface JoinGroupDto {\n  node_id: string;\n  public_key: string;\n  display_name?: string;\n}\n\nexport interface UpdateDisplayNameDto {\n  node_id: string;\n  display_name: string;\n}",
    )
    dto.write_text(t, encoding="utf-8")
    print("ok groups.dto.ts")

# groups.service helper + methods
patch(
    "apps/control-plane/src/groups/groups.service.ts",
    "  UpdateGovernanceDto,\n} from \"./groups.dto.js\";",
    "  UpdateGovernanceDto,\n  UpdateDisplayNameDto,\n} from \"./groups.dto.js\";",
)

patch(
    "apps/control-plane/src/groups/groups.service.ts",
    """} from "./groups-rbac.js";
import type {
""",
    """} from "./groups-rbac.js";

function normalizeDisplayName(raw?: string): string {
  const s = (raw ?? "").trim();
  if (s.length < 1 || s.length > 32) {
    throw new BadRequestException("display_name must be 1-32 characters");
  }
  return s;
}

import type {
""",
)

patch(
    "apps/control-plane/src/groups/groups.service.ts",
    """          members: {
            create: {
              nodeId: dto.owner_node_id,
              publicKey: dto.owner_public_key,
            },
          },""",
    """          members: {
            create: {
              nodeId: dto.owner_node_id,
              publicKey: dto.owner_public_key,
              displayName: dto.owner_display_name
                ? normalizeDisplayName(dto.owner_display_name)
                : "",
            },
          },""",
)

# Fix: createGroup can't call normalizeDisplayName if empty - use try/catch or optional
# Better: only normalize when provided
patch(
    "apps/control-plane/src/groups/groups.service.ts",
    """              displayName: dto.owner_display_name
                ? normalizeDisplayName(dto.owner_display_name)
                : "",
            },
          },""",
    """              displayName: dto.owner_display_name?.trim()
                ? normalizeDisplayName(dto.owner_display_name)
                : "",
            },
          },""",
)

patch(
    "apps/control-plane/src/groups/groups.service.ts",
    """    await this.prisma.member.upsert({
      where: { groupId_nodeId: { groupId, nodeId: dto.node_id } },
      create: { groupId, nodeId: dto.node_id, publicKey: dto.public_key },
      update: { publicKey: dto.public_key, leftAt: null },
    });""",
    """    const displayName = dto.display_name?.trim()
      ? normalizeDisplayName(dto.display_name)
      : undefined;
    await this.prisma.member.upsert({
      where: { groupId_nodeId: { groupId, nodeId: dto.node_id } },
      create: {
        groupId,
        nodeId: dto.node_id,
        publicKey: dto.public_key,
        displayName: displayName ?? "",
      },
      update: {
        publicKey: dto.public_key,
        leftAt: null,
        ...(displayName ? { displayName } : {}),
      },
    });""",
)

patch(
    "apps/control-plane/src/groups/groups.service.ts",
    """      members: rows.map((m) => ({
        node_id: m.nodeId,
        public_key: m.publicKey,
      })),""",
    """      members: rows.map((m) => ({
        node_id: m.nodeId,
        public_key: m.publicKey,
        display_name: m.displayName,
      })),""",
)

patch(
    "apps/control-plane/src/groups/groups.service.ts",
    """      members: members.map((m) => ({ node_id: m.nodeId, public_key: m.publicKey })),""",
    """      members: members.map((m) => ({
        node_id: m.nodeId,
        public_key: m.publicKey,
        display_name: m.displayName,
      })),""",
)

# add updateMemberDisplayName before getGovernance or at end of class - find listMembers and add after
patch(
    "apps/control-plane/src/groups/groups.service.ts",
    """  async getGovernance(groupId: string, callerNodeId: string) {
    const group = await this.requireGroup(groupId);""",
    """  async updateMemberDisplayName(nodeId: string, displayName: string) {
    const name = normalizeDisplayName(displayName);
    await this.prisma.member.updateMany({
      where: { nodeId, leftAt: null },
      data: { displayName: name },
    });
    return { ok: true, display_name: name };
  }

  async getGovernance(groupId: string, callerNodeId: string) {
    const group = await this.requireGroup(groupId);""",
)

# controller
patch(
    "apps/control-plane/src/groups/groups.controller.ts",
    """  UpdateGovernanceDto,
} from "./groups.dto.js";""",
    """  UpdateGovernanceDto,
  UpdateDisplayNameDto,
} from "./groups.dto.js";""",
)

patch(
    "apps/control-plane/src/groups/groups.controller.ts",
    """  @Get("users/me/groups")
  listMyGroups(""",
    """  @Post("users/me/display-name")
  updateDisplayName(@Body() body: UpdateDisplayNameDto) {
    return this.groups.updateMemberDisplayName(body.node_id, body.display_name);
  }

  @Get("users/me/groups")
  listMyGroups(""",
)

print("backend patches done")
