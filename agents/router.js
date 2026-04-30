// Router de agentes — esqueleto necesario para self/agentFactory.js
//
// Despacha la ejecución de un agente según su tipo. Implementación
// mínima para que la factory tenga a quién llamar; la lógica real se
// rellena cuando existan agentes ejecutables de verdad.

async function runAgent({ type, input, config }) {
  console.log(`🤖 runAgent ejecutado — tipo=${type}`, { input, config });
  return { ok: true, type, input, config };
}

module.exports = { runAgent };
