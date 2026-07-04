// ── DEMO PÚBLICA (SIMULADA) ──────────────────────────────────────────────────
// Endpoint sin autenticación que permite a visitantes no registrados ver
// "a Maris AI generando una app en vivo".
//
// IMPORTANTE — POR QUÉ ES SIMULADA Y NO UNA GENERACIÓN REAL:
// La versión anterior lanzaba un job de generación REAL (enqueueGenerateJob),
// consumiendo tokens reales de la API de Anthropic en cada demo, sin ninguna
// garantía de que ese visitante fuese a convertirse en cliente de pago.
// Con hasta 3 demos/IP/24h y tráfico anónimo sin control, esto es un vector
// de coste sin techo real — cualquiera (o un bot) puede quemar tokens sin
// intención de compra. Ningún competidor ofrece generación real gratuita
// sin registro por esta misma razón.
//
// Esta versión NO llama nunca al pipeline de generación real. En su lugar:
//   1. Reproduce un guion de logs con tiempos fijos (misma sensación de
//      "ver a la IA trabajar" que antes, coste de token: cero).
//   2. Al terminar, muestra el preview de una app REAL, generada una única
//      vez de antemano por un humano del equipo (no en cada visita), y
//      reutilizada para todos los visitantes de esa categoría.
//
// CONFIGURACIÓN NECESARIA: hay que generar (o elegir una ya existente y
// aprobada en el Showcase) una app real por categoría, y poner su ID en las
// variables de entorno DEMO_SAMPLE_APP_ID_<CATEGORIA> (ver DEMO_PROMPTS).
// Mientras una categoría no tenga su variable configurada, esa demo concreta
// avisa con un mensaje claro en vez de fallar en silencio o, peor, caer de
// vuelta a generación real.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import { connectDB } from "../lib/db";
import { GenerationJob, GeneratedApp } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router = Router();

// Rate limiting en memoria (IP → timestamps de demos del día)
const demoRateLimit = new Map<string, number[]>();
const DEMO_MAX_PER_IP = 3;
const DEMO_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const DEMO_JOB_TTL_MS = 2 * 60 * 60 * 1000; // 2h

// Guion de logs simulados — mismos tiempos y agentes que un job real típico,
// pero fijos y sin coste. ~26s de duración total.
const SIMULATED_SCRIPT: Array<{ atMs: number; agent: string; message: string }> = [
  { atMs: 400, agent: "researcher", message: "Analizando tu idea y planificando el proyecto…" },
  { atMs: 2800, agent: "architect", message: "Diseñando la arquitectura técnica…" },
  { atMs: 5500, agent: "designer", message: "Creando el sistema visual y la paleta de colores…" },
  { atMs: 8500, agent: "frontend", message: "Generando componentes de React…" },
  { atMs: 12000, agent: "frontend", message: "Escribiendo las páginas y las rutas de la app…" },
  { atMs: 15500, agent: "backend", message: "Configurando la API y la base de datos…" },
  { atMs: 19000, agent: "qa", message: "Verificando que todo funciona correctamente…" },
  { atMs: 22500, agent: "optimizer", message: "Puliendo detalles finales del diseño…" },
  { atMs: 25500, agent: "system", message: "¡App generada con éxito!" },
];
const SIMULATED_TOTAL_MS = 27000;

// Prompts rotativos — cada visita ve uno diferente. `sampleAppId` es el ID de
// una GeneratedApp REAL, generada una única vez, reutilizada para todos.
const DEMO_PROMPTS = [
  {
    id: "reservas",
    label: "App de reservas para restaurante",
    prompt: "Crea una app web de reservas para un restaurante llamado 'La Taberna del Mar'. Debe tener: página de inicio con menú y fotos, sistema de reservas con calendario, confirmación por email, panel de administración para el restaurante para ver y gestionar reservas, y diseño elegante en tonos azul marino y dorado.",
    emoji: "🍽️",
    sampleAppId: process.env.DEMO_SAMPLE_APP_ID_RESERVAS || null,
  },
  {
    id: "crm",
    label: "CRM para pequeña empresa",
    prompt: "Crea un CRM sencillo para una pequeña empresa de servicios. Debe incluir: lista de clientes con búsqueda y filtros, ficha de cliente con historial de contactos, pipeline de ventas con etapas arrastrables (Kanban), panel de métricas con gráficas de ventas, y sistema de notas y tareas por cliente. Diseño profesional y limpio.",
    emoji: "📊",
    sampleAppId: process.env.DEMO_SAMPLE_APP_ID_CRM || null,
  },
  {
    id: "tienda",
    label: "Tienda online de productos artesanales",
    prompt: "Crea una tienda online para vender productos artesanales llamada 'Artesanía Viva'. Incluye: catálogo de productos con categorías y filtros, carrito de compra, proceso de pago con Stripe, panel de administración para gestionar productos e inventario, y página de seguimiento de pedidos. Diseño cálido con colores tierra.",
    emoji: "🛍️",
    sampleAppId: process.env.DEMO_SAMPLE_APP_ID_TIENDA || null,
  },
  {
    id: "academia",
    label: "Plataforma de cursos online",
    prompt: "Crea una plataforma de cursos online llamada 'AprenderYa'. Debe tener: catálogo de cursos con categorías, página de detalle de curso con temario, sistema de registro y login de alumnos, reproductor de vídeo con progreso guardado, panel del alumno con cursos activos y certificados, y área de administración para subir cursos. Diseño moderno y motivador.",
    emoji: "🎓",
    sampleAppId: process.env.DEMO_SAMPLE_APP_ID_ACADEMIA || null,
  },
];

// GET /api/demo/prompts — prompts disponibles para la demo
router.get("/prompts", (_req, res) => {
  res.json(DEMO_PROMPTS.map(({ id, label, emoji }) => ({ id, label, emoji })));
});

// POST /api/demo/start — "iniciar" una demo simulada (no consume tokens)
router.post("/start", async (req: any, res: any): Promise<void> => {
  try {
    await connectDB();

    // Rate limiting por IP (se mantiene igual que antes, aunque ya no haya
    // coste real de tokens — sigue evitando abuso/spam del endpoint público).
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

    // Limpiar jobs de demo antiguos (TTL)
    const cutoff = new Date(now - DEMO_JOB_TTL_MS);
    await GenerationJob.deleteMany({ isDemo: true, createdAt: { $lt: cutoff } });

    // Elegir categoría: la que pidió el visitante, o si escribió texto libre,
    // una categoría de ejemplo al azar (no generamos nada nuevo de verdad,
    // así que no podemos "adivinar" su idea exacta — se lo dejamos claro en
    // el frontend: esto es un ejemplo real, no literalmente lo que escribió).
    const rawCustomPrompt = typeof req.body?.customPrompt === "string" ? req.body.customPrompt.trim().slice(0, 500) : "";
    const promptId = req.body?.promptId ||
      (rawCustomPrompt ? DEMO_PROMPTS[Math.floor(Math.random() * DEMO_PROMPTS.length)]!.id : DEMO_PROMPTS[0]!.id);
    const selected = DEMO_PROMPTS.find((p) => p.id === promptId) ?? DEMO_PROMPTS[0]!;

    if (!selected.sampleAppId) {
      logger.warn({ promptId: selected.id }, "Demo: falta configurar DEMO_SAMPLE_APP_ID para esta categoría");
      res.status(503).json({
        error: "Esta demo todavía se está preparando. Prueba con otro ejemplo o regístrate gratis para crear la tuya.",
      });
      return;
    }

    // Job "simulado": no dispara generación real, solo guarda el punto de
    // partida y qué app de muestra hay que enseñar al final.
    const job = await GenerationJob.create({
      userId: process.env.DEMO_USER_ID || "demo_system",
      prompt: rawCustomPrompt || selected.prompt,
      status: "queued",
      phase: "queued",
      progress: 0,
      isDemo: true,
      isSimulated: true,
      simulatedStartAt: new Date(),
      simulatedSampleAppId: selected.sampleAppId,
      simulatedLabel: rawCustomPrompt ? "Tu idea (ejemplo similar)" : selected.label,
    });

    logger.info({ jobId: String(job._id), promptId, ip: ipKey, simulated: true }, "Demo pública iniciada (simulada, sin coste de tokens)");

    res.json({
      jobId: String(job._id),
      promptLabel: rawCustomPrompt ? "Tu idea (ejemplo similar)" : selected.label,
      promptEmoji: selected.emoji,
      remainingDemos: DEMO_MAX_PER_IP - timestamps.length,
    });
  } catch (err: any) {
    logger.error({ err }, "demo/start error");
    res.status(500).json({ error: "Error iniciando la demo. Inténtalo de nuevo." });
  }
});

// GET /api/demo/status/:jobId — progreso simulado (calculado por tiempo, sin
// tocar ningún job real ni gastar tokens)
router.get("/status/:jobId", async (req: any, res: any): Promise<void> => {
  try {
    await connectDB();
    const job = await GenerationJob.findOne({
      _id: req.params.jobId,
      isDemo: true,
      isSimulated: true,
    }).lean() as any;

    if (!job) {
      res.status(404).json({ error: "Demo no encontrada" });
      return;
    }

    const elapsedMs = Date.now() - new Date(job.simulatedStartAt).getTime();
    const logs = SIMULATED_SCRIPT
      .filter((l) => l.atMs <= elapsedMs)
      .map((l) => ({
        agent: l.agent,
        message: l.message,
        level: "info",
        ts: new Date(job.simulatedStartAt.getTime() + l.atMs).toISOString(),
      }));

    const done = elapsedMs >= SIMULATED_TOTAL_MS;
    const progress = Math.min(100, Math.round((elapsedMs / SIMULATED_TOTAL_MS) * 100));

    res.json({
      status: done ? "done" : "generating",
      phase: done ? "done" : (SIMULATED_SCRIPT.filter((l) => l.atMs <= elapsedMs).slice(-1)[0]?.agent ?? "queued"),
      progress,
      logs,
      hasPreview: done,
      appTitle: job.simulatedLabel,
    });
  } catch (err: any) {
    logger.error({ err }, "demo/status error");
    res.status(500).json({ error: "Error obteniendo estado" });
  }
});

// GET /api/demo/preview/:jobId — sirve el preview de la app de MUESTRA real
// asociada a esta categoría (la misma para todos los visitantes, generada
// una única vez de antemano — nunca se genera nada nuevo aquí).
router.get("/preview/:jobId", async (req: any, res: any): Promise<void> => {
  try {
    await connectDB();
    const job = await GenerationJob.findOne({
      _id: req.params.jobId,
      isDemo: true,
      isSimulated: true,
    }).select("simulatedSampleAppId simulatedStartAt simulatedLabel").lean() as any;

    const elapsedMs = job ? Date.now() - new Date(job.simulatedStartAt).getTime() : 0;
    if (!job || elapsedMs < SIMULATED_TOTAL_MS) {
      res.status(404).send("<html><body>Preview no disponible aún</body></html>");
      return;
    }

    const app = await GeneratedApp.findById(job.simulatedSampleAppId).select("frontendCode title").lean() as any;
    if (!app?.frontendCode) {
      res.status(404).send("<html><body>Preview no disponible</body></html>");
      return;
    }

    const { buildDeployHtml } = await import("../lib/deployBundle");
    const html = await buildDeployHtml({ bundle: app.frontendCode, title: job.simulatedLabel || app.title || "Demo Maris AI" });
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.send(html);
  } catch (err: any) {
    logger.error({ err }, "demo/preview error");
    res.status(500).send("<html><body>Error cargando preview</body></html>");
  }
});

export default router;
