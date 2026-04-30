// Sincronización de estado global — Fase 8 PRO
//
// Todos los agentes ven el mismo "mundo": archivos, tareas y conflictos
// activos. Implementación in-memory; para que sobreviva a reinicios o se
// comparta entre procesos hay que persistirlo (Postgres / Redis).

const state = {
  files: {},
  tasks: {},
  issues: [],
};

function updateState(partial) {
  Object.assign(state, partial);
}

function getState() {
  return state;
}

module.exports = { updateState, getState };
