import { useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, X, ArrowRight, Zap, Globe, Shield, Euro } from "lucide-react";
import { motion } from "framer-motion";
import { Layout } from "@/components/layout";

export default function VsBase44Page() {
  useEffect(() => {
    document.title = "Maris AI vs Base44 — Mejor Alternativa Española 2026";
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", "Maris AI es la mejor alternativa a Base44 para emprendedores españoles. Código 100% tuyo, sin vendor lock-in, en español y con 9 agentes IA.");
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", "Maris AI vs Base44 — Mejor Alternativa Española 2026");
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", "Maris AI es la mejor alternativa a Base44 para emprendedores españoles. Código 100% tuyo, sin vendor lock-in, en español y con 9 agentes IA.");
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute("content", "https://www.marisai.es/vs-base44");
    let canonical = document.getElementById("canonical-tag") as HTMLLinkElement | null;
    if (!canonical) canonical = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    if (canonical) canonical.setAttribute("href", "https://www.marisai.es/vs-base44");
  }, []);
  const comparison = [
    { feature: "Idioma de la interfaz", maris: "100% Español", base44: "Inglés y español parcial", marisWins: true },
    { feature: "Soporte en español", maris: "Sí, email directo", base44: "No", marisWins: true },
    { feature: "Backend incluido", maris: "Sí (Express + MongoDB)", base44: "Sí (propio)", marisWins: false },
    { feature: "Código exportable", maris: "Sí, 100% tuyo a GitHub", base44: "Limitado", marisWins: true },
    { feature: "Precio entrada pago", maris: "20€", base44: "20$/mes (~18€)", marisWins: false },
    { feature: "Créditos caducan", maris: "Nunca", base44: "Mensualmente", marisWins: true },
    { feature: "Agentes IA especializados", maris: "9 agentes en paralelo", base44: "1 agente general", marisWins: true },
    { feature: "Stack tecnológico", maris: "React + TS + Tailwind + Express + MongoDB", base44: "Stack propio cerrado", marisWins: true },
    { feature: "Dependencia de plataforma", maris: "Ninguna — código tuyo", base44: "Alta — datos en su plataforma", marisWins: true },
    { feature: "Deploy propio", maris: "Sí — Vercel + Railway", base44: "Solo su hosting", marisWins: true },
    { feature: "Personalización total", maris: "Sí — código abierto", base44: "Limitada a sus bloques", marisWins: true },
    { feature: "Para emprendedores en España", maris: "Diseñado específicamente", base44: "Global en inglés", marisWins: true },
  ];

  const faqs = [
    {
      q: "¿Cuál es la diferencia principal entre Maris AI y Base44?",
      a: "La diferencia más importante es la propiedad del código y la dependencia de plataforma. Con Base44, tu app vive en su plataforma y los datos están en sus servidores. Con Maris AI recibes el código completo que puedes exportar a GitHub y desplegar donde quieras — en Vercel, Railway, AWS o tu propio servidor. Además, Maris AI está completamente en español.",
    },
    {
      q: "¿Base44 permite exportar el código completo?",
      a: "Base44 tiene limitaciones en la exportación del código. El código generado está optimizado para su plataforma. Maris AI genera código estándar React + TypeScript + Express + MongoDB que puedes exportar completo a GitHub y modificar libremente.",
    },
    {
      q: "¿Qué pasa con mis datos si Base44 cierra o sube los precios?",
      a: "Con Base44, como con cualquier plataforma cerrada, dependes de su continuidad. Si cierran o suben los precios, tu app puede quedar inaccesible. Con Maris AI, el código es tuyo desde el primer momento y lo puedes desplegar en cualquier servidor independientemente de Maris AI.",
    },
    {
      q: "¿Base44 tiene soporte en español?",
      a: "Base44 tiene algo de interfaz en español pero el soporte es principalmente en inglés. Maris AI está 100% en español con soporte por email en español.",
    },
    {
      q: "¿Cuál es más barato a largo plazo?",
      a: "Base44 cobra mensualmente mientras uses la plataforma. Si pagas 20$/mes durante 12 meses son 240$. Con Maris AI compras créditos que nunca caducan — si generas tu app con 20€ de créditos y la despliegas en Vercel gratis, tu coste mensual recurrente es 0€.",
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
              Maris AI vs Base44<br />
              <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
                Código tuyo vs plataforma cerrada
              </span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              Base44 genera apps rápido pero el código vive en su plataforma. Maris AI te da el código completo, exportable y sin dependencia de ninguna plataforma.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/sign-up">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-white h-12 px-8">
                  Probar Maris AI gratis <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="https://base44.com" target="_blank" rel="noopener noreferrer">
                <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10 h-12 px-8">
                  Ver Base44
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
                <div>
                  <h2 className="text-xl font-bold text-white">Maris AI</h2>
                  <p className="text-xs text-primary/70">Código 100% tuyo</p>
                </div>
              </div>
              <ul className="space-y-2">
                {[
                  "Código completo exportable a GitHub",
                  "Sin dependencia de plataforma",
                  "Deploy en Vercel/Railway/AWS",
                  "100% en español",
                  "9 agentes IA especializados",
                  "Créditos que nunca caducan",
                  "0€/mes en hosting (plan gratuito)",
                ].map(f => (
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
                <div>
                  <h2 className="text-xl font-bold text-white">Base44</h2>
                  <p className="text-xs text-white/30">Plataforma cerrada</p>
                </div>
              </div>
              <ul className="space-y-2">
                {[
                  "Código limitado a su plataforma",
                  "Alta dependencia del proveedor",
                  "Solo su hosting",
                  "Inglés (español parcial)",
                  "1 agente general",
                  "Créditos mensuales que caducan",
                  "20$/mes recurrente obligatorio",
                ].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-white/60">
                    <X className="h-4 w-4 text-red-400 shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </section>

        {/* El problema del vendor lock-in */}
        <section className="container px-4 md:px-8 mx-auto max-w-4xl mb-16">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="h-6 w-6 text-amber-400" />
              <h2 className="text-2xl font-bold text-white">El riesgo del vendor lock-in con Base44</h2>
            </div>
            <p className="text-white/70 mb-6">Con plataformas cerradas como Base44, tu negocio depende de su continuidad:</p>
            <div className="space-y-3 mb-6">
              {[
                { riesgo: "Si Base44 sube precios", impacto: "Tienes que pagar o perder tu app" },
                { riesgo: "Si Base44 cierra", impacto: "Tu app desaparece con ellos" },
                { riesgo: "Si necesitas una función que no tienen", impacto: "No puedes añadirla tú mismo" },
                { riesgo: "Si quieres migrar", impacto: "Difícil exportar y replicar en otro lado" },
              ].map((row, i) => (
                <div key={i} className="flex items-start gap-4 rounded-xl bg-white/5 px-4 py-3">
                  <X className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-sm font-medium text-white/80">{row.riesgo}:</span>
                    <span className="text-sm text-red-400/80 ml-2">{row.impacto}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-xl bg-primary/10 border border-primary/20 px-4 py-3 flex items-center gap-3">
              <Check className="h-4 w-4 text-emerald-400 shrink-0" />
              <p className="text-sm text-white/80">Con Maris AI el código es tuyo desde el primer commit. Si Maris AI desaparece mañana, tu app sigue funcionando igual.</p>
            </div>
          </motion.div>
        </section>

        {/* Tabla comparativa */}
        <section className="container px-4 md:px-8 mx-auto max-w-4xl mb-16">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl font-bold text-white mb-8 text-center">Comparativa completa</h2>
            <div className="rounded-2xl border border-white/10 overflow-hidden">
              <div className="grid grid-cols-3 bg-white/5 px-6 py-3 text-xs font-bold uppercase tracking-widest text-white/40">
                <span>Característica</span>
                <span className="text-center text-primary">Maris AI</span>
                <span className="text-center">Base44</span>
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
                    {row.base44}
                  </span>
                </div>
              ))}
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
            <h2 className="text-3xl font-bold text-white mb-4">Tu código, tu app, tu libertad</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              Con Maris AI el código es tuyo desde el primer momento. En español, con backend incluido y sin dependencia de ninguna plataforma.
            </p>
            <Link href="/sign-up">
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-white h-14 px-10 text-lg">
                Empieza gratis — 45 créditos sin tarjeta <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <p className="text-xs text-muted-foreground mt-4">Sin tarjeta de crédito · En español · Código 100% tuyo</p>
          </motion.div>
        </section>
      </div>
    </Layout>
  );
}
