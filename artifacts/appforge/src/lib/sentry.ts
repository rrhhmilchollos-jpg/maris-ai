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
    // Capturamos solo navegación; no clicks, consola, formularios ni llamadas
    // para que la telemetría no contenga contenido de clientes.
    integrations: [
      Sentry.breadcrumbsIntegration({
        console: false,
        dom: false,
        fetch: false,
        history: true,
        xhr: false,
      }),
    ],
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      if (event.request) delete event.request.data;
      delete event.user;
      return event;
    },
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
    Sentry.setUser({ id: user.id });
  } else {
    Sentry.setUser(null);
  }
}

export { Sentry };
