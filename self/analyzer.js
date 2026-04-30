// Self-Improvement Engine — Analyzer (Fase 9 PRO)
//
// Lee el estado global y devuelve un informe de salud: tareas lentas,
// tareas fallidas y carga total. Auto-diagnóstico para que el optimizer
// decida qué tocar.
//
// NOTA: scaffold creado a petición explícita. No está conectado a
// ningún flujo real de Maris AI todavía.

const { getState } = require("../communication/stateSync");

function analyzeSystem() {
  const state = getState();

  const report = {
    slowTasks: state.tasks?.filter
      ? state.tasks.filter((t) => t.time > 3000)
      : [],
    failedTasks: state.issues,
    load: Object.keys(state.tasks || {}).length,
  };

  return report;
}

module.exports = { analyzeSystem };
