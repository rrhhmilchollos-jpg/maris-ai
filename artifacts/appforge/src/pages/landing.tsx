import { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Zap, Code2, Globe, ArrowRight, CheckCircle2, LayoutDashboard,
  Database, Smartphone, Newspaper, ChevronRight, GitBranch, Star,
  Users, TrendingUp, Clock
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
          <span className="animate-pulse text-primary">|</span>
        </div>
      )}
    </div>
  );
}

function AuroraBackground() {
  return (
    <div className="fixed inset-0 -z-20 overflow-hidden pointer-events-none">
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-20 blur-[100px] animate-pulse"
        style={{ background: "radial-gradient(circle, #7c3aed, transparent)" }} />
      <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full opacity-15 blur-[120px]"
        style={{ background: "radial-gradient(circle, #0ea5e9, transparent)", animation: "pulse 4s ease-in-out infinite 1s" }} />
      <div className="absolute -bottom-40 left-1/3 w-[700px] h-[400px] rounded-full opacity-10 blur-[150px]"
        style={{ background: "radial-gradient(circle, #ec4899, transparent)", animation: "pulse 6s ease-in-out infinite 2s" }} />
      <div className="absolute inset-0"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)", backgroundSize: "40px 40px" }} />
    </div>
  );
}

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { isSignedIn } = useAuth();
  const [prompt, setPrompt] = useState("");
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0.3]);

  useEffect(() => {
    const saved = localStorage.getItem("appforge_pending_prompt");
    if (saved) setPrompt(saved);
  }, []);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    localStorage.setItem("appforge_pending_prompt", prompt);
    setLocation(isSignedIn ? "/dashboard" : "/sign-up");
  };

  const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };
  const stagger = { animate: { transition: { staggerChildren: 0.1 } } };

  const stats = [
    { value: "2,400+", label: "Apps generadas", icon: TrendingUp },
    { value: "890+", label: "Usuarios activos", icon: Users },
    { value: "4.2 min", label: "Tiempo medio", icon: Clock },
    { value: "4.9★", label: "Valoración", icon: Star },
  ];

  const testimonials = [
    { name: "Carlos M.", role: "Founder, SaaS startup", text: "En 8 minutos tenía un MVP funcional listo para mostrar a inversores. Increíble.", avatar: "CM" },
    { name: "Laura G.", role: "Diseñadora freelance", text: "Paso de idea a prototipo en tiempo real. Mis clientes no pueden creerlo.", avatar: "LG" },
    { name: "Iñaki R.", role: "CTO, Agencia digital", text: "Entregamos proyectos 5x más rápido. El ROI es brutal.", avatar: "IR" },
    { name: "Sofía P.", role: "Product Manager", text: "La calidad del código generado es tan buena que nuestros devs lo usan directamente.", avatar: "SP" },
    { name: "Diego F.", role: "Indie developer", text: "Lancé mi SaaS en un fin de semana. Algo impensable antes de Maris AI.", avatar: "DF" },
    { name: "Ana T.", role: "Entrepreneur", text: "Validé 3 ideas de negocio en una semana con apps reales. Game changer.", avatar: "AT" },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <AuroraBackground />

      <header className="fixed top-0 z-50 w-full border-b border-border/10 bg-background/60 backdrop-blur-xl">
        <div className="container flex h-14 max-w-screen-2xl items-center px-4 md:px-8 justify-between">
          <div className="flex items-center space-x-2">
            <img src={`${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/logo.svg`} alt="Maris AI" className="h-6 w-6" />
            <span className="font-bold tracking-tight text-lg text-white">Maris AI</span>
          </div>
          <nav className="hidden md:flex items-center space-x-6 text-sm text-muted-foreground">
            <Link href="/news" className="hover:text-white transition-colors">Noticias</Link>
          </nav>
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
                  <Button className="bg-primary hover:bg-primary/90 text-white text-sm">Comenzar gratis</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden min-h-screen flex items-center justify-center">
        <motion.div style={{ opacity: heroOpacity }} className="container px-4 md:px-8 max-w-6xl mx-auto relative z-10">
          <motion.div initial="initial" animate="animate" variants={stagger} className="text-center">
            <motion.div variants={fadeIn} className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary mb-8 backdrop-blur-sm">
              <Zap className="mr-2 h-3.5 w-3.5" />
              <span>Inteligencia artificial de última generación</span>
            </motion.div>

            <motion.h1 variants={fadeIn} className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tighter text-white mb-6 leading-[1.05]">
              Escribe una idea. <br />
              <span className="bg-gradient-to-r from-primary via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                Recibe una app real.
              </span>
            </motion.h1>

            <motion.p variants={fadeIn} className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto font-light leading-relaxed">
              Describe lo que quieres construir y nuestra plataforma de IA lo convierte en una aplicación completa y funcional lista para producción.
            </motion.p>

            <motion.div variants={fadeIn} className="max-w-3xl mx-auto relative mb-6">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-primary via-purple-500 to-cyan-500 rounded-2xl blur opacity-30"></div>
              <form onSubmit={handleGenerate} className="relative flex flex-col sm:flex-row gap-2 bg-background/90 backdrop-blur rounded-2xl border border-white/10 p-2 shadow-2xl">
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
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
                  className="px-3 py-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:text-white transition-all text-xs">
                  {ex}
                </button>
              ))}
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* Stats */}
      <section className="py-16 border-y border-white/5 bg-card/20 backdrop-blur-sm">
        <div className="container px-4 md:px-8 mx-auto max-w-5xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }} viewport={{ once: true }} className="text-center">
                <div className="flex justify-center mb-3">
                  <div className="h-10 w-10 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                    <stat.icon className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <div className="text-3xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Code animation + features */}
      <section className="py-24 relative">
        <div className="container px-4 md:px-8 mx-auto max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }} viewport={{ once: true }}>
              <h2 className="text-4xl font-bold text-white mb-6">Código real. <br />
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  Generado en tiempo real.
                </span>
              </h2>
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                Maris AI no genera plantillas genéricas. Cada aplicación se construye desde cero, adaptada exactamente a lo que describes.
              </p>
              <div className="space-y-5">
                {[
                  { title: "Arquitectura impulsada por IA", desc: "Nuestra plataforma entiende la estructura de aplicaciones y elige los patrones correctos para tu caso de uso.", icon: Code2 },
                  { title: "Listo en minutos", desc: "Tu app completa lista para producción en minutos. Itera con la misma rapidez.", icon: Zap },
                  { title: "Código tuyo, para siempre", desc: "Sin ataduras. Código React + Vite limpio que puedes exportar y desplegar donde quieras.", icon: Globe },
                  { title: "Control de versiones integrado", desc: "Cada generación crea un commit en tu repositorio GitHub. Historial completo.", icon: GitBranch },
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

            {/* Código animado */}
            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }} viewport={{ once: true }} className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-purple-500/20 to-cyan-500/20 rounded-2xl blur-xl"></div>
              <div className="relative rounded-2xl border border-white/10 bg-background/80 backdrop-blur shadow-2xl overflow-hidden">
                {/* Barra del editor */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/5">
                  <div className="h-3 w-3 rounded-full bg-red-500/80"></div>
                  <div className="h-3 w-3 rounded-full bg-yellow-500/80"></div>
                  <div className="h-3 w-3 rounded-full bg-green-500/80"></div>
                  <span className="text-xs text-muted-foreground ml-2 font-mono">Dashboard.tsx</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
                    <span className="text-xs text-emerald-400 font-mono">generando...</span>
                  </div>
                </div>
                {/* Números de línea + código */}
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
                {/* Barra de estado */}
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
            <p className="text-muted-foreground text-lg">Lo que nuestra comunidad está creando a velocidad récord.</p>
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

      {/* Testimonios */}
      <section className="py-24 relative overflow-hidden">
        <div className="container px-4 md:px-8 mx-auto max-w-7xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Lo que dicen nuestros usuarios</h2>
            <p className="text-muted-foreground text-lg">Miles de personas ya están creando con Maris AI.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {testimonials.map((t, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }} viewport={{ once: true }}
                className="p-6 rounded-xl border border-white/10 bg-card/40 backdrop-blur hover:border-white/20 transition-all">
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="text-white/80 text-sm leading-relaxed mb-5">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/30 border border-primary/40 flex items-center justify-center text-xs font-bold text-primary">
                    {t.avatar}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.role}</p>
                  </div>
                </div>
              </motion.div>
            ))}
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
              Únete a miles de personas creando software con inteligencia artificial.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/sign-up">
                <Button size="lg" className="h-14 px-10 text-lg bg-white text-black hover:bg-white/90 shadow-[0_0_60px_-10px_rgba(255,255,255,0.4)] font-semibold">
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

      <footer className="py-12 border-t border-white/5 bg-background/80 backdrop-blur">
        <div className="container px-4 md:px-8 mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between mb-8">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <img src={`${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/logo.svg`} alt="Maris AI" className="h-5 w-5 opacity-70" />
              <span className="font-semibold text-muted-foreground">Maris AI</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link href="/news" className="hover:text-white transition-colors">Noticias</Link>
              <a href="mailto:hola@marisai.es" className="hover:text-white transition-colors">Contacto</a>
            </div>
          </div>
          <div className="flex justify-center mb-6">
            <a href="https://www.producthunt.com/products/maris-ai?embed=true&utm_source=embed&utm_medium=post_embed" target="_blank" rel="noopener">
              <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=maris-ai&theme=dark" alt="Maris AI on Product Hunt" style={{height: "54px"}} />
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
