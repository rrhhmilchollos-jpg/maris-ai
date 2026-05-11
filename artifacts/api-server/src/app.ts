import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { stripeWebhookRouter } from "./routes/stripeWebhook";
import publicDeployRouter from "./routes/publicDeploy";
import { logger } from "./lib/logger";
import { initSentry, isSentryEnabled, Sentry, addBreadcrumb } from "./lib/sentry";
import { apiRateLimiter } from "./middlewares/rateLimit";
import { metricsMiddleware } from "./lib/metrics";
import adminExtendedRouter from "./routes/adminExtended";

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

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Stripe webhook needs the raw body — mount BEFORE express.json()
app.use("/api/billing/webhook", stripeWebhookRouter);

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

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

app.use("/api", router);

// El router principal (router) ya incluye adminRouter y adminExtendedRouter bajo /api
// No es necesario montarlos de nuevo aquí si ya están en ./routes/index.ts

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
