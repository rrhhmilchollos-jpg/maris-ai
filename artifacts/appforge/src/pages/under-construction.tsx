/**
 * under-construction.tsx — Página "En construcción" de cara a los clientes.
 *
 * Se muestra cuando el modo construcción está activo (SiteSetting
 * maintenance_mode = "on") y el visitante NO es admin. Los admins nunca la
 * ven: entran con normalidad y además tienen la pastilla flotante para
 * apagar el modo (ver components/maintenance-gate.tsx).
 *
 * Diseño: fondo oscuro de marca, orbes de gradiente violeta animados,
 * logo, frase elegante rotatoria y una línea de progreso "viva" — la
 * sensación buscada es "aquí se está cocinando algo grande", no "error".
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";

const FRASES = [
  "Lo bueno se hace esperar. Lo extraordinario, un poco más.",
  "Estamos puliendo cada detalle para ti.",
  "Las mejores ideas necesitan su momento.",
  "Construyendo algo que va a merecer la pena.",
];

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function UnderConstructionPage() {
  const [fraseIndex, setFraseIndex] = useState(0);

  useEffect(() => {
    document.title = "Maris AI — Muy pronto";
    const timer = setInterval(() => {
      setFraseIndex((i) => (i + 1) % FRASES.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#09090b] px-6 text-center">
      {/* Orbes de gradiente violeta — el "latido" de la marca */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#7c3aed]/25 blur-[140px] animate-pulse"
        style={{ animationDuration: "5s" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 -left-32 h-[420px] w-[420px] rounded-full bg-[#a78bfa]/15 blur-[120px] animate-pulse"
        style={{ animationDuration: "7s" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-1/3 h-[380px] w-[380px] rounded-full bg-[#6d28d9]/20 blur-[130px] animate-pulse"
        style={{ animationDuration: "9s" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
        className="relative z-10 flex max-w-2xl flex-col items-center"
      >
        <img
          src={`${basePath}/logo.svg`}
          alt="Maris AI"
          className="mb-10 h-12 w-auto drop-shadow-[0_0_28px_rgba(168,85,247,0.45)]"
        />

        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#a855f7]/30 bg-[#a855f7]/10 px-4 py-1.5 text-xs font-medium tracking-wide text-[#c084fc]">
          <Sparkles className="h-3.5 w-3.5" />
          EN CONSTRUCCIÓN
        </span>

        <h1 className="mb-5 bg-gradient-to-r from-white via-[#e9d5ff] to-[#a78bfa] bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-6xl">
          Estamos creando algo
          <br />
          que va a sorprenderte
        </h1>

        {/* Frase elegante rotatoria */}
        <div className="mb-12 h-8">
          <AnimatePresence mode="wait">
            <motion.p
              key={fraseIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.6 }}
              className="text-base italic text-[#a1a1aa] sm:text-lg"
            >
              “{FRASES[fraseIndex]}”
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Línea de progreso "viva" — sensación de trabajo en marcha */}
        <div className="relative mb-14 h-1 w-64 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-[#a855f7] to-transparent"
            animate={{ x: ["-120%", "320%"] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <p className="text-sm text-[#71717a]">
          Maris AI vuelve muy pronto, mejor que nunca.
        </p>
      </motion.div>

      {/* Acceso discreto para el equipo — imprescindible: sin esto el admin
          no podría iniciar sesión para atravesar la puerta */}
      <a
        href={`${basePath}/sign-in`}
        className="absolute bottom-6 right-6 z-10 text-xs text-[#3f3f46] transition-colors hover:text-[#a855f7]"
      >
        Acceso del equipo →
      </a>
    </div>
  );
}
