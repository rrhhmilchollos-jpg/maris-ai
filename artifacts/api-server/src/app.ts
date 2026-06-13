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
import { stripeWebhookRouter } from "./routes/stripeWebhook";
import publicDeployRouter from "./routes/publicDeploy";
import botRenderRouter from "./routes/botRender";
import adminRouter from "./routes/admin";
import { logger } from "./lib/logger";
import clerkWebhookRouter from "./routes/clerkWebhook";
import { initSentry, isSentryEnabled, Sentry, addBreadcrumb } from "./lib/sentry";
import { apiRateLimiter } from "./middlewares/rateLimit";
import { metricsMiddleware } from "./lib/metrics";
import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
 
initSentry();
 
const app: Express = express();
 
// Behind the reverse proxy — trust one hop so req.ip is the real client IP
// and the rate-limiter buckets correctly.
app.set("trust proxy", 1);
 
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
          // Facebook Pixel
          "https://connect.facebook.net",
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
    xFrameOptions: false,
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
// Con credentials:true, permitir CUALQUIER origen (origin:'*') es un riesgo
// de CORS+CSRF: un sitio malicioso podría hacer fetch con credentials:'include'
// y, si el navegador adjunta cookies de sesión de Clerk, leer respuestas con
// datos del usuario. Restringimos a los dominios legítimos de Maris AI:
// - marisai.es / www.marisai.es (frontend de producción)
// - *.vercel.app (previews de Vercel del propio appforge y de apps generadas)
// - *.railway.app (backend y posibles previews)
// - localhost / 127.0.0.1 (desarrollo local)
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
    // Peticiones sin origin (curl, server-to-server, healthchecks) se permiten.
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
// Adjusted to be more permissive while maintaining isolation
app.use((_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Anti-hacking: NoSQL injection + HTTP Parameter Pollution protection ────
// express-mongo-sanitize: elimina claves que empiecen por '$' o contengan '.'
// en req.body/query/params, evitando inyecciones de operadores Mongo
// (ej: {"email": {"$ne": null}} para bypass de autenticación).
app.use(
  mongoSanitize({
    replaceWith: "_",
    onSanitize: ({ req, key }) => {
      logger.warn({ path: req.path, key, ip: req.ip }, "mongoSanitize: clave sospechosa eliminada");
    },
  }),
);
// hpp: si un atacante envía el mismo parámetro de query repetido
// (?id=1&id=2), express normalmente lo convierte en array — hpp se
// queda con el último valor para evitar bypasses de validación.
app.use(hpp());
 
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
 
// Per-request Sentry breadcrumb — records method, path, status, duration.
// No-op if Sentry is not configured.
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
 
// Dynamic rendering for search engine bots (Googlebot, Bingbot, etc.)
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
