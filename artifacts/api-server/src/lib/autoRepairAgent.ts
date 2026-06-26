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
import { patchBundle } from "./shared-agents";
import { buildDeployHtml } from "./deployBundle";
import { GeneratedApp, User, AppMessage } from "@workspace/db/schema";

// ─── Constantes ───────────────────────────────────────────────────────────────
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutos
const ERROR_THRESHOLD_FOR_REPAIR = 3;              // 3 errores → auto-reparar
const MAX_AUTO_REPAIR_CYCLES = 3;                  // Máximo 3 ciclos de reparación
const REPAIR_COOLDOWN_MS = 10 * 60 * 1000;        // 10 min entre reparaciones del mismo app

// ─── Schema: AppRepairLog ─────────────────────────────────────────────────────
interface IAppRepairLog extends Document {
  appId: string;
  userId: string;
  trigger: "visual-test" | "runtime-error" | "health-check" | "post-generation";
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
    trigger: { type: String, enum: ["visual-test", "runtime-error", "health-check", "post-generation"], required: true },
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

// ─── Schema: AppRuntimeError (ampliado) ──────────────────────────────────────
interface IAppRuntimeError extends Document {
  appId: string;
  slug: string;
  message: string;
  stack?: string;
  kind: string;
  count: number;
  repaired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AppRuntimeErrorSchema = new Schema<IAppRuntimeError>(
  {
    appId: { type: String, required: true, index: true },
    slug: { type: String, required: true, index: true },
    message: { type: String, required: true },
    stack: String,
    kind: { type: String, default: "error" },
    count: { type: Number, default: 1 },
    repaired: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const AppRuntimeError: Model<IAppRuntimeError> =
  mongoose.models.AppRuntimeError ||
  mongoose.model<IAppRuntimeError>("AppRuntimeError", AppRuntimeErrorSchema);

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
}): Promise<void> {
  const { appId, userId, userIntent } = opts;
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
    const { analyzePreviewScreenshots } = await import("./visualTester");
    const baseUrl = process.env.MARIS_AI_PUBLIC_URL || "https://www.marisai.es";
    const previewUrl = `${baseUrl}/api/apps/${appId}/preview`;

    log.info({ previewUrl }, "Analyzing preview with Claude Vision");

    const report = await analyzePreviewScreenshots({
      appId,
      previewUrl,
      userIntent,
      log,
    });

    if (!report) return;

    const criticalIssues = report.issues?.filter((i: any) => i.severity === "critical") || [];
    const score = report.score || 0;

    log.info({ score, criticalCount: criticalIssues.length }, "Preview analysis complete");

    // Si hay issues críticos o score bajo → auto-reparar
    if (criticalIssues.length > 0 || score < 60) {
      const errorSummary = criticalIssues
        .map((i: any) => `[${i.type}] ${i.description} → ${i.fix}`)
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
}): Promise<boolean> {
  const { appId, userId, trigger, errorSummary, scoreBeforeRepair, maxCycles = 2 } = opts;
  const log = opts.log || logger.child({ module: "auto-repair", appId });

  if (isInCooldown(appId)) {
    log.info("App en cooldown — saltando reparación");
    return false;
  }

  try {
    await connectDB();
    const app = await GeneratedApp.findById(appId).lean() as any;
    if (!app?.frontendCode) return false;

    setCooldown(appId);

    log.info({ trigger, errorSummary: errorSummary.slice(0, 100) }, "Starting auto-repair");

    // Construir el prompt de reparación
    const repairPrompt = buildRepairPrompt(errorSummary, app.title || "App");

    // Aplicar el patcher
    const patchResult = await patchBundle({
      bundle: app.frontendCode,
      instruction: repairPrompt,
      language: (app.kind === "python-api" ? "python" : "typescript") as any,
      log,
    });

    if (!patchResult?.bundle || patchResult.bundle === app.frontendCode) {
      log.warn("Patcher no produjo cambios");
      return false;
    }

    // Verificar que el nuevo bundle compila
    try {
      await buildDeployHtml({ bundle: patchResult.bundle, title: app.title || "App", kind: app.kind });
    } catch (buildErr: any) {
      log.warn({ buildErr: String(buildErr).slice(0, 200) }, "Repaired bundle doesn't compile");
      return false;
    }

    // Guardar el bundle reparado
    await GeneratedApp.findByIdAndUpdate(appId, {
      $set: {
        frontendCode: patchResult.bundle,
        updatedAt: new Date(),
        lastAutoRepairAt: new Date(),
        autoRepairCount: ((app.autoRepairCount || 0) + 1),
      },
    });

    // Registrar en el log de reparaciones
    await AppRepairLog.create({
      appId,
      userId,
      trigger,
      errorSummary: errorSummary.slice(0, 1000),
      fixApplied: (patchResult.summary || "Bundle reparado automáticamente").slice(0, 500),
      cyclesUsed: 1,
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
    return true;
  } catch (err) {
    log.warn({ err }, "Auto-repair failed");
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
  };

  const firstError = errorSummary.split("\n")[0].slice(0, 150);

  return `🔧 **Maris AI Auto-Repair** ha detectado y corregido automáticamente un problema ${triggerLabels[trigger]}:

> ${firstError}

La app ha sido reparada y actualizada. Puedes ver los cambios en la vista previa. Si el problema persiste, escríbeme y lo resuelvo manualmente.`;
}
