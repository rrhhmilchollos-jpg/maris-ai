import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { GeneratedApp } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const PAGE_SIZE = 24;

// Solo campos seguros — NUNCA exponer frontendCode/backendCode/prompt/userId/
// requiredEnvVars/githubRepoUrl/etc. en endpoints públicos.
const SAFE_FIELDS = {
  _id: 0,
  title: 1,
  description: 1,
  techStack: 1,
  kind: 1,
  language: 1,
  publicSlug: 1,
  vercelDeployUrl: 1,
  vercelCustomDomain: 1,
  customDomain: 1,
  showcasePublishedAt: 1,
  createdAt: 1,
};

function formatShowcaseItem(app: any) {
  const demoUrl = app.vercelCustomDomain
    ? `https://${app.vercelCustomDomain}`
    : app.customDomain
      ? `https://${app.customDomain}`
      : app.vercelDeployUrl || null;

  return {
    title: app.title,
    description: app.description,
    techStack: app.techStack || [],
    kind: app.kind || "fullstack",
    language: app.language || "es",
    publicSlug: app.publicSlug,
    demoUrl,
    publishedAt: app.showcasePublishedAt || app.createdAt,
  };
}

// ── GET /api/showcase — galería pública paginada ────────────────────────────
router.get("/showcase", async (req, res) => {
  await connectDB();
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);

    const [items, total] = await Promise.all([
      GeneratedApp.find({ isPublic: true, publicSlug: { $exists: true, $ne: null } }, SAFE_FIELDS)
        .sort({ showcasePublishedAt: -1, createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      GeneratedApp.countDocuments({ isPublic: true, publicSlug: { $exists: true, $ne: null } }),
    ]);

    res.json({
      items: items.map(formatShowcaseItem),
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
    });
  } catch (err) {
    logger.error({ err }, "GET /showcase error");
    res.status(500).json({ error: "Error al cargar la galería" });
  }
});

// ── GET /api/showcase/:slug — detalle de un proyecto público ────────────────
router.get("/showcase/:slug", async (req, res) => {
  await connectDB();
  try {
    const app = await GeneratedApp.findOne(
      { publicSlug: req.params.slug, isPublic: true },
      SAFE_FIELDS,
    ).lean();
    if (!app) {
      res.status(404).json({ error: "Proyecto no encontrado o no es público" });
      return;
    }
    res.json(formatShowcaseItem(app));
  } catch (err) {
    logger.error({ err }, "GET /showcase/:slug error");
    res.status(500).json({ error: "Error al cargar el proyecto" });
  }
});

export default router;
