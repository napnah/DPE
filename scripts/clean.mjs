import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
for (const name of ["dist", ".turbo"]) {
  const p = path.join(root, name);
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
console.log("cleaned");
