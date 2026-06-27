import { useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, X, ArrowRight, Zap, Globe, Code2, Shield, Clock, Euro } from "lucide-react";
import { motion } from "framer-motion";
import { Layout } from "@/components/layout";

export default function VsBoltPage() {
  useEffect(() => {
    document.title = "Maris AI vs Bolt.new — Mejor Alternativa Española 2026";
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", "Maris AI es la mejor alternativa a Bolt.new para emprendedores españoles. En español, con 9 agentes IA, precios en euros y soporte directo.");
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", "Maris AI vs Bolt.new — Mejor Alternativa Española 2026");
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", "Maris AI es la mejor alternativa a Bolt.new para emprendedores españoles. En español, con 9 agentes IA, precios en euros y soporte directo.");
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute("content", "https://www.marisai.es/vs-bolt");
    let canonical = document.getElementById("canonical-tag") as HTMLLinkElement | null;
    if (!canonical) canonical = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    if (canonical) canonical.setAttribute("href", "https://www.marisai.es/vs-bolt");
  }, []);
  const comparison = [
    { feature: "Idioma de la interfaz", maris: "100% Español", bolt: "Inglés", marisWins: true },
    { feature: "Soporte en español", maris: "Sí, email directo", bolt: "No", marisWins: true },
    { feature: "Backend incluido", maris: "Sí (Express + MongoDB)", bolt: "Parcial (WebContainers)", marisWins: true },
    { feature: "Sistema de precios", maris: "Créditos claros", bolt: "Tokens impredecibles", marisWins: true },
    { feature: "Precio entrada pago", maris: "20€", bolt: "25$/mes (~23€)", marisWins: true },
    { feature: "Créditos/tokens caducan", maris: "Nunca", bolt: "Sí (1 mes en plan Free)", marisWins: true },
    { feature: "Agentes IA especializados", maris: "9 agentes en paralelo", bolt: "1 agente general", marisWins: true },
    { feature: "Exportación a GitHub", maris: "Sí, incluido", bolt: "Sí, incluido", marisWins: false },
    { feature: "Código 100% tuyo", maris: "Sí", bolt: "Sí", marisWins: false },
    { feature: "Coste predecible", maris: "Sí — créditos fijos", bolt: "No — varía por proyecto", marisWins: true },
    { feature: "Stack tecnológico", maris: "React + TS + Tailwind + Express + MongoDB", bolt: "React, Vue, Next.js, Svelte...", marisWins: false },
    { feature: "Enfoque", maris: "Emprendedores en España/LATAM", bolt: "Developers globales", marisWins: true },
  ];

  const faqs = [
    {
      q: "¿Cuál es la principal diferencia entre Maris AI y Bolt.new?",
      a: "La diferencia clave es el idioma, el modelo de precios y el enfoque. Bolt.new está en inglés y usa tokens impredecibles donde el coste real varía según la complejidad del proyecto. Maris AI está en español con un sistema de créditos transparente donde siempre sabes lo que gastas.",
    },
    {
      q: "¿Por qué los tokens de Bolt son impredecibles?",
      a: "Bolt cobra tokens según la complejidad de cada petición. Un proyecto grande con 50 archivos consume muchos más tokens por prompt que uno pequeño, porque Bolt envía todo el código al modelo en cada mensaje. Esto hace imposible saber cuánto vas a gastar antes de empezar. Maris AI cobra créditos fijos por tipo de proyecto.",
    },
    {
      q: "¿Bolt.new genera el backend completo como Maris AI?",
      a: "Bolt puede generar código de backend, pero corre en WebContainers (un entorno de navegador). Para producción real necesitas configurar tu propio servidor o un servicio externo. Maris AI genera un backend Express + MongoDB listo para desplegar en Railway con un clic.",
    },
    {
      q: "¿Es Bolt.new bueno para emprendedores españoles?",
      a: "Bolt es una herramienta potente, pero está pensada para developers globales en inglés. La curva de aprendizaje es mayor, el soporte es en inglés y los costes de tokens pueden sorprenderte. Para emprendedores en España sin perfil técnico, Maris AI es más accesible.",
    },
    {
      q: "¿Qué pasa con los tokens de Bolt si no los uso?",
      a: "En el plan Free los tokens se reinician mensualmente y no acumulan. En planes de pago se pueden acumular hasta 2 meses. En Maris AI los créditos nunca caducan — los compras cuando los necesitas y los usas sin presión de fechas.",
    },
  ];

  return (
    <Layout>
      <div className="min-h-screen bg-background pt-24 pb-16">
        {/* Hero */}
        <section className="container px-4 md:px-8 mx-auto max-w-5xl mb-16 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary mb-6">
              Comparativa actualizada junio 2026
            </div>
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 tracking-tight">
              Maris AI vs Bolt.new<br />
              <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
                Alternativa en español a Bolt
              </span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              Bolt.new es potente pero en inglés y con tokens impredecibles. Maris AI es la alternativa en español con precios claros y backend incluido para emprendedores.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/sign-up">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-white h-12 px-8">
                  Probar Maris AI gratis <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="https://bolt.new" target="_blank" rel="noopener noreferrer">
                <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10 h-12 px-8">
                  Ver Bolt.new
                </Button>
              </a>
            </div>
          </motion.div>
        </section>

        {/* Resumen rápido */}
        <section className="container px-4 md:px-8 mx-auto max-w-4xl mb-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
              className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-white">Maris AI</h2>
              </div>
              <ul className="space-y-2">
                {["100% en español", "Precios en créditos claros y fijos", "9 agentes IA especializados", "Créditos que nunca caducan", "Backend Express + MongoDB incluido", "Soporte real en español"].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-white/80">
                    <Check className="h-4 w-4 text-emerald-400 shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
              className="rounded-2xl border border-white/10 bg-card/40 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center">
                  <Globe className="h-5 w-5 text-white/60" />
                </div>
                <h2 className="text-xl font-bold text-white">Bolt.new</h2>
              </div>
              <ul className="space-y-2">
                {[
                  "Solo en inglés",
                  "Tokens impredecibles — el coste varía",
                  "1 agente general",
                  "Tokens caducan mensualmente (plan Free)",
                  "Backend limitado (WebContainers)",
                  "Soporte en inglés",
                ].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-white/60">
                    <X className="h-4 w-4 text-red-400 shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </section>

        {/* Tabla comparativa */}
        <section className="container px-4 md:px-8 mx-auto max-w-4xl mb-16">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl font-bold text-white mb-8 text-center">Comparativa completa</h2>
            <div className="rounded-2xl border border-white/10 overflow-hidden">
              <div className="grid grid-cols-3 bg-white/5 px-6 py-3 text-xs font-bold uppercase tracking-widest text-white/40">
                <span>Característica</span>
                <span className="text-center text-primary">Maris AI</span>
                <span className="text-center">Bolt.new</span>
              </div>
              {comparison.map((row, i) => (
                <div key={i} className={`grid grid-cols-3 px-6 py-4 border-t border-white/5 items-center ${row.marisWins ? "bg-primary/[0.03]" : ""}`}>
                  <span className="text-sm text-white/70">{row.feature}</span>
                  <span className={`text-center text-sm font-medium ${row.marisWins ? "text-emerald-400" : "text-white/60"}`}>
                    {row.marisWins && <Check className="h-3.5 w-3.5 inline mr-1" />}
                    {row.maris}
                  </span>
                  <span className={`text-center text-sm ${row.marisWins ? "text-red-400/70" : "text-white/60"}`}>
                    {row.marisWins && <X className="h-3.5 w-3.5 inline mr-1" />}
                    {row.bolt}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* El problema de los tokens */}
        <section className="container px-4 md:px-8 mx-auto max-w-4xl mb-16">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="h-6 w-6 text-amber-400" />
              <h2 className="text-2xl font-bold text-white">El problema real de los tokens de Bolt</h2>
            </div>
            <p className="text-white/70 mb-6">Los usuarios de Bolt reportan consistentemente el mismo problema: el coste es impredecible.</p>
            <div className="space-y-4 mb-6">
              {[
                { title: "App pequeña (5 archivos)", bolt: "~150K tokens/mes", maris: "1 crédito" },
                { title: "App mediana (20 archivos)", bolt: "~600K tokens/mes", maris: "2 créditos" },
                { title: "App grande (50+ archivos)", bolt: ">1M tokens/mes → plan de pago", maris: "3 créditos" },
              ].map((row, i) => (
                <div key={i} className="grid grid-cols-3 gap-4 rounded-xl bg-white/5 px-4 py-3 text-sm">
                  <span className="text-white/70">{row.title}</span>
                  <span className="text-amber-400 text-center">{row.bolt}</span>
                  <span className="text-emerald-400 text-center">{row.maris}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-white/30">En Maris AI siempre sabes exactamente cuántos créditos consume cada tipo de proyecto antes de generarlo.</p>
          </motion.div>
        </section>

        {/* FAQ */}
        <section className="container px-4 md:px-8 mx-auto max-w-3xl mb-16">
          <h2 className="text-3xl font-bold text-white mb-8 text-center">Preguntas frecuentes</h2>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} viewport={{ once: true }}
                className="rounded-xl border border-white/10 bg-card/40 p-6 hover:border-primary/30 transition-all">
                <h3 className="font-semibold text-white mb-2">{faq.q}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{faq.a}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="container px-4 md:px-8 mx-auto max-w-3xl text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="rounded-2xl border border-primary/20 bg-primary/5 p-10">
            <h2 className="text-3xl font-bold text-white mb-4">La alternativa a Bolt en español</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              Si buscas una herramienta como Bolt.new pero en español, con precios predecibles y backend incluido, Maris AI es tu mejor opción.
            </p>
            <Link href="/sign-up">
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-white h-14 px-10 text-lg">
                Empieza gratis — 78 créditos sin tarjeta <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <p className="text-xs text-muted-foreground mt-4">Sin tarjeta de crédito · En español · Precios transparentes</p>
          </motion.div>
        </section>
      </div>
    </Layout>
  );
}
