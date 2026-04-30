// Evolution Core — Sandbox Tester (Fase 10 PRO)
//
// Ejecuta el archivo de agente recién creado y devuelve éxito/fallo.
// AVISO: el documento original recomienda Docker como sandbox real;
// aquí se ejecuta con el mismo `node` del proceso principal, así que NO
// es una sandbox de seguridad. No usar con código no confiado sin
// añadir aislamiento real (Docker, VM, gVisor…).

const path = require("node:path");
const { runCommand } = require("../tools/execTool");

async function testCode(file) {
  const agentPath = path.resolve(__dirname, "..", "agents", file);
  try {
    const result = await runCommand(`node "${agentPath}"`);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err };
  }
}

module.exports = { testCode };
