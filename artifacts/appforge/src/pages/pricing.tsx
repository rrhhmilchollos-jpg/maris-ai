import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, ArrowRight, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { Layout } from "@/components/layout";

export default function PricingPage() {
  const creditPacks = [
    {
      credits: 100,
      price: 20,
      pricePerCredit: "0,20€",
      highlight: false,
      badge: null,
      label: "Starter",
    },
    {
      credits: 250,
      price: 45,
      pricePerCredit: "0,18€",
      highlight: false,
      badge: null,
      label: "Builder",
    },
    {
      credits: 500,
      price: 85,
      pricePerCredit: "0,17€",
      highlight: true,
      badge: "MÁS POPULAR",
      label: "Popular",
    },
    {
      credits: 1250,
      price: 200,
      pricePerCredit: "0,16€",
      highlight: false,
      badge: null,
      label: "Pro",
    },
    {
      credits: 3000,
      price: 450,
      originalPrice: 600,
      pricePerCredit: "0,15€",
      highlight: false,
      badge: "25% MÁS",
      label: "Scale",
    },
    {
      credits: 6000,
      price: 850,
      originalPrice: 1200,
      pricePerCredit: "0,14€",
      highlight: false,
      badge: "30% MÁS",
      label: "Enterprise",
    },
  ];

  const features = [
    "Acceso completo a 9 agentes IA especializados",
    "Generación de apps React + TypeScript + Tailwind",
    "Backend Express + MongoDB incluido",
    "Exportación de código a GitHub",
    "Despliegue automático en Vercel",
    "Los créditos nunca caducan",
    "Soporte por email incluido",
  ];

  return (
    <Layout>
      <div className="min-h-screen bg-background pt-24 pb-12">
        {/* Header */}
        <section className="container px-4 md:px-8 mx-auto max-w-5xl mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 tracking-tight">
              Créditos flexibles para tu éxito.
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Paga solo lo que necesitas. Los créditos nunca caducan y se usan para generar apps con los 9 agentes IA de Maris AI.
            </p>
            <p className="mt-4 text-sm text-primary font-medium">
              🎁 Regístrate gratis y recibe 45 créditos de bienvenida — sin tarjeta de crédito
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400">
              <Zap className="h-4 w-4" />
              Cuanto más compras, más barato el crédito
            </div>
          </motion.div>
        </section>

        {/* Credit Packs */}
        <section className="container px-4 md:px-8 mx-auto max-w-6xl mb-20">
          <div className="grid md:grid-cols-3 gap-6">
            {creditPacks.map((pack, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                viewport={{ once: true }}
                className={`relative rounded-2xl border transition-all ${
                  pack.highlight
                    ? "border-primary/50 bg-gradient-to-br from-primary/10 to-primary/5 ring-2 ring-primary/20 scale-105"
                    : "border-white/10 bg-card/40 hover:border-primary/30"
                }`}
              >
                {pack.badge && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-white text-xs font-bold px-4 py-1 rounded-full">
                      {pack.badge}
                    </span>
                  </div>
                )}

                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Zap className="h-5 w-5 text-primary" />
                      <span className="text-2xl font-bold text-white">{pack.credits.toLocaleString()} cr</span>
                    </div>
                    <span className="text-xs font-bold text-white/40 uppercase tracking-widest">{pack.label}</span>
                  </div>

                  <div className="mb-2">
                    {pack.originalPrice && (
                      <span className="text-muted-foreground line-through text-sm mr-2">
                        {pack.originalPrice.toLocaleString()}€
                      </span>
                    )}
                    <span className="text-4xl font-bold text-white">{pack.price.toLocaleString()}€</span>
                  </div>

                  <p className="text-sm text-emerald-400 font-medium mb-6">
                    {pack.pricePerCredit} por crédito
                  </p>

                  <Link href="/sign-up">
                    <Button
                      className={`w-full h-11 text-base mb-4 ${
                        pack.highlight
                          ? "bg-primary text-white hover:bg-primary/90"
                          : "bg-white/10 text-white hover:bg-white/20"
                      }`}
                    >
                      Comprar ahora
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>

                  <p className="text-xs text-muted-foreground text-center">
                    Los créditos nunca caducan
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Tabla comparativa de precio por crédito */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-10 rounded-2xl border border-white/10 bg-card/40 p-6"
          >
            <p className="text-sm font-semibold text-white/60 text-center mb-4 uppercase tracking-widest">Ahorro por volumen</p>
            <div className="flex items-end justify-between gap-2">
              {creditPacks.map((pack, i) => {
                const pct = Math.round((1 - parseFloat(pack.pricePerCredit.replace(",", ".")) / 0.20) * 100);
                const height = 20 + i * 13;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-emerald-400 font-bold">{pct > 0 ? `-${pct}%` : "base"}</span>
                    <div
                      className={`w-full rounded-t-md ${pack.highlight ? "bg-primary" : "bg-white/10"}`}
                      style={{ height: `${height}px` }}
                    />
                    <span className="text-[10px] text-white/30">{pack.label}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </section>

        {/* What's included */}
        <section className="container px-4 md:px-8 mx-auto max-w-3xl mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-2xl border border-white/10 bg-card/40 p-8"
          >
            <h2 className="text-2xl font-bold text-white mb-6 text-center">
              Todo incluido en cada crédito
            </h2>
            <div className="grid md:grid-cols-2 gap-3">
              {features.map((feature, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-white/80">{feature}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* FAQ */}
        <section className="container px-4 md:px-8 mx-auto max-w-3xl mb-20">
          <h2 className="text-3xl font-bold text-white mb-12 text-center">Preguntas Frecuentes</h2>
          <div className="space-y-6">
            {[
              {
                q: "¿Qué son los créditos y cómo se usan?",
                a: "Los créditos son la moneda de Maris AI. Cada vez que generas una app, modificas código o usas los agentes IA, se consumen créditos según la complejidad de la tarea. Una landing page básica consume 1 crédito; una app completa con backend puede consumir 3-15 créditos.",
              },
              {
                q: "¿Cuántos créditos recibo al registrarme gratis?",
                a: "Al crear tu cuenta gratuita recibes 45 créditos de bienvenida, sin necesidad de tarjeta de crédito. Esto te permite generar tu primera app completa (frontend + backend) y todavía te queda saldo real para probar varios ajustes y ediciones — no solo lo justo para una demo.",
              },
              {
                q: "¿Por qué es más barato comprar packs grandes?",
                a: "Cuanto mayor es el pack, menor es el precio por crédito. El pack Starter cuesta 0,20€/crédito mientras que el Enterprise baja hasta 0,14€/crédito — un 30% de ahorro. Es nuestra forma de premiar a los usuarios que más confían en Maris AI.",
              },
              {
                q: "¿Los créditos caducan?",
                a: "No. Los créditos que compras nunca caducan. Puedes usarlos a tu ritmo, sin presión de fechas límite.",
              },
              {
                q: "¿Puedo comprar más créditos en cualquier momento?",
                a: "Sí. Puedes comprar créditos adicionales en cualquier momento desde tu panel de usuario.",
              },
              {
                q: "¿El código generado es mío?",
                a: "Sí, el código generado por Maris AI es 100% tuyo. Puedes exportarlo a GitHub, desplegarlo donde quieras y modificarlo libremente sin restricciones de licencia.",
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                viewport={{ once: true }}
                className="p-6 rounded-xl border border-white/10 bg-card/40 hover:border-primary/30 transition-all"
              >
                <h3 className="font-semibold text-white mb-3">{item.q}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.a}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="container px-4 md:px-8 mx-auto max-w-3xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold text-white mb-6">
              ¿Preparado para transformar tus ideas en realidad?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Empieza hoy mismo con Maris AI. Recibe 45 créditos de bienvenida al registrarte, sin necesidad de tarjeta de crédito y sin compromiso.
            </p>
            <Link href="/sign-up">
              <Button size="lg" className="h-14 px-8 text-lg bg-primary text-white hover:bg-primary/90">
                Empieza Gratis <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </motion.div>
        </section>
      </div>
    </Layout>
  );
}
