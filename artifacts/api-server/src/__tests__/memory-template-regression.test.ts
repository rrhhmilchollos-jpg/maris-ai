import fs from "node:fs";
import path from "node:path";
import { buildDeterministicMemory } from "../lib/agentMemoryExtractor";
import { TEMPLATES, selectAgentGenerationBlueprint } from "../lib/templates";

let failures = 0;
function expect(label: string, condition: boolean): void {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}`);
    failures += 1;
  }
}

console.log("\n[1] Memoria persistente de respaldo");
const memory = buildDeterministicMemory(
  "Crea un marketplace de alojamientos en español, responsive, con reservas y favoritos.",
  "Entrega validada del portal de reservas.",
);
expect("guarda una nota específica del dominio", memory.appNotes.some((note) => /búsqueda, favoritos y solicitud de reserva/i.test(note)));
expect("recuerda el idioma explícito", memory.userPreferences.some((note) => /español/i.test(note)));
expect("recuerda el requisito responsive", memory.userPreferences.some((note) => /responsive/i.test(note)));
expect("no introduce secretos en la memoria determinista", !JSON.stringify(memory).match(/api.?key|secret|token|password/i));

console.log("\n[2] Plantilla y ruta de marketplace");
const blueprint = selectAgentGenerationBlueprint("Necesito un marketplace clon funcional de Booking para reservas de hoteles", "fullstack");
expect("selecciona el blueprint de alojamientos", blueprint.id === "accommodation-marketplace");
expect("el catálogo público ofrece la plantilla de alojamientos", TEMPLATES.some((template) => template.id === "marketplace-alojamientos"));
expect("la plantilla prohíbe copiar marcas o activos ajenos", blueprint.qualityChecklist.some((rule) => /no usar marca/i.test(rule)));

console.log("\n[3] Progreso verificable sin spam");
const corePath = path.resolve(process.cwd(), "../../lib/services/src/CoreOrchestrator.ts");
const core = fs.readFileSync(corePath, "utf8");
expect("no reemite el mismo heartbeat visible cada 15 segundos", !core.includes("setInterval(emitHeartbeat"));
expect("incluye módulos deterministas para alojamiento", core.includes("deterministicAccommodationModule"));
expect("incluye semilla de datos de alojamiento", core.includes("deterministicDomainSeed"));

if (failures > 0) {
  console.error(`\n${failures} regresión(es) fallaron.`);
  process.exit(1);
}
console.log("\nRegresiones de memoria, plantilla y progreso superadas.");
