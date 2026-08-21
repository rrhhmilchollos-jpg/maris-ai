import assert from "node:assert/strict";
import { selectAgentGenerationBlueprint } from "../artifacts/api-server/src/lib/templates";

const prompt = "Crea una protectora municipal con perros en adopción, acogida, voluntariado, veterinaria, moderación y códigos de empleado.";
const blueprint = selectAgentGenerationBlueprint(prompt, "fullstack");
assert.equal(blueprint.id, "animal-shelter-operations", "Debe seleccionar el blueprint de protectora");
assert.ok(blueprint.qualityChecklist.some((rule) => /foto.*ficha completa/i.test(rule)), "Debe exigir fichas completas desde las fotos");
assert.ok(blueprint.qualityChecklist.some((rule) => /c[oó]digo de empleado.*contrase[nñ]a/i.test(rule)), "Debe exigir código más contraseña");
assert.ok(blueprint.qualityChecklist.some((rule) => /exportaci[oó]n de auditor[ií]a.*administraci[oó]n/i.test(rule)), "Debe limitar exportación a administración");
console.log(JSON.stringify({ ok: true, blueprint: blueprint.id }));
