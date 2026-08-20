import { strict as assert } from "node:assert";
import { validateBundle } from "../lib/validate";

const validReactBundle = `// === FILE: src/main.tsx ===
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);

// === FILE: src/App.tsx ===
import React from "react";
export default function CustomerPortal() {
  return <main><h1>Portal de clientes</h1><p>Tu proyecto está listo.</p></main>;
}
`;

const placeholderBundle = `// === FILE: src/App.tsx ===
import React from "react";
export default function Payments() {
  return <div className="p-8"><h1 className="text-2xl font-bold">Cargando Payments...</h1><p>Este módulo se está generando.</p></div>;
}
`;

const emptySourceBundle = `// === FILE: src/App.tsx ===
import React from "react";
export default function App() { return <main>Lista</main>; }

// === FILE: src/components/Empty.tsx ===
`;

const blankRootBundle = `// === FILE: src/main.tsx ===
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);

// === FILE: src/App.tsx ===
import React from "react";
export default function App() { return null; }
`;

async function expectRejected(name: string, bundle: string, fragment: string) {
  const report = await validateBundle(bundle);
  assert.equal(report.ok, false, `${name}: el bundle debía rechazarse`);
  assert.ok(report.issues.some((issue) => issue.message.includes(fragment)), `${name}: falta el motivo esperado (${fragment})`);
  console.log(`✓ ${name}`);
}

async function main() {
  const valid = await validateBundle(validReactBundle);
  assert.equal(valid.ok, true, `bundle React válido rechazado: ${valid.issues.map((i) => i.message).join(" | ")}`);
  console.log("✓ bundle React funcional aceptado");

  await expectRejected("placeholder de entrega", placeholderBundle, "Visible internal placeholder");
  await expectRejected("archivo fuente vacío", emptySourceBundle, "Empty source file");
  await expectRejected("raíz React sin interfaz", blankRootBundle, "React root returns no visible interface");

  console.log("\nLa puerta de integridad bloquea resultados vacíos, incompletos y no renderizables.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
