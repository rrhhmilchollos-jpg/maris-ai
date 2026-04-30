// Evolution Core — Rollback System (Fase 10 PRO)
//
// Salvavidas: si un cambio rompe algo, restaurar la copia anterior.
// Recibe un objeto { from, to } con las dos rutas absolutas o relativas
// al cwd y copia el respaldo encima del archivo vivo.

const fs = require("node:fs");

function rollback(fileBackup) {
  fs.copyFileSync(fileBackup.from, fileBackup.to);
  console.log("🔁 rollback ejecutado");
}

module.exports = { rollback };
