import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, X, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { Layout } from "@/components/layout";

export default function PricingPage() {
  const plans = [
    {
      name: "Starter",
      price: "0€",
      period: "para siempre",
      description: "Ideal para explorar el potencial de Maris AI y dar vida a tu primera idea.",
      features: [
        { text: "1 app generada/mes", included: true },
        { text: "Acceso completo a 9 agentes IA", included: true },
        { text: "Exportación de código a GitHub", included: true },
        { text: "Soporte estándar por email", included: true },
        { text: "Generación de apps ilimitadas", included: false },
        { text: "Soporte prioritario 24/7", included: false },
        { text: "Dominio personalizado y SSL", included: false },
      ],
      cta: "Empieza gratis",
      href: "/sign-up",
      highlight: false,
    },
    {
      name: "Pro",
      price: "29€",
      period: "/mes",
      description: "Para emprendedores y equipos que buscan escalar rápidamente con soporte premium.",
      features: [
        { text: "Generación de apps ilimitadas", included: true },
        { text: "Acceso completo a 9 agentes IA", included: true },
        { text: "Exportación de código a GitHub", included: true },
        { text: "Soporte prioritario 24/7", included: true },
        { text: "Dominio personalizado y SSL", included: true },
        { text: "Historial de proyectos ilimitado", included: true },
        { text: "Acceso a la API de generación", included: false },
      ],
      cta: "Actualizar a Pro",
      href: "/sign-up",
      highlight: true,
    },
    {
      name: "Enterprise",
      price: "A medida",
      period: "contacta con nosotros",
      description: "Soluciones personalizadas para grandes empresas y proyectos con requisitos únicos.",
      features: [
        { text: "Todas las características del plan Pro", included: true },
        { text: "Acceso a la API de generación", included: true },
        { text: "Modelos de IA personalizados y optimizados", included: true },
        { text: "Soporte técnico 24/7 dedicado", included: true },
        { text: "Acuerdo de Nivel de Servicio (SLA) garantizado", included: true },
        { text: "Integración personalizada con tus sistemas", included: true },
        { text: "Análisis de uso avanzado y consultoría estratégica", included: true },
      ],
      cta: "Contactar con Ventas",
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
              Planes flexibles para tu éxito.
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Elige la potencia de Maris AI que mejor se adapte a tus ambiciones. Escala sin límites, paga solo por lo que necesitas.
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
            <h2 className="text-3xl font-bold text-white mb-12 text-center">Preguntas Frecuentes (FAQ)</h2>

          <div className="space-y-6">
            {[
              {
                q: "¿Puedo cambiar o cancelar mi plan en cualquier momento?",
                a: "Sí, tienes total flexibilidad. Puedes cambiar o cancelar tu suscripción en cualquier momento desde tu panel de usuario, sin penalizaciones. Los cambios se aplic aplicarán al inicio de tu próximo ciclo de facturación.",
              },
              {
                q: "¿Qué funcionalidades incluye el plan Starter (gratuito)?",
                a: "El plan Starter te permite generar 1 aplicación al mes, acceder a nuestro equipo completo de 9 agentes IA especializados y exportar el código generado a GitHub. No se requiere tarjeta de crédito para empezar.",
              },
              {
                q: "¿Ofrecen descuentos por suscripciones anuales?",
                a: "¡Absolutamente! Al optar por una suscripción anual, te beneficiarás de un descuento equivalente a 2 meses gratis. Contacta con nuestro equipo de ventas para obtener más información y activar esta oferta.",
              },
              {
                q: "¿Qué sucede con mis aplicaciones si decido cancelar mi suscripción?",
                a: "Tus aplicaciones son y siempre serán tuyas. Aunque canceles, mantendrás la propiedad y podrás exportar todo el código a GitHub para desplegarlo donde desees. Solo perderás la capacidad de generar nuevas aplicaciones o acceder a funciones premium.",
              },
              {
                q: "¿Cómo funciona el soporte prioritario?",
                a: "Los planes Pro y Enterprise incluyen soporte prioritario 24/7. Esto significa que tus consultas y solicitudes serán atendidas con la máxima urgencia por nuestro equipo de expertos, garantizando una resolución rápida y eficiente.",
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
              Empieza hoy mismo con Maris AI. Crea tu primera aplicación de forma gratuita, sin necesidad de tarjeta de crédito y sin compromiso.
            </p>
            <Link href="/sign-up">
              <Button size="lg" className="h-14 px-8 text-lg bg-primary text-white hover:bg-primary/90">
                Crea tu primera app gratis <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </motion.div>
        </section>
      </div>
    </Layout>
  );
}
