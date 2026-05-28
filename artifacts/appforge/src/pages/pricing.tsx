import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, X, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { Layout } from "@/components/layout";

export function PricingPage() {
  const plans = [
    {
      name: "Gratuito",
      price: "0€",
      period: "para siempre",
      description: "Perfecto para probar Maris AI sin compromiso",
      features: [
        { text: "1 app generada/mes", included: true },
        { text: "Acceso a 9 agentes IA", included: true },
        { text: "Exportación a GitHub", included: true },
        { text: "Soporte por email", included: true },
        { text: "Apps ilimitadas", included: false },
        { text: "Prioridad en soporte", included: false },
        { text: "Dominio personalizado", included: false },
      ],
      cta: "Comenzar gratis",
      href: "/sign-up",
      highlight: false,
    },
    {
      name: "Pro",
      price: "29€",
      period: "/mes",
      description: "Para emprendedores y startups que necesitan velocidad",
      features: [
        { text: "Apps ilimitadas", included: true },
        { text: "Acceso a 9 agentes IA", included: true },
        { text: "Exportación a GitHub", included: true },
        { text: "Soporte prioritario", included: true },
        { text: "Dominio personalizado", included: true },
        { text: "Historial ilimitado", included: true },
        { text: "API de generación", included: false },
      ],
      cta: "Actualizar a Pro",
      href: "/sign-up",
      highlight: true,
    },
    {
      name: "Enterprise",
      price: "Personalizado",
      period: "contacta con nosotros",
      description: "Para equipos y organizaciones con necesidades específicas",
      features: [
        { text: "Todo en Pro", included: true },
        { text: "API de generación", included: true },
        { text: "Modelos personalizados", included: true },
        { text: "Soporte 24/7 dedicado", included: true },
        { text: "SLA garantizado", included: true },
        { text: "Integración personalizada", included: true },
        { text: "Análisis de uso avanzado", included: true },
      ],
      cta: "Contactar ventas",
      href: "mailto:ventas@marisai.es",
      highlight: false,
    },
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
              Precios transparentes
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Sin sorpresas. Sin cargos ocultos. Elige el plan que se adapte a tu presupuesto y escala cuando necesites.
            </p>
          </motion.div>
        </section>

        {/* Pricing Cards */}
        <section className="container px-4 md:px-8 mx-auto max-w-6xl mb-20">
          <div className="grid md:grid-cols-3 gap-8">
            {plans.map((plan, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                viewport={{ once: true }}
                className={`relative rounded-2xl border transition-all ${
                  plan.highlight
                    ? "border-primary/50 bg-gradient-to-br from-primary/10 to-primary/5 ring-2 ring-primary/20 scale-105"
                    : "border-white/10 bg-card/40 hover:border-primary/30"
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-white text-xs font-bold px-4 py-1 rounded-full">
                      MÁS POPULAR
                    </span>
                  </div>
                )}

                <div className="p-8">
                  <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                  <p className="text-muted-foreground text-sm mb-6">{plan.description}</p>

                  <div className="mb-8">
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold text-white">{plan.price}</span>
                      <span className="text-muted-foreground text-sm">{plan.period}</span>
                    </div>
                  </div>

                  <Link href={plan.href}>
                    <Button
                      className={`w-full mb-8 h-12 text-base ${
                        plan.highlight
                          ? "bg-primary text-white hover:bg-primary/90"
                          : "bg-white/10 text-white hover:bg-white/20"
                      }`}
                    >
                      {plan.cta}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>

                  <div className="space-y-4">
                    {plan.features.map((feature, j) => (
                      <div key={j} className="flex items-start gap-3">
                        {feature.included ? (
                          <Check className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        ) : (
                          <X className="h-5 w-5 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
                        )}
                        <span
                          className={`text-sm ${
                            feature.included ? "text-white/80" : "text-muted-foreground/60"
                          }`}
                        >
                          {feature.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="container px-4 md:px-8 mx-auto max-w-3xl mb-20">
          <h2 className="text-3xl font-bold text-white mb-12 text-center">Preguntas frecuentes</h2>

          <div className="space-y-6">
            {[
              {
                q: "¿Puedo cambiar de plan en cualquier momento?",
                a: "Sí. Puedes cambiar o cancelar tu plan en cualquier momento sin penalización. Los cambios se aplican al siguiente ciclo de facturación.",
              },
              {
                q: "¿Qué incluye la prueba gratuita?",
                a: "La prueba gratuita incluye acceso completo a los 9 agentes IA, generación de 1 app/mes y exportación a GitHub. Sin tarjeta de crédito requerida.",
              },
              {
                q: "¿Hay descuentos para pagos anuales?",
                a: "Sí. Si pagas anualmente, obtienes 2 meses gratis. Contacta con nosotros para más detalles.",
              },
              {
                q: "¿Qué pasa con mis apps si cancelo?",
                a: "Tus apps seguirán siendo tuyas. Puedes exportarlas a GitHub y desplegarlas donde quieras. Solo perderás acceso a generar nuevas apps.",
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
              ¿Listo para empezar?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Crea tu primera app gratis. Sin tarjeta de crédito. Sin compromiso.
            </p>
            <Link href="/sign-up">
              <Button size="lg" className="h-14 px-8 text-lg bg-primary text-white hover:bg-primary/90">
                Comenzar ahora <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </motion.div>
        </section>
      </div>
    </Layout>
  );
}
