// Salud de interfaz: errores técnicos se reportan de forma minimizada y nunca se muestran al cliente.
import { Component, type ReactNode, type ErrorInfo, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { getApiUrl } from "@/lib/api-client";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorPathname: string | null; // ruta donde ocurrió el error
}

function fingerprintError(error: Error, pathname: string | undefined) {
  const source = `${error.name}|${error.message}|${pathname || ""}`;
  let value = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return `ui-${(value >>> 0).toString(36)}`;
}

/**
 * ErrorBoundary global de Maris AI.
 * Captura cualquier error de renderizado (incluyendo fallos de Clerk, imports dinámicos, etc.)
 * y muestra un mensaje útil en lugar de una pantalla en negro.
 *
 * IMPORTANTE: La detección de "error de Clerk" se basa en el mensaje y stack
 * del error. Sin embargo, errores de Socket.io/WebSocket pueden tener "clerk"
 * en su stack trace porque el scheduler de React (empaquetado en vendor-clerk)
 * es quien procesa el error. Por eso se excluyen explícitamente los errores
 * que mencionan "WebSocket" o "socket" en su mensaje — esos NO son errores
 * de autenticación reales.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorPathname: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      errorPathname: typeof window !== "undefined" ? window.location.pathname : null,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log al servidor de Sentry si está disponible
    try {
      if (typeof window !== "undefined" && (window as any).__sentry_init) {
        (window as any).__sentry_init?.captureException?.(error, {
          extra: { componentStack: info.componentStack },
        });
      }
    } catch (_) {}
    console.error("[Maris AI] Error crítico de renderizado:", error, info);

    // El cliente no necesita ver un stack trace. El backend recibe solo una
    // huella estable y el contexto mínimo necesario para agrupar incidencias.
    try {
      const pathname = typeof window !== "undefined" ? window.location.pathname : undefined;
      fetch(getApiUrl("/api/panel-error"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: fingerprintError(error, pathname),
          name: error.name || "RenderError",
          pathname,
          component: info.componentStack?.split("\n").find(Boolean)?.trim().slice(0, 180),
        }),
        keepalive: true,
      }).catch(() => { /* best-effort */ });
    } catch (_) { /* best-effort */ }
  }

  handleReload = () => {
    window.location.reload();
  };

  reset = () => {
    this.setState({ hasError: false, error: null, errorPathname: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorMsg = this.state.error?.message || "";
      // Excluir errores de WebSocket/Socket.io de ser clasificados como
      // errores de Clerk — estos errores pueden tener "clerk" en el stack
      // porque el bundle de vendor-clerk incluye el scheduler de React.
      const isSocketError =
        /websocket|socket\.io|socket/i.test(errorMsg) ||
        /WebSocket is closed/i.test(errorMsg);

      const isClerkError = !isSocketError && (
        errorMsg.includes("Clerk") ||
        errorMsg.includes("clerk") ||
        errorMsg.includes("publishableKey") ||
        errorMsg.includes("session")
      );

      return (
        <div
          style={{
            minHeight: "100vh",
            background: "hsl(240 10% 4%)",
            color: "hsl(0 0% 98%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            fontFamily: "Inter, system-ui, sans-serif",
            textAlign: "center",
          }}
        >
          {/* Logo */}
          <div style={{ marginBottom: "1.5rem" }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect width="48" height="48" rx="12" fill="hsl(272 72% 55%)" />
              <text x="24" y="32" textAnchor="middle" fill="white" fontSize="22" fontWeight="bold">M</text>
            </svg>
          </div>

          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              marginBottom: "0.75rem",
              color: "white",
            }}
          >
            {isClerkError ? "No se pudo recuperar tu sesión" : "Esta vista necesita recargarse"}
          </h1>

          <p
            style={{
              color: "hsl(240 5% 65%)",
              maxWidth: "400px",
              marginBottom: "1.5rem",
              lineHeight: 1.6,
            }}
          >
            {isClerkError
              ? "Tu trabajo guardado no se ha modificado. Recarga la página para recuperar la sesión de forma segura."
              : "Tu proyecto y la última versión sana siguen protegidos. Recarga esta vista para continuar."}
          </p>

          <button
            onClick={this.handleReload}
            style={{
              background: "hsl(272 72% 55%)",
              color: "white",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.2s",
            }}
            onMouseOver={(e) =>
              ((e.target as HTMLButtonElement).style.background = "hsl(272 72% 45%)")
            }
            onMouseOut={(e) =>
              ((e.target as HTMLButtonElement).style.background = "hsl(272 72% 55%)")
            }
          >
            Recargar página
          </button>

          <p
            style={{
              marginTop: "1rem",
              fontSize: "0.75rem",
              color: "hsl(240 5% 45%)",
            }}
          >
            Si el problema persiste, contacta con{" "}
            <a
              href="mailto:soporte@marisai.es"
              style={{ color: "hsl(272 72% 65%)", textDecoration: "none" }}
            >
              soporte@marisai.es
            </a>
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * RouteAwareErrorBoundary — wrapper que resetea automáticamente el
 * ErrorBoundary al cambiar de ruta. Esto evita que un error en la página A
 * muestre la pantalla de error al navegar a la página B, que puede ser
 * completamente válida.
 *
 * Uso: sustituye <ErrorBoundary> por <RouteAwareErrorBoundary> en main.tsx.
 */
export function RouteAwareErrorBoundary({ children, fallback }: Props) {
  const boundaryRef = useRef<ErrorBoundary>(null);
  const [location] = useLocation();
  const prevLocation = useRef(location);

  useEffect(() => {
    // Solo resetear si la ruta cambió Y hay un error activo
    if (location !== prevLocation.current) {
      prevLocation.current = location;
      if (boundaryRef.current?.state.hasError) {
        boundaryRef.current.reset();
      }
    }
  }, [location]);

  return (
    <ErrorBoundary ref={boundaryRef} fallback={fallback}>
      {children}
    </ErrorBoundary>
  );
}
