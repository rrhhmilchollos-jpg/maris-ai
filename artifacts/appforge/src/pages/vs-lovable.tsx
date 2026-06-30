import { useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, X, ArrowRight, Zap, Globe, Code2, Shield, Clock, Euro } from "lucide-react";
import { motion } from "framer-motion";
import { Layout } from "@/components/layout";

export default function VsLovablePage() {
  useEffect(() => {
    document.title = "Maris AI vs Lovable — Mejor Alternativa Española 2026";
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", "Maris AI es la mejor alternativa a Lovable para emprendedores españoles. En español, con 9 agentes IA, precios en euros y soporte directo.");
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", "Maris AI vs Lovable — Mejor Alternativa Española 2026");
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", "Maris AI es la mejor alternativa a Lovable para emprendedores españoles. En español, con 9 agentes IA, precios en euros y soporte directo.");
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute("content", "https://www.marisai.es/vs-lovable");
    let canonical = document.getElementById("canonical-tag") as HTMLLinkElement | null;
    if (!canonical) canonical = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    if (canonical) canonical.setAttribute("href", "https://www.marisai.es/vs-lovable");
  }, []);
  const comparison = [
    { feature: "Idioma de la interfaz", maris: "100% Español", lovable: "Inglés", marisWins: true },
    { feature: "Soporte en español", maris: "Sí, email directo", lovable: "No", marisWins: true },
    { feature: "Backend incluido", maris: "Sí (Express + MongoDB)", lovable: "Requiere Supabase (+25€/mes)", marisWins: true },
    { feature: "Precio entrada", maris: "Gratis (45 créditos)", lovable: "Gratis (5 créditos/día)", marisWins: true },
    { feature: "Plan de pago desde", maris: "20€", lovable: "25$/mes (~23€)", marisWins: true },
    { feature: "Créditos caducan", maris: "Nunca", lovable: "Sí (2 meses)", marisWins: true },
    { feature: "Agentes IA especializados", maris: "9 agentes en paralelo", lovable: "1 agente general", marisWins: true },
    { feature: "Exportación a GitHub", maris: "Sí, incluido", lovable: "Sí, incluido", marisWins: false },
    { feature: "Código 100% tuyo", maris: "Sí", lovable: "Sí", marisWins: false },
    { feature: "Usuarios registrados", maris: "Creciendo", lovable: "8M+ usuarios", marisWins: false },
    { feature: "Stack tecnológico", maris: "React + TypeScript + Tailwind + Express + MongoDB", lovable: "React + Supabase", marisWins: true },
    { feature: "Coste real para SaaS", maris: "Solo Maris AI", lovable: "Lovable ($25) + Supabase ($25) = $50/mes", marisWins: true },
  ];

  const faqs = [
    {
      q: "¿Cuál es la principal diferencia entre Maris AI y Lovable?",
      a: "La diferencia más importante es el idioma y el backend. Maris AI está completamente en español con soporte real en español, mientras que Lovable está en inglés. Además, Maris AI incluye backend Express + MongoDB de serie, mientras que Lovable requiere contratar Supabase aparte (otros 25€/mes) para tener base de datos real.",
    },
    {
      q: "¿Es Maris AI más barato que Lovable?",
      a: "Sí. El plan Pro de Lovable cuesta 25$/mes, y si añades Supabase (necesario para apps reales) sumas otros 25$/mes, llegando a 50$/mes. Maris AI empieza en 20€ con backend incluido. Para emprendedores en España, Maris AI es claramente más económico.",
    },
    {
      q: "¿Lovable genera apps fullstack como Maris AI?",
      a: "Lovable es principalmente un builder frontend. Para tener base de datos y autenticación real necesitas conectar Supabase, que tiene coste adicional y configuración técnica. Maris AI genera el stack completo (React + TypeScript + Express + MongoDB) en una sola generación, sin servicios externos.",
    },
    {
      q: "¿Los créditos de Lovable caducan?",
      a: "Sí. Los créditos de Lovable caducan a los 2 meses de emitirse. En Maris AI los créditos nunca caducan — los compras y los usas cuando quieras, sin presión.",
    },
    {
      q: "¿Por qué elegir Maris AI si Lovable tiene más usuarios?",
      a: "Lovable tiene más usuarios porque lleva más tiempo y es global, pero para el mercado español tiene dos problemas: está en inglés y el soporte no es en español. Si eres emprendedor en España o Latinoamérica, Maris AI es la única plataforma diseñada específicamente para ti.",
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
              Maris AI vs Lovable<br />
              <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
                ¿Cuál es mejor para España?
              </span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              Lovable es la herramienta más popular en inglés. Maris AI es la única alternativa completa en español con backend incluido. Aquí va la comparativa real.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/sign-up">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-white h-12 px-8">
                  Probar Maris AI gratis <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="https://lovable.dev" target="_blank" rel="noopener noreferrer">
                <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10 h-12 px-8">
                  Ver Lovable
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
                {["100% en español", "Backend incluido (Express + MongoDB)", "9 agentes IA especializados", "Créditos que nunca caducan", "Soporte real en español", "Desde 20€ con todo incluido"].map(f => (
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
                <h2 className="text-xl font-bold text-white">Lovable</h2>
              </div>
              <ul className="space-y-2">
                {[
                  { text: "Solo en inglés", ok: false },
                  { text: "Backend requiere Supabase (+25€/mes)", ok: false },
                  { text: "1 agente general", ok: false },
                  { text: "Créditos caducan a los 2 meses", ok: false },
                  { text: "Soporte en inglés", ok: false },
                  { text: "Desde 25$/mes (sin backend real)", ok: false },
                ].map(f => (
                  <li key={f.text} className="flex items-center gap-2 text-sm text-white/60">
                    <X className="h-4 w-4 text-red-400 shrink-0" />{f.text}
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
                <span className="text-center">Lovable</span>
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
                    {row.lovable}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* Coste real */}
        <section className="container px-4 md:px-8 mx-auto max-w-4xl mb-16">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8">
            <div className="flex items-center gap-3 mb-4">
              <Euro className="h-6 w-6 text-amber-400" />
              <h2 className="text-2xl font-bold text-white">El coste real de Lovable para una app de producción</h2>
            </div>
            <p className="text-white/70 mb-6">Lovable parece barato en la página de precios, pero para tener una app real necesitas servicios adicionales:</p>
            <div className="space-y-3 mb-6">
              {[
                { item: "Lovable Pro", price: "25$/mes", note: "Solo frontend" },
                { item: "Supabase Pro (base de datos)", price: "+25$/mes", note: "Necesario para apps reales" },
                { item: "Total mensual real", price: "~50$/mes (~46€)", note: "Sin contar extras", highlight: true },
              ].map((row, i) => (
                <div key={i} className={`flex items-center justify-between rounded-xl px-4 py-3 ${row.highlight ? "bg-red-500/10 border border-red-500/20" : "bg-white/5"}`}>
                  <div>
                    <span className={`text-sm font-medium ${row.highlight ? "text-red-300" : "text-white/80"}`}>{row.item}</span>
                    <span className="text-xs text-white/30 ml-2">{row.note}</span>
                  </div>
                  <span className={`text-sm font-bold ${row.highlight ? "text-red-300" : "text-white/60"}`}>{row.price}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-xl px-4 py-3 bg-primary/10 border border-primary/20">
              <div>
                <span className="text-sm font-medium text-primary">Maris AI (todo incluido)</span>
                <span className="text-xs text-white/30 ml-2">Backend + frontend + soporte</span>
              </div>
              <span className="text-sm font-bold text-primary">Desde 20€/mes</span>
            </div>
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
            <h2 className="text-3xl font-bold text-white mb-4">La alternativa a Lovable en español</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              Si buscas una herramienta como Lovable pero en español, con backend incluido y sin pagar por Supabase aparte, Maris AI es la respuesta.
            </p>
            <Link href="/sign-up">
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-white h-14 px-10 text-lg">
                Empieza gratis — 45 créditos sin tarjeta <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <p className="text-xs text-muted-foreground mt-4">Sin tarjeta de crédito · En español · Backend incluido</p>
          </motion.div>
        </section>
      </div>
    </Layout>
  );
}
