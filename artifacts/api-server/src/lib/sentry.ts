import * as Sentry from "@sentry/node";
import { logger } from "./logger";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN_API;
  if (!dsn) {
    logger.warn(
      "SENTRY_DSN_API not set — Sentry disabled (errors will only appear in server logs).",
    );
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      return event;
    },
  });
  initialized = true;
  logger.info("Sentry initialized for api-server");
}

export function isSentryEnabled(): boolean {
  return initialized;
}

type CaptureExtras = Record<string, unknown>;

export function captureAgentError(
  err: unknown,
  context: {
    jobId?: number;
    appId?: number;
    userId?: string;
    phase: string;
    extra?: CaptureExtras;
  },
): void {
  if (!initialized) return;
  try {
    Sentry.withScope((scope) => {
      scope.setTag("phase", context.phase);
      if (context.jobId !== undefined) scope.setTag("jobId", String(context.jobId));
      if (context.appId !== undefined) scope.setTag("appId", String(context.appId));
      if (context.userId) scope.setUser({ id: context.userId });
      if (context.extra) scope.setExtras(context.extra);
      Sentry.captureException(err);
    });
  } catch {
    // Never let monitoring crash the pipeline.
  }
}

export function addBreadcrumb(message: string, data?: CaptureExtras): void {
  if (!initialized) return;
  try {
    Sentry.addBreadcrumb({
      category: "agent",
      level: "info",
      message,
      data,
    });
  } catch {
    // ignore
  }
}

export { Sentry };
