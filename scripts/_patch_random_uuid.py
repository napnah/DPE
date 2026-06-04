from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

idx = ROOT / "packages/shared/src/index.ts"
t = idx.read_text(encoding="utf-8")
if "randomUuid" not in t:
    idx.write_text(t.rstrip() + '\n\nexport { randomUuid } from "./random-uuid.js";\n', encoding="utf-8")

gp = ROOT / "apps/web/src/pages/GroupPage.tsx"
t = gp.read_text(encoding="utf-8")
if "randomUuid" not in t:
    t = t.replace(
        'import { isFolderDoc } from "@dpe/shared";',
        'import { isFolderDoc, randomUuid } from "@dpe/shared";',
    )
    t = t.replace("const doc_id = crypto.randomUUID();", "const doc_id = randomUuid();")
    gp.write_text(t, encoding="utf-8")
print("ok")
