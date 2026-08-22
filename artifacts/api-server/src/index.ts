import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { verifySessionToken } from "./lib/session";
import app from "./app";
import { logger } from "./lib/logger";
import { reclaimOrphanedJobs, runJobById } from "./routes/apps";
import { startQueue, registerGenerateWorker, stopQueue } from "./lib/jobQueue";
import { startSelfMonitor } from "./lib/selfMonitor";
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
// Coolify con responseTime de 292507ms y 300010ms (este último abortado).
// Coolify corta conexiones a los 5 minutos por defecto (su límite máximo
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
// cada reinicio del proceso — justo después de cada deploy en Coolify,
// las primeras conexiones de socket dependen de esa llamada de red real
// a Clerk, y un fallo o lentitud puntual ahí (red, rate limit, hiccup del
// lado de Clerk) tumba la conexión con un 400 sin que el código tenga
// ningún defecto en sí. FIX: reintento con backoff corto SOLO para
// fallos que parecen de red/disponibilidad (no para un token
// genuinamente inválido/expirado, que debe rechazarse de inmediato sin
// reintentar) — da una segunda oportunidad real a la llamada antes de
// rechazar la conexión.
async function verifySocketToken(token: string): Promise<string | null> {
  // Con la sesión propia (JWT firmado con AUTH_SECRET, ver lib/session.ts)
  // la verificación es 100% local — no hay llamada de red a un proveedor
  // externo, así que ya no aplica el reintento por fallos de red que sí
  // hacía falta con Clerk (JWKS remoto).
  const session = await verifySessionToken(token);
  if (!session) {
    logger.warn("Presence socket auth failed: invalid or expired session token");
    return null;
  }
  return session.userId;
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
 
  logger.info({ port: finalPort }, "Server listening v2.1.0 (Testing Agent: reparación solo por error verificable)");
 
  // 0) Connect to MongoDB before anything else.
  try {
    await connectDB();
    logger.info("MongoDB connected successfully");
  } catch (dbErr) {
    logger.error({ err: dbErr }, "Failed to connect to MongoDB — exiting");
    process.exit(1);
  }
 
  // 1) Start the queue connection (needed to enqueue jobs from HTTP routes,
  //    e.g. POST /api/apps).
  // 2) Registering as a WORKER (picking up and running jobs) is intentionally
  //    NOT done here anymore. worker.ts (deployed as its own Coolify service,
  //    "maris-ai-worker") is the one dedicated process for that. This
  //    api-server used to also self-register as a worker from back when
  //    there was only one process — after the split, that line never got
  //    removed, so both services were consuming the same BullMQ queue at
  //    once (2x the intended concurrency, and generation work competing
  //    with HTTP traffic for CPU on the api-server). Opt back in with
  //    ENABLE_INPROCESS_WORKER=true only for local/single-process setups
  //    that don't run a separate worker deployment.
  // 3) Reclaim orphaned jobs from previous boots.
  try {
    await startQueue();
    if (process.env.ENABLE_INPROCESS_WORKER === "true") {
      logger.warn(
        "ENABLE_INPROCESS_WORKER=true — este api-server también va a procesar jobs de generación. " +
          "Si ya tienes el servicio maris-ai-worker corriendo aparte, quita esta env var.",
      );
      await registerGenerateWorker(runJobById);
    }
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

  // La salud de las apps se observa de manera no destructiva en los jobs y
  // en los diagnósticos manuales. Nunca se inicia un auto-fix desde el arranque:
  // solo el CoreOrchestrator puede pedir al Testing Agent una reparación de un
  // error reproducible sobre un bundle completo.
  logger.info("App Health auto-fix y AI Autopilot de reparación desactivados — reparación exclusiva bajo CoreOrchestrator");

  // Stripe es la única vía de cobro. No se ejecuta ningún cargo recurrente
  // desde el servidor ni se inicia la integración heredada de Viva.com.
  logger.info("Recurring Billing heredado desactivado — los créditos solo se acreditan por webhook Stripe verificado");

  // 6b-2) Política comercial: no se conceden ni renuevan créditos de forma
  // automática. Cualquier compensación exige un ticket de soporte y una
  // aprobación humana explícita; no existe un job que pueda saltarse esa puerta.
  logger.info("Automatic credit grants disabled — manual support approval required");

  // 6b-3) Aviso de renovación próxima de plan (48h) — notificación al
  // CLIENTE (campanita/UserNotification), no a los admins. Mismo patrón
  // que el tick de arriba, cada hora es de sobra para una ventana de 48h.
  try {
    const { runExpirationNotificationsTick } = await import("./lib/notificationService");
    runExpirationNotificationsTick().catch((err) => logger.error({ err }, "Expiration notifications initial tick failed"));
    const expirationInterval = setInterval(
      () => runExpirationNotificationsTick().catch((err) => logger.error({ err }, "Expiration notifications tick failed")),
      60 * 60 * 1000,
    );
    expirationInterval.unref();
    logger.info("Expiration Notifications started — hourly tick");
  } catch (expirationErr) {
    logger.error({ err: expirationErr }, "Failed to start Expiration Notifications");
  }

  // 6b-4) Caducidad de créditos de recarga (30 días) — a petición
  // explícita del usuario, cambio de política (antes "no caducan nunca").
  try {
    const { runTopUpExpirationTick } = await import("./lib/credits");
    runTopUpExpirationTick().catch((err) => logger.error({ err }, "Top-up expiration initial tick failed"));
    const topUpExpirationInterval = setInterval(
      () => runTopUpExpirationTick().catch((err) => logger.error({ err }, "Top-up expiration tick failed")),
      60 * 60 * 1000,
    );
    topUpExpirationInterval.unref();
    logger.info("Top-up Credit Expiration started — hourly tick");
  } catch (topUpExpirationErr) {
    logger.error({ err: topUpExpirationErr }, "Failed to start Top-up Credit Expiration");
  }

  // 6c) Emails de reactivación automática — una vez al día a las 10:00h España.
  // Envía emails personalizados a clientes inactivos (3, 7, 14 y 30 días).
  // Activa con: REACTIVATION_EMAILS_ENABLED=true en Coolify.
  try {
    const { runReactivationTick } = await import("./lib/reactivationEmails");
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setUTCHours(9, 0, 0, 0); // 10:00 Madrid (UTC+1 en invierno, UTC+2 en verano)
    if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
    const msUntilFirst = nextRun.getTime() - now.getTime();
    setTimeout(() => {
      runReactivationTick().catch((err) => logger.error({ err }, "Reactivation tick failed"));
      setInterval(
        () => runReactivationTick().catch((err) => logger.error({ err }, "Reactivation tick failed")),
        24 * 60 * 60 * 1000,
      ).unref();
    }, msUntilFirst).unref();
    logger.info({ nextRunAt: nextRun.toISOString(), enabled: process.env.REACTIVATION_EMAILS_ENABLED === "true" }, "Reactivation emails scheduler ready");
  } catch (reactivationErr) {
    logger.error({ err: reactivationErr }, "Failed to start Reactivation Emails");
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
 
