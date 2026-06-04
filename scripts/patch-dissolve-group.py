#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch_service() -> None:
    p = ROOT / "apps/control-plane/src/groups/groups.service.ts"
    t = p.read_text(encoding="utf-8")
    anchor = "  async updateGovernance(groupId: string, dto: UpdateGovernanceDto) {"
    insert = """  async dissolveGroup(groupId: string, callerNodeId: string) {
    const group = await this.requireGroup(groupId);
    if (group.ownerNodeId !== callerNodeId) {
      throw new ForbiddenException("only group owner may dissolve the group");
    }
    await this.prisma.group.delete({ where: { id: groupId } });
    return { ok: true };
  }

"""
    if "dissolveGroup" in t:
        print("groups.service dissolveGroup already present")
        return
    if anchor not in t:
        raise SystemExit("updateGovernance anchor not found")
    p.write_text(t.replace(anchor, insert + anchor), encoding="utf-8")
    print("groups.service.ts ok")


def patch_settings_page() -> None:
    p = ROOT / "apps/web/src/pages/GroupSettingsPage.tsx"
    t = p.read_text(encoding="utf-8")

    if "useNavigate" not in t:
        t = t.replace(
            'import { Link, useParams } from "react-router-dom";',
            'import { Link, useNavigate, useParams } from "react-router-dom";',
        )
        t = t.replace(
            'import { api, type GovernancePayload } from "../lib/api";',
            'import { api, type GovernancePayload } from "../lib/api";\nimport { stopGroupMesh } from "../lib/mesh-context";',
        )

    if "const navigate = useNavigate" not in t:
        t = t.replace(
            "  const gid = groupId ?? \"\";\n",
            "  const gid = groupId ?? \"\";\n  const navigate = useNavigate();\n",
        )

    if "async function dissolveGroup" not in t:
        t = t.replace(
            """  async function sendInvite() {
    if (!nodeId || !inviteUid.trim()) return;
""",
            """  async function dissolveGroup() {
    if (!nodeId) return;
    const name = gov?.name ?? gid;
    if (!window.confirm(`确定解散群组「${name}」？所有成员、文档与权限将被永久删除，无法恢复。`)) {
      return;
    }
    setBusy(true);
    try {
      await api.dissolveGroup(gid, nodeId);
      localStorage.removeItem(`dpe_group_${gid}_pk_admin`);
      await stopGroupMesh();
      navigate("/dashboard", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "解散群组失败");
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    if (!nodeId || !inviteUid.trim()) return;
""",
        )

    danger_section = """          <section className="app-panel app-panel--danger">
            <h2>危险操作</h2>
            <p className="app-muted">解散后群组、文档、成员与邀请记录将永久删除，无法恢复。</p>
            <button
              type="button"
              className="app-btn app-btn--danger"
              disabled={busy}
              onClick={() => void dissolveGroup()}
            >
              解散群组
            </button>
          </section>
        </>
      )}
"""
    old_end = """          </section>
        </>
      )}
"""
    if "app-panel--danger" not in t:
        # insert before closing fragment after invite section
        marker = """              <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={() => void sendInvite()}>
                发送邀请
              </button>
            </div>
          </section>
        </>
      )}
"""
        if marker not in t:
            # fallback: last invite section close
            marker = """          </section>
        </>
      )}
"""
            if marker not in t:
                raise SystemExit("GroupSettingsPage end marker not found")
            t = t.replace(marker, danger_section, 1)
        else:
            t = t.replace(marker, marker.replace("        </>\n      )}", danger_section.split("        </>")[0] + "        </>\n      )}"), 1)

    p.write_text(t, encoding="utf-8")
    print("GroupSettingsPage.tsx ok")


def patch_css() -> None:
    p = ROOT / "apps/web/src/index.css"
    t = p.read_text(encoding="utf-8")
    if "app-panel--danger" not in t:
        t = t.replace(
            ".app-panel {\n",
            ".app-panel--danger {\n  border-color: var(--bz-negative, #da4453);\n}\n\n.app-panel--danger h2 {\n  color: var(--bz-negative, #da4453);\n}\n\n.app-panel {\n",
            1,
        )
        p.write_text(t, encoding="utf-8")
        print("index.css ok")
    else:
        print("index.css already has danger panel")


if __name__ == "__main__":
    patch_service()
    patch_settings_page()
    patch_css()
