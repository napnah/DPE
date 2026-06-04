# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(rel: str, old: str, new: str) -> None:
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"missing in {rel}: {old[:60]!r}...")
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("ok", rel)


svc = "apps/control-plane/src/groups/groups.service.ts"
ctl = "apps/control-plane/src/groups/groups.controller.ts"

if "UpdateDisplayNameDto" not in (ROOT / svc).read_text(encoding="utf-8"):
    patch(svc, "  UpdateGovernanceDto,\n} from", "  UpdateGovernanceDto,\n  UpdateDisplayNameDto,\n} from")

if "normalizeDisplayName" not in (ROOT / svc).read_text(encoding="utf-8"):
    patch(
        svc,
        '} from "./groups-rbac.js";\nimport type {',
        '''} from "./groups-rbac.js";

function normalizeDisplayName(raw?: string): string {
  const s = (raw ?? "").trim();
  if (s.length < 1 || s.length > 32) {
    throw new BadRequestException("display_name must be 1-32 characters");
  }
  return s;
}

import type {''',
    )

patch(
    svc,
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
              displayName: dto.owner_display_name?.trim()
                ? normalizeDisplayName(dto.owner_display_name)
                : "",
            },
          },""",
)

patch(
    svc,
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
    svc,
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
    svc,
    """      members: members.map((m) => ({ node_id: m.nodeId, public_key: m.publicKey })),""",
    """      members: members.map((m) => ({
        node_id: m.nodeId,
        public_key: m.publicKey,
        display_name: m.displayName,
      })),""",
)

if "updateMemberDisplayName" not in (ROOT / svc).read_text(encoding="utf-8"):
    patch(
        svc,
        "  async getGovernance(groupId: string, callerNodeId: string) {",
        """  async updateMemberDisplayName(nodeId: string, displayName: string) {
    const name = normalizeDisplayName(displayName);
    await this.prisma.member.updateMany({
      where: { nodeId, leftAt: null },
      data: { displayName: name },
    });
    return { ok: true, display_name: name };
  }

  async getGovernance(groupId: string, callerNodeId: string) {""",
    )

ct = (ROOT / ctl).read_text(encoding="utf-8")
if "UpdateDisplayNameDto" not in ct:
    patch(ctl, "  UpdateGovernanceDto,\n} from", "  UpdateGovernanceDto,\n  UpdateDisplayNameDto,\n} from")
if "users/me/display-name" not in ct:
    patch(
        ctl,
        '  @Get("users/me/groups")\n  listMyGroups(',
        """  @Post("users/me/display-name")
  updateDisplayName(@Body() body: UpdateDisplayNameDto) {
    return this.groups.updateMemberDisplayName(body.node_id, body.display_name);
  }

  @Get("users/me/groups")
  listMyGroups(""",
    )

print("service/controller done")
