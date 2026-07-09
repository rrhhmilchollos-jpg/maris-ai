import { Router } from "express";
import { connectDB } from "../lib/db";
import { requireAuth, isAdminEmail } from "../lib/auth";
import { GenerationJob, JobLog, type IJobLog } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /api/jobs/:id ── consulta estado de un trabajo de generación ───────
router.get("/jobs/:id", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const userId = req.userId as string;
    const job = await GenerationJob.findOne({ _id: req.params.id, userId }).lean();

    if (!job) {
      return res.status(404).json({ error: "Trabajo no encontrado" });
    }

    // QUEUE POSITION — ENCONTRADO: un job en estado "queued" no daba NINGUNA
    // información de cuántos van delante o tiempo estimado, así que cuando
    // el servidor está cerca de su límite de concurrencia (3-25 jobs
    // simultáneos, ver jobQueue.ts) el usuario solo veía "queued" sin
    // moverse, indistinguible de "esto está roto". Esto es justo el hueco
    // real detrás de "que el sistema no colapse y la gente espere su turno
    // de forma clara" — el sistema YA no colapsa (bloqueo atómico en
    // jobQueue.ts), pero no comunicaba la espera de forma visible.
    let queuePosition: number | null = null;
    let estimatedWaitSeconds: number | null = null;
    if (job.status === "queued") {
      // Posición = cuántos jobs en cola (de cualquier usuario) se crearon
      // antes que este — coherente con el orden real de procesamiento en
      // jobQueue.ts (sort({ createdAt: 1 })).
      queuePosition = await GenerationJob.countDocuments({
        status: "queued",
        createdAt: { $lt: (job as any).createdAt },
      });
      const currentQueuePosition = queuePosition;
      // Estimación conservadora: tiempo medio real de las últimas
      // generaciones completadas, dividido entre la concurrencia activa —
      // se recalcula en cada consulta en vez de usar un número fijo, así
      // que se ajusta sola si las generaciones se vuelven más rápidas/lentas.
      const recentCompleted = await GenerationJob.find({
        status: "completed",
        updatedAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) },
      }).select("createdAt updatedAt").limit(20).lean();
      const avgDurationMs = recentCompleted.length > 0
        ? recentCompleted.reduce((sum: number, j: { createdAt?: Date; updatedAt?: Date }) => sum + (new Date((j as any).updatedAt).getTime() - new Date((j as any).createdAt).getTime()), 0) / recentCompleted.length
        : 90_000; // 90s de fallback razonable si todavía no hay datos recientes (arranque en frío)
      const concurrency = Math.min(Number.parseInt(process.env.JOB_CONCURRENCY || "3", 10) || 3, 25);
      estimatedWaitSeconds = Math.round(((currentQueuePosition + 1) / concurrency) * (avgDurationMs / 1000));
    }

    res.json({
      id: job._id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      appId: job.appId,
      errorMessage: job.errorMessage,
      // ENCONTRADO a petición del usuario: el error técnico real (guardado
      // en internalErrorMessage, ver apps.ts) no era visible en NINGÚN
      // sitio del panel -- ni para el cliente (correcto, a propósito, para
      // no exponer detalles internos) ni para el admin (bug: el propio
      // comentario del código decía "para que el equipo lo revise", pero
      // nunca se exponía por ningún endpoint con UI real). Solo se incluye
      // si quien consulta es la cuenta admin -- nunca para clientes.
      internalErrorMessage: isAdminEmail(req.dbUser?.email) ? (job as any).internalErrorMessage ?? null : undefined,
      updatedAt: job.updatedAt,
      currentAgent: (job as any).currentAgent,
      awaitingApproval: (job as any).awaitingApproval,
      approvedFacets: (job as any).approvedFacets,
      checkpointData: (job as any).checkpointData,
      partialFrontendCode: (job as any).partialFrontendCode ?? null,
      queuePosition,
      estimatedWaitSeconds,
    });
  } catch (err) {
    logger.error({ err, jobId: req.params.id }, "GET /api/jobs/:id error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── GET /api/jobs/:id/logs ── consulta logs de agentes de un trabajo ───────
router.get("/jobs/:id/logs", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const userId = req.userId as string;
    const { afterId } = req.query;

    // Verificar que el job pertenece al usuario
    const job = await GenerationJob.findOne({ _id: req.params.id, userId }, { _id: 1 }).lean();
    if (!job) {
      return res.status(404).json({ error: "Trabajo no encontrado" });
    }

    const query: any = { jobId: req.params.id };
    if (afterId) {
      query._id = { $gt: afterId };
    }

    const logs = await JobLog.find(query).sort({ _id: 1 }).lean();

    res.json({ logs: logs.map((l) => ({
      id: l._id,
      jobId: l.jobId,
      agent: l.agent,
      level: l.level,
      message: l.message,
      createdAt: l.createdAt,
    })) });
  } catch (err) {
    logger.error({ err, jobId: req.params.id }, "GET /api/jobs/:id/logs error");
    res.status(500).json({ error: "Error interno" });
  }
});

import { enqueueGenerateJob } from "../lib/jobQueue";

// ── POST /api/jobs/:id/approve ── aprobar faceta y reanudar generación ──────
router.post("/jobs/:id/approve", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const userId = req.userId as string;
    // ENCONTRADO a petición explícita del usuario, conectando el Gating
    // Question Block al endpoint que ya existía: este endpoint solo
    // recibía `facet` (ej. "technical_architecture") y la marcaba como
    // aprobada, pero NUNCA recibía las respuestas reales del cliente a
    // cada pregunta — el sistema sabía QUE el cliente respondió, pero no
    // QUÉ respondió (¿PostgreSQL o MongoDB? ¿Stripe o PayPal?). `answers`
    // es opcional para no romper cualquier otro uso futuro de esta misma
    // ruta con una faceta distinta que no necesite respuestas (aprobación
    // simple sin preguntas asociadas).
    const { facet, answers, extraNotes } = req.body;

    if (!facet) return res.status(400).json({ error: "facet es requerido" });

    const job = await GenerationJob.findOne({ _id: req.params.id, userId });
    if (!job) return res.status(404).json({ error: "Trabajo no encontrado" });

    if (job.status !== "awaiting_approval") {
      return res.status(400).json({ error: "El trabajo no está esperando aprobación" });
    }

    // Actualizar facetas aprobadas en el checkpointData
    const checkpoint = (job as any).checkpointData || {};
    const approvedFacets = [...(checkpoint.approvedFacets || [])];
    if (!approvedFacets.includes(facet)) {
      approvedFacets.push(facet);
    }
    checkpoint.approvedFacets = approvedFacets;
    // Guardar las respuestas reales del cliente, indexadas por el id de la
    // pregunta (ej. {"database": "PostgreSQL...", "auth_roles": "...",
    // "integrations": "Stripe"}) — generateApp las lee de aquí al
    // reanudar para inyectarlas como contexto real del prompt, en vez de
    // tener que volver a adivinar lo que el cliente ya confirmó.
    if (answers && typeof answers === "object" && !Array.isArray(answers)) {
      checkpoint.answers = { ...(checkpoint.answers || {}), ...answers };
    }
    // Especificaciones adicionales libres del cliente (campo de texto del
    // formulario de clarificación técnica) — se inyectan en el prompt.
    if (extraNotes && typeof extraNotes === "string" && extraNotes.trim()) {
      checkpoint.extraNotes = extraNotes.trim();
    }

    await GenerationJob.findByIdAndUpdate(req.params.id, {
      $set: {
        status: "queued",
        phase: "resuming",
        awaitingApproval: false,
        approvedFacets: approvedFacets,
        checkpointData: checkpoint,
        updatedAt: new Date(),
      },
    });

    await JobLog.create({
      jobId: req.params.id,
      agent: "system",
      message: `✅ Faceta '${facet}' aprobada por el usuario. Reanudando...`,
      level: "info",
    });

    await enqueueGenerateJob(req.params.id);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, jobId: req.params.id }, "POST /api/jobs/:id/approve error");
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
