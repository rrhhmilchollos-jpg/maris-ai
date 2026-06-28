import { useEffect, useRef } from "react";
import { useUser } from "@clerk/react";
import { io, type Socket } from "socket.io-client";

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
 * conectado ahora mismo" (ver lib/presence.ts en el backend, y la sección
 * "Presencia en vivo" del panel admin).
 *
 * Se monta una sola vez a nivel de aplicación (no por página) — un solo
 * socket por sesión de navegador, no uno nuevo en cada navegación.
 *
 * No requiere ningún cambio de comportamiento visible para el usuario
 * normal: si la conexión falla (red, servidor caído, etc.), socket.io
 * reintenta solo con backoff exponencial — no se muestra ningún error en
 * la interfaz, esto es puramente informativo para el equipo de soporte.
 */
export function usePresence() {
  const { isSignedIn } = useUser();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;

    let cancelled = false;

    (async () => {
      const token = await window.Clerk?.session?.getToken?.();
      if (cancelled || !token) return;

      const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
      const socket = io(baseUrl, {
        auth: { token },
        // Reconexión automática indefinida con backoff — comportamiento
        // por defecto de socket.io, documentado oficialmente como seguro
        // para no sobrecargar el servidor en caso de caída temporal.
        reconnection: true,
      });
      socketRef.current = socket;

      const reportPage = () => {
        socket.emit("presence:page", window.location.pathname);
      };
      socket.on("connect", reportPage);

      // Re-informar la página actual cuando el usuario navega dentro de la
      // SPA sin recargar (popstate cubre back/forward; las navegaciones
      // por click usan history.pushState, que no dispara popstate por sí
      // solo, así que también escuchamos un evento ligero de cambio de ruta
      // si el router de la app ya lo emite — en su ausencia, el intervalo
      // de abajo actúa como red de seguridad sin depender de integrarse con
      // el router interno.
      window.addEventListener("popstate", reportPage);
      const pageCheckInterval = setInterval(reportPage, 15000);

      return () => {
        window.removeEventListener("popstate", reportPage);
        clearInterval(pageCheckInterval);
      };
    })();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [isSignedIn]);
}
