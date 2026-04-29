import * as Sentry from "@sentry/react";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN_WEB as string | undefined;
  if (!dsn) {
    if (import.meta.env.DEV) {
      console.warn(
        "[sentry] VITE_SENTRY_DSN_WEB no configurado — telemetría desactivada en frontend.",
      );
    }
    return;
  }
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Enable the default breadcrumb integrations explicitly so we record the
    // user's behaviour leading up to an error: every fetch/XHR call (which
    // covers all our React Query calls to /api), every console.error, every
    // page navigation, and every relevant click. This is what gives Sentry
    // events an actionable "what was the user doing" timeline.
    integrations: [
      Sentry.breadcrumbsIntegration({
        console: true,
        dom: true,
        fetch: true,
        history: true,
        xhr: true,
      }),
    ],
  });
  initialized = true;
}

export function addBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!initialized) return;
  try {
    Sentry.addBreadcrumb({
      category: "app",
      level: "info",
      message,
      data,
    });
  } catch {
    /* monitoring must never crash the app */
  }
}

export function setSentryUser(user: { id: string; email?: string } | null): void {
  if (!initialized) return;
  if (user) {
    Sentry.setUser({ id: user.id, email: user.email });
  } else {
    Sentry.setUser(null);
  }
}

export { Sentry };
