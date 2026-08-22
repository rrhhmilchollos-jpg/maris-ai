import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import router from "./routes";
import authRoutes from "./routes/authRoutes";
import ticketsRouter from "./routes/tickets";
import reviewsRouter from "./routes/reviews";
import newsRouter from "./routes/news";
import rssRouter from "./routes/rss";
import newsSitemapRouter from "./routes/news-sitemap";
import sitemapRouter from "./routes/sitemap";
import videoRouter from "./routes/video";
import watermarkRouter from "./routes/watermark";
import mcpIntegrationsRouter from "./routes/mcpIntegrations";
import connectorsRouter from "./routes/connectors";
import workflowsRouter from "./routes/workflows";
import stressTestRouter from "./routes/stressTest";
import coolifyDeployRouter from "./routes/coolifyDeploy";
import { stripeCreditsWebhookHandler } from "./routes/stripeCreditsWebhook";
import publicDeployRouter from "./routes/publicDeploy";
import botRenderRouter from "./routes/botRender";
import adminRouter from "./routes/admin";
import demoRouter from "./routes/demo";
import affiliatesRouter from "./routes/affiliates";
import spaxAuthProxyRouter from "./routes/spaxAuthProxy";
import { logger } from "./lib/logger";
import { initSentry, isSentryEnabled, Sentry, addBreadcrumb } from "./lib/sentry";
import { apiRateLimiter } from "./middlewares/rateLimit";
import {
  ipBlockMiddleware,
  honeypotMiddleware,
  antiScrapingMiddleware,
  injectionDetectionMiddleware,
  securityHeadersMiddleware,
  codeExfiltrationMiddleware,
  getSecurityStats,
  unblockIP,
  blockIP,
} from "./middlewares/security";
import { metricsMiddleware } from "./lib/metrics";
import mongoSanitize from "express-mongo-sanitize";
 
initSentry();
 
const app: Express = express();
 
// Behind the reverse proxy — trust one hop so req.ip is the real client IP
// and the rate-limiter buckets correctly.
app.set("trust proxy", 1);

// ─── Security middlewares — ejecutan ANTES que todo lo demás ─────────────────
// 1. Bloquear IPs ya conocidas como maliciosas (check inmediato, sin proceso)
app.use(ipBlockMiddleware);
// 2. Honeypots — rutas trampa para detectar atacantes
app.use(honeypotMiddleware);
// 3. Anti-scraping — detectar bots no autorizados
app.use(antiScrapingMiddleware);
// 4. Headers de seguridad adicionales
app.use(securityHeadersMiddleware);
 
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
 
// ── Security Headers (Helmet) ─────────────────────────────────────────────
// Protects against XSS, clickjacking, MIME sniffing, and other common attacks.
// CSP is relaxed to allow Clerk, Stripe, and our CDN assets.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://clerk.marisai.es",
          "https://*.clerk.accounts.dev",
          "https://*.clerk.com",
          "https://js.stripe.com",
          "https://cdn.jsdelivr.net",
          "https://fonts.googleapis.com",
          // Google Analytics & Ads
          "https://www.googletagmanager.com",
          "https://www.google-analytics.com",
          "https://region1.google-analytics.com",
          "https://ssl.google-analytics.com",
          "https://www.google.com",
          "https://googleads.g.doubleclick.net",
          "https://static.doubleclick.net",
          "https://www.googleadservices.com",
          "https://pagead2.googlesyndication.com",
          // Facebook Pixel
          "https://connect.facebook.net",
          // TikTok Pixel
          "https://analytics.tiktok.com",
          "https://*.tiktok.com",
          "https://*.tiktokcdn.com",
          // Vercel
          "https://vercel.live",
          "https://*.vercel.live",
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:", "http:"],
        connectSrc: [
          "'self'",
          "https://api.marisai.es",
          "https://www.marisai.es",
          "https://api.marisai.es",
          "https://*.marisai.es",
          "https://*.clerk.com",
          "https://*.clerk.accounts.dev",
          "https://clerk.marisai.es",
          "https://*.stripe.com",
          "https://api.resend.com",
          // Google Analytics & Ads
          "https://www.google-analytics.com",
          "https://region1.google-analytics.com",
          "https://stats.g.doubleclick.net",
          "https://googleads.g.doubleclick.net",
          "https://www.googletagmanager.com",
          // Facebook
          "https://www.facebook.com",
          "https://connect.facebook.net",
          // TikTok
          "https://analytics.tiktok.com",
          "https://*.tiktok.com",
          "https://*.tiktokcdn.com",
          "https://log.tiktokv.com",
          "wss:",
          "ws:",
        ],
        fontSrc: ["'self'", "data:", "https:", "https://fonts.gstatic.com"],
        frameSrc: [
          "'self'",
          "https://js.stripe.com",
          "https://hooks.stripe.com",
          "https://marisai.es",
          "https://*.marisai.es",
          "https://*.vercel.app",
          "https://*.vercel.live",
          "https://*.webcontainer.io",
          "https://*.webcontainer-api.io",
          "https://*.local.webcontainer.io",
          "https://*.clerk.accounts.dev",
          "https://*.clerk.com",
          "https://clerk.marisai.es",
          // Google & Facebook iframes de tracking
          "https://www.googletagmanager.com",
          "https://td.doubleclick.net",
          "https://www.facebook.com",
          "https://accounts.google.com",
        ],
        // ✅ FIX CLICKJACKING: solo marisai.es puede embeber estas páginas
        frameAncestors: ["'self'", "https://marisai.es", "https://*.marisai.es"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // Disabled: required for WebContainers
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xContentTypeOptions: true,
    xFrameOptions: false, // Permitir iframes (protegido por frameAncestors en CSP)
    xXssProtection: true,
    hidePoweredBy: true,
  })
);

// ── Anti-phishing: block suspicious User-Agent patterns ────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const ua = req.headers["user-agent"] || "";
  // Block known scanner/exploit tools
  const blockedPatterns = [
    /sqlmap/i,
    /nikto/i,
    /masscan/i,
    /zgrab/i,
    /python-requests\/[01]\./i, // old python-requests versions used in attacks
    /go-http-client\/1\.0/i,
    /\bscanner\b/i,
    /\bexploit\b/i,
  ];
  if (blockedPatterns.some((p) => p.test(ua))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
});

// ENCONTRADO: el webhook de Stripe ya no se monta — Maris AI migró por
// completo de Stripe a Viva.com como pasarela de pago (a petición explícita
// del usuario, su cuenta bancaria real). El webhook equivalente de Viva
// (vivaWebhookRouter, ya montado más abajo en este archivo) cubre ahora
// top-ups, suscripciones y eliminación de marca de agua.
 
// ── CORS — anti-hacking: allowlist en vez de "allow all" ───────────────────
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https?:\/\/(www\.)?marisai\.es$/,
  /^https?:\/\/[a-z0-9-]+\.marisai\.es$/,
  /^https?:\/\/([a-z0-9-]+\.)*vercel\.app$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

// La vista previa de SPAX se ejecuta en un iframe con origen opaco. Solo el
// formulario público de colaboración necesita completar su preflight desde
// ese contexto; no se abre CORS para rutas autenticadas ni otros endpoints.
app.use((req: Request, res: Response, next: NextFunction) => {
  const isSpaxCollaborationPreflight = req.method === "OPTIONS"
    && req.path === "/api/spax-auth/collaboration-requests"
    && req.headers.origin === "null";
  if (!isSpaxCollaborationPreflight) return next();
  res.setHeader("Access-Control-Allow-Origin", "null");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
  return res.status(204).send();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) { callback(null, true); return; }
    if (ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin))) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
}));

// Security headers for Cross-Origin Isolation (required for WebContainers)
app.use((_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  next();
});

// Stripe exige el cuerpo crudo exacto para validar la firma del webhook.
// Debe ejecutarse antes del parser JSON y nunca acredita créditos desde el navegador.
app.post("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), stripeCreditsWebhookHandler);
app.use(express.json({ limit: "2mb" }));
// 5. Detección de inyección NoSQL/XSS en body/query (necesita body parseado)
app.use(injectionDetectionMiddleware);
app.use(express.urlencoded({ extended: true }));

// ── Anti-hacking: NoSQL injection + HTTP Parameter Pollution protection ────
function logSuspiciousKey(req: Request, key: string) {
  logger.warn({ path: req.path, key, ip: req.ip }, "mongoSanitize: clave sospechosa eliminada");
}
app.use((req: Request, _res: Response, next: NextFunction) => {
  const opts = { replaceWith: "_" };
  for (const key of ["body", "params"] as const) {
    const val = req[key];
    if (val && typeof val === "object") {
      if (mongoSanitize.has(val)) logSuspiciousKey(req, key);
      req[key] = mongoSanitize.sanitize(val, opts);
    }
  }
  for (const key of ["query", "headers"] as const) {
    const val = req[key];
    if (val && typeof val === "object") {
      if (mongoSanitize.has(val)) logSuspiciousKey(req, key);
      mongoSanitize.sanitize(val, opts); // muta in-place, sin reasignar (getter en Express 5)
    }
  }
  next();
});
 
// Sustituye al clerkMiddleware: parsea la cookie httpOnly de sesión propia
// (ver lib/session.ts) que requireAuth() lee en cada ruta protegida.
app.use(cookieParser());
if (!process.env.AUTH_SECRET) {
  logger.warn("AUTH_SECRET not set — session signing will fail.");
}
app.use("/api/auth", authRoutes);
 
// Per-request Sentry breadcrumb
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!isSentryEnabled()) {
    next();
    return;
  }
  const start = Date.now();
  res.on("finish", () => {
    addBreadcrumb(`${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
});
 
// Global API rate limit (per IP / per Clerk userId once authenticated).
app.use("/api", apiRateLimiter);
// 6. Detección de exfiltración masiva de código
app.use("/api", codeExfiltrationMiddleware);
 
// In-memory request/error/duration counters for /api/admin/metrics.
app.use("/api", metricsMiddleware);
 
// Servicio de identidad de SPAX: proxy limitado a un backend y base de datos propios.
// Se monta tras las capas globales de seguridad, rate limiting y saneado.
app.use("/api/spax-auth", spaxAuthProxyRouter);

// Clerk webhook — sin auth, con firma propia
app.use("/api", router);
app.use("/api", ticketsRouter);
app.use("/api", reviewsRouter);
app.use("/api", newsRouter);
app.use("/api", adminRouter);
// Demo pública — sin autenticación, accesible para visitantes no registrados
app.use("/api/demo", demoRouter);
// Programa de afiliados — rutas públicas y autenticadas
app.use("/api/affiliates", affiliatesRouter);
app.use("/", rssRouter);
app.use("/", newsSitemapRouter);
app.use("/", sitemapRouter);
app.use("/api", videoRouter);
app.use("/api", watermarkRouter);
app.use("/api", mcpIntegrationsRouter);
app.use("/api", connectorsRouter);
app.use("/api", workflowsRouter);
app.use("/api", stressTestRouter);
app.use("/api", coolifyDeployRouter);
// Viva está desactivado: Stripe Checkout y su webhook firmado son la única vía de pago de créditos.

// Dynamic rendering for search engine bots (Googlebot, Bingbot, etc.)
// NOTA — este sistema (mapeo de User-Agent → /bot-render/...) se ha retirado
// del flujo de peticiones. Aunque ahora /api/* SÍ está correctamente
// proxeado desde www.marisai.es hacia este servidor, las páginas que este
// middleware intentaba cubrir (/, /pricing, /news, /vs-emergent...) NUNCA
// llegan aquí: Vercel las sirve como archivos HTML estáticos generados en
// build time por artifacts/appforge/prerender.mjs, directamente desde su
// CDN, antes de que la petición pueda alcanzar el servidor Coolify. Ese sistema es
// además la mejor solución de las dos — no depende de mantener una lista
// de User-Agents de bots, funciona igual para cualquier crawler (incluidos
// los que no están en esa lista) y no añade latencia de red.
//
// Las rutas /bot-render/... del router siguen existiendo (botRenderRouter,
// más abajo) por si se necesitan en el futuro, pero no se enruta tráfico
// real hacia ellas.
app.use(botRenderRouter);
 
// Public unauthenticated route for deployed Maris AI apps (/p/<slug>).
app.use(publicDeployRouter);
 
// Sentry error capture middleware — must come AFTER all routes.
app.use((err: unknown, req: Request, _res: Response, next: NextFunction) => {
  if (isSentryEnabled()) {
    try {
      Sentry.withScope((scope) => {
        scope.setTag("path", req.path);
        scope.setTag("method", req.method);
        const userId = (req as Request & { dbUser?: { _id?: string } }).dbUser?._id;
        if (userId) scope.setUser({ id: String(userId) });
        Sentry.captureException(err);
      });
    } catch {
      // ignore monitoring errors
    }
  }
  next(err);
});
 
// Final JSON error responder
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message =
    err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
});
 
export default app;
