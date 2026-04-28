import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Zap, Code2, Globe, ArrowRight, CheckCircle2, LayoutDashboard } from "lucide-react";

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

  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5 }
  };

  const stagger = {
    animate: { transition: { staggerChildren: 0.1 } }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="absolute top-0 z-50 w-full border-b border-border/10 bg-transparent">
        <div className="container flex h-14 max-w-screen-2xl items-center px-4 md:px-8 justify-between">
          <div className="flex items-center space-x-2">
            <img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.svg`} alt="AppForge" className="h-6 w-6" />
            <span className="font-bold sm:inline-block tracking-tight text-lg text-white">AppForge</span>
          </div>
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
              <span>AppForge Core v2.0 ya disponible</span>
            </motion.div>
            
            <motion.h1 variants={fadeIn} className="text-5xl md:text-7xl font-bold tracking-tighter text-white mb-6 leading-tight">
              Escribe una idea. <br />
              <span className="gradient-text">Recibe una app real.</span>
            </motion.h1>
            
            <motion.p variants={fadeIn} className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto font-light leading-relaxed">
              Pon a trabajar a nuestro motor neuronal y genera aplicaciones listas para producción en segundos. De la idea al código desplegado sin escribir una sola línea.
            </motion.p>
            
            <motion.div variants={fadeIn} className="max-w-3xl mx-auto bg-card/40 backdrop-blur-xl p-2 rounded-2xl border border-white/10 shadow-2xl relative">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-primary to-accent rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
              <form onSubmit={handleGenerate} className="relative flex flex-col sm:flex-row gap-2 bg-background/80 rounded-xl p-2">
                <Textarea 
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="ej. Crea una app de gestión de tareas con tableros, arrastrar y soltar, y modo oscuro..." 
                  className="min-h-[60px] max-h-[200px] resize-y border-0 focus-visible:ring-0 bg-transparent text-base md:text-lg placeholder:text-muted-foreground/60 shadow-none font-sans"
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
          </motion.div>
        </div>
      </section>

      {/* Ejemplos */}
      <section className="py-24 bg-card/30 border-y border-white/5 relative overflow-hidden">
        <div className="container px-4 md:px-8 mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Hecho con AppForge</h2>
            <p className="text-muted-foreground">Lo que nuestra comunidad está creando a velocidad récord.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {[
              { title: "Panel CRM", desc: "Un CRM completo con seguimiento de clientes, calificación de leads y analítica de ingresos.", icon: LayoutDashboard, color: "text-blue-400" },
              { title: "Control de Inventario", desc: "Gestión de stock en tiempo real con alertas de inventario bajo y pedidos a proveedores.", icon: CheckCircle2, color: "text-green-400" },
              { title: "Estudio de Contenido IA", desc: "Interfaz de generación de texto con historial, variaciones y exportación.", icon: Zap, color: "text-purple-400" }
            ].map((ex, i) => (
              <div key={i} className="glass-card p-6 rounded-xl hover:-translate-y-1 transition-transform duration-300">
                <div className={`h-12 w-12 rounded-lg bg-background flex items-center justify-center mb-4 border border-white/5`}>
                  <ex.icon className={`h-6 w-6 ${ex.color}`} />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">{ex.title}</h3>
                <p className="text-muted-foreground text-sm">{ex.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-32 relative">
        <div className="container px-4 md:px-8 mx-auto max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl font-bold text-white mb-6">Velocidad sin precedentes. <br/>Calidad sin compromisos.</h2>
              <p className="text-xl text-muted-foreground mb-8">
                AppForge no genera código de relleno. Escribe aplicaciones React completas y funcionales con manejo de estado, estilos y arquitectura sólida.
              </p>
              
              <div className="space-y-6">
                {[
                  { title: "Arquitectura impulsada por IA", desc: "Nuestros modelos entienden la estructura de aplicaciones y eligen los patrones correctos para tu caso de uso.", icon: Code2 },
                  { title: "Generación instantánea", desc: "Pasa de un texto a una vista previa funcional en menos de 30 segundos. Itera con la misma rapidez.", icon: Zap },
                  { title: "Acceso total al código", desc: "Sin ataduras. Recibes código React + Vite limpio y legible que puedes desplegar donde quieras.", icon: Globe }
                ].map((feature, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30">
                      <feature.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="text-lg font-medium text-white mb-1">{feature.title}</h4>
                      <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-accent/20 blur-3xl -z-10 rounded-full"></div>
              <div className="glass-card rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                <img 
                  src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/images/hero-illustration.png`} 
                  alt="Generación neuronal de AppForge" 
                  className="w-full h-auto object-cover opacity-90 hover:opacity-100 transition-opacity"
                />
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
            Únete a miles de personas creando la próxima generación de software.
          </p>
          <Link href="/sign-up">
            <Button size="lg" className="h-14 px-8 text-lg bg-white text-black hover:bg-white/90 shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)]">
              Empieza a crear ahora
            </Button>
          </Link>
        </div>
      </section>

      <footer className="py-12 border-t border-white/5 bg-background">
        <div className="container px-4 md:px-8 mx-auto flex flex-col md:flex-row items-center justify-between">
          <div className="flex items-center space-x-2 mb-4 md:mb-0">
            <img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.svg`} alt="AppForge" className="h-5 w-5 grayscale opacity-50" />
            <span className="font-semibold text-muted-foreground">AppForge</span>
          </div>
          <p className="text-sm text-muted-foreground/60">
            © {new Date().getFullYear()} AppForge Inc. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
