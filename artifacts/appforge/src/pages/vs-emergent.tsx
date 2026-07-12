import { useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, X, ArrowRight, Zap, Star, Shield, Clock, Euro, MessageCircle, Globe, Rocket } from "lucide-react";
import { motion } from "framer-motion";
import { Layout } from "@/components/layout";

const COMPARISON = [
  { feature: "Idioma de la interfaz", maris: "100% Español", competitor: "Solo inglés", marisWins: true },
  { feature: "Soporte en español", maris: "WhatsApp + email", competitor: "No disponible", marisWins: true },
  { feature: "Enfoque multi-agente", maris: "11 agentes especializados", competitor: "Sí, multi-agente", marisWins: false },
  { feature: "Backend incluido", maris: "Express + MongoDB", competitor: "Sí, incluido", marisWins: false },
  { feature: "Plan de pago desde", maris: "19€/mes", competitor: "17$/mes (~16€)", marisWins: false },
  { feature: "Créditos caducan", maris: "A los 30 días", competitor: "Sí, mensualmente", marisWins: false },
  { feature: "Exportación código completo", maris: "Sí, frontend + backend", competitor: "Sí, incluido", marisWins: false },
  { feature: "Deploy automático", maris: "Sí, a Vercel", competitor: "Sí, incluido", marisWins: false },
  { feature: "Precio en euros", maris: "Sí, euros reales", competitor: "No, dólares", marisWins: true },
  { feature: "Comunidad en español", maris: "Sí, activa", competitor: "No", marisWins: true },
];

const FAQS = [
  { q: "¿En qué se parecen Maris AI y Emergent.sh?", a: "Ambos usan arquitectura multi-agente para generar apps completas en una sola generación. Los dos incluyen deploy automático y exportación de código. La diferencia principal es que Maris AI está en español y Emergent.sh solo en inglés." },
  { q: "¿Es Emergent.sh mejor técnicamente que Maris AI?", a: "Emergent.sh es técnicamente muy sólido. Maris AI tiene una arquitectura similar de 11 agentes especializados. Para el mercado hispanohablante, la calidad es comparable pero Maris AI añade la ventaja del idioma y el soporte humano." },
  { q: "¿Puedo usar Emergent.sh si no sé inglés?", a: "Técnicamente puedes escribir prompts en español, pero toda la interfaz, mensajes de error y soporte son en inglés. Maris AI ofrece todo en español, incluyendo los mensajes del sistema y el soporte." },
  { q: "¿Los créditos de Emergent.sh caducan?", a: "Sí, los créditos de Emergent.sh se reinician mensualmente. En Maris AI los créditos duran 30 días desde la compra: sin presión de fin de mes natural, tú eliges cuándo comprarlos." },
  { q: "¿Por qué Maris AI si Emergent.sh tiene más trayectoria?", a: "Emergent.sh tiene más tiempo en el mercado global, pero Maris AI es la única opción construida específicamente para el mercado hispanohablante. Si tu empresa y clientes están en España o Latinoamérica, la experiencia en tu idioma marca una diferencia real." },
];

export default function VsEmergentPage() {
  useEffect(() => {
    document.title = "Maris AI vs Emergent.sh 2026 — Alternativa en español con soporte real | Maris AI";
    const setMeta = (sel: string, val: string) => { const el = document.querySelector(sel); if (el) el.setAttribute("content", val); };
    setMeta('meta[name="description"]', "Comparativa Maris AI vs Emergent.sh: cuál genera mejores apps para emprendedores españoles. Maris AI ofrece soporte en español, precios en euros y 11 agentes especializados.");
    setMeta('meta[property="og:title"]', "Maris AI vs Emergent.sh 2026 — Alternativa en español con soporte real | Maris AI");
    setMeta('meta[property="og:url"]', "https://www.marisai.es/vs-emergent");
    let canonical = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    if (!canonical) { canonical = document.createElement("link") as HTMLLinkElement; canonical.rel = "canonical"; document.head.appendChild(canonical); }
    canonical.href = "https://www.marisai.es/vs-emergent";
    const jsonLd = { "@context": "https://schema.org", "@graph": [
      { "@type": "Article", "headline": "Maris AI vs Emergent.sh 2026 — Alternativa en español con soporte real | Maris AI", "image": "https://www.marisai.es/opengraph.jpg", "author": { "@type": "Organization", "name": "Maris AI" }, "datePublished": "2026-01-15", "dateModified": "2026-07-01" },
      { "@type": "FAQPage", "mainEntity": FAQS.map(f => ({ "@type": "Question", "name": f.q, "acceptedAnswer": { "@type": "Answer", "text": f.a } })) },
      { "@type": "BreadcrumbList", "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Inicio", "item": "https://www.marisai.es/" },
        { "@type": "ListItem", "position": 2, "name": "Maris AI vs Emergent.sh", "item": "https://www.marisai.es/vs-emergent" }
      ] }
    ]};
    let s = document.getElementById("jsonld-vs") as HTMLScriptElement | null;
    if (!s) { s = document.createElement("script"); s.id = "jsonld-vs"; s.type = "application/ld+json"; document.head.appendChild(s); }
    s.textContent = JSON.stringify(jsonLd);
  }, []);

  return (
    <Layout>
      <div className="min-h-screen bg-background pt-24 pb-20">
        <section className="container px-4 mx-auto max-w-5xl mb-16 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary mb-6">⚡ Comparativa actualizada julio 2026</div>
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 tracking-tight leading-tight">
              Maris AI vs Emergent.sh<br />
              <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">¿Cuál genera mejores apps para España?</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">Emergent.sh es uno de los builders más avanzados del mercado. Maris AI es la alternativa en español con soporte humano real. Comparativa honesta para el mercado hispanohablante.</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
              <Link href="/sign-up"><Button size="lg" className="gap-2 bg-primary hover:bg-primary/90 text-white font-bold shadow-lg shadow-primary/30"><Rocket className="h-5 w-5" />Probar Maris AI gratis</Button></Link>
              <Link href="/demo"><Button size="lg" variant="outline" className="gap-2 border-white/20 text-white hover:bg-white/[0.05]"><Zap className="h-5 w-5" />Ver demo en vivo</Button></Link>
            </div>
            <p className="text-sm text-muted-foreground">Sin tarjeta · Sin inglés · 65 créditos gratis al registrarte</p>
          </motion.div>
        </section>

        <section className="container px-4 mx-auto max-w-4xl mb-20">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-8">Comparativa real: Maris AI vs Emergent.sh</h2>
          <div className="rounded-2xl border border-white/[0.08] overflow-hidden">
            <div className="grid grid-cols-3 bg-white/[0.04] border-b border-white/[0.08]">
              <div className="p-4 text-sm font-semibold text-white/60">Característica</div>
              <div className="p-4 text-sm font-bold text-primary text-center border-x border-white/[0.08]">✨ Maris AI</div>
              <div className="p-4 text-sm font-semibold text-white/60 text-center">Emergent.sh</div>
            </div>
            {COMPARISON.map((row, i) => (
              <div key={i} className={`grid grid-cols-3 border-b border-white/[0.05] ${i % 2 === 0 ? "" : "bg-white/[0.01]"}`}>
                <div className="p-4 text-sm text-white/70 flex items-center">{row.feature}</div>
                <div className={`p-4 text-sm font-medium text-center border-x border-white/[0.05] flex items-center justify-center gap-2 ${row.marisWins ? "text-green-400" : "text-white/60"}`}>
                  {row.marisWins && <Check className="h-4 w-4 shrink-0" />}<span>{row.maris}</span>
                </div>
                <div className={`p-4 text-sm text-center flex items-center justify-center gap-2 ${row.marisWins ? "text-white/40" : "text-white/60"}`}>
                  {row.marisWins && <X className="h-4 w-4 text-red-400/60 shrink-0" />}<span>{row.competitor}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="container px-4 mx-auto max-w-5xl mb-20">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-10">Por qué Maris AI gana a Emergent.sh para el mercado hispanohablante</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { icon: Globe, title: "100% en español", desc: "Interfaz, soporte, documentación y comunidad en español. Emergent.sh está en inglés — una barrera real para la mayoría de emprendedores.", color: "text-blue-400" },
              { icon: MessageCircle, title: "Soporte humano por WhatsApp", desc: "Equipo real respondiendo en español en menos de 2 horas. Sin bots, sin tickets en inglés, sin esperas de días.", color: "text-green-400" },
              { icon: Euro, title: "Precios en euros sin sorpresas", desc: "Pagas en euros, sin conversión de divisa. Los créditos duran 30 días desde la compra. Emergent.sh cobra en dólares.", color: "text-yellow-400" },
              { icon: Zap, title: "11 agentes IA especializados", desc: "Researcher, arquitecto, diseñador, frontend, backend, base de datos, integraciones, QA, DevOps, testing y reparación trabajando en paralelo.", color: "text-purple-400" },
              { icon: Shield, title: "Backend incluido sin extras", desc: "Express + MongoDB incluidos de serie. Sin servicios externos obligatorios, sin costes ocultos adicionales.", color: "text-red-400" },
              { icon: Clock, title: "Apps completas en 5 minutos", desc: "Frontend + backend + base de datos + deploy automático a Vercel en una sola generación. Sin configuraciones manuales.", color: "text-cyan-400" },
            ].map((item, i) => (
              <div key={i} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-3 hover:border-white/20 transition">
                <item.icon className={`h-6 w-6 ${item.color}`} />
                <h3 className="font-bold text-white">{item.title}</h3>
                <p className="text-sm text-white/50 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="container px-4 mx-auto max-w-3xl mb-20">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center space-y-4">
            <div className="flex justify-center gap-1">{[1,2,3,4,5].map(s => <Star key={s} className="h-5 w-5 fill-yellow-400 text-yellow-400" />)}</div>
            <h2 className="text-2xl font-bold text-white">Nuestro veredicto</h2>
            <p className="text-white/70 leading-relaxed max-w-2xl mx-auto">Emergent.sh es técnicamente muy capaz y tiene un enfoque multi-agente similar al de Maris AI, pero está completamente en inglés y sin soporte en español. Para el mercado hispanohablante, Maris AI es la opción natural: mismo nivel de calidad técnica, primera plataforma nativa en español, con soporte real (tickets con respuesta en menos de 3-4 horas, y WhatsApp para casos urgentes) y precios en euros.</p>
            <Link href="/sign-up"><Button size="lg" className="mt-2 bg-primary hover:bg-primary/90 text-white font-bold gap-2 shadow-lg shadow-primary/30">Empezar con Maris AI gratis <ArrowRight className="h-5 w-5" /></Button></Link>
          </div>
        </section>

        <section className="container px-4 mx-auto max-w-3xl mb-20">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-10">Preguntas frecuentes — Maris AI vs Emergent.sh</h2>
          <div className="space-y-4">
            {FAQS.map((faq, i) => (
              <details key={i} className="rounded-xl border border-white/[0.07] bg-white/[0.02] group">
                <summary className="p-5 font-semibold text-white cursor-pointer list-none flex justify-between items-center hover:text-primary transition">
                  <span>{faq.q}</span><ArrowRight className="h-4 w-4 text-white/40 group-open:rotate-90 transition-transform shrink-0 ml-4" />
                </summary>
                <div className="px-5 pb-5 text-sm text-white/60 leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
        </section>



        {/* Otras comparativas */}
        <section className="container px-4 mx-auto max-w-3xl">
          <h3 className="text-base font-semibold mb-3 text-center">Otras comparativas</h3>
          <div className="flex flex-wrap justify-center gap-4">
            <a href="/vs-lovable" className="text-sm text-primary hover:underline">Maris AI vs Lovable</a>
            <a href="/vs-bolt" className="text-sm text-primary hover:underline">Maris AI vs Bolt.new</a>
            <a href="/vs-base44" className="text-sm text-primary hover:underline">Maris AI vs Base44</a>
          </div>
        </section>

        {/* Enlaces cruzados — mejora enlazado interno entre páginas de contenido */}
        <section className="container px-4 mx-auto max-w-3xl">
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <a href="/news" className="p-4 rounded-lg border border-white/10 hover:border-primary/40 transition-colors block">
              <span className="font-medium">Blog de IA</span>
              <span className="block text-xs text-muted-foreground mt-1">Noticias y tutoriales sobre inteligencia artificial</span>
            </a>
            <a href="/que-es-vibe-coding" className="p-4 rounded-lg border border-white/10 hover:border-primary/40 transition-colors block">
              <span className="font-medium">¿Qué es el vibe coding?</span>
              <span className="block text-xs text-muted-foreground mt-1">El paradigma de programación con IA</span>
            </a>
            <a href="/glosario" className="p-4 rounded-lg border border-white/10 hover:border-primary/40 transition-colors block">
              <span className="font-medium">Glosario de IA</span>
              <span className="block text-xs text-muted-foreground mt-1">Todos los términos que necesitas</span>
            </a>
            <a href="/showcase" className="p-4 rounded-lg border border-white/10 hover:border-primary/40 transition-colors block">
              <span className="font-medium">Apps creadas con Maris AI</span>
              <span className="block text-xs text-muted-foreground mt-1">Ejemplos reales de lo que puedes crear</span>
            </a>
          </div>
        </section>

        <section className="container px-4 mx-auto max-w-3xl text-center">
          <div className="rounded-2xl bg-gradient-to-br from-primary/20 to-cyan-500/10 border border-primary/20 p-10 space-y-5">
            <h2 className="text-3xl font-black text-white">¿Listo para crear tu app?</h2>
            <p className="text-white/60 max-w-md mx-auto">La primera plataforma de creación de apps con IA nativa en español — hecha para hispanohablantes, no traducida después. Empieza gratis hoy.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/sign-up"><Button size="lg" className="bg-primary hover:bg-primary/90 text-white font-bold gap-2 h-12 px-8 shadow-lg shadow-primary/30"><Rocket className="h-5 w-5" />Crear cuenta gratis</Button></Link>
              <Link href="/demo"><Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/[0.05] h-12 px-8 gap-2"><Zap className="h-5 w-5" />Ver demo en vivo</Button></Link>
            </div>
            <p className="text-xs text-white/30">Sin tarjeta de crédito · Soporte por ticket (respuesta en menos de 3-4 horas) · WhatsApp para casos urgentes: <a href="https://wa.me/34611935616" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/60 transition-colors">+34 611 935 616</a></p>
          </div>
        </section>
      </div>
    </Layout>
  );
}
