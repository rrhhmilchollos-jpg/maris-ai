import { readFile } from "node:fs/promises";
import { validateBundle } from "../artifacts/api-server/src/lib/validate";

async function main() {
  const file = process.env.SPAX_BUNDLE_PATH || "/tmp/spax-frontend-bundle.txt";
  const bundle = await readFile(file, "utf8");
  const report = await validateBundle(bundle);
  console.log(JSON.stringify({ ok: report.ok, issues: report.issues, durationMs: report.durationMs }));
  if (!report.ok) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
