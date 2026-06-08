// Post-codegen patch: Orval generates `export * from './generated/types'` which causes
// TS2308 when both api.ts (Zod const) and types/ (TS type) export the same name.
// The types/ directory types are not used by any consumer — Zod-inferred types from
// api.ts are preferred. Removing the re-export resolves the TS2308 ambiguity cleanly.
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const barrelPath = resolve(__dir, "../../lib/api-zod/src/index.ts");

const original = readFileSync(barrelPath, "utf8");

// Remove the generated/types wildcard re-export — not needed since
// consumers use Zod-inferred types and the types/ types are unused.
const patched = original
  .replace(/^export (?:type )?\* from ['"]\.\/generated\/types['"];?\r?\n?/m, "")
  .trim() + "\n";

if (patched === original.trim() + "\n") {
  console.log("[patch-zod-barrel] Nothing to patch");
} else {
  writeFileSync(barrelPath, patched, "utf8");
  console.log("[patch-zod-barrel] Removed unused types barrel re-export from api-zod index.ts");
}
