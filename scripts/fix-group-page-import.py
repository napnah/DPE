import re
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "apps/web/src/pages/GroupPage.tsx"
content = path.read_text(encoding="utf-8")
if '@dpe/shared' not in content:
    content = content.replace(
        'import { DocTreeNav, ROOT_DOC_ID } from "../components/DocTreeNav";',
        'import { isFolderDoc } from "@dpe/shared";\nimport { DocTreeNav, ROOT_DOC_ID } from "../components/DocTreeNav";',
        1,
    )
content = re.sub(r"\nfunction childrenOf\([^\)]*\)[^\{]*\{[^\}]*\}\n", "\n", content, count=1)
path.write_text(content, encoding="utf-8", newline="\n")
print("fixed", path)
