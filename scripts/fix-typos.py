# -*- coding: utf-8 -*-
from pathlib import Path

gp = Path(__file__).resolve().parents[1] / "apps/web/src/pages/GroupPage.tsx"
t = gp.read_text(encoding="utf-8")
t = t.replace("selectedDoc", "selectedParentId")
gp.write_text(t, encoding="utf-8")

gs = Path(__file__).resolve().parents[1] / "apps/control-plane/src/groups/groups.service.ts"
t2 = gs.read_text(encoding="utf-8")
t2 = t2.replace("await this.prisma.((tx)", "await this.prisma.$transaction((tx)")
gs.write_text(t2, encoding="utf-8")
print("ok")
