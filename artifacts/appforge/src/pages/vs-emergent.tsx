import { Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Check, X, ArrowRight, ShieldCheck, Zap, Code2, Globe } from "lucide-react";

export default function VsEmergentPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30">
      {/* Hero Section */}
      <section className="pt-24 pb-16 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[radial-gradient(circle_at_center,rgba(124,58,237,0.08)_0%,transparent_70%)] -z-10"></div>
        <div className="container px-4 mx-auto max-w-5xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-6"
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Comparativa de Plataformas
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6"
          >
            Maris AI vs Emergent.sh
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10"
          >
            Descubre por qué Maris AI es la alternativa preferida para desarrolladores que buscan control total, 
            calidad de código de nivel senior y un pipeline de agentes más robusto.
          </motion.p>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-12 relative">
        <div className="container px-4 mx-auto max-w-4xl">
          <div className="rounded-2xl border border-white/10 bg-card/50 overflow-hidden shadow-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="p-6 text-sm font-semibold text-muted-foreground uppercase tracking-wider">Característica</th>
                  <th className="p-6 text-sm font-bold text-white text-center bg-primary/10">Maris AI</th>
                  <th className="p-6 text-sm font-semibold text-muted-foreground text-center">Emergent.sh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  { feature: "Agentes Especializados", maris: "9 Agentes (Pipeline Completo)", emergent: "Agente Único / Generalista" },
                  { feature: "Modelos Utilizados", maris: "Claude 4.6 + Gemini 3 + GPT-5", emergent: "Modelos Propios / Limitados" },
                  { feature: "Calidad del Código", maris: "Arquitectura Senior (Vite + Tailwind)", emergent: "Código Estándar" },
                  { feature: "Backend e Infraestructura", maris: "Express + Drizzle + PostgreSQL", emergent: "Enfoque Principal Frontend" },
                  { feature: "Soporte en Español", maris: "Completo (Nativo)", emergent: "Limitado / Inglés" },
                  { feature: "Exportación a GitHub", maris: "Integración Directa", emergent: "Sujeto a Plan" },
                  { feature: "Revisión de QA", maris: "Agente QA dedicado", emergent: "Manual / No disponible" },
                ].map((row, i) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="p-6 text-sm text-white/80 font-medium">{row.feature}</td>
                    <td className="p-6 text-center bg-primary/5">
                      <div className="flex flex-col items-center gap-1">
                        <Check className="h-5 w-5 text-emerald-400" />
                        <span className="text-xs text-white/60 font-medium">{row.maris}</span>
                      </div>
                    </td>
                    <td className="p-6 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <X className="h-5 w-5 text-red-400/60" />
                        <span className="text-xs text-muted-foreground">{row.emergent}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Key Advantages */}
      <section className="py-24">
        <div className="container px-4 mx-auto max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl border border-white/5 bg-card/30 hover:border-primary/30 transition-all group">
              <Zap className="h-10 w-10 text-primary mb-6 group-hover:scale-110 transition-transform" />
              <h3 className="text-xl font-bold text-white mb-3">Velocidad Extrema</h3>
              <p className="text-muted-foreground">Generamos el 100% de tu aplicación en menos de 10 minutos con despliegue automático.</p>
            </div>
            <div className="p-8 rounded-2xl border border-white/5 bg-card/30 hover:border-primary/30 transition-all group">
              <Code2 className="h-10 w-10 text-primary mb-6 group-hover:scale-110 transition-transform" />
              <h3 className="text-xl font-bold text-white mb-3">Código Senior</h3>
              <p className="text-muted-foreground">No más código "spaghetti". Usamos patrones de diseño modernos y TypeScript estricto.</p>
            </div>
            <div className="p-8 rounded-2xl border border-white/5 bg-card/30 hover:border-primary/30 transition-all group">
              <Globe className="h-10 w-10 text-primary mb-6 group-hover:scale-110 transition-transform" />
              <h3 className="text-xl font-bold text-white mb-3">Multi-Modelo</h3>
              <p className="text-muted-foreground">Combinamos lo mejor de Anthropic, Google y OpenAI para cada etapa del proceso.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 border-t border-white/5">
        <div className="container px-4 mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold text-white mb-6">Prueba la diferencia hoy mismo</h2>
          <p className="text-lg text-muted-foreground mb-10">
            Únete a los desarrolladores que han dejado atrás las herramientas limitadas por un pipeline de agentes real.
          </p>
          <Link href="/sign-up">
            <Button size="lg" className="h-14 px-8 text-lg bg-primary text-white hover:bg-primary/90">
              Crear mi App Gratis <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer simple */}
      <footer className="py-12 border-t border-white/5 bg-background/50">
        <div className="container px-4 mx-auto text-center">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Maris AI. Las marcas comerciales mencionadas pertenecen a sus respectivos propietarios.
          </p>
        </div>
      </footer>
    </div>
  );
}
