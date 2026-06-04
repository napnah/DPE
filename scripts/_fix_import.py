from pathlib import Path
p = Path(__file__).resolve().parents[1] / "apps/control-plane/src/groups/groups.service.ts"
t = p.read_text(encoding="utf-8")
old = "  syncMemberAllDocs,\n} from \"./groups-rbac.js\";"
new = "  syncMemberAllDocs,\n  syncMemberDocGrant,\n} from \"./groups-rbac.js\";"
if old in t:
    p.write_text(t.replace(old, new), encoding="utf-8")
    print("ok")
else:
    print("pattern not found")
