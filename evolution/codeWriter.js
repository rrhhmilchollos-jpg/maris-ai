// Evolution Core — Code Writer (Fase 10 PRO)
//
// Pide a OpenAI un agente nuevo en JS, lo escribe en /agents y devuelve
// el nombre del archivo. Requiere `process.env.OPENAI_KEY` y el paquete
// `openai` instalado — ninguno de los dos está configurado en este
// repo, así que el require se hace dentro de la función para que el
// módulo se pueda cargar sin reventar el resto del scaffold.

const fs = require("node:fs");
const path = require("node:path");

async function generateAgent(spec) {
  // Lazy require para no romper el módulo si `openai` no está instalado.
  // Cuando se llame de verdad, lanzará un error claro.
  let OpenAI;
  try {
    OpenAI = require("openai");
  } catch (err) {
    throw new Error(
      "El paquete 'openai' no está instalado. Instálalo y configura OPENAI_KEY antes de usar generateAgent.",
    );
  }
  if (!process.env.OPENAI_KEY) {
    throw new Error(
      "OPENAI_KEY no está configurada. Añádela a las variables de entorno antes de usar generateAgent.",
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });

  const prompt = `
Crea un agente de IA en JavaScript.

Especificación:
${spec}

Debe ser funcional y exportar una función async.
`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  const code = res.choices[0].message.content;

  const agentsDir = path.resolve(__dirname, "..", "agents");
  if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });

  const fileName = `agent_${Date.now()}.js`;
  fs.writeFileSync(path.join(agentsDir, fileName), code);

  return fileName;
}

module.exports = { generateAgent };
