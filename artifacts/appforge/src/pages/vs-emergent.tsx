import { Check, X, ArrowRight, Zap, Code2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function VsCompetidoresPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="py-24 border-b border-white/5">
        <div className="container px-4 mx-auto max-w-4xl text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 leading-tight">
            ¿Por qué elegir{" "}
            <span className="text-primary">Maris AI</span>?
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            El primer generador de apps con IA diseñado para el mercado hispanohablante.
            Pipeline completo de 9 agentes especializados, desplegado en Vercel + Railway + MongoDB.
          </p>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-24">
        <div className="container px-4 mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold text-white text-center mb-16">
            Maris AI vs otras plataformas
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 bg-card/50">
                  <th className="p-6 text-left text-sm font-semibold text-muted-foreground">Característica</th>
                  <th className="p-6 text-sm font-semibold text-primary text-center bg-primary/10">Maris AI</th>
                  <th className="p-6 text-sm font-semibold text-muted-foreground text-center">Otras plataformas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  { feature: "Agentes Especializados", maris: "9 Agentes (Pipeline Completo)", other: "Agente Único / Generalista" },
                  { feature: "Modelos de IA", maris: "Claude + Gemini + GPT (Multi-modelo)", other: "Modelo único / Limitado" },
                  { feature: "Calidad del Código", maris: "Arquitectura Senior (Vite + Tailwind)", other: "Código Estándar" },
                  { feature: "Backend e Infraestructura", maris: "Express + MongoDB + Railway", other: "Enfoque Principal Frontend" },
                  { feature: "Soporte en Español", maris: "Completo (Nativo)", other: "Limitado / Inglés" },
                  { feature: "Exportación a GitHub", maris: "Integración Directa", other: "Sujeto a Plan" },
                  { feature: "Revisión de QA", maris: "Agente QA dedicado", other: "Manual / No disponible" },
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
                        <span className="text-xs text-muted-foreground">{row.other}</span>
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
            Únete a los desarrolladores que han elegido un pipeline de agentes real para crear sus productos.
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
            © {new Date().getFullYear()} Maris AI. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
