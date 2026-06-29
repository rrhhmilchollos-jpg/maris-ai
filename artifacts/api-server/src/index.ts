import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { verifyToken } from "@clerk/express";
import app from "./app";
import { logger } from "./lib/logger";
import { reclaimOrphanedJobs, runJobById } from "./routes/apps";
import { startQueue, registerGenerateWorker, stopQueue } from "./lib/jobQueue";
import { startSelfMonitor } from "./lib/selfMonitor";
import { startAppHealthMonitor } from "./lib/autoRepairAgent";
import { runAutopilotTick } from "./lib/aiAutopilot";
import { runRecurringBillingTick } from "./lib/recurringBilling";
import { submitIndexNow } from "./lib/indexNow";
import { pingRedis, isRedisConfigured } from "./lib/redisHealth";
import { connectDB } from "./lib/db";
import { attachPresenceHandlers } from "./lib/presence";
 
const rawPort = process.env["PORT"] || "3000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  logger.warn(`Invalid PORT value: "${rawPort}". Defaulting to 3000.`);
}
const finalPort = (Number.isNaN(port) || port <= 0) ? 3000 : port;

// ENCONTRADO: el servidor usaba app.listen(...) directamente, que crea un
// http.Server interno sin darnos acceso a la referencia — necesario para
// adjuntar socket.io al MISMO servidor HTTP (no uno nuevo en otro puerto).
// httpServer.listen(...) es funcionalmente idéntico a app.listen(...) — la
// API de Express delega en el http.Server subyacente de todas formas —
// así que este cambio no altera ningún comportamiento existente del
// servidor HTTP/Express, solo nos da la referencia que necesitábamos.
const httpServer = http.createServer(app);

// ENCONTRADO en logs reales de producción: el ciclo completo de Testing
// Visual + Autofix (POST /apps/:id/visual-test) puede tardar varios
// minutos (análisis con Claude Vision + reconstrucción por hitos con
// CoreOrchestrator, repetido hasta 3 veces) — confirmado en logs de
// Railway con responseTime de 292507ms y 300010ms (este último abortado).
// Railway corta conexiones a los 5 minutos por defecto (su límite máximo
// de plataforma es 15 minutos, configurable a nivel de aplicación) — sin
// subir esto, el trabajo del ciclo de autofix se pierde a mitad sin que
// el cliente ni el servidor lo registren como un fallo real. Esto es una
// red de seguridad mientras se completa la solución de fondo (convertir
// el endpoint en asíncrono con polling, igual que ya hacen los jobs de
// generación) — no sustituye a esa solución, solo evita pérdidas de
// trabajo mientras tanto.
httpServer.setTimeout(15 * 60 * 1000);
httpServer.keepAliveTimeout = 15 * 60 * 1000;
httpServer.headersTimeout = 15 * 60 * 1000 + 5000; // debe ser mayor que keepAliveTimeout, por requerimiento de Node.js

// Presencia en tiempo real (ver lib/presence.ts) — qué usuarios tienen
// Maris AI abierto AHORA MISMO, no solo cuándo entraron por última vez.
// Autenticación real con el mismo mecanismo que el resto de la API
// (Clerk) — el cliente manda su token de sesión en el handshake
// (socket.handshake.auth.token), se verifica aquí con verifyToken antes
// de aceptar la conexión, igual que requireAuth ya hace para rutas HTTP
// normales (lib/auth.ts) — ningún socket queda sin autenticar.
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [
      "https://www.marisai.es",
      "https://marisai.es",
      /\.marisai\.es$/,
    ],
    credentials: true,
  },
});

// ENCONTRADO en producción (reportado por el usuario: "Error de
// autenticación — el sistema de autenticación no pudo cargarse" en el
// navegador, junto con GET .../socket.io/... 400 (Bad Request) visible en
// la consola): verifyToken() de Clerk SIN la opción `jwtKey` verifica el
// JWT contactando a la API de Clerk para obtener las claves públicas
// (JWKS) — documentado oficialmente como "Networkless if jwtKey is
// provided. Otherwise, performs a network call." Esa respuesta SÍ se
// cachea en memoria del proceso (ver @clerk/backend/dist —
// loadClerkJWKFromRemote + cacheHasExpired), pero la caché se vacía en
// cada reinicio del proceso — justo después de cada deploy en Railway,
// las primeras conexiones de socket dependen de esa llamada de red real
// a Clerk, y un fallo o lentitud puntual ahí (red, rate limit, hiccup del
// lado de Clerk) tumba la conexión con un 400 sin que el código tenga
// ningún defecto en sí. FIX: reintento con backoff corto SOLO para
// fallos que parecen de red/disponibilidad (no para un token
// genuinamente inválido/expirado, que debe rechazarse de inmediato sin
// reintentar) — da una segunda oportunidad real a la llamada antes de
// rechazar la conexión.
async function verifySocketToken(token: string): Promise<string | null> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
      return payload.sub || null;
    } catch (err: any) {
      // Un error de firma/expiración/formato es un rechazo LEGÍTIMO — no
      // tiene sentido reintentar algo que va a fallar siempre igual.
      const msg = String(err?.message || err?.reason || "");
      const looksLikeRealRejection = /expired|invalid signature|malformed|not active yet/i.test(msg);
      if (looksLikeRealRejection || attempt === MAX_ATTEMPTS) {
        logger.warn({ err, attempt }, "Presence socket auth failed");
        return null;
      }
      // Fallo probablemente transitorio (red/JWKS) — pequeño backoff antes
      // de reintentar, sin bloquear el event loop más de lo necesario.
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  return null;
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token || typeof token !== "string") {
    return next(new Error("Authentication error: token required"));
  }
  const userId = await verifySocketToken(token);
  if (!userId) {
    return next(new Error("Authentication error: invalid token"));
  }
  socket.data.userId = userId;
  next();
});

attachPresenceHandlers(io);
 
httpServer.listen(finalPort, async (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
 
  logger.info({ port: finalPort }, "Server listening v2.1.0 (Testing Agent Active)");
 
  // 0) Connect to MongoDB before anything else.
  try {
    await connectDB();
    logger.info("MongoDB connected successfully");
  } catch (dbErr) {
    logger.error({ err: dbErr }, "Failed to connect to MongoDB — exiting");
    process.exit(1);
  }
 
  // 1) Start the in-process job queue (MongoDB-backed polling loop).
  // 2) Register the worker so this process picks up jobs.
  // 3) Reclaim orphaned jobs from previous boots.
  try {
    await startQueue();
    await registerGenerateWorker(runJobById);
  } catch (queueErr) {
    logger.error(
      { err: queueErr },
      "Failed to start job queue — generations will run in-process",
    );
  }
 
  reclaimOrphanedJobs().catch((reclaimErr) => {
    logger.error({ err: reclaimErr }, "Orphan job reclaim failed");
  });
 
  // 4) Self-monitor — periodic state sync and optimizer events.
  try {
    startSelfMonitor();
  } catch (selfErr) {
    logger.error({ err: selfErr }, "Failed to start self-monitor");
  }

  // 5) App Health Monitor — auto-reparación continua de apps generadas.
  try {
    startAppHealthMonitor();
  } catch (healthErr) {
    logger.error({ err: healthErr }, "Failed to start AppHealthMonitor");
  }

  // 6) AI Autopilot — monitor de salud, auto-fix, resumen diario.
  try {
    // Primer tick inmediato, luego cada 5 minutos
    runAutopilotTick().catch(() => {});
    setInterval(() => runAutopilotTick().catch(() => {}), 5 * 60 * 1000);
    logger.info("AI Autopilot started (health monitor, auto-fix, daily summary)");
  } catch (autopilotErr) {
    logger.error({ err: autopilotErr }, "Failed to start AI Autopilot");
  }

  // 6b) Recurring Billing (Viva.com) — cobro mensual de suscripciones.
  // A diferencia de Stripe, Viva.com no cobra suscripciones solo: cada
  // cuota es una llamada nuestra (ver lib/recurringBilling.ts). Cada hora
  // es suficiente margen frente a la ventana de renovación de 24h sin
  // sobrecargar la API de Viva con comprobaciones innecesarias.
  try {
    runRecurringBillingTick().catch((err) => logger.error({ err }, "Recurring billing initial tick failed"));
    const recurringInterval = setInterval(
      () => runRecurringBillingTick().catch((err) => logger.error({ err }, "Recurring billing tick failed")),
      60 * 60 * 1000,
    );
    recurringInterval.unref();
    logger.info("Recurring Billing (Viva.com) started — hourly tick");
  } catch (recurringErr) {
    logger.error({ err: recurringErr }, "Failed to start Recurring Billing");
  }

  // IndexNow — notificar a Bing/DuckDuckGo/Yandex/Ecosia de todas las URLs
  // Se ejecuta al arrancar el servidor en producción
  if (process.env.NODE_ENV === "production") {
    setTimeout(() => {
      submitIndexNow().catch(() => {});
    }, 10000); // 10s delay para que el servidor esté completamente listo
  }
 
  // 5) Best-effort Redis ping at boot.
  if (isRedisConfigured()) {
    pingRedis()
      .then((result) => {
        if (result.ok) {
          logger.info(
            { latencyMs: result.latencyMs },
            "Redis ping ok",
          );
        } else {
          logger.warn({ err: result.error }, "Redis ping failed at boot");
        }
      })
      .catch((pingErr) => {
        logger.warn({ err: pingErr }, "Redis ping threw at boot");
      });
  } else {
    logger.info("Redis not configured (REDIS_URL unset) — skipping ping");
  }
 
  // 6) Periodic orphan job sweep every 1 minute (reduced from 2 for faster zombie detection).
  const RECLAIM_SWEEP_MS = Number(process.env.RECLAIM_SWEEP_MS) || 1 * 60 * 1000;
  const sweep = setInterval(() => {
    reclaimOrphanedJobs().catch((reclaimErr) => {
      logger.warn({ err: reclaimErr }, "Periodic orphan job reclaim failed");
    });
  }, RECLAIM_SWEEP_MS);
  sweep.unref();
});
 
// Graceful shutdown
const shutdown = async (signal: NodeJS.Signals) => {
  logger.info({ signal }, "Shutting down — stopping job queue");
  await stopQueue();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
 
