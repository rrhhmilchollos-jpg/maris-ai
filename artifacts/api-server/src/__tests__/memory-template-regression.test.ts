import fs from "node:fs";
import path from "node:path";
import { buildDeterministicMemory } from "../lib/agentMemoryExtractor";
import { TEMPLATES, buildAgentTemplateContextBlock, buildDeterministicPlanPreview, selectAgentGenerationBlueprint } from "../lib/templates";
import { detectBusinessVertical } from "../lib/projectPlaybooks";

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

console.log("\n[3] Clasificación de delivery sin contaminación de reservas");
const velozYaPrompts = [
  "Crea VELOZYA, una app de reparto a domicilio de comida y productos. No es turismo, reservas, alojamiento, hotel, vuelos ni alquiler. Incluye restaurantes, supermercado, farmacia, carrito, pedidos y repartidores.",
  "Construye VelozYa como delivery urbano con comercios, productos, selección de dirección, carrito, checkout demo, seguimiento del repartidor, panel de comercio y panel de reparto. Excluye hoteles, anfitriones, alojamiento y flujos de reserva.",
];
for (const [index, deliveryPrompt] of velozYaPrompts.entries()) {
  const deliveryBlueprint = selectAgentGenerationBlueprint(deliveryPrompt, "fullstack");
  const context = buildAgentTemplateContextBlock({ prompt: deliveryPrompt, kind: "fullstack" }).toLowerCase();
  const visiblePlan = buildDeterministicPlanPreview(deliveryPrompt, "fullstack");
  const visiblePlanFeatures = JSON.stringify([visiblePlan.title, visiblePlan.included, visiblePlan.extras]).toLowerCase();
  expect(`VelozYa ${index + 1} selecciona delivery`, deliveryBlueprint.id === "local-delivery");
  expect(`VelozYa ${index + 1} conserva comercios, pedidos y reparto`, /restaurantes|comida/.test(context) && /pedido/.test(context) && /reparto/.test(context));
  expect(`VelozYa ${index + 1} excluye alojamiento y reserva`, !/alojamiento|hotel|reserva|anfitrion|vuelo/.test(context));
  expect(`VelozYa ${index + 1} muestra un plan de delivery sin reservas`, /delivery/.test(visiblePlanFeatures) && /pedido/.test(visiblePlanFeatures) && !/alojamiento|hotel|reserva|anfitrion|vuelo/.test(visiblePlanFeatures) && /sin reservas ni alojamientos/i.test(visiblePlan.summary));
  expect(`VelozYa ${index + 1} usa memoria aislada de delivery`, detectBusinessVertical(deliveryPrompt) === "delivery");
}

console.log("\n[4] Progreso verificable sin spam");
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
