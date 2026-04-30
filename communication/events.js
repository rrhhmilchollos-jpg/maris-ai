// Detección de conflictos — Fase 8 PRO
//
// Suscribe handlers a eventos transversales que cualquier agente puede
// emitir (conflictos de archivo, endpoints duplicados, etc.).

const { on } = require("./bus");

on("conflict", (data) => {
  console.log("⚠️ Conflicto detectado:", data);
});

module.exports = {};
