// Frontend agent — Fase 8 PRO
//
// Pide endpoints al backend agent vía bus en lugar de hablar con el
// orquestador. Demo del patrón emisor/receptor.

const { emit, on } = require("../communication/bus");

on("backend:api_ready", (data) => {
  console.log("🟢 Frontend recibió endpoint listo:", data);
});

function requestApi(endpoint, method) {
  emit("frontend:needs_api", { endpoint, method });
}

module.exports = { requestApi };
