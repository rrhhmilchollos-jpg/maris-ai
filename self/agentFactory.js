// Self-Improvement Engine — Agent Factory (Fase 9 PRO)
//
// Permite crear variantes de agentes en caliente con configuración
// distinta (modo rápido, con caché, con prioridad alta, etc.).

const { runAgent } = require("../agents/router");

function createAgent(type, config) {
  return async function dynamicAgent(input) {
    console.log(`🧠 Nuevo agente creado: ${type}`);

    return runAgent({
      type,
      input,
      config,
    });
  };
}

module.exports = { createAgent };
