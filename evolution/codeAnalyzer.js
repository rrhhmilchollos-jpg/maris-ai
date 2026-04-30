// Evolution Core — Code Analyzer (Fase 10 PRO)
//
// El sistema lee su propio "cerebro": recorre /agents y devuelve metadatos
// por archivo. La heurística de errores ("contiene la palabra undefined")
// es la del documento; sirve como demo, no como detector real.

const fs = require("node:fs");
const path = require("node:path");

function analyzeCodebase() {
  const agentsDir = path.resolve(__dirname, "..", "agents");
  if (!fs.existsSync(agentsDir)) return [];

  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".js"));

  return files.map((file) => {
    const content = fs.readFileSync(path.join(agentsDir, file), "utf-8");
    return {
      file,
      size: content.length,
      hasErrors: content.includes("undefined"),
    };
  });
}

module.exports = { analyzeCodebase };
