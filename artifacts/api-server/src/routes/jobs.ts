/**
 * artifacts/api-server/src/routes/jobs.ts
 *
 * Rutas que el frontend espera:
 *   POST /api/apps       → crea job y devuelve { id }
 *   GET  /api/jobs/:id        → devuelve estado del job para polling
 *   GET  /api/jobs/:id/logs   → devuelve logs incrementales del job
 */

import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { GenerationJob, GeneratedApp, User, JobLog } from "@workspace/db/schema";
import { requireAuth, isAdminEmail } from "../lib/auth";
import { enqueueGenerateJob } from "../lib/jobQueue";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── POST /api/apps ──────────────────────────────────────────────────────────

router.post("/apps", requireAuth, async (req, res) => {
  await connectDB();
  const userId = req.userId!;
  const user = req.dbUser!;

  const { prompt, kind, coderModel, language, attachmentIds } = req.body as {
    prompt?: string;
    kind?: string;
    coderModel?: string;
    language?: string;
    attachmentIds?: number[];
  };

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "El prompt es obligatorio." });
    return;
  }

  // Coste en créditos según el tipo de app
  const KIND_COSTS: Record<string, number> = {
    fullstack: 1, landing: 1, vue: 1, svelte: 1,
    mobile: 2, nextjs: 2, "python-api": 2, django: 2,
    "hybrid-pwa": 3, "game-2d": 3,
    "game-3d": 5,
  };
  const creditCost = KIND_COSTS[kind ?? "fullstack"] ?? 1;

  // Verificar créditos (excepto admins)
  const isAdmin = isAdminEmail(user.email);
  if (!isAdmin && user.credits < creditCost) {
    res.status(402).json({ error: "Créditos insuficientes." });
    return;
  }

  // Crear el documento de la app
  const app = await GeneratedApp.create({
    userId,
    prompt: prompt.trim(),
    title: "Generando…",
    description: "Generando…",
    techStack: [],
    frontendCode: "",
    backendCode: "",
    status: "generating",
    kind: kind ?? "fullstack",
  });

  // Crear el job
  const job = await GenerationJob.create({
    userId,
    appId: app._id,
    prompt: prompt.trim(),
    kind: kind ?? "fullstack",
    coderModel: coderModel ?? "auto",
    language: language ?? "typescript",
    attachmentIds: attachmentIds ?? [],
    status: "queued",
    phase: "queued",
    progress: 0,
    creditCost,
  });

  // Descontar créditos si no es admin
  if (!isAdmin) {
    await User.findByIdAndUpdate(userId, { $inc: { credits: -creditCost } });
  }

  // Encolar
  await enqueueGenerateJob(String(job._id));

  logger.info({ jobId: job._id, appId: app._id, userId, kind }, "Job encolado");

  res.status(201).json({ id: job._id });
});

// ─── GET /api/jobs/:id ───────────────────────────────────────────────────────

router.get("/jobs/:id", requireAuth, async (req, res) => {
  await connectDB();
  const userId = req.userId!;
  const { id } = req.params;

  const job = await GenerationJob.findById(id).lean();

  if (!job) {
    res.status(404).json({ error: "Job no encontrado." });
    return;
  }

  // Solo el dueño o un admin puede ver el job
  const isAdmin = isAdminEmail(req.dbUser!.email);
  if (!isAdmin && String(job.userId) !== userId) {
    res.status(403).json({ error: "Sin acceso." });
    return;
  }

  res.json({
    id: job._id,
    status: job.status,
    phase: job.phase ?? "queued",
    progress: job.progress ?? 0,
    appId: job.appId ? String(job.appId) : null,
    errorMessage: job.errorMessage ?? null,
    logs: (job as any).logs ?? [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

// ─── GET /api/jobs/:id/logs ──────────────────────────────────────────────────

router.get("/jobs/:id/logs", requireAuth, async (req, res) => {
  await connectDB();
  const { id } = req.params;
  const afterId = req.query.afterId ? String(req.query.afterId) : null;

  // Verificar que el job existe y el usuario tiene acceso
  const job = await GenerationJob.findById(id).lean();
  if (!job) {
    res.status(404).json({ error: "Job no encontrado." });
    return;
  }

  const isAdmin = isAdminEmail(req.dbUser!.email);
  if (!isAdmin && String(job.userId) !== req.userId) {
    res.status(403).json({ error: "Sin acceso." });
    return;
  }

  // Cargar logs
  const query: any = { jobId: id };
  if (afterId) {
    query._id = { $gt: afterId };
  }

  const logs = await JobLog.find(query).sort({ _id: 1 }).limit(100).lean();

  res.json(
    logs.map((l) => ({
      id: l._id,
      jobId: l.jobId,
      agent: l.agent,
      level: l.level,
      message: l.message,
      createdAt: l.createdAt,
    })),
  );
});

export default router;
