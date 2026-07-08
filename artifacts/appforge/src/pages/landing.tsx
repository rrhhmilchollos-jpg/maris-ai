import { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Zap, Code2, Globe, ArrowRight, CheckCircle2, LayoutDashboard,
  Database, Smartphone, Newspaper, ChevronRight, GitBranch, Star,
  Users, TrendingUp, Clock, Activity, Menu, X
} from "lucide-react";

// Líneas de código que se van escribiendo
const CODE_LINES = [
  { text: "import { useState, useEffect } from 'react';", color: "text-blue-400" },
  { text: "import { motion } from 'framer-motion';", color: "text-purple-400" },
  { text: "", color: "" },
  { text: "export default function Dashboard() {", color: "text-emerald-400" },
  { text: "  const [data, setData] = useState([]);", color: "text-yellow-300" },
  { text: "  const [loading, setLoading] = useState(true);", color: "text-yellow-300" },
  { text: "", color: "" },
  { text: "  useEffect(() => {", color: "text-cyan-400" },
  { text: "    fetchAnalytics().then(setData);", color: "text-white/70" },
  { text: "    setLoading(false);", color: "text-white/70" },
  { text: "  }, []);", color: "text-cyan-400" },
  { text: "", color: "" },
  { text: "  return (", color: "text-emerald-400" },
  { text: "    <div className=\"dashboard-grid\">", color: "text-orange-400" },
  { text: "      <MetricsCard title=\"Ingresos\" />", color: "text-pink-400" },
  { text: "      <ChartComponent data={data} />", color: "text-pink-400" },
  { text: "      <UserTable loading={loading} />", color: "text-pink-400" },
  { text: "    </div>", color: "text-orange-400" },
  { text: "  );", color: "text-emerald-400" },
  { text: "}", color: "text-emerald-400" },
];

function CodeAnimation() {
  const [visibleLines, setVisibleLines] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [currentText, setCurrentText] = useState("");

  useEffect(() => {
    if (visibleLines >= CODE_LINES.length) {
      setTimeout(() => {
        setVisibleLines(0);
        setCharIndex(0);
        setCurrentText("");
      }, 3000);
      return;
    }

    const line = CODE_LINES[visibleLines];
    if (!line) return;

    if (charIndex < line.text.length) {
      const timeout = setTimeout(() => {
        setCurrentText(prev => prev + line.text[charIndex]);
        setCharIndex(prev => prev + 1);
      }, 18);
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => {
        setVisibleLines(prev => prev + 1);
        setCharIndex(0);
        setCurrentText("");
      }, line.text === "" ? 80 : 120);
      return () => clearTimeout(timeout);
    }
  }, [visibleLines, charIndex]);

  return (
    <div className="font-mono text-xs leading-6 overflow-hidden">
      {CODE_LINES.slice(0, visibleLines).map((line, i) => (
        <div key={i} className={line.color || "text-white/40"}>
          {line.text || "\u00a0"}
        </div>
      ))}
      {visibleLines < CODE_LINES.length && (
        <div className={CODE_LINES[visibleLines]?.color || "text-white/70"}>
          {currentText}
          <span className="text-primary" style={{animation:"marisBlob 1s step-end infinite"}}>|</span>
        </div>
      )}
    </div>
  );
}

function AuroraBackground() {
  return (
    <div className="fixed inset-0 -z-20 overflow-hidden pointer-events-none">
      <div className="absolute -top-40 -left-40 w-[300px] h-[300px] md:w-[600px] md:h-[600px] rounded-full opacity-20 blur-[100px] will-change-transform"
        style={{ background: "radial-gradient(circle, #7c3aed, transparent)" }} />
      <div className="absolute top-1/3 -right-40 w-[250px] h-[250px] md:w-[500px] md:h-[500px] rounded-full opacity-15 blur-[120px]"
        style={{ background: "radial-gradient(circle, #0ea5e9, transparent)", animation: "marisBlob 4s ease-in-out infinite 1s", transform: "translateZ(0)" }} />
      <div className="absolute -bottom-40 left-1/3 w-[300px] h-[200px] md:w-[700px] md:h-[400px] rounded-full opacity-10 blur-[150px]"
        style={{ background: "radial-gradient(circle, #ec4899, transparent)", animation: "marisBlob 6s ease-in-out infinite 2s", transform: "translateZ(0)" }} />
      <div className="absolute inset-0"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)", backgroundSize: "40px 40px" }} />
    </div>
  );
}

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { isSignedIn } = useAuth();
  // ENCONTRADO A PETICIÓN DEL USUARIO (investigación real de Emergent.sh):
  // su cuadro de generación aparece con texto YA ESCRITO ("Build me a
  // dashboard"), no vacío -- reduce la sensación de página en blanco nada
  // más entrar. Aplicado aquí el mismo criterio con un ejemplo real y
  // evocador, fácil de sustituir (seleccionado automáticamente al hacer
  // foco, ver el input onFocus más abajo).
  const [prompt, setPrompt] = useState("Crea una app de gestión de tareas con tableros kanban, modo oscuro y notificaciones en tiempo real");
  // ENCONTRADO A PETICIÓN DEL USUARIO (investigación de fricción móvil):
  // el <nav> completo (Precios, Showcase, Blog, Comparativa) usaba
  // "hidden md:flex" -- oculto por completo en móvil, sin ningún menú
  // alternativo. Un visitante en móvil no tenía forma de llegar a esas
  // páginas desde la cabecera.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0.3]);

  useEffect(() => {
    const saved = localStorage.getItem("appforge_pending_prompt");
    if (saved) setPrompt(saved);
  }, []);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    
    if (typeof window !== "undefined" && (window as any).fbq) {
      (window as any).fbq("track", "Lead", { content_name: "Generation Intent", content_category: "App Creation" });
    }

    localStorage.setItem("appforge_pending_prompt", prompt);
    setLocation(isSignedIn ? "/dashboard" : "/sign-up");
  };

  const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };
  const stagger = { animate: { transition: { staggerChildren: 0.1 } } };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-primary text-white px-4 py-2 rounded z-50">
        Saltar al contenido principal
      </a>
      <AuroraBackground />

      <header className="fixed top-0 z-50 w-full border-b border-border/10 bg-background/60 backdrop-blur-xl pt-[env(safe-area-inset-top)]" role="banner">
        <div className="container flex h-14 max-w-screen-2xl items-center px-3 md:px-8 justify-between">
          <div className="flex items-center space-x-2">
            <img src={`${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/logo.svg`} alt="Maris AI" width="24" height="24" className="h-6 w-6" fetchPriority="high" decoding="sync" />
            <span className="font-bold tracking-tight text-lg text-white">Maris AI</span>
          </div>
          <nav className="hidden md:flex items-center space-x-6 text-sm text-muted-foreground">
            <Link href="/pricing" className="hover:text-white transition-colors">Precios</Link>
            <Link href="/showcase" className="hover:text-white transition-colors">Showcase</Link>
            <Link href="/news" className="hover:text-white transition-colors">Blog</Link>
            <Link href="/vs-emergent" className="hover:text-white transition-colors">Comparativa</Link>
          </nav>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="md:hidden flex items-center justify-center h-10 w-10 rounded-lg hover:bg-white/10 transition-colors text-white"
            aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex items-center space-x-3">
            {isSignedIn ? (
              <Link href="/dashboard">
                <Button variant="ghost" className="text-white hover:bg-white/10">Panel</Button>
              </Link>
            ) : (
              <>
                <Link href="/sign-in">
                  <Button variant="ghost" className="text-white hover:bg-white/10 text-sm">Iniciar Sesión</Button>
                </Link>
                <Link href="/sign-up">
                  <Button 
                    className="bg-primary hover:bg-primary/90 text-white text-sm"
                    onClick={() => {
                      if (typeof window !== "undefined" && (window as any).fbq) {
                        (window as any).fbq("track", "CompleteRegistration", { content_name: "Sign Up Click" });
                      }
                    }}
                  >
                    Empieza Gratis
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
        {mobileMenuOpen && (
          <nav className="md:hidden border-t border-white/10 bg-background/95 backdrop-blur-xl px-4 py-3 flex flex-col gap-1">
            <Link href="/pricing" onClick={() => setMobileMenuOpen(false)} className="px-3 py-3 rounded-lg hover:bg-white/10 text-white text-sm transition-colors">Precios</Link>
            <Link href="/showcase" onClick={() => setMobileMenuOpen(false)} className="px-3 py-3 rounded-lg hover:bg-white/10 text-white text-sm transition-colors">Showcase</Link>
            <Link href="/news" onClick={() => setMobileMenuOpen(false)} className="px-3 py-3 rounded-lg hover:bg-white/10 text-white text-sm transition-colors">Blog</Link>
            <Link href="/vs-emergent" onClick={() => setMobileMenuOpen(false)} className="px-3 py-3 rounded-lg hover:bg-white/10 text-white text-sm transition-colors">Comparativa</Link>
          </nav>
        )}
      </header>

      {/* Hero */}
      <main id="main-content" role="main" aria-label="Contenido principal de Maris AI">
      <section className="relative pt-20 pb-16 sm:pt-32 sm:pb-20 md:pt-48 md:pb-32 overflow-hidden min-h-screen flex items-center justify-center">
        <motion.div style={{ opacity: heroOpacity }} className="container px-4 md:px-8 max-w-6xl mx-auto relative z-10">
          <motion.div initial="initial" animate="animate" variants={stagger} className="text-center">
            <motion.div variants={fadeIn} className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary mb-8 backdrop-blur-sm">
              <Zap className="mr-2 h-3.5 w-3.5" />
              <span>La revolución del Vibe Coding ha llegado</span>
            </motion.div>

            <motion.h1 variants={fadeIn} className="text-3xl xs:text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-bold tracking-tighter text-white mb-4 md:mb-6 leading-[1.1] md:leading-[1.05]">
              Tu visión. <br />
              <span className="bg-gradient-to-r from-primary via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                Apps reales en minutos.
              </span>
            </motion.h1>

            <motion.p variants={fadeIn} className="text-base md:text-xl text-muted-foreground mb-6 md:mb-10 max-w-2xl mx-auto font-light leading-relaxed px-2 md:px-0">
              Transforma tus ideas más ambiciosas en aplicaciones funcionales y listas para el mercado, impulsadas por un equipo de 11 agentes IA de élite.
            </motion.p>

            <motion.div variants={fadeIn} className="max-w-3xl mx-auto relative mb-6">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-primary via-purple-500 to-cyan-500 rounded-2xl blur opacity-30"></div>
              <form onSubmit={handleGenerate} className="relative flex flex-col sm:flex-row gap-2 bg-background/90 backdrop-blur rounded-2xl border border-white/10 p-2 shadow-2xl">
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="ej. Crea una app de gestión de tareas con tableros kanban, modo oscuro y notificaciones..."
                  className="min-h-[60px] max-h-[200px] resize-y border-0 focus-visible:ring-0 bg-transparent text-base placeholder:text-muted-foreground/60 shadow-none"
                  data-testid="input-prompt"
                />
                <Button
                  type="submit"
                  size="lg"
                  className="sm:h-auto sm:px-8 bg-primary hover:bg-primary/90 text-white font-semibold shadow-lg self-end sm:self-stretch whitespace-nowrap"
                  data-testid="button-generate"
                >
                  Generar App <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </form>
            </motion.div>

            <motion.div variants={fadeIn} className="flex flex-wrap justify-center gap-2 text-sm text-muted-foreground">
              {["Panel CRM", "E-commerce", "App móvil", "Dashboard analytics", "SaaS MVP", "Landing page"].map((ex) => (
                <button key={ex} onClick={() => setPrompt(`Crea un ${ex.toLowerCase()}`)}
                  className="px-4 py-2.5 min-h-[40px] rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:text-white transition-all text-xs">
                  {ex}
                </button>
              ))}
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* ¿Qué puedes construir? */}
      <section className="py-24 relative overflow-hidden">
        <div className="container px-4 md:px-8 mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">Desata tu potencial creativo.</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Desde MVPs innovadores hasta soluciones empresariales complejas, Maris AI transforma tus ideas en realidad con código impecable y escalable.
            </p>
          </motion.div>

          <div className="flex justify-center mb-12">
            <Button 
              onClick={() => setLocation("/crm/fisioterapeuta")}
              className="bg-primary hover:bg-primary/90 text-white px-8 py-6 text-lg rounded-full shadow-lg shadow-primary/20 group h-auto"
            >
              <Activity className="mr-2 h-5 w-5 opacity-90" />
              Ver Demo CRM Fisioterapeuta
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">
            {[
              {
                title: "Plataformas SaaS de Vanguardia",
                desc: "Crea sistemas de gestión de tareas, CRMs, o cualquier plataforma SaaS con funcionalidades avanzadas y escalabilidad garantizada.",
                image: "https://images.unsplash.com/photo-1540350394557-8d14678e7f91?q=80&w=800&auto=format&fit=crop",
                tags: ["React", "Express", "MongoDB"]
              },
              {
                title: "E-commerce de Alto Rendimiento",
                desc: "Lanza tiendas online con catálogos dinámicos, pasarelas de pago integradas (Stripe) y paneles de administración intuitivos.",
                image: "https://images.unsplash.com/photo-1472851294608-062f824d29cc?q=80&w=800&auto=format&fit=crop",
                tags: ["Stripe", "Tailwind", "Vite"]
              },
              {
                title: "Dashboards de Analítica Avanzada",
                desc: "Visualiza tus datos con gráficos interactivos, filtros potentes y exportación de informes para una toma de decisiones inteligente.",
                image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=800&auto=format&fit=crop",
                tags: ["Recharts", "Lucide", "Framer Motion"]
              },
              {
                title: "CRMs y Herramientas de Ventas",
                desc: "Optimiza tus procesos de venta con CRMs personalizados, seguimiento de leads y automatización de recordatorios.",
                image: "https://images.unsplash.com/photo-1552581234-26160f608093?q=80&w=800&auto=format&fit=crop",
                tags: ["CRM", "Full-stack", "IA"]
              },
              {
                title: "Plataformas Educativas Interactivas",
                desc: "Desarrolla entornos de aprendizaje online con gestión de cursos, seguimiento de progreso y herramientas de evaluación.",
                image: "https://images.unsplash.com/photo-1501504905252-473c47e087f8?q=80&w=800&auto=format&fit=crop",
                tags: ["EdTech", "PWA", "Node.js"]
              },
              {
                title: "Soluciones de RRHH Inteligentes",
                desc: "Implementa portales de empleado, sistemas de gestión de nóminas y herramientas de evaluación de desempeño para tu equipo.",
                image: "https://images.unsplash.com/photo-1521737711867-e3b97375f902?q=80&w=800&auto=format&fit=crop",
                tags: ["Internal Tools", "Auth", "Clerk"]
              }
            ].map((app, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                viewport={{ once: true }}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-card/30 hover:border-primary/30 transition-all"
              >
                <div className="aspect-video overflow-hidden">
                  <img
                    src={app.image}
                    alt={app.title}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                </div>
                <div className="p-6">
                  <div className="flex flex-wrap gap-2 mb-4">
                    {app.tags.map((tag, j) => (
                      <span key={j} className="px-2 py-0.5 rounded-full bg-primary/10 text-[10px] font-medium text-primary border border-primary/20">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{app.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{app.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 border-y border-white/5 bg-card/20 backdrop-blur-sm">
        <div className="container px-4 md:px-8 mx-auto max-w-5xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 text-center">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} viewport={{ once: true }} className="flex flex-col items-center justify-center">
              <TrendingUp className="h-10 w-10 text-primary mb-3" />
              <div className="text-4xl font-bold text-white mb-1">9</div>
              <div className="text-sm text-muted-foreground">Agentes IA especializados</div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} viewport={{ once: true }} className="flex flex-col items-center justify-center">
              <Clock className="h-10 w-10 text-primary mb-3" />
              <div className="text-4xl font-bold text-white mb-1">&lt; 5 min</div>
              <div className="text-sm text-muted-foreground">De idea a app funcional</div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} viewport={{ once: true }} className="flex flex-col items-center justify-center">
              <Globe className="h-10 w-10 text-primary mb-3" />
              <div className="text-4xl font-bold text-white mb-1">100%</div>
              <div className="text-sm text-muted-foreground">Código exportable tuyo</div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} viewport={{ once: true }} className="flex flex-col items-center justify-center">
              <Star className="h-10 w-10 text-primary mb-3" />
              <div className="text-4xl font-bold text-white mb-1">Gratis</div>
              <div className="text-sm text-muted-foreground">Para empezar hoy</div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Code animation + features */}
      <section className="py-24 relative">
        <div className="container px-4 md:px-8 mx-auto max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }} viewport={{ once: true }}>
              <h2 className="text-4xl font-bold text-white mb-6">Ingeniería de Software <br />
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  a la velocidad de la IA.
                </span>
              </h2>
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                Maris AI va más allá de los generadores de código. Nuestro equipo de agentes IA orquesta un proceso de desarrollo completo, entregando código optimizado y listo para producción.
              </p>
              <div className="space-y-5">
                {[
                  { title: "Arquitectura Inteligente", desc: "Nuestra IA diseña la estructura óptima de tu aplicación, aplicando patrones de diseño robustos y escalables.", icon: Code2 },
                  { title: "Despliegue Instantáneo", desc: "Desde la idea hasta una aplicación funcional en minutos, lista para iterar y crecer a la velocidad de tu negocio.", icon: Zap },
                  { title: "Propiedad Total del Código", desc: "Recibe código limpio, modular y 100% tuyo (React, Vite, Node.js). Exporta a GitHub y despliega donde quieras, sin ataduras.", icon: Globe },
                  { title: "Integración Git Nativa", desc: "Cada generación se traduce en un commit en tu repositorio GitHub, ofreciendo un historial de versiones completo y transparente.", icon: GitBranch }
                ].map((feature, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex-shrink-0 h-9 w-9 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30">
                      <feature.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white mb-0.5">{feature.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }} viewport={{ once: true }} className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-purple-500/20 to-cyan-500/20 rounded-2xl blur-xl"></div>
              <div className="relative rounded-2xl border border-white/10 bg-background/80 backdrop-blur shadow-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/5">
                  <div className="h-3 w-3 rounded-full bg-red-500/80"></div>
                  <div className="h-3 w-3 rounded-full bg-yellow-500/80"></div>
                  <div className="h-3 w-3 rounded-full bg-green-500/80"></div>
                  <span className="text-xs text-muted-foreground ml-2 font-mono">Dashboard.tsx</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" style={{animation:"marisBlob 2s ease-in-out infinite",transform:"translateZ(0)"}}></div>
                    <span className="text-xs text-emerald-400 font-mono">generando...</span>
                  </div>
                </div>
                <div className="p-4 flex gap-4 min-h-[380px]">
                  <div className="flex flex-col text-right font-mono text-xs text-white/20 select-none">
                    {Array.from({ length: 20 }, (_, i) => (
                      <span key={i} className="leading-6">{i + 1}</span>
                    ))}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <CodeAnimation />
                  </div>
                </div>
                <div className="px-4 py-2 border-t border-white/5 bg-white/5 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-mono">TypeScript React</span>
                  <span className="text-xs text-emerald-400 font-mono">✓ Sin errores</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Ejemplos */}
      <section className="py-24 border-y border-white/5 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/30 to-transparent -z-10"></div>
        <div className="container px-4 md:px-8 mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Hecho con Maris AI</h2>
            <p className="text-muted-foreground text-lg">Ejemplos de lo que puedes construir en minutos.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {[
              { title: "Panel CRM", desc: "CRM completo con seguimiento de clientes, calificación de leads y analítica de ingresos.", icon: LayoutDashboard, color: "text-blue-400", border: "border-blue-500/20", bg: "bg-blue-500/5" },
              { title: "Control de Inventario", desc: "Gestión de stock en tiempo real con alertas de inventario bajo y pedidos a proveedores.", icon: CheckCircle2, color: "text-green-400", border: "border-green-500/20", bg: "bg-green-500/5" },
              { title: "Estudio de Contenido IA", desc: "Interfaz de generación de texto con historial, variaciones y exportación.", icon: Zap, color: "text-purple-400", border: "border-purple-500/20", bg: "bg-purple-500/5" },
              { title: "App de Reservas", desc: "Sistema de reservas con calendario, notificaciones y panel de administración.", icon: Database, color: "text-orange-400", border: "border-orange-500/20", bg: "bg-orange-500/5" },
              { title: "App Móvil PWA", desc: "Progressive Web App instalable con soporte offline y notificaciones push.", icon: Smartphone, color: "text-cyan-400", border: "border-cyan-500/20", bg: "bg-cyan-500/5" },
              { title: "Portal de Noticias", desc: "Blog con editor Markdown, SEO optimizado y sitemap para Google News.", icon: Newspaper, color: "text-pink-400", border: "border-pink-500/20", bg: "bg-pink-500/5" },
            ].map((ex, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }} viewport={{ once: true }}
                className={`p-6 rounded-xl border ${ex.border} ${ex.bg} hover:-translate-y-1 transition-all duration-300`}>
                <div className={`h-11 w-11 rounded-lg bg-background/60 flex items-center justify-center mb-4 border ${ex.border}`}>
                  <ex.icon className={`h-5 w-5 ${ex.color}`} />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{ex.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{ex.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Early Adopters */}
      <section className="py-24 relative overflow-hidden">
        <div className="container px-4 md:px-8 mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Sé pionero en la era del Vibe Coding.</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Maris AI es la herramienta definitiva para visionarios. Únete a nuestra comunidad de early adopters y co-crea el futuro del desarrollo de software.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {[
              { icon: Zap, title: "Pruébalo gratis ahora", desc: "Genera tu primera app sin tarjeta de crédito. Sin límite de tiempo para explorar la plataforma." },
              { icon: Users, title: "Acceso directo al creador", desc: "Los primeros usuarios tienen línea directa. Tu feedback da forma al producto desde el primer día." },
              { icon: Star, title: "Precio de lanzamiento", desc: "El mejor precio disponible, solo para los primeros. Una vez llenos los cupos, sube." },
            ].map((item, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }} viewport={{ once: true }}
                className="p-6 rounded-xl border border-white/10 bg-card/40 backdrop-blur hover:border-primary/30 transition-all text-center">
                <div className="h-11 w-11 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-4">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              ¿Tienes dudas antes de registrarte?{" "}
              <a href="mailto:hola@marisai.es" className="text-primary hover:underline">Escríbenos directamente</a>{" "}
              — respondemos en menos de 24 horas.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-primary/10 blur-[100px] rounded-full pointer-events-none"></div>
        <div className="container px-4 md:px-8 mx-auto text-center relative z-10">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-4xl md:text-6xl font-bold text-white mb-6 tracking-tight">
              Tu próxima app empieza <br />
              <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">con una frase.</span>
            </h2>
            <p className="text-xl text-muted-foreground mb-10 max-w-xl mx-auto">
              Sin programar. Sin contratar. Sin esperar semanas.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/sign-up">
                <Button size="lg" className="h-12 md:h-14 px-6 md:px-10 text-base md:text-lg bg-white text-black hover:bg-white/90 shadow-[0_0_60px_-10px_rgba(255,255,255,0.4)] font-semibold w-full sm:w-auto">
                  Empieza gratis <ChevronRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/news">
                <Button size="lg" variant="outline" className="h-14 px-10 text-lg border-white/20 text-white hover:bg-white/10">
                  <Newspaper className="mr-2 h-5 w-5" /> Últimas noticias
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      </main>
      <footer className="py-12 border-t border-white/5 bg-background/80 backdrop-blur" role="contentinfo">
        <div className="container px-4 md:px-8 mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <img src={`${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/logo.svg`} alt="Maris AI" className="h-5 w-5 opacity-70" width="20" height="20" loading="lazy" decoding="async" />
                <span className="font-semibold text-muted-foreground">Maris AI</span>
              </div>
              <p className="text-xs text-muted-foreground/60">Generador de apps con IA. Describe tu idea, recibe una app real.</p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-3 text-sm">Producto</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/pricing" className="hover:text-white transition-colors">Precios</Link></li>
                <li><Link href="/vs-emergent" className="hover:text-white transition-colors">vs Competidores</Link></li>
                <li><Link href="/news" className="hover:text-white transition-colors">Noticias</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-3 text-sm">Compañía</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="mailto:hola@marisai.es" className="hover:text-white transition-colors">Contacto</a></li>
                <li><a href="mailto:soporte@marisai.es" className="hover:text-white transition-colors">Soporte</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-3 text-sm">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/legal/privacidad" className="hover:text-white transition-colors">Privacidad</Link></li>
                <li><Link href="/legal/aviso-legal" className="hover:text-white transition-colors">Aviso Legal</Link></li>
                <li><Link href="/legal/cookies" className="hover:text-white transition-colors">Cookies</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/5 pt-8 mb-6">
            <a href="https://www.producthunt.com/products/maris-ai?embed=true&utm_source=embed&utm_medium=post_embed" target="_blank" rel="noopener">
              <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=maris-ai&theme=dark" alt="Maris AI on Product Hunt" width="250" height="54" loading="lazy" decoding="async" />
            </a>
          </div>
          <div className="border-t border-white/5 pt-6 text-center">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Maris AI Inc. Todos los derechos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
