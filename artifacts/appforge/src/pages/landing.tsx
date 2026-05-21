import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Zap, Code2, Globe, ArrowRight, CheckCircle2, LayoutDashboard,
  Search, Cpu, Palette, MonitorSmartphone, Server, ShieldCheck,
  Wrench, GitBranch, Layers, Sparkles, Database, Smartphone,
  Newspaper, ChevronRight, Star, Bot
} from "lucide-react";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { isSignedIn } = useAuth();
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("appforge_pending_prompt");
    if (saved) {
      setPrompt(saved);
    }
  }, []);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (isSignedIn) {
      localStorage.setItem("appforge_pending_prompt", prompt);
      setLocation("/dashboard");
    } else {
      localStorage.setItem("appforge_pending_prompt", prompt);
      setLocation("/sign-up");
    }
  };

  // Animaciones optimizadas para móvil:
  // - Usar solo opacity (sin y/transform) para evitar forced reflow en Framer Motion
  // - Reducir duración en móvil para mejorar TBT
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const fadeIn = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: isMobile ? 0.2 : 0.4 }
  };

  const stagger = {
    animate: { transition: { staggerChildren: isMobile ? 0.05 : 0.1 } }
  };

  // Pipeline de agentes actualizado con modelos reales
  const agents = [
    {
      id: 1,
      name: "Researcher",
      role: "Investigador",
      model: "Claude Haiku 4.5",
      provider: "Anthropic",
      desc: "Analiza URLs de referencia, busca contexto visual y genera un brief de marca para orientar al resto del pipeline.",
      icon: Search,
      color: "from-blue-500/20 to-blue-600/10",
      border: "border-blue-500/30",
      badge: "bg-blue-500/20 text-blue-300",
      timeout: "18s",
    },
    {
      id: 2,
      name: "Architect",
      role: "Arquitecto",
      model: "Claude Haiku 4.5",
      provider: "Anthropic",
      desc: "Diseña la estructura completa del proyecto: páginas, componentes, hooks, modelos de datos y archivos necesarios.",
      icon: Cpu,
      color: "from-violet-500/20 to-violet-600/10",
      border: "border-violet-500/30",
      badge: "bg-violet-500/20 text-violet-300",
      timeout: "35s",
    },
    {
      id: 3,
      name: "Designer",
      role: "Diseñador",
      model: "Claude Haiku 4.5",
      provider: "Anthropic",
      desc: "Genera el sistema de diseño visual: paleta de colores, tipografía, espaciado y tokens de Tailwind personalizados.",
      icon: Palette,
      color: "from-pink-500/20 to-pink-600/10",
      border: "border-pink-500/30",
      badge: "bg-pink-500/20 text-pink-300",
      timeout: "15s",
    },
    {
      id: 4,
      name: "Frontend Engineer",
      role: "Ing. Frontend",
      model: "Claude Sonnet 3.5",
      provider: "Anthropic",
      desc: "Genera el bundle React completo: todas las páginas, componentes, hooks y configuración de Vite + Tailwind.",
      icon: MonitorSmartphone,
      color: "from-emerald-500/20 to-emerald-600/10",
      border: "border-emerald-500/30",
      badge: "bg-emerald-500/20 text-emerald-300",
      timeout: "600s",
      highlight: true,
    },
    {
      id: 5,
      name: "Backend Engineer",
      role: "Ing. Backend",
      model: "Claude Sonnet 3.5",
      provider: "Anthropic",
      desc: "Escribe el servidor Express + TypeScript con rutas REST, validación Zod, Drizzle ORM y manejo de errores.",
      icon: Server,
      color: "from-orange-500/20 to-orange-600/10",
      border: "border-orange-500/30",
      badge: "bg-orange-500/20 text-orange-300",
      timeout: "600s",
      highlight: true,
    },
    {
      id: 6,
      name: "Image Agent",
      role: "Agente de Imágenes",
      model: "Gemini 3 Pro Image",
      provider: "Google",
      desc: "Reemplaza placeholders de Unsplash/Picsum con imágenes reales generadas por IA, adaptadas al contexto de la app.",
      icon: Sparkles,
      color: "from-yellow-500/20 to-yellow-600/10",
      border: "border-yellow-500/30",
      badge: "bg-yellow-500/20 text-yellow-300",
      timeout: "60s",
    },
    {
      id: 7,
      name: "QA Reviewer",
      role: "Revisor QA",
      model: "Claude Sonnet 3.5",
      provider: "Anthropic",
      desc: "Revisa el bundle generado, detecta imports rotos, archivos faltantes y problemas de estructura antes del despliegue.",
      icon: ShieldCheck,
      color: "from-cyan-500/20 to-cyan-600/10",
      border: "border-cyan-500/30",
      badge: "bg-cyan-500/20 text-cyan-300",
      timeout: "30s",
    },
    {
      id: 8,
      name: "Patcher",
      role: "Parcheador",
      model: "Claude Haiku 4.5",
      provider: "Anthropic",
      desc: "Corrige automáticamente los issues detectados por el QA Reviewer, aplicando parches quirúrgicos sin regenerar todo el bundle.",
      icon: Wrench,
      color: "from-red-500/20 to-red-600/10",
      border: "border-red-500/30",
      badge: "bg-red-500/20 text-red-300",
      timeout: "30s",
    },
    {
      id: 9,
      name: "Visual Evaluator",
      role: "Evaluador Visual",
      model: "Claude Opus 4.7",
      provider: "Anthropic",
      desc: "Toma capturas de pantalla del bundle renderizado y evalúa si la app cumple la intención original del usuario.",
      icon: Star,
      color: "from-indigo-500/20 to-indigo-600/10",
      border: "border-indigo-500/30",
      badge: "bg-indigo-500/20 text-indigo-300",
      timeout: "60s",
    },
  ];

  // Herramientas y librerías del stack
  const tools = [
    { name: "React 18", category: "Frontend", icon: "⚛️" },
    { name: "TypeScript", category: "Lenguaje", icon: "🔷" },
    { name: "Tailwind CSS v3", category: "Estilos", icon: "🎨" },
    { name: "Vite 6", category: "Build", icon: "⚡" },
    { name: "Wouter v3", category: "Router", icon: "🗺️" },
    { name: "Framer Motion", category: "Animaciones", icon: "🎭" },
    { name: "Lucide React", category: "Iconos", icon: "✨" },
    { name: "Recharts", category: "Gráficas", icon: "📊" },
    { name: "Zod", category: "Validación", icon: "🛡️" },
    { name: "React Hook Form", category: "Formularios", icon: "📝" },
    { name: "date-fns", category: "Fechas", icon: "📅" },
    { name: "Radix UI", category: "Componentes", icon: "🧩" },
    { name: "Express 5", category: "Backend", icon: "🚀" },
    { name: "Drizzle ORM", category: "Base de datos", icon: "🗄️" },
    { name: "PostgreSQL", category: "Base de datos", icon: "🐘" },
    { name: "MongoDB", category: "Base de datos", icon: "🍃" },
    { name: "Stripe", category: "Pagos", icon: "💳" },
    { name: "Clerk Auth", category: "Autenticación", icon: "🔐" },
    { name: "Sandpack", category: "Preview", icon: "🖥️" },
    { name: "WebContainers", category: "Runtime", icon: "📦" },
    { name: "GitHub API", category: "Control de versiones", icon: "🐙" },
    { name: "Vercel API", category: "Despliegue", icon: "▲" },
    { name: "Puppeteer", category: "Testing visual", icon: "🤖" },
    { name: "Pino", category: "Logging", icon: "📋" },
    { name: "BullMQ", category: "Colas", icon: "⚙️" },
    { name: "Redis", category: "Caché", icon: "🔴" },
    { name: "E2B Sandbox", category: "Ejecución segura", icon: "🏖️" },
    { name: "Sentry", category: "Monitoreo", icon: "🔍" },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="absolute top-0 z-50 w-full border-b border-border/10 bg-transparent">
        <div className="container flex h-14 max-w-screen-2xl items-center px-4 md:px-8 justify-between">
          <div className="flex items-center space-x-2">
            <img src={`${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/logo.svg`} alt="Maris AI" className="h-6 w-6" />
            <span className="font-bold sm:inline-block tracking-tight text-lg text-white">Maris AI</span>
          </div>
          <nav className="hidden md:flex items-center space-x-6 text-sm text-muted-foreground">
            <a href="#agentes" className="hover:text-white transition-colors">Agentes</a>
            <a href="#herramientas" className="hover:text-white transition-colors">Herramientas</a>
            <Link href="/news" className="hover:text-white transition-colors">Noticias</Link>
          </nav>
          <div className="flex items-center space-x-4">
            {isSignedIn ? (
              <Link href="/dashboard">
                <Button variant="ghost" className="text-white hover:bg-white/10">Panel</Button>
              </Link>
            ) : (
              <>
                <Link href="/sign-in">
                  <Button variant="ghost" className="text-white hover:bg-white/10">Iniciar Sesión</Button>
                </Link>
                <Link href="/sign-up">
                  <Button className="bg-white text-black hover:bg-white/90">Comenzar</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden min-h-screen flex items-center justify-center">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_center,_var(--tw-gradient-stops))] from-primary/20 via-background to-background"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -z-20 w-[800px] h-[800px] opacity-30 bg-primary/30 blur-[120px] rounded-full pointer-events-none"></div>
        <div className="container px-4 md:px-8 max-w-5xl mx-auto text-center relative z-10">
          <motion.div initial="initial" animate="animate" variants={stagger}>
            <motion.div variants={fadeIn} className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm font-medium text-primary-foreground backdrop-blur-sm mb-8">
              <Zap className="mr-2 h-4 w-4 text-primary" />
              <span>Maris AI Core v2.0 — 9 agentes especializados</span>
            </motion.div>
            <motion.h1 variants={fadeIn} className="text-5xl md:text-7xl font-bold tracking-tighter text-white mb-6 leading-tight">
              Escribe una idea. <br />
              <span className="gradient-text">Recibe una app real.</span>
            </motion.h1>
            <motion.p variants={fadeIn} className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto font-light leading-relaxed">
              Un pipeline de 9 agentes de IA especializados — desde el investigador hasta el evaluador visual — genera aplicaciones listas para producción en minutos.
            </motion.p>
            <motion.div variants={fadeIn} className="max-w-3xl mx-auto bg-card/40 backdrop-blur-xl p-2 rounded-2xl border border-white/10 shadow-2xl relative">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-primary to-accent rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
              <form onSubmit={handleGenerate} className="relative flex flex-col sm:flex-row gap-2 bg-background/80 rounded-xl p-2">
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="ej. Crea una app de gestión de tareas con tableros, arrastrar y soltar, y modo oscuro..."
                  className="min-h-[60px] max-h-[200px] resize-y border-0 focus-visible:ring-0 bg-transparent text-base md:text-lg placeholder:text-muted-foreground/80 shadow-none font-sans"
                  data-testid="input-prompt"
                />
                <Button
                  type="submit"
                  size="lg"
                  className="sm:h-auto sm:px-8 bg-primary hover:bg-primary/90 text-white font-medium shadow-lg hover:shadow-primary/25 transition-all self-end sm:self-stretch whitespace-nowrap"
                  data-testid="button-generate"
                >
                  Generar App <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </form>
            </motion.div>
            <motion.div variants={fadeIn} className="mt-6 flex flex-wrap justify-center gap-3 text-sm text-muted-foreground">
              {["Panel CRM", "E-commerce", "App móvil", "Dashboard analytics", "SaaS MVP", "Landing page"].map((ex) => (
                <button
                  key={ex}
                  onClick={() => setPrompt(`Crea un ${ex.toLowerCase()}`)}
                  className="px-3 py-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:text-white transition-all text-xs"
                >
                  {ex}
                </button>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Agentes del pipeline */}
      <section id="agentes" className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card/20 to-background -z-10"></div>
        <div className="container px-4 md:px-8 mx-auto max-w-7xl">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4 border-primary/50 text-primary-foreground bg-primary/80">
              <Bot className="mr-2 h-3 w-3" /> Pipeline Multi-Agente
            </Badge>
            <h2 className="text-4xl font-bold text-white mb-4">9 agentes especializados trabajando en paralelo</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Cada agente tiene un rol, un modelo de IA y un timeout optimizados para su tarea. El resultado: apps de producción sin compromisos.
            </p>
          </div>

          {/* Pipeline visual */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className={`relative rounded-xl border ${agent.border} bg-gradient-to-br ${agent.color} p-5 hover:-translate-y-1 transition-all duration-300 ${agent.highlight ? "ring-1 ring-white/10" : ""}`}
              >
                {agent.highlight && (
                  <div className="absolute -top-2 -right-2">
                    <Badge className="bg-primary text-white text-xs px-2 py-0.5">Principal</Badge>
                  </div>
                )}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-9 w-9 rounded-lg bg-background/60 flex items-center justify-center border ${agent.border}`}>
                      <agent.icon className="h-4 w-4 text-white/80" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-mono">Agente #{agent.id}</p>
                      <h3 className="text-sm font-semibold text-white">{agent.role}</h3>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">{agent.timeout}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">{agent.desc}</p>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${agent.badge}`}>
                    {agent.model}
                  </span>
                  <span className="text-xs text-muted-foreground">{agent.provider}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Modelos usados */}
          <div className="mt-8 p-6 rounded-2xl border border-white/5 bg-card/30 backdrop-blur-sm">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" /> Modelos de IA disponibles
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { model: "Claude Haiku 4.5", provider: "Anthropic", use: "Velocidad · Clasificación · Parches", color: "text-blue-400" },
                { model: "Claude Sonnet 3.5", provider: "Anthropic", use: "Calidad · Frontend · Backend · QA", color: "text-violet-400" },
                { model: "Claude Opus 4.7", provider: "Anthropic", use: "Visión · Evaluación visual avanzada", color: "text-pink-400" },
                { model: "Gemini 3 Pro Image", provider: "Google", use: "Generación de imágenes con IA", color: "text-yellow-400" },
                { model: "GPT-5.4", provider: "OpenAI", use: "Alternativa premium (seleccionable)", color: "text-emerald-400" },
              ].map((m) => (
                <div key={m.model} className="p-3 rounded-lg bg-background/40 border border-white/5">
                  <p className={`text-xs font-semibold font-mono ${m.color}`}>{m.model}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.provider}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-tight">{m.use}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Ejemplos */}
      <section className="py-24 bg-card/30 border-y border-white/5 relative overflow-hidden">
        <div className="container px-4 md:px-8 mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Hecho con Maris AI</h2>
            <p className="text-muted-foreground">Lo que nuestra comunidad está creando a velocidad récord.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {[
              { title: "Panel CRM", desc: "Un CRM completo con seguimiento de clientes, calificación de leads y analítica de ingresos.", icon: LayoutDashboard, color: "text-blue-400" },
              { title: "Control de Inventario", desc: "Gestión de stock en tiempo real con alertas de inventario bajo y pedidos a proveedores.", icon: CheckCircle2, color: "text-green-400" },
              { title: "Estudio de Contenido IA", desc: "Interfaz de generación de texto con historial, variaciones y exportación.", icon: Zap, color: "text-purple-400" },
              { title: "App de Reservas", desc: "Sistema de reservas con calendario, notificaciones y panel de administración.", icon: Database, color: "text-orange-400" },
              { title: "App Móvil PWA", desc: "Progressive Web App instalable con soporte offline y notificaciones push.", icon: Smartphone, color: "text-cyan-400" },
              { title: "Portal de Noticias", desc: "Blog con editor Markdown, SEO optimizado y sitemap para Google News.", icon: Newspaper, color: "text-pink-400" },
            ].map((ex, i) => (
              <div key={i} className="glass-card p-6 rounded-xl hover:-translate-y-1 transition-transform duration-300">
                <div className="h-12 w-12 rounded-lg bg-background flex items-center justify-center mb-4 border border-white/5">
                  <ex.icon className={`h-6 w-6 ${ex.color}`} />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">{ex.title}</h3>
                <p className="text-muted-foreground text-sm">{ex.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Herramientas y librerías */}
      <section id="herramientas" className="py-24 relative">
        <div className="container px-4 md:px-8 mx-auto max-w-7xl">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4 border-emerald-500/50 text-white bg-emerald-600/70">
              <Layers className="mr-2 h-3 w-3" /> Stack Tecnológico
            </Badge>
            <h2 className="text-4xl font-bold text-white mb-4">28 herramientas y librerías integradas</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Maris AI genera apps con el stack más moderno y probado en producción. Sin configuración manual.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {tools.map((tool) => (
              <div
                key={tool.name}
                className="flex flex-col items-center gap-2 p-3 rounded-xl border border-white/5 bg-card/30 hover:bg-card/50 hover:border-white/10 transition-all duration-200 text-center"
              >
                <span className="text-2xl">{tool.icon}</span>
                <span className="text-xs font-medium text-white leading-tight">{tool.name}</span>
                <span className="text-xs text-muted-foreground">{tool.category}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-32 relative bg-card/10">
        <div className="container px-4 md:px-8 mx-auto max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl font-bold text-white mb-6">Velocidad sin precedentes. <br />Calidad sin compromisos.</h2>
              <p className="text-xl text-muted-foreground mb-8">
                Maris AI no genera código de relleno. Escribe aplicaciones React completas y funcionales con manejo de estado, estilos y arquitectura sólida.
              </p>
              <div className="space-y-6">
                {[
                  { title: "Arquitectura impulsada por IA", desc: "Nuestros modelos entienden la estructura de aplicaciones y eligen los patrones correctos para tu caso de uso.", icon: Code2 },
                  { title: "Generación en minutos", desc: "El pipeline completo de 9 agentes tarda entre 3 y 12 minutos según la complejidad. Itera con la misma rapidez.", icon: Zap },
                  { title: "Acceso total al código", desc: "Sin ataduras. Recibes código React + Vite limpio y legible que puedes exportar a GitHub y desplegar en Vercel.", icon: Globe },
                  { title: "Control de versiones integrado", desc: "Cada generación crea un commit en tu repositorio GitHub. Historial completo de revisiones.", icon: GitBranch },
                ].map((feature, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30">
                      <feature.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-white mb-1">{feature.title}</h3>
                      <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-accent/20 blur-3xl -z-10 rounded-full"></div>
              <div className="glass-card rounded-2xl overflow-hidden border border-white/10 shadow-2xl p-6 space-y-3">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-3 w-3 rounded-full bg-red-500"></div>
                  <div className="h-3 w-3 rounded-full bg-yellow-500"></div>
                  <div className="h-3 w-3 rounded-full bg-green-500"></div>
                  <span className="text-xs text-muted-foreground ml-2 font-mono">pipeline.log</span>
                </div>
                {[
                  { step: "01", label: "Researcher", status: "✓", model: "haiku-4-5", time: "7s" },
                  { step: "02", label: "Architect", status: "✓", model: "haiku-4-5", time: "28s" },
                  { step: "03", label: "Designer", status: "✓", model: "haiku-4-5", time: "12s" },
                  { step: "04", label: "Frontend Engineer", status: "✓", model: "sonnet-3-5", time: "3m 42s" },
                  { step: "05", label: "Backend Engineer", status: "✓", model: "sonnet-3-5", time: "1m 18s" },
                  { step: "06", label: "Image Agent", status: "✓", model: "gemini-3-pro", time: "45s" },
                  { step: "07", label: "QA Reviewer", status: "✓", model: "sonnet-3-5", time: "8s" },
                  { step: "08", label: "Patcher", status: "✓", model: "haiku-4-5", time: "22s" },
                  { step: "09", label: "Visual Evaluator", status: "✓", model: "opus-4-7", time: "18s" },
                ].map((row) => (
                  <div key={row.step} className="flex items-center justify-between text-xs font-mono">
                    <span className="text-muted-foreground">[{row.step}]</span>
                    <span className="text-white/80 flex-1 ml-2">{row.label}</span>
                    <span className="text-muted-foreground mr-3">{row.model}</span>
                    <span className="text-muted-foreground mr-2">{row.time}</span>
                    <span className="text-emerald-400">{row.status}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs font-mono">
                  <span className="text-emerald-400 font-semibold">✓ App generada y desplegada</span>
                  <span className="text-muted-foreground">6m 40s total</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-primary/5"></div>
        <div className="container px-4 md:px-8 mx-auto text-center relative z-10">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">¿Listo para lanzar?</h2>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            Únete a miles de personas creando la próxima generación de software con 9 agentes de IA trabajando para ti.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/sign-up">
              <Button size="lg" className="h-14 px-8 text-lg bg-white text-black hover:bg-white/90 shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)]">
                Empieza a crear ahora <ChevronRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/news">
              <Button size="lg" variant="outline" className="h-14 px-8 text-lg border-white/20 text-white hover:bg-white/10">
                <Newspaper className="mr-2 h-5 w-5" /> Últimas noticias
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="py-12 border-t border-white/5 bg-background">
        <div className="container px-4 md:px-8 mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between mb-8">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <img src={`${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/logo.svg`} alt="Maris AI" className="h-5 w-5 opacity-70" />
              <span className="font-semibold text-muted-foreground">Maris AI</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link href="/news" className="hover:text-white transition-colors">Noticias</Link>
              <a href="https://github.com" className="hover:text-white transition-colors">GitHub</a>
              <a href="mailto:hola@maris-ai.shop" className="hover:text-white transition-colors">Contacto</a>
            </div>
          </div>
          <div className="flex justify-center mb-6">
  <a href="https://www.producthunt.com/products/maris-ai?embed=true&utm_source=embed&utm_medium=post_embed" target="_blank" rel="noopener">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=maris-ai&theme=dark" alt="Maris AI on Product Hunt" style={{height: "54px"}} />
  </a>
</div>
          <div className="border-t border-white/5 pt-6 flex flex-col md:flex-row items-center justify-between">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Maris AI Inc. Todos los derechos reservados.
            </p>
            <p className="text-xs text-muted-foreground mt-2 md:mt-0">
              Impulsado por Claude (Anthropic) · Gemini (Google) · GPT-5 (OpenAI)
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
