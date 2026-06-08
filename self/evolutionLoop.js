// Self-Improvement Engine — Evolution Loop (Fase 9 PRO)
//
// Cada 10 segundos analiza el estado del sistema y dispara
// optimizaciones. Es el "latido" del cerebro adaptativo.

const { analyzeSystem } = require("./analyzer");
const { optimize } = require("./optimizer");

let _interval = null;

async function evolutionLoop() {
  if (_interval) {
    console.log("⚠️ Automejora ya en curso.");
    return;
  }
  console.log("🚀 Iniciando bucle de automejora (10s)...");
  _interval = setInterval(() => {
    try {
      const report = analyzeSystem();
      console.log("📊 Sistema analizado:", report);
      optimize(report);
    } catch (err) {
      console.error("❌ Error en bucle de automejora:", err);
    }
  }, 10000);
}

function stopLoop() {
  if (_interval) {
    console.log("🛑 Deteniendo bucle de automejora...");
    clearInterval(_interval);
    _interval = null;
  }
}

module.exports = { evolutionLoop, stopLoop };
