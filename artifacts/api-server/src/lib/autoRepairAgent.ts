/**
 * autoRepairAgent.ts — Maris AI Continuous Auto-Repair System
 *
 * Sistema de auto-reparación y monitorización continua que:
 *
 * 1. GenerationWatcher: Después de cada generación completada, lanza
 *    automáticamente el visual test + autofix aunque la app no esté desplegada.
 *    Usa el preview interno (/api/apps/:id/preview) para capturar screenshots.
 *
 * 2. AppHealthMonitor: Worker que revisa periódicamente todas las apps
 *    desplegadas públicamente y repara las que tienen errores de runtime
 *    acumulados (vía /_error endpoint).
 *
 * 3. RuntimeErrorWatcher: Escucha los errores de runtime que llegan desde
 *    las apps en producción y lanza auto-reparación cuando supera el umbral.
 *
 * 4. SelfHealingPipeline: Detecta patrones de error recurrentes en las
 *    generaciones y los inyecta en el prompt del patcher para evitarlos.
 */
import mongoose, { Schema, Document, Model } from "mongoose";
import { connectDB } from "./db";
import { logger } from "./logger";
import { patchBundle, patchBundleMultiFile, type QAIssue } from "./shared-agents";
import { CoreOrchestrator } from "@workspace/services";
import { validateBundle } from "./validate";
import { buildDeployHtml } from "./deployBundle";
import { GeneratedApp, User, AppMessage, JobLog, GenerationJob, AppRuntimeError } from "@workspace/db/schema";

// ─── Constantes ───────────────────────────────────────────────────────────────
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutos
const ERROR_THRESHOLD_FOR_REPAIR = 3;              // 3 errores → auto-reparar
const MAX_AUTO_REPAIR_CYCLES = 6;                  // Máximo 6 ciclos de reparación — antes 3, insuficiente: el caso real "MesaYa" necesitó 4 ciclos completos tras el modo multi-archivo para terminar de compilar. Con 3, ese mismo caso real (que afecta a cualquier cliente, no solo a soporte) se habría quedado sin reparar del todo. Ahora igualado al límite que ya usa el flujo de soporte (admin.ts), que demostró ser suficiente en producción real.
const REPAIR_COOLDOWN_MS = 10 * 60 * 1000;        // 10 min entre reparaciones del mismo app

// ─── Schema: AppRepairLog ─────────────────────────────────────────────────────
interface IAppRepairLog extends Document {
  appId: string;
  userId: string;
  trigger: "visual-test" | "runtime-error" | "health-check" | "post-generation" | "manual";
  errorSummary: string;
  fixApplied: string;
  cyclesUsed: number;
  scoreBeforeRepair?: number;
  scoreAfterRepair?: number;
  success: boolean;
  createdAt: Date;
}

const AppRepairLogSchema = new Schema<IAppRepairLog>(
  {
    appId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    trigger: { type: String, enum: ["visual-test", "runtime-error", "health-check", "post-generation", "manual"], required: true },
    errorSummary: { type: String, default: "" },
    fixApplied: { type: String, default: "" },
    cyclesUsed: { type: Number, default: 0 },
    scoreBeforeRepair: Number,
    scoreAfterRepair: Number,
    success: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const AppRepairLog: Model<IAppRepairLog> =
  mongoose.models.AppRepairLog ||
  mongoose.model<IAppRepairLog>("AppRepairLog", AppRepairLogSchema);

// AppRuntimeError unificado en el schema central (@workspace/db/schema) —
// ver el comentario en lib/db/src/schema/index.ts para el contexto completo
// de por qué existían dos definiciones separadas del mismo modelo.

// ─── Cooldown tracker en memoria ─────────────────────────────────────────────
const repairCooldowns = new Map<string, number>();

function isInCooldown(appId: string): boolean {
  const last = repairCooldowns.get(appId);
  if (!last) return false;
  return Date.now() - last < REPAIR_COOLDOWN_MS;
}

function setCooldown(appId: string): void {
  repairCooldowns.set(appId, Date.now());
}

// ─── 1. GenerationWatcher ─────────────────────────────────────────────────────
/**
 * Se llama automáticamente después de cada generación completada.
 * Analiza el bundle con Claude Vision usando el preview interno y aplica
 * autofix si hay errores críticos, sin necesidad de deploy público.
 */
export async function runPostGenerationRepair(opts: {
  appId: string;
  userId: string;
  userIntent: string;
  jobId?: string;
  /** Lista de archivos truncados detectados en la generación */
  truncatedFiles?: string[];
}): Promise<void> {
  const { appId, userId, userIntent, truncatedFiles } = opts;
  const log = logger.child({ module: "auto-repair", appId, trigger: "post-generation" });

  try {
    await connectDB();
    const app = await GeneratedApp.findById(appId).select("frontendCode title kind publicSlug").lean() as any;
    if (!app?.frontendCode) return;

    log.info("Post-generation auto-repair: building preview HTML");

    // Intentar compilar el bundle — si falla, ya hay un error crítico
    let compiledOk = false;
    let compileError = "";
    try {
      await buildDeployHtml({ bundle: app.frontendCode, title: app.title || "App", kind: app.kind });
      compiledOk = true;
    } catch (err: any) {
      compileError = String(err?.message || err).slice(0, 500);
      log.warn({ compileError }, "Bundle compilation failed — triggering auto-repair");
    }

    // Si hay archivos truncados conocidos, reparar aunque compile
    if (truncatedFiles && truncatedFiles.length > 0 && compiledOk) {
      await autoRepairBundle({
        appId,
        userId,
        trigger: "post-generation",
        errorSummary: `${truncatedFiles.length} archivo(s) truncado(s) detectado(s): ${truncatedFiles.join(", ")}. Completar cada archivo con su contenido real y funcional.`,
        maxCycles: MAX_AUTO_REPAIR_CYCLES,
        log,
      });
      return;
    }
    if (!compiledOk) {
      // Error de compilación → reparar inmediatamente
      await autoRepairBundle({
        appId,
        userId,
        trigger: "post-generation",
        errorSummary: `Error de compilación del bundle: ${compileError}`,
        maxCycles: MAX_AUTO_REPAIR_CYCLES,
        log,
      });
      return;
    }

    // Si tiene publicSlug, el runAutoEvaluator ya se encarga
    // Si no tiene publicSlug, lanzar análisis con preview interno
    if (!app.publicSlug) {
      log.info("App sin deploy público — usando preview interno para análisis");
      await analyzeAndRepairWithPreview({
        appId,
        userId,
        userIntent,
        log,
      });
    }
  } catch (err) {
    log.warn({ err }, "Post-generation repair failed silently");
  }
}

// ─── 2. Análisis con preview interno ─────────────────────────────────────────
/**
 * Usa el endpoint /api/apps/:id/preview para capturar screenshots y analizar
 * la app con Claude Vision sin necesidad de deploy público.
 */
async function analyzeAndRepairWithPreview(opts: {
  appId: string;
  userId: string;
  userIntent: string;
  log: any;
}): Promise<void> {
  const { appId, userId, userIntent, log } = opts;

  try {
    // BUG PREEXISTENTE ENCONTRADO Y CORREGIDO: este código llamaba a
    // analyzePreviewScreenshots con una firma antigua y ya eliminada
    // ({appId, previewUrl, userIntent, log}) — la función real espera
    // {shots, app, prompt}, recibiendo las capturas YA TOMADAS en vez de
    // capturarlas ella misma desde una URL. Causaba un error de tipos en
    // cada build (TS2561/TS2339) y, en runtime, habría fallado siempre con
    // "shots is not iterable" o similar — esta rama de auto-reparación
    // visual nunca pudo haber funcionado tal como estaba.
    const { analyzePreviewScreenshots, takeScreenshots } = await import("./visualTester");
    const baseUrl = process.env.MARIS_AI_PUBLIC_URL || "https://www.marisai.es";
    const previewUrl = `${baseUrl}/api/apps/${appId}/preview`;

    log.info({ previewUrl }, "Capturing preview screenshots for visual analysis");
    const shots = await takeScreenshots(previewUrl);
    if (!shots || shots.length === 0) {
      log.warn({ previewUrl }, "No se pudieron capturar screenshots del preview — saltando análisis visual");
      return;
    }

    const app = await GeneratedApp.findById(appId, { title: 1, description: 1 }).lean() as any;
    log.info({ previewUrl, shots: shots.length }, "Analyzing preview with Claude Vision");

    const report = await analyzePreviewScreenshots({
      shots,
      app: { title: app?.title || "App", description: app?.description },
      prompt: userIntent,
    });

    if (!report) return;

    const criticalIssues = report.issues?.filter((i) => i.severity === "critical") || [];
    const score = report.overallScore || 0;

    log.info({ score, criticalCount: criticalIssues.length }, "Preview analysis complete");

    // Si hay issues críticos o score bajo → auto-reparar
    if (criticalIssues.length > 0 || score < 60) {
      const errorSummary = criticalIssues
        .map((i) => `[${i.type}] ${i.description}${i.cssfix ? ` → ${i.cssfix}` : ""}`)
        .join("\n");

      await autoRepairBundle({
        appId,
        userId,
        trigger: "post-generation",
        errorSummary: errorSummary || `Score visual bajo: ${score}/100`,
        scoreBeforeRepair: score,
        maxCycles: 2,
        log,
      });
    }
  } catch (err) {
    log.warn({ err }, "Preview analysis failed silently");
  }
}

// ─── 3. Core: autoRepairBundle ────────────────────────────────────────────────
/**
 * Motor central de auto-reparación. Aplica el patcher de Maris AI al bundle
 * con el contexto del error, guarda el resultado y notifica al usuario.
 */
export async function autoRepairBundle(opts: {
  appId: string;
  userId: string;
  trigger: IAppRepairLog["trigger"];
  errorSummary: string;
  scoreBeforeRepair?: number;
  maxCycles?: number;
  log?: any;
  jobId?: string;
}): Promise<boolean> {
  const { appId, userId, trigger, errorSummary, scoreBeforeRepair, maxCycles = 4, jobId } = opts;
  const log = opts.log || logger.child({ module: "auto-repair", appId });

  // ANTES: esta función solo escribía en el logger interno del servidor
  // (logger.info/warn — visible en logs de Railway, INVISIBLE en el panel
  // de Monitorización). El admin pulsaba "Reparar y continuar" y veía
  // "repairing" sin ningún log mientras la reparación trabajaba en segundo
  // plano varios minutos — exactamente el síntoma reportado de "no se ve lo
  // que está haciendo". Ahora, si se pasa jobId (el job de seguimiento
  // ligero que ya crea el endpoint de soporte), cada paso real del ciclo
  // escribe también en JobLog — la misma colección que lee el panel en
  // tiempo real (polling de 3s) para los jobs de generación normal.
  const jlog = async (message: string, level: "info" | "warn" | "error" = "info") => {
    if (!jobId) return;
    try {
      await JobLog.create({ jobId, agent: "repair", level, message });
    } catch { /* no bloquear la reparación si el log falla */ }
  };

  if (isInCooldown(appId)) {
    log.info("App en cooldown — saltando reparación");
    await jlog("⏸️ Esta app está en periodo de espera tras una reparación reciente — inténtalo de nuevo en unos minutos.", "warn");
    return false;
  }

  try {
    await connectDB();
    const app = await GeneratedApp.findById(appId).lean() as any;
    if (!app?.frontendCode) {
      await jlog("⚠️ No se encontró código de frontend en esta app — no hay nada que reparar.", "warn");
      return false;
    }

    setCooldown(appId);

    log.info({ trigger, errorSummary: errorSummary.slice(0, 100), maxCycles }, "Starting auto-repair");
    await jlog(`🔧 Iniciando reparación — instrucción: "${errorSummary.slice(0, 150)}${errorSummary.length > 150 ? "…" : ""}" (hasta ${maxCycles} ciclos)`);

    const repairKind = (app.kind === "python-api" ? "python" : "typescript") as any;
    let currentCode = app.frontendCode as string;
    let cyclesUsed = 0;
    let lastFixSummary = "Bundle reparado automáticamente por el Patcher Agent";

    // BUCLE REAL DE REPARACIÓN — antes esta función hacía un único intento de
    // parche sin validar ni reintentar; maxCycles existía como parámetro pero
    // nunca se usaba. Ahora: en cada ciclo se valida con esbuild real
    // (validateBundle, el mismo validador que usa la generación normal) y,
    // si quedan errores de compilación reales, se reintenta el parche sobre
    // ellos — no solo sobre el error original — hasta maxCycles veces o hasta
    // que el bundle compile limpio.
    for (let cycle = 1; cycle <= Math.max(1, maxCycles); cycle++) {
      cyclesUsed = cycle;
      await jlog(`🔄 Ciclo ${cycle}/${maxCycles} — analizando y aplicando el parche…`);
      const repairIssues: QAIssue[] = cycle === 1
        ? [{ file: "general", problem: errorSummary.slice(0, 2000), fix: buildRepairPrompt(errorSummary, app.title || "App") }]
        : []; // a partir del ciclo 2, los issues vienen de la validación real (abajo)

      let issuesForThisCycle = repairIssues;
      if (cycle > 1) {
        const validation = await validateBundle(currentCode);
        if (validation.ok) {
          log.info({ cycle }, "Bundle ya compila limpio antes de este ciclo — deteniendo bucle");
          await jlog(`✅ El bundle ya compila correctamente — no hace falta seguir reparando.`);
          break;
        }
        issuesForThisCycle = validation.issues.slice(0, 6).map((i) => ({
          file: i.file,
          problem: `Build error${i.line ? ` at line ${i.line}` : ""}: ${i.message}`,
          fix: "Fix the import / symbol / syntax so the file compiles.",
        }));
        if (issuesForThisCycle.length === 0) break;
        await jlog(`🔍 Quedan ${issuesForThisCycle.length} error(es) de compilación — reintentando…`, "warn");
      }

      // CAMINO ROBUSTO: archivos truncados o muchos errores → CoreOrchestrator
      // (1 archivo por llamada, sin límite de tokens). patchBundle falla en 
      // silencio cuando hay 8+ archivos truncados simultáneos (tokens agotados).
      const isStructuralDamage = (
        errorSummary.toLowerCase().includes("truncado") ||
        errorSummary.toLowerCase().includes("truncat") ||
        errorSummary.toLowerCase().includes("404") ||
        errorSummary.toLowerCase().includes("blank_page") ||
        issuesForThisCycle.length >= 4
      );
      if (isStructuralDamage && cycle === 1) {
        await jlog("🏗️ Daño estructural → CoreOrchestrator reparando archivo por archivo…");
        try {
          const orchestrator = new CoreOrchestrator(process.cwd(), { model: "claude-sonnet-4-6" });
          const orchPrompt =
            "[REPARACIÓN AUTOMÁTICA — REPAIR AGENT]\n" +
            "App: \"" + (app.title || "App") + "\"\n\n" +
            "PROBLEMA:\n" + errorSummary + "\n\n" +
            "ERRORES:\n" + issuesForThisCycle.map((e,n) => (n+1)+". "+e.problem+"\n   Fix: "+e.fix).join("\n") + "\n\n" +
            "INSTRUCCIONES:\n" +
            "1. Completa TODOS los archivos truncados con su contenido real y funcional.\n" +
            "2. src/App.tsx: catch-all <Route> siempre al FINAL del Switch.\n" +
            "3. Sin TODOs, sin stubs, sin placeholders — código real completo.";
          const orchResult = await orchestrator.editProjectIncremental(
            orchPrompt, currentCode, (app as any).backendCode || "", 
            (u: any) => { void jlog("🔨 " + (u.message || "Reparando…")); }
          );
          if (orchResult.frontendCode?.trim().length > 100) {
            currentCode = orchResult.frontendCode;
            lastFixSummary = "Reparación por hitos: " + issuesForThisCycle.length + " errores corregidos";
            await jlog("✅ CoreOrchestrator completó la reparación");
            continue;
          }
        } catch (orchErr) {
          await jlog("⚠️ CoreOrchestrator falló — usando patcher estándar", "warn");
        }
      }
      const patchedCode = await patchBundle(currentCode, issuesForThisCycle, repairKind, "", "claude-sonnet-4-6");
      if (!patchedCode || patchedCode === currentCode) {
        log.warn({ cycle }, "Patcher no produjo cambios en este ciclo");

        // FALLBACK MULTI-ARCHIVO — solo en el primer ciclo: el patcher
        // estándar (16K tokens, una sola respuesta JSON) puede fallar
        // silenciosamente cuando la reparación implica regenerar un archivo
        // grande y/o crear varios archivos nuevos completos (caso real
        // documentado: app "MesaYa", App.tsx corrupto + 3 páginas
        // faltantes) — el modelo se queda sin presupuesto de tokens y
        // produce JSON truncado/inválido. patchBundleMultiFile divide esto
        // en una llamada de planificación + una llamada completa por
        // archivo, con su propio presupuesto de 16K tokens cada una.
        if (cycle === 1) {
          await jlog(`⚠️ El reparador estándar no consiguió generar un cambio — probando con el modo multi-archivo (para reparaciones grandes)…`, "warn");
          const multiFileResult = await patchBundleMultiFile(
            currentCode,
            errorSummary,
            repairKind,
            "claude-sonnet-4-6",
            (msg) => { void jlog(msg); },
          );
          if (multiFileResult.result) {
            currentCode = multiFileResult.result;
            lastFixSummary = `Bundle reparado automáticamente en modo multi-archivo (${multiFileResult.filesSucceeded}/${multiFileResult.filesAttempted} archivo(s))`;
            await jlog(`✅ Modo multi-archivo completado: ${multiFileResult.filesSucceeded}/${multiFileResult.filesAttempted} archivo(s) generados correctamente.`);
            continue; // saltar al siguiente ciclo de validación normal
          }
          await jlog(`❌ El modo multi-archivo tampoco consiguió reparar la app (${multiFileResult.filesSucceeded}/${multiFileResult.filesAttempted} archivos completados).`, "error");
          return false;
        }
        await jlog(`⚠️ El reparador no consiguió generar un cambio en este ciclo.`, "warn");
        break; // ciclos posteriores sin cambios → entregamos lo mejor que tenemos
      }
      currentCode = patchedCode;
      lastFixSummary = `Bundle reparado automáticamente por el Patcher Agent (${cycle} ciclo${cycle > 1 ? "s" : ""})`;
      await jlog(`✏️ Ciclo ${cycle} completado — código actualizado (${Math.round(currentCode.length / 1000)} KB).`);
    }

    // Validación final real — si tras todos los ciclos sigue sin compilar,
    // no guardamos un bundle roto sobre uno que (aunque con errores) sí
    // compilaba antes.
    const finalValidation = await validateBundle(currentCode);
    if (!finalValidation.ok) {
      log.warn({ cyclesUsed, remainingIssues: finalValidation.issues.length }, "Bundle sigue sin compilar tras todos los ciclos — no se sobrescribe el original");
      await jlog(`❌ Tras ${cyclesUsed} ciclo(s) siguen quedando ${finalValidation.issues.length} error(es) de compilación — se conserva la app original sin sobrescribir.`, "error");
      await AppRepairLog.create({
        appId, userId, trigger,
        errorSummary: errorSummary.slice(0, 1000),
        fixApplied: `Reparación incompleta tras ${cyclesUsed} ciclo(s) — ${finalValidation.issues.length} error(es) de compilación residuales. No se aplicó para no degradar la app.`,
        cyclesUsed, scoreBeforeRepair, success: false,
      });
      // Aunque no se pudo reparar, devolver la app al cliente para que
      // no quede oculta indefinidamente — es mejor que vea la versión
      // anterior que que no vea nada.
      await GeneratedApp.findByIdAndUpdate(appId, {
        $set: { pendingAdminApproval: false },
      });
      return false;
    }
    await jlog(`✅ Validación con esbuild superada — el bundle compila correctamente.`);

    // Verificar también que el HTML final se construye correctamente
    // (capa adicional sobre la validación de esbuild)
    try {
      await buildDeployHtml({ bundle: currentCode, title: app.title || "App", kind: app.kind });
    } catch (buildErr: any) {
      log.warn({ buildErr: String(buildErr).slice(0, 200) }, "Repaired bundle doesn't compile (deploy build)");
      await jlog(`❌ El bundle compila con esbuild, pero falla al construir el HTML final de preview — se conserva la app original.`, "error");
      // Desbloquear igualmente para que el cliente vea la versión anterior
      await GeneratedApp.findByIdAndUpdate(appId, {
        $set: { pendingAdminApproval: false },
      });
      return false;
    }
    await jlog(`✅ Validación de preview superada — guardando el resultado final…`);

    // Guardar el bundle reparado y limpiar pendingAdminApproval para que
    // el cliente vea la app actualizada en su panel inmediatamente.
    await GeneratedApp.findByIdAndUpdate(appId, {
      $set: {
        frontendCode: currentCode,
        updatedAt: new Date(),
        lastAutoRepairAt: new Date(),
        autoRepairCount: ((app.autoRepairCount || 0) + 1),
        pendingAdminApproval: false,   // ← CRÍTICO: desbloquear para el cliente
        approvedByAdminAt: new Date(), // ← Registrar cuándo fue aprobada
      },
    });

    // Registrar en el log de reparaciones
    await AppRepairLog.create({
      appId,
      userId,
      trigger,
      errorSummary: errorSummary.slice(0, 1000),
      fixApplied: lastFixSummary,
      cyclesUsed,
      scoreBeforeRepair,
      success: true,
    });

    // Notificar al usuario via AppMessage (aparece en el chat)
    await AppMessage.create({
      appId,
      role: "assistant",
      content: buildRepairNotification(trigger, errorSummary),
    }).catch(() => {});

    log.info({ appId, trigger }, "Auto-repair completed successfully");
    await jlog(`🎉 Reparación completada con éxito tras ${cyclesUsed} ciclo(s) — app actualizada y lista para revisar.`);
    return true;
  } catch (err) {
    log.warn({ err }, "Auto-repair failed");
    await jlog(`❌ Error inesperado durante la reparación: ${String((err as any)?.message || err).slice(0, 200)}`, "error");
    return false;
  }
}

// ─── 4. AppHealthMonitor ──────────────────────────────────────────────────────
/**
 * Worker que corre cada 5 minutos y revisa:
 * - Apps con errores de runtime acumulados (>= ERROR_THRESHOLD_FOR_REPAIR)
 * - Apps desplegadas que devuelven 404 o error en el /_inner
 */
let healthMonitorStarted = false;
let healthMonitorTimer: NodeJS.Timeout | null = null;

export function startAppHealthMonitor(): void {
  if (healthMonitorStarted) return;
  healthMonitorStarted = true;

  const tick = async () => {
    try {
      await checkAppsWithRuntimeErrors();
    } catch (err) {
      logger.warn({ err }, "AppHealthMonitor tick failed");
    }
  };

  // Primera ejecución después de 2 minutos (dar tiempo al servidor a arrancar)
  setTimeout(() => {
    void tick();
    healthMonitorTimer = setInterval(() => void tick(), HEALTH_CHECK_INTERVAL_MS);
    if (healthMonitorTimer && typeof healthMonitorTimer.unref === "function") {
      healthMonitorTimer.unref();
    }
  }, 2 * 60 * 1000);

  logger.info({ intervalMs: HEALTH_CHECK_INTERVAL_MS }, "AppHealthMonitor started");
}

export function stopAppHealthMonitor(): void {
  if (healthMonitorTimer) clearInterval(healthMonitorTimer);
  healthMonitorTimer = null;
  healthMonitorStarted = false;
}

/**
 * Busca apps con errores de runtime acumulados y las repara automáticamente.
 */
async function checkAppsWithRuntimeErrors(): Promise<void> {
  await connectDB();

  // Buscar apps con errores no reparados que superen el umbral
  const errorGroups = await AppRuntimeError.aggregate([
    { $match: { repaired: false } },
    {
      $group: {
        _id: "$appId",
        totalErrors: { $sum: "$count" },
        messages: { $push: "$message" },
        slug: { $first: "$slug" },
      },
    },
    { $match: { totalErrors: { $gte: ERROR_THRESHOLD_FOR_REPAIR } } },
    { $limit: 10 }, // Máximo 10 apps por ciclo
  ]);

  if (errorGroups.length === 0) return;

  logger.info({ count: errorGroups.length }, "AppHealthMonitor: apps with runtime errors found");

  for (const group of errorGroups) {
    const appId = group._id;
    if (isInCooldown(appId)) continue;

    const app = await GeneratedApp.findById(appId).select("userId title frontendCode kind").lean() as any;
    if (!app) continue;

    const errorSummary = `${group.totalErrors} errores de runtime en producción:\n` +
      [...new Set(group.messages as string[])].slice(0, 5).map((m: string) => `- ${m}`).join("\n");

    const repaired = await autoRepairBundle({
      appId,
      userId: app.userId,
      trigger: "runtime-error",
      errorSummary,
      maxCycles: 2,
    });

    if (repaired) {
      // Marcar errores como reparados
      await AppRuntimeError.updateMany(
        { appId, repaired: false },
        { $set: { repaired: true } },
      );
    }
  }
}

// ─── 5. RuntimeError Recorder (para el endpoint /_error) ─────────────────────
/**
 * Registra un error de runtime en la DB. Se llama desde publicDeploy.ts
 * cuando llega un POST a /p/:slug/_error.
 */
export async function recordRuntimeError(opts: {
  appId: string;
  slug: string;
  message: string;
  stack?: string;
  kind?: string;
}): Promise<void> {
  try {
    await connectDB();

    // Upsert: incrementar contador si ya existe el mismo error
    await AppRuntimeError.findOneAndUpdate(
      { appId: opts.appId, message: opts.message.slice(0, 200) },
      {
        $inc: { count: 1 },
        $set: {
          slug: opts.slug,
          stack: opts.stack?.slice(0, 2000),
          kind: opts.kind || "error",
          repaired: false,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true },
    );
  } catch (err) {
    logger.warn({ err }, "Failed to record runtime error");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildRepairPrompt(errorSummary: string, appTitle: string): string {
  return `MARIS AI AUTO-REPAIR AGENT — Reparación automática de "${appTitle}"

Se han detectado los siguientes problemas críticos que impiden que la app funcione correctamente:

${errorSummary}

INSTRUCCIONES DE REPARACIÓN:
1. Analiza cada problema listado arriba
2. Aplica las correcciones necesarias al bundle
3. Asegúrate de que:
   - La ruta '/' renderiza el componente principal de la app
   - No hay pantallas en blanco ni errores de importación
   - La navbar/navegación está presente y funcional
   - El contenido mock data es visible desde el inicio
   - Los touch targets en mobile tienen mínimo 44x44px
4. NO cambies la funcionalidad ni el diseño general — solo repara los errores
5. Mantén toda la lógica de negocio existente

Aplica las correcciones y devuelve el bundle completo reparado.`;
}

function buildRepairNotification(trigger: IAppRepairLog["trigger"], errorSummary: string): string {
  const triggerLabels: Record<IAppRepairLog["trigger"], string> = {
    "post-generation": "tras la generación",
    "runtime-error": "por errores detectados en producción",
    "health-check": "durante la revisión periódica",
    "visual-test": "tras el análisis visual",
    "manual": "a petición del equipo de soporte",
  };

  const firstError = errorSummary.split("\n")[0].slice(0, 150);

  return `🔧 **Maris AI Auto-Repair** ha detectado y corregido automáticamente un problema ${triggerLabels[trigger]}:

> ${firstError}

La app ha sido reparada y actualizada. Puedes ver los cambios en la vista previa. Si el problema persiste, escríbeme y lo resuelvo manualmente.`;
}

/**
 * Llamado cuando el evaluador visual falla por créditos agotados.
 * En vez de marcar la app como needs_review, lanza el repair agent
 * que usa el bundle existente + CoreOrchestrator sin llamadas de visión.
 */
export async function autoRepairOnCreditsExhausted(opts: { appId: string; userId: string }): Promise<void> {
  const { appId, userId } = opts;
  const log = logger.child({ module: "auto-repair", appId, trigger: "credits-exhausted" });
  log.info("Créditos agotados en evaluador — lanzando repair agent sin visión");
  try {
    await autoRepairBundle({
      appId,
      userId,
      trigger: "post-generation",
      errorSummary: "El evaluador visual no pudo verificar la app por créditos agotados. Verificar y completar archivos truncados, router y contenido.",
      maxCycles: 3,
      log,
    });
  } catch (err) {
    log.warn({ err }, "autoRepairOnCreditsExhausted failed silently");
  }
}
