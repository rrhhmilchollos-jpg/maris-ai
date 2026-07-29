/**
 * aiAutopilot.ts — Sistema de IA autogestionada de Maris AI
 *
 * 6 módulos que se ejecutan en background sin intervención humana:
 *
 * 1. AUTO-DIAGNÓSTICO: cuando un job falla, IA analiza logs y lanza corrección
 * 2. MONITOR DE SALUD: detecta patrones de fallos y actúa automáticamente
 * 3. SOPORTE INTELIGENTE: tickets de soporte resueltos por IA antes de llegar a Ivan
 * 4. AUTO-CORRECCIÓN DE APPS: preview en blanco → IA detecta y corrige sola
 * 5. EVALUADOR DE CALIDAD: antes de marcar succeeded, IA puntúa y regenera si es mala
 * 6. RESUMEN DIARIO: email cada mañana con estado de la plataforma
 *
 * Solo escala a intervención manual cuando la IA no puede resolverlo.
 */

import mongoose from "mongoose";
import { connectDB } from "./db";
import { logger } from "./logger";
import { createZocoMessageWithFallback } from "./shared-agents";
import {
  GenerationJob,
  GeneratedApp,
  User,
  UserNotification,
  CreditTransaction,
  JobLog,
  AppMessage,
  Ticket,
} from "@workspace/db/schema";
import { enqueueGenerateJob } from "./jobQueue";
import { notifyAdminSupportTicket } from "./notify";

const AI_MODEL = "zoco-flash"; // Rápido y barato para diagnóstico
const AI_MODEL_SMART = "zoco-plus";   // Para análisis complejos

// ─── Utilidades ───────────────────────────────────────────────────────────────

async function askAI(system: string, user: string, model = AI_MODEL): Promise<string> {
  try {
    const res = await createZocoMessageWithFallback("system", model, {
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: user }],
    });
    return (res.content[0] as any).text ?? "";
  } catch (e) {
    logger.warn({ e }, "aiAutopilot: askAI failed");
    return "";
  }
}

async function sendPlatformEmail(subject: string, html: string) {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "Maris AI <alertas@marisai.es>",
        to: [process.env.ADMIN_EMAIL || "rrhh.milchollos@gmail.com"],
        subject,
        html,
      }),
    });
    return res.ok;
  } catch { return false; }
}

// ─── MÓDULO 1: Auto-diagnóstico de jobs fallidos ──────────────────────────────
// Se ejecuta cada vez que un job falla. Analiza los logs con IA y decide:
// A) Lanzar corrección automática (si el error es conocido y solucionable)
// B) Escalar a soporte humano (si es algo grave o desconocido)

export async function autoDiagnoseFailedJob(jobId: string): Promise<void> {
  try {
    await connectDB();
    const job = await GenerationJob.findById(jobId).lean() as any;
    if (!job || job.status !== "failed") return;

    // Evitar re-diagnóstico
    if ((job as any).autoDiagnosed) return;
    await GenerationJob.findByIdAndUpdate(jobId, { $set: { autoDiagnosed: true } });

    // CASO REAL CONFIRMADO por el usuario en producción: decenas de jobs
    // "autopilot-quality"/"autopilot-fix" encadenados sin fin contra el
    // mismo cliente, saturando la cola de Monitorización en vivo y
    // haciendo imposible encontrar el job real de un cliente concreto.
    // CAUSA RAÍZ: autoFixedFromJobId solo referenciaba al padre INMEDIATO
    // — la protección "evitar re-diagnóstico" solo evitaba que UN MISMO
    // job se diagnosticara dos veces, pero nunca limitaba cuántos jobs
    // NUEVOS podían encadenarse uno tras otro (cada uno con su propio
    // autoDiagnosed=false). FIX: repairChainDepth se hereda +1 del padre
    // en cada job nuevo, y si supera el límite, se escala a revisión
    // humana en vez de seguir generando jobs sin fin.
    const MAX_AUTO_REPAIR_CHAIN_DEPTH = 3;
    const currentDepth = (job as any).repairChainDepth || 0;
    if (currentDepth >= MAX_AUTO_REPAIR_CHAIN_DEPTH) {
      logger.warn({ jobId, currentDepth }, "aiAutopilot: límite de reparaciones encadenadas alcanzado — escalando a revisión humana");
      await GenerationJob.findByIdAndUpdate(jobId, {
        $set: {
          status: "reviewing",
          phase: "reviewing",
          autoDiagnosisNote: `Se alcanzó el límite de ${MAX_AUTO_REPAIR_CHAIN_DEPTH} reparaciones automáticas encadenadas sin éxito. Requiere revisión manual.`,
        },
      });
      return;
    }

    // Obtener logs del job
    const logs = await JobLog.find({ jobId }).sort({ createdAt: -1 }).limit(30).lean() as any[];
    const logText = logs.map((l: any) => `[${l.agent}] ${l.message}`).join("\n").slice(0, 3000);
    const cleanPrompt = (job.prompt || "").replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "").trim().slice(0, 300);

    const diagnosis = await askAI(
      `Eres el sistema de auto-diagnóstico de Maris AI. Analiza el error de generación y devuelve SOLO JSON:
{
  "canAutoFix": true/false,
  "errorType": "timeout|memory|syntax|api_limit|unknown",
  "fixStrategy": "retry|edit|regenerate|none",
  "repairInstruction": "instrucción específica para corregir el código (si aplica)",
  "escalateToHuman": true/false,
  "reason": "explicación breve en español"
}

canAutoFix=true si el error es: timeout, syntax error en el código generado, import faltante, o error de compilación conocido.
canAutoFix=false si es: fallo de API externa, error de configuración del servidor, error desconocido grave.
fixStrategy="retry" si solo necesita reintentar, "edit" si hay código parcial que reparar, "regenerate" si hay que empezar de cero.`,
      `Prompt del usuario: ${cleanPrompt}\n\nError: ${job.errorMessage || "desconocido"}\n\nLogs:\n${logText}`
    );

    let parsed: any = {};
    try {
      const f = diagnosis.indexOf("{"); const l = diagnosis.lastIndexOf("}");
      if (f !== -1 && l !== -1) parsed = JSON.parse(diagnosis.slice(f, l + 1));
    } catch { /* si no parsea, no hacer nada */ return; }

    logger.info({ jobId, diagnosis: parsed }, "aiAutopilot: diagnóstico completado");

    if (!parsed.canAutoFix) {
      // Escalar a soporte humano con contexto
      logger.warn({ jobId, reason: parsed.reason }, "aiAutopilot: escalando a soporte humano");
      await GenerationJob.findByIdAndUpdate(jobId, {
        $set: { status: "reviewing", phase: "reviewing", autoDiagnosisNote: parsed.reason },
      });
      return;
    }

    // Lanzar corrección automática
    const user = await User.findById(job.userId).lean() as any;
    const baseAppId = job.appId || job.editAppId;

    if (parsed.fixStrategy === "retry") {
      // Simple reintento
      await GenerationJob.findByIdAndUpdate(jobId, { $set: { status: "queued", phase: "queued", retryCount: (job.retryCount || 0) + 1 } });
      await enqueueGenerateJob(jobId);
      logger.info({ jobId }, "aiAutopilot: reintento automático lanzado");

    } else if ((parsed.fixStrategy === "edit" || parsed.fixStrategy === "regenerate") && baseAppId) {
      // Crear job de corrección con instrucción específica de la IA
      const newJobId = new mongoose.Types.ObjectId().toString();
      const repairPrompt = parsed.repairInstruction
        ? `[ADMIN REPAIR] ${parsed.repairInstruction}\n\nPrompt original: ${cleanPrompt}`
        : `[ADMIN REPAIR] Corrige los errores que impidieron la generación anterior. Prompt original: ${cleanPrompt}`;

      // ENCONTRADO en producción (cliente real, proyecto "club de swingers en
      // Valencia"): cuando errorType="memory" (el modelo se quedó sin espacio
      // de salida a mitad de un cambio grande en modo edición — el propio
      // mensaje de error que ve el usuario dice literalmente "cambia al
      // modelo de calidad desde el menú Modelo"), este bloque relanzaba el
      // job de reparación con el MISMO coderModel ("zoco-plus") que
      // ya había demostrado no tener suficiente capacidad de salida para ese
      // cambio. El repairInstruction que la IA generaba SÍ recomendaba
      // fragmentar o subir de modelo, pero esa recomendación nunca se
      // aplicaba de verdad al job — solo viajaba como texto dentro del
      // prompt, sin cambiar ningún parámetro real. Resultado observado en
      // logs reales: el job de reparación volvía a fallar exactamente por el
      // mismo motivo (mismo stack trace, mismo "El cambio era demasiado
      // grande"), y el ciclo se repetía indefinidamente sin que el usuario
      // viera ningún avance.
      // FIX: si el error que disparó esta reparación fue por memoria/tamaño
      // de salida, forzamos el modelo de mayor capacidad (zoco-max)
      // en el job de reparación — la misma acción que el sistema ya le
      // recomienda hacer manualmente al usuario, ahora aplicada de verdad de
      // forma automática. Para el resto de errorType (timeout, syntax,
      // api_limit) se mantiene sonnet, que es el comportamiento original.
      const repairCoderModel = parsed.errorType === "memory" ? "zoco-max" : "zoco-plus";

      await GenerationJob.create({
        _id: newJobId,
        userId: job.userId,
        prompt: `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=autopilot-fix. ${repairPrompt}`,
        editAppId: baseAppId,
        coderModel: repairCoderModel,
        language: job.language || "typescript",
        kind: "edit",
        status: "queued", phase: "queued", progress: 0,
        isAdmin: true, hasEverPaid: true,
        autoFixedFromJobId: jobId,
        repairChainDepth: currentDepth + 1,
      });
      await enqueueGenerateJob(newJobId);
      logger.info({ jobId, newJobId, strategy: parsed.fixStrategy, repairCoderModel }, "aiAutopilot: corrección automática lanzada");

    } else if (parsed.fixStrategy === "regenerate" && !baseAppId) {
      // Regenerar desde cero
      const newJobId = new mongoose.Types.ObjectId().toString();
      await GenerationJob.create({
        _id: newJobId,
        userId: job.userId,
        prompt: job.prompt,
        coderModel: "zoco-plus",
        language: job.language || "typescript",
        kind: job.kind || "fullstack",
        status: "queued", phase: "queued", progress: 0,
        isAdmin: true, hasEverPaid: true,
        autoFixedFromJobId: jobId,
        repairChainDepth: currentDepth + 1,
      });
      await enqueueGenerateJob(newJobId);
      logger.info({ jobId, newJobId }, "aiAutopilot: regeneración desde cero lanzada");
    }

    // Notificar al cliente que estamos trabajando en ello
    if (user?.email && baseAppId) {
      const app = await GeneratedApp.findById(baseAppId).lean() as any;
      await UserNotification.create({
        userId: job.userId,
        appId: baseAppId,
        appTitle: app?.title || "Tu app",
        type: "support_patch",
        message: `🔧 Nuestro sistema ha detectado un problema con tu app **"${app?.title || "Tu app"}"** y ha lanzado una corrección automática. Te avisaremos cuando esté lista. No necesitas hacer nada. 💜`,
        read: false,
      });
    }
  } catch (err) {
    logger.error({ err, jobId }, "aiAutopilot.autoDiagnoseFailedJob error");
  }
}

// ─── MÓDULO 2: Monitor de salud de la plataforma ─────────────────────────────
// Corre cada 5 minutos. Detecta patrones anómalos y actúa.

let lastHealthCheck = 0;
export async function runHealthMonitor(): Promise<void> {
  if (Date.now() - lastHealthCheck < 5 * 60 * 1000) return;
  lastHealthCheck = Date.now();

  try {
    await connectDB();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

    const [failedCount, runningCount, stuckCount] = await Promise.all([
      GenerationJob.countDocuments({ status: "failed", updatedAt: { $gte: oneHourAgo } }),
      GenerationJob.countDocuments({ status: "running" }),
      GenerationJob.countDocuments({ status: "running", updatedAt: { $lt: thirtyMinAgo } }),
    ]);

    // Jobs atascados en running > 30min → marcar failed y diagnose
    if (stuckCount > 0) {
      const stuck = await GenerationJob.find({ status: "running", updatedAt: { $lt: thirtyMinAgo } }).lean() as any[];
      for (const j of stuck) {
        await GenerationJob.findByIdAndUpdate(j._id, {
          $set: { status: "failed", phase: "failed", errorMessage: "Job atascado — timeout detectado por autopilot" },
        });
        await autoDiagnoseFailedJob(String(j._id));
      }
      logger.warn({ stuckCount }, "aiAutopilot: jobs atascados detectados y gestionados");
    }

    // Tasa de fallos alta (>5 en 1h) → alerta a admin
    if (failedCount > 5) {
      logger.warn({ failedCount }, "aiAutopilot: tasa de fallos alta");
      await sendPlatformEmail(
        `⚠️ Maris AI — ${failedCount} fallos en la última hora`,
        `<div style="font-family:sans-serif;padding:24px;background:#0a0a0f;color:#f3f4f6">
          <h2 style="color:#ef4444">⚠️ Alerta: ${failedCount} jobs fallidos en 1h</h2>
          <p>El monitor de salud de Maris AI detectó una tasa de fallos anormal.</p>
          <ul>
            <li>Jobs fallidos (1h): <strong>${failedCount}</strong></li>
            <li>Jobs en ejecución: <strong>${runningCount}</strong></li>
            <li>Jobs atascados: <strong>${stuckCount}</strong></li>
          </ul>
          <p>El autopilot ya ha intentado corregir los jobs atascados automáticamente.</p>
          <a href="https://www.marisai.es/admin" style="background:#7c3aed;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Ver panel admin →</a>
        </div>`
      );
    }
  } catch (err) {
    logger.error({ err }, "aiAutopilot.runHealthMonitor error");
  }
}

// ─── MÓDULO 3: Soporte IA — pre-filtro de tickets ─────────────────────────────
// Cuando llega un ticket, la IA intenta resolverlo antes de molestarte.

export async function handleSupportTicketWithAI(opts: {
  userEmail: string;
  userId: string;
  subject: string;
  message: string;
  ticketId: string;
}): Promise<{ resolved: boolean; reply: string }> {
  const { userEmail, subject, message, userId, ticketId } = opts;

  try {
    // Contexto del usuario
    const user = await User.findById(userId).lean() as any;
    const recentJobs = await GenerationJob.find({ userId }).sort({ updatedAt: -1 }).limit(5).lean() as any[];
    const jobContext = recentJobs.map((j: any) =>
      `- Job ${j._id}: ${j.status} | ${j.prompt?.slice(0, 80) || "sin prompt"}`
    ).join("\n");

    const response = await askAI(
      `Eres el agente de soporte de Maris AI. Tu objetivo: resolver el ticket del usuario SIN necesitar intervención humana cuando sea posible.

Tienes acceso al estado de sus jobs recientes. Devuelve SOLO JSON:
{
  "canResolve": true/false,
  "confidence": 0-100,
  "reply": "respuesta completa en español al usuario (si canResolve=true)",
  "action": "none|escalate|notify_team|auto_fix", // NUNCA refund_credits — los reembolsos requieren aprobación manual del admin
  "actionDetails": "detalles de la acción si aplica",
  "escalateReason": "por qué escalar si canResolve=false"
}

Resuelve si: el usuario pregunta cómo usar algo, hay un error en su app que puedes explicar, necesita saber el estado de su job, el usuario tiene dudas operativas (NUNCA reembolsar automáticamente — escalar siempre al admin).
Escala si: bug crítico de la plataforma, fraude, petición técnica compleja, queja grave.`,
      `Usuario: ${userEmail} | Plan: ${user?.plan || "free"} | Créditos: ${user?.credits || 0}

Jobs recientes:
${jobContext}

Ticket #${ticketId}
Asunto: ${subject}
Mensaje: ${message}`
    , AI_MODEL_SMART);

    let parsed: any = { canResolve: false };
    try {
      const f = response.indexOf("{"); const l = response.lastIndexOf("}");
      if (f !== -1 && l !== -1) parsed = JSON.parse(response.slice(f, l + 1));
    } catch { /* escalar */ }

    if (parsed.canResolve && parsed.confidence >= 75 && parsed.reply) {
      // Los reembolsos NUNCA son automáticos — siempre requieren aprobación del admin.
      // Si el sistema detecta que el usuario pide reembolso → escalar a soporte humano.
      if (parsed.action === "refund_credits" || parsed.action === "refund") {
        // Marcar el ticket como escalado en vez de reembolsar
        parsed.action = "escalate";
        parsed.reply = "Hemos recibido tu solicitud de reembolso. Nuestro equipo de soporte la revisará y te responderá en 24-48h. Por favor, espera nuestra respuesta.";
      }

      // Notificar al usuario con la respuesta
      await UserNotification.create({
        userId, type: "support_patch",
        message: parsed.reply,
        read: false,
      });

      logger.info({ ticketId, confidence: parsed.confidence }, "aiAutopilot: ticket resuelto automáticamente");
      return { resolved: true, reply: parsed.reply };
    }

    logger.info({ ticketId, reason: parsed.escalateReason }, "aiAutopilot: ticket escalado a humano");
    return { resolved: false, reply: parsed.escalateReason || "Requiere revisión manual" };
  } catch (err) {
    logger.error({ err, ticketId }, "aiAutopilot.handleSupportTicketWithAI error");
    return { resolved: false, reply: "Error en el sistema de soporte IA" };
  }
}

// ─── MÓDULO 4: Auto-corrección de apps rotas ──────────────────────────────────
// Detecta apps con preview en blanco y lanza corrección sin que nadie lo pida.
// Se ejecuta en background cada 10 minutos.

let lastAppCheck = 0;
export async function autoFixBrokenApps(): Promise<void> {
  if (Date.now() - lastAppCheck < 10 * 60 * 1000) return;
  lastAppCheck = Date.now();

  // ENCONTRADO A PETICIÓN DEL USUARIO (caso real confirmado con capturas:
  // docenas de notificaciones duplicadas para las mismas 2 apps -- ver
  // comentario junto a autopilotFixAttempts en el esquema). Tope real de
  // intentos por app: si tras varios intentos automáticos la app SIGUE
  // pareciendo rota, seguir reintentando cada 10 minutos para siempre no
  // la arregla -- solo genera spam de notificaciones y créditos de
  // "compensación" repetidos sin fin. A partir de este límite, se deja
  // de reintentar automáticamente y se avisa una única vez de que hace
  // falta revisión manual.
  const MAX_AUTOPILOT_ATTEMPTS_PER_APP = 2;

  try {
    await connectDB();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Apps generadas en la última hora con código muy pequeño (posible fallo)
    const suspectApps = await GeneratedApp.find({
      createdAt: { $gte: oneHourAgo },
      status: "ready",
      $expr: { $lt: [{ $strLenCP: "$frontendCode" }, 5000] }, // Menos de 5KB = sospechoso
    }).select("_id userId title frontendCode prompt autopilotFixAttempts").lean() as any[];

    for (const app of suspectApps) {
      // Verificar si ya hay un job de auto-fix para esta app
      const existingFix = await GenerationJob.findOne({
        editAppId: String(app._id),
        status: { $in: ["queued", "running"] },
        autoFixedFromJobId: { $exists: true },
      }).lean();
      if (existingFix) continue;

      const attemptsSoFar = app.autopilotFixAttempts ?? 0;
      if (attemptsSoFar >= MAX_AUTOPILOT_ATTEMPTS_PER_APP) {
        // Ya se intentó el máximo de veces -- avisar UNA sola vez (marcando
        // el intento como "agotado" para no repetir este aviso tampoco) en
        // vez de seguir intentando cada 10 minutos para siempre.
        if (attemptsSoFar === MAX_AUTOPILOT_ATTEMPTS_PER_APP) {
          await GeneratedApp.updateOne({ _id: app._id }, { $inc: { autopilotFixAttempts: 1 } });
          await AppMessage.create({
            appId: app._id,
            role: "assistant",
            content: `⚠️ Hemos intentado corregir automáticamente tu app **${app.title || "Tu app"}** varias veces sin lograrlo del todo. Para no seguir intentándolo en bucle, hemos parado los intentos automáticos — por favor, abre un **ticket de soporte** contándonos qué falla, y lo revisamos manualmente. Disculpa las molestias. 💜`,
          }).catch(() => {});
        }
        continue;
      }

      // Diagnóstico rápido del código
      const codeSnippet = (app.frontendCode || "").slice(0, 1000);
      const diagnosis = await askAI(
        `Analiza este fragmento de código generado por IA y di si parece incompleto o roto. Devuelve SOLO JSON: {"broken": true/false, "reason": "..."}`,
        `Código (primeros 1000 chars):\n${codeSnippet}`
      );

      let isBroken = false;
      try {
        const f = diagnosis.indexOf("{"); const l = diagnosis.lastIndexOf("}");
        if (f !== -1) { const p = JSON.parse(diagnosis.slice(f, l + 1)); isBroken = p.broken; }
      } catch { /* no hacer nada */ }

      if (!isBroken) continue;

      // Lanzar corrección automática
      await GeneratedApp.updateOne({ _id: app._id }, { $inc: { autopilotFixAttempts: 1 } });
      const cleanPrompt = (app.prompt || "").replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "").trim().slice(0, 400);
      const newJobId = new mongoose.Types.ObjectId().toString();
      await GenerationJob.create({
        _id: newJobId,
        userId: app.userId,
        prompt: `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=autopilot-fix. [ADMIN REPAIR] La app generada quedó incompleta. Complétala según el prompt original: ${cleanPrompt}`,
        editAppId: String(app._id),
        coderModel: "zoco-plus",
        language: "typescript", kind: "edit",
        status: "queued", phase: "queued", progress: 0,
        isAdmin: true, hasEverPaid: true,
        autoFixedFromJobId: "autopilot-broken-app",
      });
      await enqueueGenerateJob(newJobId);
      logger.info({ appId: String(app._id), newJobId, attempt: attemptsSoFar + 1 }, "aiAutopilot: app rota detectada y corrección lanzada");
    }
  } catch (err) {
    logger.error({ err }, "aiAutopilot.autoFixBrokenApps error");
  }
}

// ─── MÓDULO 5: Evaluador de calidad pre-succeeded ─────────────────────────────
// Antes de marcar un job como succeeded, la IA puntúa la app.
// Si la puntuación es < 60, lanza un patcher automático.

export async function evaluateJobQuality(jobId: string, appId: string, frontendCode: string, prompt: string): Promise<{ pass: boolean; score: number; issues: string[] }> {
  try {
    const cleanPrompt = prompt.replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "").trim().slice(0, 400);

    // CRÍTICO: usar compactBundleForPrompt en vez de slice(0,4000)
    // slice(0,4000) solo mostraba archivos de config (vercel.json, package.json, vite.config)
    // compactBundleForPrompt prioriza los archivos de código real (App.tsx, páginas, componentes)
    const { compactBundleForPrompt } = await import("./shared-agents");
    const codePreview = compactBundleForPrompt(frontendCode, [], 12_000);
    const bundleSize = frontendCode.length;

    const result = await askAI(
      `Eres el evaluador de calidad de Maris AI. Analiza el código generado y devuelve SOLO JSON:
{
  "score": 0-100,
  "pass": true/false,
  "issues": ["problema 1", "problema 2"],
  "verdict": "explicación breve"
}

pass=true si score >= 65. Evalúa: ¿el código responde al prompt? ¿tiene páginas reales implementadas (App.tsx, componentes)? ¿hay contenido real (no solo config files)?
pass=false SOLO si: bundle total < 5000 chars, no hay NINGÚN componente React real, todo son archivos de configuración sin código de app.
IMPORTANTE: Si el bundle tiene > 10000 chars y hay al menos un componente React → pass=true aunque no veas todo el código.`,
      `Prompt original: ${cleanPrompt}\n\nTamaño total del bundle: ${bundleSize} chars\n\nCódigo (muestra inteligente):\n${codePreview}`
    );

    let parsed: any = { score: 50, pass: true, issues: [] };
    try {
      const f = result.indexOf("{"); const l = result.lastIndexOf("}");
      if (f !== -1) parsed = JSON.parse(result.slice(f, l + 1));
    } catch { /* si falla, aprobar para no bloquear */ }

    logger.info({ jobId, appId, score: parsed.score, pass: parsed.pass }, "aiAutopilot: evaluación de calidad");
    return { pass: parsed.pass ?? true, score: parsed.score ?? 50, issues: parsed.issues ?? [] };
  } catch (err) {
    logger.warn({ err, jobId }, "aiAutopilot.evaluateJobQuality error — aprobando por defecto");
    return { pass: true, score: 50, issues: [] };
  }
}

// ─── MÓDULO 6: Resumen diario para el admin ───────────────────────────────────
// Se ejecuta a las 8:00 cada mañana. Email con estado de la plataforma.

let lastDailySummary = 0;
export async function sendDailySummary(): Promise<void> {
  const now = new Date();
  const hour = now.getHours();
  // Solo entre 8:00 y 8:10 y si no se ha enviado hoy
  if (hour !== 8) return;
  if (Date.now() - lastDailySummary < 23 * 60 * 60 * 1000) return;
  lastDailySummary = Date.now();

  try {
    await connectDB();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalJobs, succeededJobs, failedJobs, newUsers, totalApps] = await Promise.all([
      GenerationJob.countDocuments({ createdAt: { $gte: yesterday } }),
      GenerationJob.countDocuments({ status: "succeeded", updatedAt: { $gte: yesterday } }),
      GenerationJob.countDocuments({ status: "failed", updatedAt: { $gte: yesterday } }),
      User.countDocuments({ createdAt: { $gte: yesterday } }),
      GeneratedApp.countDocuments({ createdAt: { $gte: yesterday } }),
    ]);

    const successRate = totalJobs > 0 ? Math.round((succeededJobs / totalJobs) * 100) : 0;
    const statusColor = successRate >= 80 ? "#10b981" : successRate >= 60 ? "#f59e0b" : "#ef4444";
    const statusEmoji = successRate >= 80 ? "✅" : successRate >= 60 ? "⚠️" : "🚨";

    // Pedirle a la IA un análisis de los fallos
    let aiAnalysis = "";
    if (failedJobs > 0) {
      const recentFailed = await GenerationJob.find({ status: "failed", updatedAt: { $gte: yesterday } })
        .select("errorMessage prompt").limit(10).lean() as any[];
      const errSummary = recentFailed.map((j: any) => j.errorMessage || "desconocido").join(", ").slice(0, 800);
      aiAnalysis = await askAI(
        "Eres el analista de Maris AI. Resume brevemente (máx 2 frases en español) el patrón principal de los errores de hoy y una recomendación.",
        `Errores del día: ${errSummary}`
      );
    }

    await sendPlatformEmail(
      `${statusEmoji} Maris AI — Resumen del ${now.toLocaleDateString("es-ES")}`,
      `<div style="font-family:-apple-system,sans-serif;padding:32px;background:#09090f;color:#f3f4f6;max-width:560px;margin:0 auto">
        <div style="margin-bottom:24px">
          <span style="background:#111118;border:1px solid #1f1f2e;border-radius:8px;padding:4px 12px;color:#7c3aed;font-size:12px;font-weight:600">MARIS AI · RESUMEN DIARIO</span>
        </div>
        <h1 style="font-size:22px;font-weight:800;margin:0 0 4px">${statusEmoji} ${now.toLocaleDateString("es-ES", { weekday:"long", day:"numeric", month:"long" })}</h1>
        <p style="color:#6b7280;font-size:14px;margin:0 0 28px">Actividad de las últimas 24 horas</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px">
          ${[
            ["🚀 Jobs lanzados", totalJobs],
            ["✅ Exitosos", succeededJobs],
            ["❌ Fallidos", failedJobs],
            ["👤 Nuevos usuarios", newUsers],
            ["📦 Apps generadas", totalApps],
            [`${statusEmoji} Tasa de éxito`, `${successRate}%`],
          ].map(([label, value]) => `
            <div style="background:#111118;border:1px solid #1f1f2e;border-radius:10px;padding:14px 16px">
              <div style="color:#6b7280;font-size:12px;margin-bottom:4px">${label}</div>
              <div style="color:#f3f4f6;font-size:22px;font-weight:700">${value}</div>
            </div>
          `).join("")}
        </div>

        <div style="background:#111118;border:1px solid #1f1f2e;border-radius:10px;padding:16px;margin-bottom:20px">
          <div style="color:#f3f4f6;font-weight:600;font-size:13px;margin-bottom:8px">Estado general</div>
          <div style="height:8px;background:#1f1f2e;border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${successRate}%;background:${statusColor};border-radius:4px"></div>
          </div>
          <div style="color:${statusColor};font-size:13px;margin-top:6px;font-weight:600">${successRate}% de éxito</div>
        </div>

        ${aiAnalysis ? `
        <div style="background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.25);border-radius:10px;padding:16px;margin-bottom:20px">
          <div style="color:#a78bfa;font-weight:600;font-size:12px;margin-bottom:6px">🤖 ANÁLISIS IA</div>
          <div style="color:#d1d5db;font-size:13px;line-height:1.6">${aiAnalysis}</div>
        </div>` : ""}

        <a href="https://www.marisai.es/admin" style="display:block;text-align:center;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;padding:12px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">
          Ver panel admin →
        </a>
        <p style="color:#374151;font-size:11px;text-align:center;margin-top:16px">Maris AI Autopilot · marisai.es</p>
      </div>`
    );

    logger.info({ totalJobs, succeededJobs, failedJobs, newUsers, successRate }, "aiAutopilot: resumen diario enviado");
  } catch (err) {
    logger.error({ err }, "aiAutopilot.sendDailySummary error");
  }
}

// ─── Ticker principal — se llama desde el worker ──────────────────────────────
export async function runAutopilotTick(): Promise<void> {
  await Promise.allSettled([
    runHealthMonitor(),
    autoFixBrokenApps(),
    sendDailySummary(),
    checkStaleTickets(),
  ]);
}

// ENCONTRADO A PETICIÓN DEL USUARIO (red de seguridad real para la
// promesa de "respuesta en menos de 3-4 horas" ahora visible en 5
// páginas públicas de marisai.es -- ver commits del mismo día sobre las
// páginas de comparación): sin esto, la promesa dependía por completo
// de que alguien revisara el correo a mano. Con un solo fundador
// llevando varios productos a la vez, un ticket real podía quedar sin
// respuesta mucho más de lo prometido, sin que nadie se enterase hasta
// que el cliente se quejara.
async function checkStaleTickets(): Promise<void> {
  try {
    await connectDB();
    const THREE_HOURS_AGO = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const staleTickets = await Ticket.find({
      status: "open",
      responses: { $size: 0 }, // sin ninguna respuesta todavía
      createdAt: { $lte: THREE_HOURS_AGO },
      staleReminderSentAt: { $exists: false }, // aviso único, no repetido
    }).limit(20).lean();

    for (const ticket of staleTickets) {
      const user = await User.findById(ticket.userId).select("email").lean() as any;
      await notifyAdminSupportTicket({
        userEmail: user?.email,
        subject: `⏰ SIN RESPONDER (${Math.round((Date.now() - new Date(ticket.createdAt).getTime()) / (60 * 60 * 1000))}h): ${ticket.subject}`,
        message: ticket.message,
        ticketId: String(ticket._id),
      });
      await Ticket.updateOne({ _id: ticket._id }, { $set: { staleReminderSentAt: new Date() } });
      logger.warn({ ticketId: String(ticket._id) }, "aiAutopilot: ticket sin responder tras 3h -- aviso de recordatorio enviado");
    }
  } catch (err) {
    logger.error({ err }, "aiAutopilot.checkStaleTickets error");
  }
}
