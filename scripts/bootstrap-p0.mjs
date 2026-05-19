import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function w(rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content.replace(/\n/g, "\n"), "utf8");
}

const files = {
  ".gitignore": `node_modules/
dist/
build/
.turbo/
*.tsbuildinfo
.env
.env.local
*.pem
coverage/
.dpe/
`,
  ".gitattributes": `* text=auto eol=lf
*.bat text eol=crlf
`,
  ".editorconfig": `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
`,
  "pnpm-workspace.yaml": `packages:
  - "packages/*"
  - "apps/*"
`,
  "package.json": JSON.stringify({
    name: "distributed-privacy-editor",
    version: "0.1.0",
    private: true,
    description: "Distributed Privacy Editor (DPE)",
    license: "MIT",
    packageManager: "pnpm@9.15.0",
    engines: { node: ">=20" },
    scripts: {
      dev: "turbo run dev --parallel",
      build: "turbo run build",
      test: "turbo run test",
      lint: "turbo run lint",
      clean: "node scripts/clean.mjs",
    },
    devDependencies: {
      cross-env: "^7.0.3",
      prettier: "^3.4.2",
      turbo: "^2.3.3",
      typescript: "^5.7.2",
    },
  }, null, 2) + "\n",
};

for (const [rel, content] of Object.entries(files)) {
  w(rel, content);
}
console.log("bootstrap part 1 done");