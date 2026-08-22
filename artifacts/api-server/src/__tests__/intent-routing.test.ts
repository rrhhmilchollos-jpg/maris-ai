import assert from "node:assert/strict";
import { classifyChatIntent } from "../lib/intentClassifier";

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
} as any;

async function classify(message: string) {
  return classifyChatIntent({
    appTitle: "Proyecto de prueba",
    appDescription: "",
    recentMessages: [],
    message,
    log: silentLog,
  });
}

const cases: Array<{ message: string; intent: string; engine: string }> = [
  {
    message: "¿Por qué no se pudo editar la aplicación?",
    intent: "question",
    engine: "ENGINE_INFO",
  },
  {
    message: "por qué no se pudo editar la aplicación",
    intent: "question",
    engine: "ENGINE_INFO",
  },
  {
    message: "¿Qué tecnología usa esta app?",
    intent: "question",
    engine: "ENGINE_INFO",
  },
  {
    message: "Corrige el error del login",
    intent: "edit",
    engine: "ENGINE_DEV",
  },
  {
    message: "¿Puedes arreglar el error del login?",
    intent: "edit",
    engine: "ENGINE_DEV",
  },
  {
    message: "Esto se ve raro",
    intent: "ambiguous",
    engine: "ENGINE_CLARIFY",
  },
];

for (const testCase of cases) {
  const result = await classify(testCase.message);
  assert.equal(result.intent, testCase.intent, testCase.message);
  assert.equal(result.engine, testCase.engine, testCase.message);
}

console.log("intent-routing: preguntas, órdenes y mensajes ambiguos OK");
