import assert from "node:assert/strict";
import { ensureLocalStyleFiles, ensureReactEntrypoint, isStaticHtmlBundle } from "@workspace/bundle-format";

const missingCssFiles: Record<string, string> = {
  "src/App.tsx": 'import "./App.css";\nexport default function App() { return <main>SPAX</main>; }',
};
assert.deepEqual(ensureLocalStyleFiles(missingCssFiles), ["src/App.css"]);
assert.match(missingCssFiles["src/App.css"], /creada automáticamente/);
assert.equal(ensureReactEntrypoint(missingCssFiles)?.entry, "src/App.tsx");

const nonStandardDefaultFiles: Record<string, string> = {
  "src/pages/Home.tsx": "export default function Home() { return <section>Inicio</section>; }",
};
const defaultRecovery = ensureReactEntrypoint(nonStandardDefaultFiles);
assert.equal(defaultRecovery?.entry, "src/App.tsx");
assert.equal(defaultRecovery?.recovered, true);
assert.match(nonStandardDefaultFiles["src/App.tsx"], /export \{ default \}/);
assert.equal(isStaticHtmlBundle({ ...nonStandardDefaultFiles, "index.html": "<div id=\"root\"></div>" }), false);

const nonStandardNamedFiles: Record<string, string> = {
  "apps/web/src/screens/Dashboard.tsx": "export function Dashboard() { return <section>Panel</section>; }",
};
const namedRecovery = ensureReactEntrypoint(nonStandardNamedFiles);
assert.equal(namedRecovery?.entry, "apps/web/src/App.tsx");
assert.match(nonStandardNamedFiles["apps/web/src/App.tsx"], /Dashboard as RecoveredApp/);

const staticFiles: Record<string, string> = {
  "index.html": "<!doctype html><html><body><h1>Estática</h1></body></html>",
  "styles/site.css": "body { color: #111; }",
};
assert.equal(isStaticHtmlBundle(staticFiles), true);

console.log("OK: recuperación de entrypoint y CSS local validada");
