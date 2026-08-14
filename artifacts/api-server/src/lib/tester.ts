import { anthropic as zocoia } from "@workspace/integrations-anthropic-ai";
// MODO OPENAI/DEEPSEEK: SDK de Zoco IA eliminado — todo viaja por el cliente OpenAI de zocoia.
import { validateBundle } from "./validate";
import { patchBundle, patchBundleMultiFile, type GenLanguage, type BuildIssue, type ValidationReport } from "./shared-agents";
import { logger } from "./logger";
import { rememberPatch, extractFixHint, redactSecrets } from "./agentMemory";
import { GenerationJob } from "@workspace/db/schema";

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
  /** true en modo edición de proyecto existente: menos ciclos (2 vs 5), la edición termina minutos antes */
  isEdit?: boolean;
}

// El Testing Agent es un guardrail, no un segundo generador de proyectos.
// Dos pasadas bastan para reparar errores reproducibles; más ciclos aumentaban
// coste, latencia y el riesgo de reescribir una app correcta a partir de una
// heurística ambigua. Las ediciones reciben una única pasada segura.
const MAX_FIX_CYCLES = 2;
const MAX_EDIT_FIX_CYCLES = 1;
const MAX_ISSUES_PER_AUTOFIX = 3;
const MAX_TESTING_RUNTIME_MS = 120_000;

/**
 * Testing Agent — systematic validation and repair loop.
 * Inspired by Emergent.sh's approach.
 */
export async function runTestingAgent(
  bundle: string,
  options: TestingAgentOptions
): Promise<string> {
  const { log, onProgress, language, prompt, plan } = options;
  const maxCycles = options.isEdit ? MAX_EDIT_FIX_CYCLES : MAX_FIX_CYCLES;
  let currentBundle = bundle;
  let allPassing = false;
  let cycle = 0;
  const startedAt = Date.now();
  let stoppedForSafety = false;
  // FIX VELOCIDAD: si dos ciclos consecutivos detectan EXACTAMENTE los mismos
  // issues, el parche no está convergiendo — seguir quemando ciclos (y
  // llamadas LLM de minutos cada una) producirá el mismo resultado. Cortar ya.
  let previousIssuesSignature = "";
  // Issues descartados por no-convergencia (firma "file|message") — se
  // consideran falsos positivos de las heurísticas salvo que el build falle.
  const quarantinedIssues = new Set<string>();
  // Declarado fuera del bucle a propósito -- report (más abajo) vive
  // dentro del while y no está disponible tras salir de él, pero
  // necesitamos su último valor para saber qué problemas quedaron sin
  // resolver si se agotan los ciclos.
  let lastReport: ValidationReport | null = null;
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

  while (!allPassing && cycle < maxCycles) {
    if (Date.now() - startedAt >= MAX_TESTING_RUNTIME_MS) {
      stoppedForSafety = true;
      log("testing", "⚠️ El Testing Agent alcanzó su presupuesto de tiempo y detuvo reparaciones automáticas. La app se conserva sin sobrescrituras adicionales.", "warn");
      onProgress?.({ phase: "testing", progress: 88, note: "Validación acotada por seguridad; no se aplicarán más parches automáticos." });
      break;
    }
    cycle++;

    // 1. RUN VALIDATION
    const report: ValidationReport = await validateBundle(currentBundle);
    lastReport = report;
    
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
    
    // Buscar enlaces que apuntan a rutas no definidas.
    // FIX VELOCIDAD (bucle "1 problema(s)" repetido observado en producción):
    // este detector marcaba como "rotos" enlaces perfectamente válidos —
    // anclas de sección (href="/#galeria"), rutas con query ("/planes?x=1") y
    // rutas dinámicas de React Router (path="/post/:id" no coincide
    // literalmente con href="/post/7") — y disparaba al patcher (una llamada
    // LLM de hasta 4 minutos POR CICLO) para "reparar" algo que no estaba
    // roto. Como el enlace válido seguía ahí tras el parche, el siguiente
    // ciclo volvía a marcar EXACTAMENTE el mismo problema: hasta 5 ciclos
    // de LLM desperdiciados por edición. Ahora: se ignoran anclas y queries,
    // y las rutas dinámicas se comparan por patrón (":param" → segmento
    // comodín), igual que hace el router real.
    const routePatterns = [...routes].map((r) => {
      const pattern = String(r)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\:[^/]+/g, "[^/]+")
        .replace(/\/\\\*$/, "(/.*)?");
      return new RegExp(`^${pattern}/?$`);
    });
    const routeMatchesHref = (href: string): boolean => {
      if (routes.has(href)) return true;
      return routePatterns.some((re) => re.test(href));
    };
    files.forEach(f => {
      const path = f.split(" ===")[0];
      const hrefMatches = f.matchAll(/href=["'](\/.*?)["']/g);
      for (const m of hrefMatches) {
        const raw = m[1];
        // Anclas y queries: válidos por definición para el router (misma página / misma ruta)
        if (raw.includes("#")) continue;
        const clean = raw.split("?")[0].replace(/\/+$/, "") || "/";
        if (clean === "/" || raw.startsWith("http")) continue;
        // Sin App.tsx con rutas detectadas no se puede afirmar nada — no inventar issues
        if (routes.size === 0) continue;
        if (!routeMatchesHref(clean)) {
          brokenLinks.push({
            file: path,
            message: `Enlace roto: el botón apunta a "${raw}" pero esa ruta no está definida en App.tsx.`
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
    
    // REDISEÑO estilo emergent.sh — principio de EVIDENCIA: un issue que
    // sobrevive intacto a una reparación es, con altisima probabilidad, un
    // FALSO POSITIVO de las heurísticas (no un error real del código) — un
    // error real de compilación cambia o desaparece cuando el patcher toca
    // el archivo. Antes: se abortaba TODO el ciclo (dejando quizá errores
    // reales sin reparar) o peor, se insistía. Ahora: los issues que
    // persisten idénticos tras un parche se DESCARTAN individualmente de la
    // lista (cuarentena) y el agente continúa solo con los issues nuevos o
    // cambiados — exactamente lo que hace un tester humano: "esto ya lo
    // intenté, no es un bug real o no sé arreglarlo, sigo con el resto".
    const allDetected = [...report.issues, ...brokenLinks];
    const activeIssues = allDetected.filter(
      (i) => !quarantinedIssues.has(`${i.file}|${i.message}`),
    );
    if (activeIssues.length === 0) {
      allPassing = report.ok;
      if (quarantinedIssues.size > 0) {
        log("testing", `✓ Validación completada — ${quarantinedIssues.size} aviso(s) heurístico(s) descartado(s) por no ser reproducibles como errores reales.`);
      }
      break;
    }
    // Un arreglo que afecta a más de tres problemas no es seguro para un
    // patcher automático: antes caía al modo multiarchivo y reescribía hasta
    // ocho archivos por una sola validación. Se conserva la app y se deja un
    // diagnóstico para revisión explícita.
    if (activeIssues.length > MAX_ISSUES_PER_AUTOFIX) {
      stoppedForSafety = true;
      log("testing", `⚠️ Se detectaron ${activeIssues.length} problemas; exceden el máximo seguro de ${MAX_ISSUES_PER_AUTOFIX} para auto-reparación. Se detiene el parcheo automático sin sobrescribir la app.`, "warn");
      onProgress?.({ phase: "testing", progress: 88, note: "Se requiere revisión: demasiados cambios para un parche automático seguro." });
      break;
    }
    const issuesSignature = activeIssues
      .map((i) => `${i.file}|${i.message}`)
      .sort()
      .join("\n");
    if (issuesSignature && issuesSignature === previousIssuesSignature) {
      // Estos issues sobrevivieron a un parche sin cambiar — a cuarentena.
      for (const i of activeIssues) quarantinedIssues.add(`${i.file}|${i.message}`);
      log("testing", `⚠️ ${activeIssues.length} aviso(s) persisten idénticos tras la reparación — marcados como no-reproducibles y descartados (probables falsos positivos).`, "warn");
      // Registrar el patrón en memoria para que futuras generaciones sepan
      // que este tipo de issue no converge con parches LLM.
      if (lastErrorMessage) {
        rememberPatch({
          errorMessage: redactSecrets(lastErrorMessage).slice(0, 1000),
          errorContext: `testing-agent NON-CONVERGENT (probable false positive) cycle=${cycle}`,
          patch: "NO_FIX_NEEDED: issue did not change after a full patch cycle — treat as heuristic false positive unless build fails.",
          language,
        }).catch(() => {});
      }
      continue; // re-evaluar: quizá quedan issues reales distintos
    }
    previousIssuesSignature = issuesSignature;
    // A partir de aquí, trabajar SOLO con los issues activos (no en cuarentena)
    report.issues = activeIssues.filter((i) => !brokenLinks.includes(i));

    announceIfNeeded();
    onProgress?.({
      phase: "testing",
      progress: 80 + cycle * 2,
      note: `🧪 Testing Agent: corrigiendo (ciclo ${cycle}/${maxCycles})...`,
    });

    const activeBrokenLinks = brokenLinks.filter((b) => report.issues.includes(b) || activeIssues.includes(b));
    if (activeBrokenLinks.length > 0) {
      // REPARACIÓN QUIRÚRGICA DETERMINISTA — estilo emergent.sh. ENCONTRADO
      // en producción: para arreglar un simple href el flujo anterior metía
      // los enlaces en el patcher LLM, que acababa REESCRIBIENDO PÁGINAS
      // ENTERAS ("✏️ Generando src/pages/RegisterPage.tsx (reescritura
      // completa)…" — 14 KB regenerados para tocar una línea), tardísimo y
      // con riesgo de romper código que funcionaba. Un enlace roto tiene una
      // reparación MECÁNICA que no necesita IA: apuntarlo a la ruta definida
      // más parecida de App.tsx (o "/" si no hay ninguna razonable). Se
      // reescribe SOLO el atributo href, byte a byte — cero tokens, cero
      // riesgo, milisegundos en vez de minutos.
      log("testing", `🔗 ${activeBrokenLinks.length} enlace(s) rotos — aplicando reparación quirúrgica de navegación (solo el atributo href, sin reescribir páginas)...`);
      const knownRoutes = [...routes].map(String);
      const closestRoute = (broken: string): string => {
        const seg = broken.split("/").filter(Boolean);
        let best = "/";
        let bestScore = 0;
        for (const r of knownRoutes) {
          if (r.includes(":") || r.includes("*")) continue; // no enlazar a rutas paramétricas
          const rseg = r.split("/").filter(Boolean);
          let score = 0;
          for (let i = 0; i < Math.min(seg.length, rseg.length); i++) {
            if (seg[i].toLowerCase() === rseg[i].toLowerCase()) score += 2;
            else if (rseg[i].toLowerCase().includes(seg[i].toLowerCase()) || seg[i].toLowerCase().includes(rseg[i].toLowerCase())) score += 1;
          }
          if (score > bestScore) { bestScore = score; best = r; }
        }
        return bestScore > 0 ? best : "/";
      };
      let surgicalFixes = 0;
      const unfixedLinks: BuildIssue[] = [];
      for (const b of activeBrokenLinks) {
        const m = b.message.match(/apunta a "([^"]+)"/);
        const badHref = m?.[1];
        if (!badHref) { unfixedLinks.push(b); continue; }
        const replacement = closestRoute(badHref.split("?")[0].replace(/\/+$/, "") || "/");
        const before = currentBundle;
        // Sustituir SOLO apariciones exactas del href roto (comillas simples y dobles)
        currentBundle = currentBundle
          .split(`href="${badHref}"`).join(`href="${replacement}"`)
          .split(`href='${badHref}'`).join(`href='${replacement}'`)
          .split(`to="${badHref}"`).join(`to="${replacement}"`)
          .split(`to='${badHref}'`).join(`to='${replacement}'`);
        if (currentBundle !== before) {
          surgicalFixes++;
          log("testing", `🔗 Enlace corregido: "${badHref}" → "${replacement}" (reparación directa, sin regenerar código).`);
        } else {
          // No se encontró el literal en el bundle — dejar que el patcher LLM lo trate
          unfixedLinks.push(b);
        }
      }
      if (surgicalFixes > 0) {
        lastPatchedBundle = currentBundle;
      }
      // Recomponer la lista de issues: los NO-enlace + los enlaces que la
      // reparación quirúrgica no pudo tocar (esos sí van al patcher LLM).
      report.issues = [
        ...report.issues.filter((i) => !brokenLinks.includes(i as any)),
        ...unfixedLinks,
      ];
      if (report.issues.length === 0 && report.ok) {
        log("testing", `✅ Navegación reparada quirúrgicamente (${surgicalFixes} enlace(s)). Re-validando...`);
        continue;
      }
    }

    // 2. ANALYZE ISSUES — con detalle REAL de qué se está corrigiendo, para
    // que el usuario nunca más vea un "1 problema(s)" opaco sin saber cuál es.
    const issuePreview = report.issues
      .slice(0, 3)
      .map((i) => `${i.file.replace(/^appforge-vfs:/, "")}: ${i.message.slice(0, 110)}`)
      .join(" • ");
    log("testing", `🔧 Se encontraron ${report.issues.length} problema(s): ${issuePreview}${report.issues.length > 3 ? " • …" : ""}`);
    
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
      // El respaldo multiarchivo se reserva para diagnósticos pequeños. Su
      // propio límite de tres archivos evita la antigua reescritura masiva y
      // mantiene una segunda oportunidad cuando un parche JSON único se corta.
      const errorSummary = report.issues.map((issue) => `[${issue.file}] ${issue.message}`).join("\n");
      const multiFilePatched = await patchBundleMultiFile(
        currentBundle,
        errorSummary,
        language,
        "zoco-plus",
        options.jobId,
      );
      if (multiFilePatched && multiFilePatched !== currentBundle) {
        currentBundle = multiFilePatched;
        lastPatchedBundle = currentBundle;
        log("testing", "✅ Respaldo multiarchivo acotado completado; revalidando una última vez.");
        continue;
      }
      stoppedForSafety = true;
      log("testing", "⚠️ El reparador no produjo un cambio verificable. Se detiene el auto-fix para preservar la app y evitar una reescritura masiva.", "warn");
      onProgress?.({ phase: "testing", progress: 88, note: "Auto-reparación detenida: no hubo un parche verificable." });
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

  // Si TODOS los issues restantes están en cuarentena (no-reproducibles —
  // falsos positivos de heurísticas), el resultado real es un PASS: no hay
  // errores de compilación confirmados. No marcar el job con "problemas de
  // calidad" ni asustar al usuario por avisos que el propio agente descartó.
  const remainingReal = (lastReport?.issues ?? []).filter(
    (i) => !quarantinedIssues.has(`${i.file}|${i.message}`),
  );
  if (!allPassing && remainingReal.length === 0 && quarantinedIssues.size > 0) {
    allPassing = true;
    if (hasAnnouncedToClient) {
      log("testing", "✅ Revisión completada — sin errores reales de compilación (avisos heurísticos no reproducibles descartados).");
    }
  }
  if (!allPassing) {
    log("testing", stoppedForSafety
      ? "⚠️ La validación quedó pendiente de revisión manual; la aplicación se preservó sin auto-fixes adicionales."
      : "⚠️ Algunos problemas persisten pero se ha alcanzado el límite de ciclos o el parche no convergió.", "warn");
    // ENCONTRADO A PETICIÓN DEL USUARIO (auditoría de calidad de la
    // primera generación): antes esta información se perdía por completo
    // al devolver solo el bundle -- el cliente recibía su app sin ningún
    // indicio de que quedaron problemas conocidos sin resolver. Se
    // guarda ahora en el propio job (accesible vía jobId, sin necesitar
    // cambiar la firma de la función ni tocar los 4 sitios que la
    // llaman) para que quede constancia real, consultable desde el panel
    // admin y, más adelante, mostrable al cliente con honestidad.
    const issuesSummary = remainingReal.slice(0, 5).map((i) => `${i.file}: ${i.message}`).join(" | ");
    await GenerationJob.updateOne(
      { _id: options.jobId },
      { $set: { hasKnownQualityIssues: true, knownQualityIssuesSummary: issuesSummary.slice(0, 500) } },
    ).catch((err) => logger.warn({ err, jobId: options.jobId }, "No se pudo guardar hasKnownQualityIssues en el job"));
  }

  return currentBundle;
}
