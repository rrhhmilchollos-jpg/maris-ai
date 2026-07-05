import { anthropic } from "@workspace/integrations-anthropic-ai";
import { validateBundle } from "./validate";
import { patchBundle, patchBundleMultiFile, type GenLanguage, type BuildIssue, type ValidationReport } from "./shared-agents";
import { logger } from "./logger";
import { rememberPatch, extractFixHint, redactSecrets } from "./agentMemory";

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
  // A petición EXPLÍCITA del usuario: el Testing Agent debe ser invisible
  // para el cliente cuando no hay nada que corregir -- antes se anunciaba
  // ("activado", "ciclo 1/5 escaneando...", "¡todas las pruebas pasaron!")
  // en TODA generación, incluso cuando no había ningún problema real, lo
  // que hacía parecer que "trabajaba" sin necesidad. Ahora solo aparece en
  // el log visible del cliente la PRIMERA VEZ que encuentra algo real que
  // corregir, y desaparece (sin mensaje de despedida) en cuanto termina —
  // dando paso a que el resto del pipeline continúe con normalidad. Si
  // nunca encuentra nada que corregir, no deja ningún rastro visible.
  let hasAnnouncedToClient = false;
  // ENCONTRADO A PETICIÓN DEL USUARIO (mostró "Memoria del agente" con solo
  // 2 entradas en más de un mes de uso real): este Testing Agent -- el que
  // de verdad ejecuta el 99% de las reparaciones hoy en día, tras la
  // migración a hitos obligatorios -- nunca llamaba a rememberPatch(). Solo
  // lo hacía un camino antiguo y secundario (runValidatePatchLoop en
  // apps.ts), así que casi ninguna reparación real quedaba aprendida.
  let lastErrorMessage: string | null = null;
  let lastPatchedBundle: string | null = null;
  const announceIfNeeded = () => {
    if (!hasAnnouncedToClient) {
      hasAnnouncedToClient = true;
      log("testing", "🧪 Testing Agent: encontró algo que corregir, aplicando arreglos automáticos...");
    }
  };

  while (!allPassing && cycle < MAX_FIX_CYCLES) {
    cycle++;

    // 1. RUN VALIDATION
    const report: ValidationReport = await validateBundle(currentBundle);
    
    // 1.1 DETECT BROKEN LINKS (Navegación)
    const brokenLinks: BuildIssue[] = [];
    const files = currentBundle.split("// === FILE: ");
    const routes = new Set();
    // ENCONTRADO en producción (caso real: 22 hitos en una app de gestión
    // dental, "404 en todas las resoluciones" detectado por Claude Vision
    // mientras este Testing Agent decía "todas las pruebas pasaron"):
    // `files.find(f => f.includes("App.tsx"))` no busca el archivo CUYA
    // RUTA sea App.tsx — busca el PRIMER archivo cuyo CONTENIDO contenga
    // ese texto en cualquier parte. Confirmado con código real ejecutado:
    // un componente cualquiera con un comentario como "// se usa dentro
    // de App.tsx" (patrón habitual y razonable que un modelo SÍ escribe)
    // coincide ANTES que el App.tsx real si aparece antes en el bundle —
    // `routes` queda vacío o con rutas de un archivo que no es el router,
    // y entonces TODOS los enlaces internos reales de la app se marcan
    // como "rotos" sin estarlo, disparando reparaciones sobre un
    // diagnóstico equivocado. FIX: comparar la RUTA real del archivo
    // (primera línea de cada bloque, antes de su propio "===" de cierre),
    // no su contenido — exactamente como exige el formato real
    // "// === FILE: <ruta> ===\n<contenido>".
    const appFile = files.find(f => {
      const declaredPath = f.split("\n")[0].split(" ===")[0].trim();
      return /(^|\/)App\.(tsx|jsx)$/.test(declaredPath);
    });
    if (appFile) {
      const routeMatches = appFile.matchAll(/path=["'](\/.*?)["']/g);
      for (const m of routeMatches) routes.add(m[1]);
    }
    
    // Buscar enlaces que apuntan a rutas no definidas
    files.forEach(f => {
      const path = f.split(" ===")[0];
      const hrefMatches = f.matchAll(/href=["'](\/.*?)["']/g);
      for (const m of hrefMatches) {
        if (m[1] !== "/" && !routes.has(m[1]) && !m[1].startsWith("http")) {
          brokenLinks.push({
            file: path,
            message: `Enlace roto: el botón apunta a "${m[1]}" pero esa ruta no está definida en App.tsx.`
          });
        }
      }
    });

    if (report.ok && brokenLinks.length === 0) {
      allPassing = true;
      // Silencioso si nunca hizo falta anunciarse (nada que corregir en
      // ningún ciclo). Si SÍ hubo que corregir algo antes, un cierre breve.
      if (hasAnnouncedToClient) {
        log("testing", `✅ Corregido. Continuando...`);
      }
      // Guardar en memoria SOLO cuando se confirma que el parche del ciclo
      // anterior de verdad resolvió el problema (esta validación, la del
      // ciclo SIGUIENTE, ha salido limpia) -- nunca antes de confirmarlo,
      // para no aprender de "parches" que en realidad no funcionaron.
      if (lastErrorMessage && lastPatchedBundle) {
        const fixHint = extractFixHint(lastPatchedBundle, lastErrorMessage);
        rememberPatch({
          errorMessage: redactSecrets(lastErrorMessage).slice(0, 1000),
          errorContext: `testing-agent cycle=${cycle} bundleLen=${lastPatchedBundle.length}`,
          patch: fixHint,
          language,
        }).catch((err) => logger.warn({ err }, "rememberPatch falló (no crítico, no bloquea la generación)"));
      }
      break;
    }
    
    announceIfNeeded();
    onProgress?.({
      phase: "testing",
      progress: 80 + cycle * 2,
      note: `🧪 Testing Agent: corrigiendo (ciclo ${cycle}/${MAX_FIX_CYCLES})...`,
    });

    if (brokenLinks.length > 0) {
      log("testing", `🔗 Se detectaron ${brokenLinks.length} enlaces rotos. Forzando reparación de navegación...`);
      report.issues.push(...brokenLinks);
    }

    // 2. ANALYZE ISSUES
    log("testing", `🔧 Se encontraron ${report.issues.length} problema(s). Analizando reparaciones...`);
    
    // 3. APPLY PATCHES (Optimización de Contexto)
    const MAX_BUNDLE_SIZE = 400000; // ~100k tokens
    let codeToPatch = currentBundle;
    let isContextReduced = false;

    if (currentBundle.length > MAX_BUNDLE_SIZE) {
      log("testing", "📦 Bundle muy extenso. Reduciendo contexto para evitar errores de API...");
      const errorFiles = new Set(report.issues.map(i => i.file));
      const files = currentBundle.split("// === FILE: ");
      const filteredFiles = files.filter(f => {
        if (!f.trim()) return false;
        const path = f.split(" ===")[0];
        // Mantener archivos con errores + archivos raíz críticos
        return errorFiles.has(path) || path.includes("App.") || path.includes("main.") || path.includes("package.json");
      });
      codeToPatch = filteredFiles.map(f => f.startsWith("// === FILE: ") ? f : "// === FILE: " + f).join("");
      isContextReduced = true;
    }

    // Capturado ANTES del intento de parche para poder guardarlo en memoria
    // si en el SIGUIENTE ciclo se confirma que de verdad funcionó — cubre
    // las 3 rutas de éxito posteriores (multi-archivo, contexto reducido,
    // parche simple).
    lastErrorMessage = report.issues.map((issue) => `[${issue.file}] ${issue.message}`).join("\n");

    const patched = await patchBundle(
      codeToPatch,
      report.issues.map(issue => ({
        file: issue.file,
        problem: issue.message,
        fix: `Repara este error: "${issue.message}".`
      })),
      language
    );

    if (!patched) {
      // ENCONTRADO en producción (mismo patrón EXACTO ya documentado y
      // corregido en autoRepairAgent.ts para el caso real "MesaYa"):
      // patchBundle estándar (16K tokens, una sola respuesta JSON) puede
      // fallar silenciosamente cuando hay que reparar varios archivos a la
      // vez (confirmado en logs reales: "Reparando 6 error(es):
      // appforge-vfs:src/components/ui/index.ts, ...") — el modelo se
      // queda sin presupuesto de tokens y produce JSON truncado/inválido,
      // devolviendo null sin ninguna pista real de qué pasó. Este Testing
      // Agent (tester.ts) seguía usando SOLO el patcher simple, sin la
      // solución multi-archivo que ya existe en shared-agents.ts y que ya
      // se usa en autoRepairAgent.ts — conectado aquí también, mismo
      // patrón probado: una llamada de planificación + una llamada
      // completa por archivo, cada una con su propio presupuesto de 16K
      // tokens, eliminando el riesgo de truncamiento por acumular todo en
      // una sola respuesta.
      log("testing", "⚠️ El reparador estándar no consiguió generar un cambio — probando con el modo multi-archivo (para reparaciones grandes)…", "warn");
      const errorSummary = report.issues.map((issue) => `[${issue.file}] ${issue.message}`).join("\n");
      const multiFileResult = await patchBundleMultiFile(
        currentBundle,
        errorSummary,
        language,
        "claude-sonnet-4-6",
        (msg) => log("testing", msg),
      );
      if (multiFileResult.result) {
        currentBundle = multiFileResult.result;
        lastPatchedBundle = currentBundle;
        log("testing", `✅ Modo multi-archivo completado: ${multiFileResult.filesSucceeded}/${multiFileResult.filesAttempted} archivo(s) generados correctamente. Re-validando en el siguiente ciclo...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      log("testing", `⚠️ El modo multi-archivo tampoco pudo generar una solución en este ciclo (${multiFileResult.filesSucceeded}/${multiFileResult.filesAttempted} archivo(s) completados).`, "warn");
      // FIX 3+5: 0 archivos completados = el parche no converge.
      // Romper el bucle inmediatamente para no gastar tokens en ciclos
      // idénticos que producirán el mismo resultado. Sin este break, el
      // testing agent agota todos los MAX_FIX_CYCLES intentando lo mismo.
      break;
    }

    if (isContextReduced) {
      // Reintegrar archivos parcheados en el bundle original
      const originalFiles = currentBundle.split("// === FILE: ");
      const patchedFiles = patched.split("// === FILE: ");
      const patchedMap = new Map();
      patchedFiles.forEach(f => {
        if (!f.trim()) return;
        const path = f.split(" ===")[0];
        patchedMap.set(path, f);
      });
      
      currentBundle = originalFiles.map(f => {
        if (!f.trim()) return f;
        const path = f.split(" ===")[0];
        return patchedMap.has(path) ? patchedMap.get(path) : f;
      }).join("// === FILE: ");
      lastPatchedBundle = currentBundle;
    } else {
      // FIX 5: si el bundle parchado es idéntico al anterior, el parche
      // no produjo ningún cambio real — romper el bucle para no desperdiciar
      // más ciclos y tokens en el mismo intento que ya falló.
      if (patched === currentBundle) {
        log("testing", "⚠️ El parche no produjo cambios en el bundle — deteniendo ciclos para no gastar tokens innecesariamente.", "warn");
        break;
      }
      currentBundle = patched;
      lastPatchedBundle = currentBundle;
    }
    log("testing", "✓ Reparaciones aplicadas — re-validando en el siguiente ciclo...");
    
    // Small delay to avoid hitting rate limits too fast
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!allPassing) {
    log("testing", "⚠️ Algunos problemas persisten pero se ha alcanzado el límite de ciclos o el parche no convergió.", "warn");
  }

  return currentBundle;
}
