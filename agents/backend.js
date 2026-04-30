// Backend agent — Fase 8 PRO
//
// Escucha peticiones del frontend agent y responde cuando el endpoint
// está listo. Demo del patrón emisor/receptor sobre el bus.

const { emit, on } = require("../communication/bus");

on("frontend:needs_api", async (data) => {
  console.log("🔵 Backend recibió petición del frontend:", data);

  // Aquí iría la lógica real: crear el handler, registrar la ruta, etc.
  emit("backend:api_ready", {
    endpoint: data.endpoint,
    method: data.method,
  });
});

module.exports = {};
