import { useEffect, useRef } from "react";
import { useUser } from "@/lib/auth-context";
import { io, type Socket } from "socket.io-client";
import { getApiBaseUrl } from "@/lib/api-client";

declare global {
  interface Window {
    Clerk?: {
      session?: {
        getToken?: () => Promise<string | null>;
      };
    };
  }
}

/**
 * Mantiene una conexión socket.io autenticada mientras el usuario tiene
 * Maris AI abierto, para que el panel admin pueda ver "quién está
 * conectado ahora mismo".
 *
 * IMPORTANTE: Este hook es puramente informativo para el equipo de soporte.
 * Cualquier fallo de conexión se silencia completamente — NUNCA debe
 * propagarse un error al árbol de React ni al ErrorBoundary, porque eso
 * tumbaría la aplicación entera mostrando "El sistema de autenticación no
 * pudo cargarse" (el ErrorBoundary detecta "clerk" en el stack trace del
 * scheduler de React y lo interpreta como fallo de Clerk).
 *
 * Problema original: Socket.io, al fallar la conexión WebSocket (token
 * aún no sincronizado, red inestable, servidor reiniciando), entraba en
 * un bucle de reconexión agresivo que saturaba el event loop de React,
 * provocando un error no capturado que el ErrorBoundary atrapaba.
 *
 * Solución: reconexión limitada (máximo 3 intentos con backoff largo),
 * y envuelto en try/catch total para que NINGÚN error escape al render.
 */
export function usePresence() {
  const { isSignedIn } = useUser();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Solo conectar si el usuario está autenticado
    if (!isSignedIn) return;

    let cancelled = false;

    const connect = async () => {
      try {
        const token = await window.Clerk?.session?.getToken?.();
        if (cancelled || !token) return;

        const baseUrl = getApiBaseUrl() || window.location.origin;
        const socket = io(baseUrl, {
          auth: { token },
          // CRÍTICO: Limitar reconexión para evitar bucle infinito que
          // bloquea el hilo principal y tumba la app.
          reconnection: true,
          reconnectionAttempts: 3,        // máximo 3 intentos
          reconnectionDelay: 2000,        // esperar 2s entre intentos
          reconnectionDelayMax: 10000,    // máximo 10s entre intentos
          timeout: 10000,                 // timeout de conexión 10s
          // Usar solo polling primero, upgrade a websocket después —
          // evita el error "WebSocket is closed before the connection
          // is established" que ocurre cuando el handshake aún no
          // completó y el navegador cierra el WS prematuramente.
          transports: ["polling", "websocket"],
          upgrade: true,
        });

        if (cancelled) {
          socket.disconnect();
          return;
        }

        socketRef.current = socket;

        const reportPage = () => {
          try {
            socket.emit("presence:page", window.location.pathname);
          } catch (_) {
            // Silenciar — nunca propagar errores de presencia
          }
        };

        socket.on("connect", reportPage);

        // Silenciar TODOS los errores de socket — presencia es best-effort
        socket.on("connect_error", (err) => {
          // Log silencioso para debugging, pero NUNCA throw
          console.debug("[Maris AI Presence] connect_error (silenciado):", err?.message);
        });

        socket.on("error", (err) => {
          console.debug("[Maris AI Presence] error (silenciado):", err);
        });

        // Si se agotan los reintentos, desconectar limpiamente
        socket.io.on("reconnect_failed", () => {
          console.debug("[Maris AI Presence] Reconexión agotada — desconectando limpiamente.");
          try {
            socket.disconnect();
          } catch (_) {}
          socketRef.current = null;
        });

        window.addEventListener("popstate", reportPage);
        const pageCheckInterval = setInterval(reportPage, 15000);

        // Guardar cleanup en el ref para el desmontaje
        (socketRef as any).__cleanup = () => {
          window.removeEventListener("popstate", reportPage);
          clearInterval(pageCheckInterval);
        };
      } catch (err) {
        // CRÍTICO: Capturar CUALQUIER error para que nunca escape al
        // árbol de React. Presencia es opcional — si falla, la app
        // debe seguir funcionando normalmente.
        console.debug("[Maris AI Presence] Error silenciado:", err);
      }
    };

    // Retrasar la conexión 3 segundos después del login para dar tiempo
    // a que la sesión de Clerk se estabilice completamente y el token
    // sea válido en el backend.
    const delayTimer = setTimeout(connect, 3000);

    return () => {
      cancelled = true;
      clearTimeout(delayTimer);
      try {
        (socketRef as any).__cleanup?.();
        socketRef.current?.disconnect();
      } catch (_) {}
      socketRef.current = null;
    };
  }, [isSignedIn]);
}
