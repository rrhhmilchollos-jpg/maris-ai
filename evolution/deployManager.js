// Evolution Core — Deploy Manager (Fase 10 PRO)
//
// Hace commit y build automático. AVISO: ejecuta `git add .` y
// `git commit` sobre el repo del usuario — usar solo cuando se decida
// que el ciclo de auto-evolución es deseable. En este repo NADIE llama
// a esta función todavía.

const { runCommand } = require("../tools/execTool");

async function deploy() {
  console.log("🚀 Deploy iniciado...");

  await runCommand("git add .");
  await runCommand('git commit -m "auto evolution update"');

  // ejemplo deploy: build del proyecto
  await runCommand("npm run build");

  console.log("✅ Deploy completado");
}

module.exports = { deploy };
