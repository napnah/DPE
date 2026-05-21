import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(agentRoot, "../..");
config({ path: path.join(repoRoot, ".env") });
