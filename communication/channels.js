// Canales de comunicación — Fase 8 PRO
//
// Convención de nombres de eventos para que los agentes hablen el mismo
// idioma. Importa estas constantes en lugar de pasar strings sueltos.

const CHANNELS = {
  FRONTEND_NEEDS_API: "frontend:needs_api",
  BACKEND_API_READY: "backend:api_ready",
  CONFLICT: "conflict",
  STATE_UPDATED: "state:updated",
};

module.exports = { CHANNELS };
