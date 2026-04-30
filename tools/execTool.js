// Exec tool — utilidad compartida usada por /evolution.
//
// El documento de Fase 10 PRO la referencia (`../tools/execTool`) pero no la
// define. Implementación mínima: envuelve child_process.exec en una promesa
// y devuelve { stdout, stderr } en éxito, o lanza con stderr en fallo.

const { exec } = require("node:child_process");

function runCommand(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

module.exports = { runCommand };
