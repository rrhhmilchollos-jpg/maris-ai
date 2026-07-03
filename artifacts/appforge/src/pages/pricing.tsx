import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, ArrowRight, Zap, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { Layout } from "@/components/layout";
import { useListCreditPackages } from "@/lib/api-client";

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  currency: string;
  popular?: boolean;
  badge?: string;
  pricePerCredit?: string;
}

export default function PricingPage() {
  // Los paquetes SIEMPRE se leen de /api/billing/packages (fuente única de
  // verdad: lib/payments.ts en el backend). ENCONTRADO: antes esta página
  // tenía su propio array de precios hardcodeado, desincronizado del backend
  // real que procesa el cobro — el usuario veía un precio en /pricing y se
  // le cobraba otro distinto en el checkout. Ahora es imposible que diverjan
  // porque es literalmente el mismo dato.
  const { data, isLoading } = useListCreditPackages();
  const creditPacks = (data as CreditPackage[] | undefined) || [];

  const features = [
    "Acceso completo a 9 agentes IA especializados",
    "Generación de apps React + TypeScript + Tailwind",
    "Backend Express + MongoDB incluido",
    "Exportación de código a GitHub",
    "Despliegue automático en Vercel",
    "Los créditos nunca caducan",
    "Soporte por email incluido",
  ];

  // Precio por crédito más caro de la tabla (paquete de 250, el primero
  // que no es el "gancho" de entrada) — se usa como referencia 100% para
  // calcular el % de ahorro que se muestra en cada pack.
  const packs = creditPacks;
  const baselinePerCredit = packs.length > 1
    ? packs[1].priceCents / packs[1].credits / 100
    : null;

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
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400">
              <Zap className="h-4 w-4" />
              Cuanto más compras, más barato el crédito
            </div>
          </motion.div>
        </section>

        {/* Credit Packs */}
        <section className="container px-4 md:px-8 mx-auto max-w-6xl mb-20">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              {packs.map((pack) => {
                const priceEur = pack.priceCents / 100;
                const perCreditNum = pack.priceCents / pack.credits / 100;
                const savingsPct = baselinePerCredit
                  ? Math.round((1 - perCreditNum / baselinePerCredit) * 100)
                  : 0;
                const highlight = !!pack.popular;
                return (
                  <motion.div
                    key={pack.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className={`relative rounded-2xl border transition-all ${
                      highlight
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
                        {savingsPct > 0 && (
                          <span className="text-xs font-bold text-emerald-400">-{savingsPct}%</span>
                        )}
                      </div>

                      <div className="mb-2">
                        <span className="text-4xl font-bold text-white">{priceEur.toLocaleString("es-ES")}€</span>
                      </div>

                      <p className="text-sm text-emerald-400 font-medium mb-6">
                        {pack.pricePerCredit || `${perCreditNum.toFixed(3)}€`} por crédito
                      </p>

                      <Link href="/sign-up">
                        <Button
                          className={`w-full h-11 text-base mb-4 ${
                            highlight
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
                );
              })}
            </div>
          )}
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
                q: "¿Por qué es más barato comprar packs grandes?",
                a: "Cuanto mayor es el pack, menor es el precio por crédito (con la única excepción del pack de entrada, pensado para que tu primera compra sea lo más accesible posible). Es nuestra forma de premiar a los usuarios que más confían en Maris AI.",
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
              Empieza hoy mismo con Maris AI, sin necesidad de tarjeta de crédito y sin compromiso.
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
