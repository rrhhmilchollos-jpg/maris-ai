import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import ticketsRouter from "./routes/tickets";
import newsRouter from "./routes/news";
import rssRouter from "./routes/rss";
import newsSitemapRouter from "./routes/news-sitemap";
import sitemapRouter from "./routes/sitemap";
import videoRouter from "./routes/video";
import watermarkRouter from "./routes/watermark";
import { vivaWebhookRouter } from "./routes/vivaWebhook";
import { stripeWebhookRouter } from "./routes/stripeWebhook";
import publicDeployRouter from "./routes/publicDeploy";
import botRenderRouter from "./routes/botRender";
import adminRouter from "./routes/admin";
import { logger } from "./lib/logger";
import clerkWebhookRouter from "./routes/clerkWebhook";
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
          "https://cdn.tailwindcss.com",
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
          "https://maris-ai-api-server-production-fbad.up.railway.app",
          "https://*.railway.app",
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
          "https://*.railway.app",
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
    xFrameOptions: { action: "sameorigin" }, // ✅ FIX: era `false`, ahora bloquea clickjacking
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

// Stripe webhook needs the raw body — mount BEFORE express.json()
app.use("/api/billing/webhook", stripeWebhookRouter);
 
// ── CORS — anti-hacking: allowlist en vez de "allow all" ───────────────────
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https?:\/\/(www\.)?marisai\.es$/,
  /^https?:\/\/[a-z0-9-]+\.marisai\.es$/,
  /^https?:\/\/([a-z0-9-]+\.)*vercel\.app$/,
  /^https?:\/\/([a-z0-9-]+\.)*railway\.app$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

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
 
if (process.env.CLERK_PUBLISHABLE_KEY || process.env.CLERK_SECRET_KEY) {
  app.use(
    clerkMiddleware({
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    }),
  );
} else {
  logger.warn("Clerk keys not set — Authentication will be disabled or fail.");
}
 
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
 
// Clerk webhook — sin auth, con firma propia
app.use("/api", clerkWebhookRouter);
app.use("/api", router);
app.use("/api", ticketsRouter);
app.use("/api", newsRouter);
app.use("/api", adminRouter);
app.use("/", rssRouter);
app.use("/", newsSitemapRouter);
app.use("/", sitemapRouter);
app.use("/api", videoRouter);
app.use("/api", watermarkRouter);
app.use("/api", vivaWebhookRouter);

// Dynamic rendering for search engine bots (Googlebot, Bingbot, etc.)
// ENCONTRADO: botRenderRouter define páginas HTML estáticas completas en
// rutas /bot-render/... (con meta tags, JSON-LD, contenido sin depender de
// JS) — pero nunca existía ninguna detección de User-Agent que conectara
// esas rutas con las URLs REALES que Googlebot visita (/news, /pricing...).
// Confirmado en Search Console: "/news" rechazada en la prueba de versión
// publicada — el HTML real servido en esa URL depende de JS para mostrar
// el contenido ("Cargando Maris AI..." visible en el HTML estático), justo
// el síntoma que este sistema fue construido para evitar, sin llegar a
// conectarse nunca. Mapeo explícito y de mantenimiento bajo: solo las
// rutas que realmente tienen una versión /bot-render/... equivalente.
const BOT_USER_AGENT_PATTERN = /googlebot|bingbot|yandex|baiduspider|duckduckbot|slurp|facebookexternalhit|twitterbot|linkedinbot|discordbot|whatsapp/i;
const BOT_RENDER_ROUTE_MAP: Record<string, string> = {
  "/": "/bot-render/",
  "/pricing": "/bot-render/pricing",
  "/vs-emergent": "/bot-render/vs-emergent",
  "/news": "/bot-render/news",
};
app.use((req, res, next) => {
  const ua = req.headers["user-agent"] || "";
  if (!BOT_USER_AGENT_PATTERN.test(ua)) return next();

  const newsArticleMatch = req.path.match(/^\/news\/([^/]+)$/);
  if (newsArticleMatch) {
    req.url = `/bot-render/news/${newsArticleMatch[1]}`;
    return next();
  }
  const mapped = BOT_RENDER_ROUTE_MAP[req.path];
  if (mapped) {
    req.url = mapped;
  }
  next();
});
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
