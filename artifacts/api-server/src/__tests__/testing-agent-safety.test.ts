import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const apiRoot = resolve(root, "..");
const workspaceRoot = resolve(apiRoot, "..", "..");

function read(relativePath: string): string {
  return readFileSync(resolve(apiRoot, "src", relativePath), "utf8");
}

function readAppforge(relativePath: string): string {
  return readFileSync(resolve(workspaceRoot, "artifacts", "appforge", "src", relativePath), "utf8");
}

let failed = 0;
function check(name: string, passed: boolean): void {
  if (passed) {
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

const tester = read("lib/tester.ts");
const sharedAgents = read("lib/shared-agents.ts");
const deployment = read("routes/deployment.ts");
const appDetail = readAppforge("pages/app-detail.tsx");
const agentLogStream = readAppforge("components/agent-log-stream.tsx");
const generationStudio = readAppforge("components/generation-studio.tsx");
const polling = readAppforge("lib/job-polling.ts");

check(
  "Testing Agent limita automáticamente los ciclos y el tiempo de ejecución",
  /MAX_FIX_CYCLES\s*=\s*2/.test(tester)
    && /MAX_EDIT_FIX_CYCLES\s*=\s*1/.test(tester)
    && /MAX_TESTING_RUNTIME_MS\s*=\s*120_000/.test(tester),
);

check(
  "El fallback multiarchivo queda limitado a tres archivos",
  /MAX_FILES_PER_REPAIR_CYCLE\s*=\s*3/.test(sharedAgents)
    && /boundedPlan\s*=\s*plan\.slice\(0, MAX_FILES_PER_REPAIR_CYCLE\)/.test(sharedAgents),
);

check(
  "La ausencia de Chromium se devuelve como prueba omitida y no como job fallido",
  /skipped:\s*true/.test(deployment)
    && /code:\s*"NO_CHROMIUM"/.test(deployment)
    && /Testing visual omitido/.test(deployment),
);

check(
  "La política de polling aplica backoff ante HTTP 429 y evita reintentos inmediatos",
  /isRateLimited/.test(polling)
    && /maxBackoff/.test(polling)
    && /if \(isRateLimited\(error\)\) return false/.test(polling),
);

check(
  "La vista de app deja de consultar job, logs y mensajes a intervalos subsegundo",
  /JOB_POLLING\.job/.test(appDetail)
    && /JOB_POLLING\.logs/.test(appDetail)
    && /JOB_POLLING\.messages/.test(appDetail)
    && !/\?\s*false\s*:\s*1000/.test(appDetail),
);

check(
  "Los streams de logs dejan de consultar cada 400 ms",
  !/refetchInterval:\s*isActive\s*\?\s*400/.test(agentLogStream)
    && !/refetchInterval:\s*isActive\s*\?\s*400/.test(generationStudio)
    && /JOB_POLLING\.logs/.test(agentLogStream)
    && /JOB_POLLING\.logs/.test(generationStudio),
);

if (failed > 0) {
  console.error(`\n${failed} prueba(s) de seguridad del Testing Agent fallaron.`);
  process.exit(1);
}

console.log("\nEl Testing Agent mantiene los límites de seguridad esperados.");
