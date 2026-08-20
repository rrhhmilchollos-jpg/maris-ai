import assert from "node:assert/strict";
import { validateBundle } from "../artifacts/api-server/src/lib/validate";
import { buildDeployHtml } from "../artifacts/api-server/src/lib/deployBundle";

async function main(): Promise<void> {
  const cssImportWithoutFile = `// === FILE: src/App.tsx ===
import "./App.css";
export default function App() { return <main><h1>SPAX operativa</h1></main>; }
`;
  const cssReport = await validateBundle(cssImportWithoutFile);
  assert.equal(cssReport.ok, true, JSON.stringify(cssReport.issues));
  const cssPreview = await buildDeployHtml({ bundle: cssImportWithoutFile, title: "CSS recovery" });
  assert.match(cssPreview, /SPAX operativa/);

  const nonConventionalRoot = `// === FILE: src/pages/Home.tsx ===
export default function Home() { return <main><h1>Entrada recuperada</h1></main>; }
`;
  const recoveredReport = await validateBundle(nonConventionalRoot);
  assert.equal(recoveredReport.ok, true, JSON.stringify(recoveredReport.issues));
  const recoveredPreview = await buildDeployHtml({ bundle: nonConventionalRoot, title: "Entry recovery" });
  assert.match(recoveredPreview, /Entrada recuperada/);

  const namedMonorepoRoot = `// === FILE: apps/web/src/screens/Dashboard.tsx ===
export function Dashboard() { return <main><h1>Panel válido</h1></main>; }
`;
  const namedReport = await validateBundle(namedMonorepoRoot);
  assert.equal(namedReport.ok, true, JSON.stringify(namedReport.issues));
  const namedPreview = await buildDeployHtml({ bundle: namedMonorepoRoot, title: "Named root" });
  assert.match(namedPreview, /Panel válido/);

  console.log("OK: validador y preview recuperan CSS local y entradas no convencionales");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
