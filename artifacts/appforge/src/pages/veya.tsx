import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";

const VEYA_APP_ID = "6a7e7b998c2ddda0ecd1f219";
const VEYA_PREVIEW_PATH = `/api/apps/${VEYA_APP_ID}/preview`;

/**
 * Public Veya entry point built by the Maris AI frontend deployed on Vercel.
 * The banking interface remains the independently versioned Veya bundle,
 * delivered through the same-origin Maris proxy so its authenticated API
 * requests and browser security policies keep working as in app previews.
 */
export default function VeyaPage() {
  const [location] = useLocation();
  const employeePortal = location === "/veya/empleados";
  const previewSource = employeePortal ? `${VEYA_PREVIEW_PATH}?portal=employees` : `${VEYA_PREVIEW_PATH}?portal=customer`;
  return (
    <main className="min-h-[100dvh] bg-[#110d25] text-white">
      <header className="relative z-10 flex items-center justify-between gap-4 border-b border-white/10 bg-[#181231]/95 px-4 py-3 backdrop-blur md:px-8">
        <a href="/" className="flex items-center gap-2 text-sm font-semibold text-white/80 transition hover:text-white">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#9b7cff] to-[#34d4b6] font-black text-white">M</span>
          Maris AI
        </a>
        <div className="hidden items-center gap-2 text-sm text-white/70 sm:flex">
          <ShieldCheck className="h-4 w-4 text-[#71e0c5]" />
          {employeePortal ? "Portal de empleados Veya" : "Espacio Veya protegido"}
        </div>
        <a href={previewSource} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold text-[#23184d] transition hover:bg-[#f0edff]">
          {employeePortal ? "Abrir portal" : "Abrir Veya"} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </header>
      <section className="relative h-[calc(100dvh-57px)] min-h-[680px] overflow-hidden bg-[#f7f6ff]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-16 items-center justify-center bg-gradient-to-b from-[#110d25]/25 to-transparent">
          <div className="flex items-center gap-2 rounded-full border border-white/20 bg-[#17112d]/70 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Cargando interfaz Veya…
          </div>
        </div>
        <iframe
          title="Veya"
          src={previewSource}
          className="h-full w-full border-0 bg-[#f7f6ff]"
          allow="camera; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </section>
    </main>
  );
}
