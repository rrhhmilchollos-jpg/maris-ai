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

    res.json(logs.map(l => ({
      id: l._id,
      jobId: l.jobId,
      agent: l.agent,
      level: l.level,
      message: l.message,
      createdAt: l.createdAt,
    })));
  } catch (err) {
    logger.error({ err, jobId: req.params.id }, "GET /api/jobs/:id/logs error");
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
