// Team Leader agent — Fase 8 PRO
//
// Coordinador automático: cuando otro agente emite un conflicto, este
// rol decide qué versión gana. Aquí queda el esqueleto; la política de
// resolución se rellena cuando haya conflictos reales que resolver.

const { on } = require("../communication/bus");

on("conflict", (data) => {
  console.log("🧠 Resolviendo conflicto:", data);
  // Política de decisión: por ahora se queda con la última versión
  // emitida. Sustituir por reglas reales (votación, prioridad por
  // agente, intervención humana) cuando exista carga real.
});

module.exports = {};
