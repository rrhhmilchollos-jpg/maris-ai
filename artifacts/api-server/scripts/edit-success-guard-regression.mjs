import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = resolve(process.cwd(), "src/routes/apps.ts");
const source = await readFile(sourcePath, "utf8");

const requiredGuards = [
  "let editFailureMessage: string | null = null;",
  "const unchangedEdit = validFrontend",
  "editResultInvalid = true;",
  'editResultInvalid\n          ? { status: "failed", phase: "failed", progress: 100',
  "La edición no produjo cambios válidos; la versión anterior se conserva intacta.",
];

const missing = requiredGuards.filter((guard) => !source.includes(guard));
if (missing.length > 0) {
  throw new Error(`Guardas de éxito de edición ausentes: ${missing.join(" | ")}`);
}

console.log("edit success guard regression: ok");
