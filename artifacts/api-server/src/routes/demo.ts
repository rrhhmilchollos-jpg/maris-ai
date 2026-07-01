// ── DEMO PÚBLICA ─────────────────────────────────────────────────────────────
// Endpoint sin autenticación que permite a visitantes no registrados ver
// Maris AI generando una app en vivo. Usa una cuenta de sistema dedicada
// (DEMO_USER_ID en env) y limita a 3 demos por IP cada 24 horas para
// evitar abuso. Los jobs de demo tienen una vida útil de 2 horas y se
// borran automáticamente. NO consumen créditos del usuario.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import { connectDB } from "../lib/db";
import { GenerationJob, GeneratedApp, JobLog } from "@workspace/db/schema";
import { enqueueGenerateJob } from "../lib/jobQueue";
import { logger } from "../lib/logger";

const router = Router();

// Rate limiting en memoria (IP → timestamps de demos del día)
const demoRateLimit = new Map<string, number[]>();
const DEMO_MAX_PER_IP = 3;
const DEMO_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const DEMO_JOB_TTL_MS = 2 * 60 * 60 * 1000; // 2h

// Prompts rotativos — cada visita ve uno diferente
const DEMO_PROMPTS = [
  {
    id: "reservas",
    label: "App de reservas para restaurante",
    prompt: "Crea una app web de reservas para un restaurante llamado 'La Taberna del Mar'. Debe tener: página de inicio con menú y fotos, sistema de reservas con calendario, confirmación por email, panel de administración para el restaurante para ver y gestionar reservas, y diseño elegante en tonos azul marino y dorado.",
    emoji: "🍽️",
  },
  {
    id: "crm",
    label: "CRM para pequeña empresa",
    prompt: "Crea un CRM sencillo para una pequeña empresa de servicios. Debe incluir: lista de clientes con búsqueda y filtros, ficha de cliente con historial de contactos, pipeline de ventas con etapas arrastrables (Kanban), panel de métricas con gráficas de ventas, y sistema de notas y tareas por cliente. Diseño profesional y limpio.",
    emoji: "📊",
  },
  {
    id: "tienda",
    label: "Tienda online de productos artesanales",
    prompt: "Crea una tienda online para vender productos artesanales llamada 'Artesanía Viva'. Incluye: catálogo de productos con categorías y filtros, carrito de compra, proceso de pago con Stripe, panel de administración para gestionar productos e inventario, y página de seguimiento de pedidos. Diseño cálido con colores tierra.",
    emoji: "🛍️",
  },
  {
    id: "academia",
    label: "Plataforma de cursos online",
    prompt: "Crea una plataforma de cursos online llamada 'AprenderYa'. Debe tener: catálogo de cursos con categorías, página de detalle de curso con temario, sistema de registro y login de alumnos, reproductor de vídeo con progreso guardado, panel del alumno con cursos activos y certificados, y área de administración para subir cursos. Diseño moderno y motivador.",
    emoji: "🎓",
  },
];

// GET /api/demo/prompts — prompts disponibles para la demo
router.get("/prompts", (_req, res) => {
  res.json(DEMO_PROMPTS.map(({ id, label, emoji }) => ({ id, label, emoji })));
});

// POST /api/demo/start — iniciar una generación de demo
router.post("/start", async (req: any, res: any): Promise<void> => {
  try {
    await connectDB();

    // Rate limiting por IP
    const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
    const now = Date.now();
    const ipKey = String(ip).split(",")[0]?.trim() || "unknown";
    const timestamps = (demoRateLimit.get(ipKey) || []).filter(
      (t) => now - t < DEMO_WINDOW_MS,
    );
    if (timestamps.length >= DEMO_MAX_PER_IP) {
      res.status(429).json({
        error: "Has alcanzado el límite de demos gratuitas por hoy (3 por día). ¡Regístrate gratis para crear las tuyas sin límite!",
        limitReached: true,
      });
      return;
    }
    timestamps.push(now);
    demoRateLimit.set(ipKey, timestamps);

    // Limpiar demos antiguas (TTL)
    const cutoff = new Date(now - DEMO_JOB_TTL_MS);
    await GenerationJob.deleteMany({ isDemo: true, createdAt: { $lt: cutoff } });

    // Seleccionar prompt
    const promptId = req.body?.promptId || DEMO_PROMPTS[Math.floor(Math.random() * DEMO_PROMPTS.length)]!.id;
    const selected = DEMO_PROMPTS.find((p) => p.id === promptId) ?? DEMO_PROMPTS[0]!;

    // Crear la app y el job de demo
    const demoUserId = process.env.DEMO_USER_ID || "demo_system";
    const app = await GeneratedApp.create({
      userId: demoUserId,
      title: selected.label,
      prompt: selected.prompt,
      status: "generating",
      isDemo: true,
    });

    const job = await GenerationJob.create({
      appId: app._id,
      userId: demoUserId,
      prompt: `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=public-demo. ${selected.prompt}`,
      status: "queued",
      phase: "queued",
      progress: 0,
      isDemo: true,
    });

    await enqueueGenerateJob(String(job._id));

    logger.info({ jobId: String(job._id), promptId, ip: ipKey }, "Demo pública iniciada");

    res.json({
      jobId: String(job._id),
      appId: String(app._id),
      promptLabel: selected.label,
      promptEmoji: selected.emoji,
      remainingDemos: DEMO_MAX_PER_IP - timestamps.length,
    });
  } catch (err: any) {
    logger.error({ err }, "demo/start error");
    res.status(500).json({ error: "Error iniciando la demo. Inténtalo de nuevo." });
  }
});

// GET /api/demo/status/:jobId — estado del job de demo (sin auth)
router.get("/status/:jobId", async (req: any, res: any): Promise<void> => {
  try {
    await connectDB();
    const job = await GenerationJob.findOne({
      _id: req.params.jobId,
      isDemo: true,
    }).lean() as any;

    if (!job) {
      res.status(404).json({ error: "Demo no encontrada" });
      return;
    }

    const logs = await JobLog.find({ jobId: req.params.jobId })
      .sort({ createdAt: 1 })
      .limit(100)
      .select("agent message level createdAt")
      .lean();

    const app = job.appId
      ? await GeneratedApp.findById(job.appId).select("frontendCode title status").lean() as any
      : null;

    res.json({
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      logs: logs.map((l: any) => ({
        agent: l.agent,
        message: l.message,
        level: l.level,
        ts: l.createdAt,
      })),
      hasPreview: !!app?.frontendCode,
      appTitle: app?.title,
    });
  } catch (err: any) {
    logger.error({ err }, "demo/status error");
    res.status(500).json({ error: "Error obteniendo estado" });
  }
});

// GET /api/demo/preview/:jobId — HTML del preview de la app demo (sin auth)
router.get("/preview/:jobId", async (req: any, res: any): Promise<void> => {
  try {
    await connectDB();
    const job = await GenerationJob.findOne({
      _id: req.params.jobId,
      isDemo: true,
    }).select("appId status").lean() as any;

    if (!job || job.status !== "done") {
      res.status(404).send("<html><body>Preview no disponible aún</body></html>");
      return;
    }

    const app = await GeneratedApp.findById(job.appId).select("frontendCode title").lean() as any;
    if (!app?.frontendCode) {
      res.status(404).send("<html><body>Preview no disponible</body></html>");
      return;
    }

    const { buildDeployHtml } = await import("../lib/deployBundle");
    const html = await buildDeployHtml({ bundle: app.frontendCode, title: app.title || "Demo Maris AI" });
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.send(html);
  } catch (err: any) {
    logger.error({ err }, "demo/preview error");
    res.status(500).send("<html><body>Error cargando preview</body></html>");
  }
});

export default router;
