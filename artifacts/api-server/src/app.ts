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

initSentry();

const app: Express = express();

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

// Per-request Sentry breadcrumb. Records the incoming request (method, path,
// status, duration) so when a downstream error is captured, the Sentry event
// includes a timeline of the user's recent navigation. No-op if Sentry is
// not configured. Mounted right before the API router so we capture the auth
// context already attached by clerkMiddleware.
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

app.use("/api", router);

// Public unauthenticated route for deployed Maris AI apps. Mounted on the root
// (outside /api) so /p/<slug> resolves on the published domain directly.
app.use(publicDeployRouter);

// Sentry error capture middleware. Must come AFTER all routes so Express
// forwards the error here, but BEFORE the final JSON error responder.
app.use((err: unknown, req: Request, _res: Response, next: NextFunction) => {
  if (isSentryEnabled()) {
    try {
      Sentry.withScope((scope) => {
        scope.setTag("path", req.path);
        scope.setTag("method", req.method);
        const userId = (req as Request & { dbUser?: { id?: string } }).dbUser?.id;
        if (userId) scope.setUser({ id: userId });
        Sentry.captureException(err);
      });
    } catch {
      // ignore monitoring errors
    }
  }
  next(err);
});

export default app;
