import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, Play, CheckCircle2, ArrowRight, Loader2, RefreshCw, ExternalLink, Star, Users, Code2, Rocket, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface DemoPrompt { id: string; label: string; emoji: string; }
interface DemoLog { agent: string; message: string; level: string; ts: string; }
interface DemoStatus {
  status: string; phase: string; progress: number;
  logs: DemoLog[]; hasPreview: boolean; appTitle?: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────
const API = "/api/demo";
const POLL_INTERVAL = 2500;

const PHASE_LABELS: Record<string, string> = {
  queued: "En cola…",
  analyzing: "Analizando tu idea…",
  planning: "Diseñando la arquitectura…",
  designing: "Creando el diseño…",
  generating: "Escribiendo el código…",
  testing: "Verificando que todo funciona…",
  deploying: "Preparando el preview…",
  done: "¡App lista!",
};

const STATS = [
  { value: "+2.400", label: "apps creadas", icon: "🚀" },
  { value: "< 5 min", label: "tiempo medio", icon: "⚡" },
  { value: "100%", label: "en español", icon: "🇪🇸" },
  { value: "Gratis", label: "para empezar", icon: "🎁" },
];

const TESTIMONIALS = [
  { name: "Carlos M.", role: "Autónomo, Madrid", text: "En 8 minutos tenía mi app de reservas funcionando. Lo que me iba a costar 3.000€ con un freelance.", avatar: "C" },
  { name: "Laura P.", role: "Emprendedora, Barcelona", text: "Maris AI entiende lo que quieres en español. Ninguna otra herramienta lo hace tan bien.", avatar: "L" },
  { name: "Iván S.", role: "Startup, México DF", text: "Lancé mi MVP en un día. Mis inversores no podían creer que lo había hecho yo solo.", avatar: "I" },
];

// ─── Componente principal ─────────────────────────────────────────────────────
export default function DemoPage() {
  const [prompts, setPrompts] = useState<DemoPrompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<DemoPrompt | null>(null);
  const [stage, setStage] = useState<"select" | "generating" | "done" | "error">("select");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remainingDemos, setRemainingDemos] = useState(3);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // SEO
  useEffect(() => {
    document.title = "Demo en vivo — Ve Maris AI crear una app en tiempo real | Maris AI";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Ve cómo Maris AI crea una aplicación web completa en menos de 5 minutos, en directo, sin registrarte. La plataforma de vibe-coding en español.");
  }, []);

  // Cargar prompts
  useEffect(() => {
    fetch(`${API}/prompts`)
      .then((r) => r.json())
      .then((data) => {
        setPrompts(data);
        setSelectedPrompt(data[0] || null);
      })
      .catch(() => {});
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [status?.logs?.length]);

  // Polling
  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPoll = useCallback((jId: string) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API}/status/${jId}`);
        if (!r.ok) return;
        const data: DemoStatus = await r.json();
        setStatus(data);
        if (data.status === "done") { setStage("done"); stopPoll(); }
        if (data.status === "failed") { setStage("error"); setError("La generación falló. Inténtalo de nuevo."); stopPoll(); }
      } catch {}
    }, POLL_INTERVAL);
  }, [stopPoll]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const startDemo = async () => {
    if (!selectedPrompt) return;
    setStage("generating");
    setStatus(null);
    setError(null);
    try {
      const r = await fetch(`${API}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: selectedPrompt.id }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "Error iniciando la demo");
        setStage(data.limitReached ? "select" : "error");
        if (data.limitReached) setRemainingDemos(0);
        return;
      }
      setJobId(data.jobId);
      setRemainingDemos(data.remainingDemos ?? 2);
      startPoll(data.jobId);
    } catch {
      setError("Error de conexión. Inténtalo de nuevo.");
      setStage("error");
    }
  };

  const reset = () => {
    stopPoll();
    setStage("select");
    setJobId(null);
    setStatus(null);
    setError(null);
  };

  return (
    <main className="min-h-screen bg-[#06060f] text-white">
      {/* ── Header ── */}
      <header className="border-b border-white/[0.06] bg-[#06060f]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center">
              <Zap className="h-4 w-4 text-white fill-current" />
            </div>
            <span className="font-bold text-white">Maris AI</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/sign-in">
              <Button variant="ghost" size="sm" className="text-white/60 hover:text-white text-xs">Iniciar sesión</Button>
            </Link>
            <Link href="/sign-up">
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold">
                Crear cuenta gratis
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-10 space-y-16">

        {/* ── Hero ── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-xs text-violet-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
            Demo en vivo — sin registro
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">
            Ve cómo creamos tu app<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-purple-400">en menos de 5 minutos</span>
          </h1>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Elige un ejemplo, pulsa el botón y observa cómo Maris AI escribe el código en tiempo real. Gratis, sin tarjeta, sin registro.
          </p>
        </motion.div>

        {/* ── Stats ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STATS.map((s) => (
            <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-center space-y-1">
              <div className="text-2xl">{s.icon}</div>
              <div className="text-xl font-black text-white">{s.value}</div>
              <div className="text-xs text-white/40">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Demo principal ── */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0a0a14] overflow-hidden">

          {/* Selector de ejemplo */}
          {(stage === "select" || stage === "generating" || stage === "done") && (
            <div className="border-b border-white/[0.07] p-5 space-y-4">
              <p className="text-sm font-semibold text-white/70">Elige qué tipo de app quieres ver:</p>
              <div className="flex flex-wrap gap-2">
                {prompts.map((p) => (
                  <button
                    key={p.id}
                    disabled={stage !== "select"}
                    onClick={() => setSelectedPrompt(p)}
                    className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition ${
                      selectedPrompt?.id === p.id
                        ? "border-violet-500 bg-violet-500/15 text-white font-medium"
                        : "border-white/[0.08] text-white/50 hover:text-white hover:border-white/20"
                    } ${stage !== "select" ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    <span>{p.emoji}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>

              {stage === "select" && (
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-white/30">
                    {remainingDemos > 0
                      ? `Te quedan ${remainingDemos} demo${remainingDemos === 1 ? "" : "s"} gratuita${remainingDemos === 1 ? "" : "s"} hoy`
                      : "Has alcanzado el límite diario — regístrate para demos ilimitadas"}
                  </p>
                  <Button
                    onClick={startDemo}
                    disabled={!selectedPrompt || remainingDemos === 0}
                    className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-bold shadow-lg shadow-violet-500/25"
                  >
                    <Play className="h-4 w-4 mr-2 fill-current" />
                    Ver la demo en vivo
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Estado de generación */}
          <AnimatePresence mode="wait">
            {stage === "generating" && (
              <motion.div key="generating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-5 space-y-4">
                {/* Barra de progreso */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-violet-400 font-medium flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {PHASE_LABELS[status?.phase ?? "queued"] ?? "Procesando…"}
                    </span>
                    <span className="text-white/30">{status?.progress ?? 0}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500"
                      animate={{ width: `${status?.progress ?? 0}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                </div>

                {/* Logs en tiempo real */}
                <div className="rounded-xl bg-black/40 border border-white/[0.06] p-4 h-64 overflow-y-auto font-mono text-[11px] space-y-1.5">
                  {(!status?.logs || status.logs.length === 0) && (
                    <div className="text-white/30 animate-pulse">Conectando con los agentes de Maris AI…</div>
                  )}
                  {status?.logs?.map((log, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex gap-2 ${log.level === "error" ? "text-red-400" : log.agent === "system" ? "text-violet-400" : "text-white/60"}`}
                    >
                      <span className="shrink-0 text-white/20">
                        {new Date(log.ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className="shrink-0 text-violet-500/70 uppercase text-[10px] pt-px">[{log.agent}]</span>
                      <span className="break-all">{log.message}</span>
                    </motion.div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </motion.div>
            )}

            {/* App lista — preview + CTA */}
            {stage === "done" && jobId && (
              <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-0">
                {/* Banner de éxito */}
                <div className="flex items-center justify-between px-5 py-3 bg-green-500/10 border-b border-green-500/20">
                  <div className="flex items-center gap-2 text-green-400 font-semibold text-sm">
                    <CheckCircle2 className="h-4 w-4" />
                    ¡App generada en tiempo real! — {status?.appTitle}
                  </div>
                  <button onClick={reset} className="text-xs text-white/40 hover:text-white flex items-center gap-1 transition">
                    <RefreshCw className="h-3 w-3" /> Probar otra
                  </button>
                </div>

                {/* Preview iframe */}
                <div className="relative bg-black" style={{ height: "460px" }}>
                  <iframe
                    src={`${API}/preview/${jobId}`}
                    className="w-full h-full border-0"
                    title="Preview de la app generada"
                    sandbox="allow-scripts"
                  />
                  {/* Overlay "Crea la tuya" */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#06060f] via-[#06060f]/80 to-transparent pt-16 pb-6 px-6 flex flex-col items-center gap-3">
                    <p className="text-white font-bold text-lg text-center">
                      ¿Te imaginas tu propia app así?
                    </p>
                    <p className="text-white/50 text-sm text-center max-w-md">
                      Esta app se generó en minutos. La tuya también puede estar lista hoy, en español, sin saber programar.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
                      <Link href="/sign-up" className="flex-1">
                        <Button className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 font-bold text-white shadow-lg shadow-violet-500/30 h-11">
                          <Rocket className="h-4 w-4 mr-2" />
                          Crear la mía gratis
                        </Button>
                      </Link>
                      <a href={`${API}/preview/${jobId}`} target="_blank" rel="noopener noreferrer" className="flex-1">
                        <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/[0.05] h-11 text-sm">
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Ver en pantalla completa
                        </Button>
                      </a>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Error */}
            {stage === "error" && (
              <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-8 text-center space-y-4">
                <p className="text-red-400">{error}</p>
                <Button onClick={reset} variant="outline" className="border-white/20 text-white hover:bg-white/[0.05]">
                  <RefreshCw className="h-4 w-4 mr-2" /> Intentar de nuevo
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Qué puede crear Maris AI ── */}
        <div className="space-y-6">
          <h2 className="text-2xl font-black text-center">¿Qué puedes crear con Maris AI?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { emoji: "🏪", title: "Tiendas online", desc: "Catálogo, carrito, Stripe, panel de administración. Lista para vender en horas." },
              { emoji: "📅", title: "Apps de reservas", desc: "Para restaurantes, clínicas, salones. Con calendario, confirmaciones y panel." },
              { emoji: "📊", title: "CRMs y dashboards", desc: "Gestión de clientes, pipeline de ventas, métricas en tiempo real." },
              { emoji: "🎓", title: "Plataformas de cursos", desc: "Vídeos, temarios, alumnos, certificados. Tu academia online." },
              { emoji: "🤖", title: "Apps con IA", desc: "Chatbots, generadores de contenido, asistentes personalizados." },
              { emoji: "🏥", title: "Apps para clínicas", desc: "Citas, historiales, facturación. Todo lo que tu consulta necesita." },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2 hover:border-violet-500/30 transition">
                <div className="text-2xl">{item.emoji}</div>
                <h3 className="font-bold text-white">{item.title}</h3>
                <p className="text-sm text-white/50">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Testimonios ── */}
        <div className="space-y-6">
          <h2 className="text-2xl font-black text-center">Lo que dicen nuestros clientes</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-3">
                <div className="flex items-center gap-2">
                  {[1,2,3,4,5].map((s) => <Star key={s} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />)}
                </div>
                <p className="text-sm text-white/70 italic">"{t.text}"</p>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-xs font-bold">{t.avatar}</div>
                  <div>
                    <p className="text-xs font-semibold text-white">{t.name}</p>
                    <p className="text-[10px] text-white/40">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CTA final ── */}
        <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-900/20 to-purple-900/10 p-10 text-center space-y-5">
          <div className="flex items-center justify-center gap-2 text-violet-400 text-sm font-medium">
            <Users className="h-4 w-4" />
            +2.400 emprendedores ya crearon su app
          </div>
          <h2 className="text-3xl font-black">
            Tu turno. Empieza gratis.
          </h2>
          <p className="text-white/50 max-w-md mx-auto">
            Sin tarjeta de crédito. Sin saber programar. Sin inglés. En menos de 5 minutos tienes tu primera app funcionando.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/sign-up">
              <Button size="lg" className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 font-bold text-white shadow-xl shadow-violet-500/30 h-12 px-8">
                <Rocket className="h-5 w-5 mr-2" />
                Crear mi app gratis
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
            <Link href="/pricing">
              <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/[0.05] h-12 px-8">
                Ver planes y precios
              </Button>
            </Link>
          </div>
          <p className="text-xs text-white/30 flex items-center justify-center gap-1">
            <Code2 className="h-3 w-3" />
            Soporte en español · WhatsApp · Sin compromisos
          </p>
        </div>

      </div>
    </main>
  );
}
