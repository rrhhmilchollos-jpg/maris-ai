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

// Lo que el equipo está haciendo "ahora mismo" — rota junto al punto verde
// de actividad en vivo para transmitir que detrás hay gente trabajando.
const ACTIVIDAD_EQUIPO = [
  "Los ingenieros de Maris AI están diseñando nuevas funciones",
  "El equipo está mejorando la velocidad de la plataforma",
  "Maris AI está entrenando a sus agentes para crear apps aún mejores",
  "El equipo está puliendo la experiencia hasta el último píxel",
  "Los ingenieros están reforzando la seguridad y la estabilidad",
];

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function UnderConstructionPage() {
  const [fraseIndex, setFraseIndex] = useState(0);
  const [actividadIndex, setActividadIndex] = useState(0);

  useEffect(() => {
    document.title = "Maris AI — Muy pronto";
    const timer = setInterval(() => {
      setFraseIndex((i) => (i + 1) % FRASES.length);
    }, 6000);
    // La actividad del equipo rota a otro ritmo (4.5s) para que la pantalla
    // se sienta viva y no sincronizada de forma mecánica.
    const timerActividad = setInterval(() => {
      setActividadIndex((i) => (i + 1) % ACTIVIDAD_EQUIPO.length);
    }, 4500);
    return () => {
      clearInterval(timer);
      clearInterval(timerActividad);
    };
  }, []);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#09090b] px-6 text-center">
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
          width="48"
          height="48"
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

        {/* Subtítulo -- añadido a propósito para que el texto real de esta
            página supere con margen los 200 caracteres que exige el script
            que oculta el bloque de contenido SEO (ver index.html,
            checkHide()) -- sin esto, el texto real de la página se quedaba
            justo por debajo de ese umbral, y el bloque SEO nunca llegaba a
            desaparecer, mostrándose mezclado con esta pantalla. */}
        <p className="mb-8 max-w-md text-base text-[#a1a1aa]">
          Estamos preparando una nueva versión de Maris AI con funciones que todavía no hemos anunciado. Vuelve pronto para descubrirlas.
        </p>

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

        {/* Actividad en vivo del equipo — punto verde latiendo + mensaje rotatorio */}
        <div className="mb-8 flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 backdrop-blur-sm">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <div className="h-5 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.span
                key={actividadIndex}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.45 }}
                className="block text-sm text-[#d4d4d8]"
              >
                {ACTIVIDAD_EQUIPO[actividadIndex]}
              </motion.span>
            </AnimatePresence>
          </div>
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
    </main>
  );
}
