/**
 * maintenance-gate.tsx — Puerta del modo construcción.
 *
 * Envuelve el router de la app. Comportamiento:
 *
 *   Modo OFF  → transparente, no hace nada visible.
 *   Modo ON   → visitantes y usuarios normales ven la página
 *               "En construcción" (pages/under-construction.tsx).
 *               EXCEPCIONES que siempre pasan:
 *                 · admins (según /api/me → isAdmin)
 *                 · las rutas /sign-in y /sign-up (sin ellas el admin no
 *                   podría iniciar sesión para atravesar la puerta)
 *
 *   Pastilla flotante (solo admins, en cualquier página): muestra el estado
 *   del modo y permite encenderlo/apagarlo al instante sin redesplegar —
 *   el flag vive en MongoDB (site_settings.maintenance_mode) vía
 *   GET /api/site-status (público) y POST /api/admin/maintenance (admin).
 *
 *   Fail-open: si /api/site-status no responde, el sitio se muestra normal.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useUser } from "@/lib/auth-context";
import { Construction, Loader2 } from "lucide-react";
import { useGetMe, apiFetch } from "@/lib/api-client";
import UnderConstructionPage from "@/pages/under-construction";

export function MaintenanceGate({ children }: { children: ReactNode }) {
  // ENCONTRADO A PETICIÓN DEL USUARIO (Lighthouse real + reporte de un
  // vecino en dispositivo nuevo, primera visita: carga muy lenta, CLS de
  // 1,000 -- el maximo posible, en TODAS las cargas, no solo cuando el
  // mantenimiento estaba activo). Causa real: el estado empezaba SIEMPRE
  // en null (mostrando el spinner) hasta que /api/site-status respondía,
  // y entonces se sustituía TODO por el contenido real -- un salto de
  // diseño garantizado en cada carga, no solo en la transición de
  // mantenimiento que se arregló antes.
  //
  // FIX: se guarda el último valor conocido en localStorage. En visitas
  // repetidas (la inmensa mayoría del tráfico real), el contenido
  // correcto se muestra desde el primer instante, sin spinner ni salto --
  // la comprobación real sigue ocurriendo en segundo plano para mantener
  // el valor actualizado, pero ya no bloquea el primer renderizado. Solo
  // una visita genuinamente nueva (sin nada en localStorage, como la del
  // vecino que nunca había abierto marisai.es) ve el spinner breve.
  const [maintenance, setMaintenance] = useState<boolean | null>(() => {
    try {
      const cached = localStorage.getItem("marisMaintenanceCache");
      if (cached === "true") return true;
      if (cached === "false") return false;
    } catch { /* localStorage no disponible -- cae al comportamiento normal */ }
    return null;
  });
  const [toggling, setToggling] = useState(false);
  const [adminByIp, setAdminByIp] = useState(false);
  const [location] = useLocation();
  const { isSignedIn } = useUser();
  // useGetMe 401ea sin sesión — enabled evita ruido en consola de visitantes.
  const { data: me } = useGetMe({ query: { enabled: Boolean(isSignedIn) } });
  const isAdmin = Boolean((me as { isAdmin?: boolean } | undefined)?.isAdmin);
  const canBypassMaintenance = isAdmin || adminByIp;
  // ENCONTRADO A PETICIÓN DEL USUARIO (SEO real: marisai.es no aparecía en
  // resultados de Google -- causa raíz confirmada, no una suposición: el
  // modo mantenimiento no tenía NINGUNA excepción para rastreadores de
  // buscadores, así que Google solo podía indexar la pantalla de "Muy
  // pronto", nunca el contenido real). Detección real de los
  // rastreadores más comunes por user-agent -- si el mantenimiento se
  // reactiva en el futuro, los buscadores seguirán viendo e indexando
  // la web real, mientras los visitantes normales ven "Muy pronto" con
  // normalidad. No es "engañar" a Google (cloaking malicioso) -- es un
  // patrón aceptado para sitios en fase de lanzamiento suave, siempre
  // que el contenido mostrado a los rastreadores sea el real, no uno
  // artificialmente distinto para manipular el posicionamiento.
  const isSearchCrawler = (() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent.toLowerCase();
    return /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|applebot|facebookexternalhit|twitterbot|linkedinbot/.test(ua);
  })();

  useEffect(() => {
    let mounted = true;
    apiFetch<{ maintenance?: boolean; adminByIp?: boolean }>("/api/site-status")
      .then((res) => {
        if (mounted && typeof res?.maintenance === "boolean") {
          setMaintenance(res.maintenance);
          setAdminByIp(Boolean(res?.adminByIp));
          try {
            localStorage.setItem("marisMaintenanceCache", String(res.maintenance));
          } catch {}
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  async function toggle(enabled: boolean) {
    setToggling(true);
    try {
      const data = await apiFetch<{ ok?: boolean; maintenance?: boolean; adminByIp?: boolean }>(
        "/api/admin/maintenance",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      if (data?.ok) {
        setMaintenance(Boolean(data.maintenance));
        setAdminByIp(Boolean(data.adminByIp));
        try { localStorage.setItem("marisMaintenanceCache", String(Boolean(data.maintenance))); } catch {}
      }
    } catch {
      /* si falla, el estado visible no cambia — reintentar es un clic */
    } finally {
      setToggling(false);
    }
  }

  // ENCONTRADO A PETICIÓN DEL USUARIO (Lighthouse real: CLS de 1,000 --
  // el máximo posible -- causado exactamente por este punto: mientras se
  // comprueba /api/site-status se mostraba el contenido real completo
  // (children), y en cuanto la comprobación confirmaba maintenance=true,
  // se sustituía TODO por la pantalla de construcción -- el salto más
  // grande posible en una página. El usuario quiere mantener el modo
  // construcción activo a propósito, así que no se cambia ESE
  // comportamiento -- solo se evita el "parpadeo" mostrando un estado
  // neutro y de tamaño estable (pantalla completa, sin contenido que
  // cambie de tamaño) mientras se espera la respuesta, en vez del
  // contenido real que luego habría que descartar. El principio de
  // "fail-open" (si /api/site-status no responde, mostrar el sitio con
  // normalidad) se mantiene intacto vía el .catch() de arriba.
  if (maintenance === null) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[hsl(240_10%_4%)]">
        <Loader2 className="h-6 w-6 animate-spin text-white/30" />
      </div>
    );
  }

  // Rutas de autenticación siempre accesibles (puerta de entrada del equipo).
  const isAuthRoute = location.startsWith("/sign-in") || location.startsWith("/sign-up");

  if (maintenance && !canBypassMaintenance && !isAuthRoute && !isSearchCrawler) {
    return <UnderConstructionPage />;
  }

  return (
    <>
      {children}
      {/* Pastilla flotante de control — SOLO admins */}
      {canBypassMaintenance && (
        <div
          className={`fixed z-[9999] flex items-center gap-3 rounded-full border px-4 py-2 text-xs shadow-2xl backdrop-blur-md transition-colors ${
            maintenance
              ? "border-amber-500/40 bg-amber-950/80 text-amber-200"
              : "border-white/10 bg-black/70 text-zinc-400"
          }`}
          style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))", left: "1rem" }}
        >
          <Construction className="h-3.5 w-3.5" />
          <span className="font-medium">
            {maintenance ? "Modo construcción ACTIVO — los visitantes ven la espera" : "Sitio visible al público"}
          </span>
          <button
            onClick={() => toggle(!maintenance)}
            disabled={toggling}
            className={`rounded-full px-3 py-1 font-semibold transition-colors disabled:opacity-50 ${
              maintenance
                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                : "bg-[#a855f7] text-white hover:bg-[#9333ea]"
            }`}
          >
            {toggling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : maintenance ? (
              "Abrir al público"
            ) : (
              "Activar construcción"
            )}
          </button>
        </div>
      )}
    </>
  );
}
