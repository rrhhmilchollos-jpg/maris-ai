import { anthropic } from "@workspace/integrations-anthropic-ai";
import { validateBundle } from "./validate";
import { patchBundle, type GenLanguage, type BuildIssue, type ValidationReport } from "./shared-agents";
import { logger } from "./logger";

export interface TestResult {
  test: string;
  status: "running" | "pass" | "fail";
  details?: string;
}

export interface TestingAgentOptions {
  jobId: string;
  prompt: string;
  plan: any;
  language: GenLanguage;
  log: (agent: string, message: string, level?: "info" | "warn" | "error") => void;
  onProgress?: (update: any) => void;
}

const MAX_FIX_CYCLES = 5;

/**
 * Testing Agent — systematic validation and repair loop.
 * Inspired by Emergent.sh's approach.
 */
export async function runTestingAgent(
  bundle: string,
  options: TestingAgentOptions
): Promise<string> {
  const { log, onProgress, language, prompt, plan } = options;
  let currentBundle = bundle;
  let allPassing = false;
  let cycle = 0;

  log("testing", "🧪 Testing Agent activado. Iniciando suite de pruebas completa...");

  while (!allPassing && cycle < MAX_FIX_CYCLES) {
    cycle++;
    log("testing", `🔍 Ciclo de prueba ${cycle}/${MAX_FIX_CYCLES} — escaneando problemas...`);
    
    onProgress?.({
      phase: "testing",
      progress: 80 + cycle * 2,
      note: `🧪 Testing Agent: ciclo ${cycle}/${MAX_FIX_CYCLES}...`,
    });

    // 1. RUN VALIDATION
    const report: ValidationReport = await validateBundle(currentBundle);

    if (report.ok) {
      allPassing = true;
      log("testing", `✅ ¡Todas las pruebas pasaron tras ${cycle} ciclo(s)! La app está lista.`);
      break;
    }

    // 2. ANALYZE ISSUES
    log("testing", `🔧 Se encontraron ${report.issues.length} problema(s). Analizando reparaciones...`);
    
    // 3. APPLY PATCHES
    // We reuse the existing patchBundle logic but driven by the Testing Agent's findings
    const patched = await patchBundle(
      currentBundle,
      report.issues.map(issue => ({
        file: issue.file,
        problem: issue.message,
        fix: `Repara este error detectado por esbuild: "${issue.message}". Asegúrate de que todos los archivos necesarios existan y que los imports sean correctos.`
      })),
      language
    );

    if (!patched || patched === currentBundle) {
      log("testing", "⚠️ El reparador no pudo aplicar cambios adicionales o el bundle es idéntico.", "warn");
      break;
    }

    currentBundle = patched;
    log("testing", "✓ Reparaciones aplicadas — re-validando en el siguiente ciclo...");
    
    // Small delay to avoid hitting rate limits too fast
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!allPassing) {
    log("testing", "⚠️ Algunos problemas persisten pero se ha alcanzado el límite de ciclos o el parche no convergió.", "warn");
  }

  return currentBundle;
}
