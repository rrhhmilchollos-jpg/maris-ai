import { Router } from "express";
import { connectDB } from "../lib/db";
import { requireAuth } from "../lib/auth";
import { GenerationJob, JobLog } from "@workspace/db/schema";
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

    res.json({
      id: job._id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      appId: job.appId,
      errorMessage: job.errorMessage,
      updatedAt: job.updatedAt,
      currentAgent: (job as any).currentAgent,
      awaitingApproval: (job as any).awaitingApproval,
      approvedFacets: (job as any).approvedFacets,
      checkpointData: (job as any).checkpointData,
      // ── preview en tiempo real ──
      partialFrontendCode: (job as any).partialFrontendCode ?? null,
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

    res.json({ logs: logs.map(l => ({
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
    const { facet } = req.body;

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
