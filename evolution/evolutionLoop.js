// Evolution Core — Evolution Loop final (Fase 10 PRO)
//
// Cada 30 s analiza el código, si detecta errores genera un agente
// nuevo, lo testea y si pasa hace deploy.
//
// DESVIACIÓN CONSCIENTE respecto al documento: el doc original arranca
// el setInterval a nivel de módulo. Eso significaría que con solo
// requerir este archivo el sistema empezaría a escribir archivos a
// disco, llamar a OpenAI y hacer `git commit` automáticos. Lo
// encerramos en una función `start()` que NADIE llama todavía. Cuando
// quieras activar el ciclo, importa esta función y llámala
// explícitamente — y solo después de revisar los avisos en
// sandboxTester.js y deployManager.js.

const { analyzeCodebase } = require("./codeAnalyzer");
const { generateAgent } = require("./codeWriter");
const { testCode } = require("./sandboxTester");
const { deploy } = require("./deployManager");

async function evolutionLoop() {
  const report = analyzeCodebase();

  if (report.some((f) => f.hasErrors)) {
    const newAgent = await generateAgent("Fix system errors automatically");

    const test = await testCode(newAgent);

    if (test.success) {
      await deploy();
    }
  }
}

let intervalHandle = null;

function start(intervalMs = 30000) {
  if (intervalHandle) {
    console.log("⚠️ evolutionLoop ya está en ejecución.");
    return intervalHandle;
  }
  console.log(`🚀 Iniciando evolutionLoop cada ${intervalMs}ms...`);
  intervalHandle = setInterval(() => {
    evolutionLoop().catch((err) =>
      console.error("❌ evolutionLoop error:", err),
    );
  }, intervalMs);
  return intervalHandle;
}

function stop() {
  if (intervalHandle) {
    console.log("🛑 Deteniendo evolutionLoop...");
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { evolutionLoop, start, stop };
