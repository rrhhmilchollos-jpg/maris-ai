import { runTestingAgent } from "./artifacts/api-server/src/lib/tester";
import { connectDB } from "./lib/db/src";
import { logger } from "./artifacts/api-server/src/lib/logger";
import { type GenLanguage } from "./artifacts/api-server/src/lib/shared-agents";

async function test() {
  console.log("🚀 Iniciando prueba del Testing Agent...");
  
  const mockBundle = `
// === FILE: src/App.tsx ===
import React from 'react';
import { Button } from './components/Button'; // ERROR: This file doesn't exist

export default function App() {
  return <Button>Click me</Button>;
}
  `;

  const options = {
    jobId: "test-job-id",
    prompt: "Crea una app con un botón",
    plan: { title: "Test App" },
    language: "typescript" as const,
    log: (agent: string, message: string, level: string = "info") => {
      console.log(`[${agent.toUpperCase()}] [${level.toUpperCase()}] ${message}`);
    },
    onProgress: (p: any) => {
      console.log(`[PROGRESS] ${p.phase}: ${p.progress}% - ${p.note}`);
    }
  };

  try {
    const result = await runTestingAgent(mockBundle, options);
    console.log("✅ Resultado final del bundle:");
    console.log(result.slice(0, 500) + "...");
  } catch (error) {
    console.error("❌ Error durante la prueba:", error);
  }
}

test();
