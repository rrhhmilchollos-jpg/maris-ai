import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useUser } from "@clerk/react";
import { Copy, Check, ArrowRight, Euro, Users, TrendingUp, Zap, Share2, Rocket, ChevronRight, ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";

// ─── Cómo funciona ───────────────────────────────────────────────────────────
const STEPS = [
  {
    num: "01",
    title: "Genera tu link único",
    desc: "Entra en tu panel, ve a 'Programa de afiliados' y copia tu link personalizado. Listo en 10 segundos.",
    icon: "🔗",
  },
  {
    num: "02",
    title: "Compártelo donde quieras",
    desc: "En TikTok, Instagram, YouTube, LinkedIn, WhatsApp, tu blog o donde tengas audiencia. Sin límites.",
    icon: "📢",
  },
  {
    num: "03",
    title: "Tu referido se registra y compra",
    desc: "Cuando alguien usa tu link y compra créditos en Maris AI, el sistema lo registra automáticamente.",
    icon: "💳",
  },
  {
    num: "04",
    title: "Cobras el 30% de por vida",
    desc: "Recibes el 30% de cada compra que haga tu referido, no solo la primera. Para siempre, sin caducidad.",
    icon: "💰",
  },
];

// ─── Calculadora de ingresos ─────────────────────────────────────────────────
const TIERS = [
  { referrals: 10, avgSpend: 50, label: "Empezando" },
  { referrals: 50, avgSpend: 80, label: "Creciendo" },
  { referrals: 200, avgSpend: 100, label: "Escalando" },
];

// ─── FAQs ────────────────────────────────────────────────────────────────────
const FAQS = [
  { q: "¿Cuánto cobro exactamente?", a: "El 30% de cada compra que haga tu referido en Maris AI, no solo la primera. Si alguien que trú trajiste compra 100€ de créditos, tú recibes 30€. Si luego compra otros 200€, recibes otros 60€." },
  { q: "¿Cuándo puedo cobrar?", a: "Cuando acumules 50€ o más en comisiones. Puedes cobrar por PayPal o transferencia bancaria. Procesamos los pagos en un máximo de 48 horas laborables." },
  { q: "¿Las comisiones caducan?", a: "No. Las comisiones que generes se acumulan indefinidamente hasta que las cobres. Y el 30% aplica a todas las compras de tus referidos, sin fecha límite." },
  { q: "¿Hay límite de referidos?", a: "Ninguno. Puedes traer 1 referido o 10.000. Cuantos más traigas, más cobras. Sin tope." },
  { q: "¿Puedo ver quién se ha registrado con mi link?", a: "Puedes ver el número de referidos y cuántos han pagado, pero no sus datos personales por privacidad. Sí ves el importe de cada comisión y cuándo se generó." },
  { q: "¿Qué herramientas tengo para promocionar Maris AI?", a: "Tu link personalizado, acceso a la demo en vivo para mostrar en directo, y puedes pedirnos assets gráficos para redes sociales escribiéndonos por WhatsApp." },
];

export default function AfiliadosPage() {
  const { isSignedIn } = useUser();
  const { toast } = useToast();
  const [affiliateData, setAffiliateData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [payoutForm, setPayoutForm] = useState(false);
  const [paypalEmail, setPaypalEmail] = useState("");
  const [bankIban, setBankIban] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Programa de Afiliados — Gana el 30% con Maris AI | Maris AI";
    const setMeta = (sel: string, val: string) => { const el = document.querySelector(sel); if (el) el.setAttribute("content", val); };
    setMeta('meta[name="description"]', "Gana el 30% de comisión por cada cliente que traigas a Maris AI. Sin límite de referidos, sin caducidad, pago por PayPal o transferencia.");
    let canonical = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    if (!canonical) { canonical = document.createElement("link") as HTMLLinkElement; canonical.rel = "canonical"; document.head.appendChild(canonical); }
    canonical.href = "https://www.marisai.es/afiliados";
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;
    setIsLoading(true);
    Promise.all([
      apiFetch<any>("/api/affiliates/my-code").catch(() => null),
      apiFetch<any>("/api/affiliates/stats").catch(() => null),
    ]).then(([codeData, statsData]) => {
      setAffiliateData({ ...codeData, ...statsData });
    }).finally(() => setIsLoading(false));
  }, [isSignedIn]);

  const generateCode = async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch<any>("/api/affiliates/my-code");
      setAffiliateData((prev: any) => ({ ...prev, ...data }));
      toast({ title: "✅ Link generado", description: "Ya puedes compartirlo y empezar a ganar." });
    } catch {
      toast({ title: "Error", description: "No se pudo generar el código.", variant: "destructive" });
    } finally { setIsLoading(false); }
  };

  const copyLink = () => {
    if (!affiliateData?.link) return;
    navigator.clipboard?.writeText(affiliateData.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "✅ Link copiado", description: "Pégalo donde quieras para empezar a ganar." });
  };

  const requestPayout = async () => {
    if (!paypalEmail && !bankIban) {
      toast({ title: "Indica un método de cobro", variant: "destructive" }); return;
    }
    setSubmitting(true);
    try {
      const data = await apiFetch<any>("/api/affiliates/request-payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paypalEmail, bankIban }),
      });
      toast({ title: "✅ Solicitud enviada", description: data.message });
      setPayoutForm(false);
      setAffiliateData((prev: any) => ({ ...prev, payoutRequested: true }));
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  return (
    <Layout>
      <div className="min-h-screen bg-background">

        {/* ── Hero ── */}
        <section className="container max-w-5xl mx-auto px-4 pt-20 pb-16 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-4 py-1.5 text-sm font-medium text-yellow-400">
              💰 Programa de Afiliados — Gana el 30% de comisión
            </div>
            <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight leading-tight">
              Recomienda Maris AI<br />
              <span className="bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">y cobra el 30% para siempre</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Sin límite de referidos. Sin caducidad de comisiones. 30% de cada compra que haga alguien que venga de tu link, no solo la primera.
            </p>

            {/* Calculadora rápida */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto pt-2">
              {TIERS.map((t) => (
                <div key={t.label} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-center space-y-1">
                  <div className="text-xs text-white/40 font-medium">{t.label}</div>
                  <div className="text-sm text-white/60">{t.referrals} referidos × {t.avgSpend}€</div>
                  <div className="text-2xl font-black text-yellow-400">
                    {Math.round(t.referrals * t.avgSpend * 0.30)}€<span className="text-sm font-normal text-white/30">/mes</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              {isSignedIn ? (
                <button onClick={() => document.getElementById("panel-afiliado")?.scrollIntoView({ behavior: "smooth" })}>
                  <Button size="lg" className="bg-yellow-500 hover:bg-yellow-400 text-black font-black gap-2 shadow-lg shadow-yellow-500/30">
                    <Euro className="h-5 w-5" />Ver mi panel de afiliado
                  </Button>
                </button>
              ) : (
                <Link href="/sign-up">
                  <Button size="lg" className="bg-yellow-500 hover:bg-yellow-400 text-black font-black gap-2 shadow-lg shadow-yellow-500/30">
                    <Rocket className="h-5 w-5" />Unirme al programa gratis
                  </Button>
                </Link>
              )}
              <Link href="/demo">
                <Button size="lg" variant="outline" className="gap-2 border-white/20 text-white hover:bg-white/[0.05]">
                  <Zap className="h-5 w-5" />Ver demo para mostrar a tu audiencia
                </Button>
              </Link>
            </div>
          </motion.div>
        </section>

        {/* ── Cómo funciona ── */}
        <section className="container max-w-5xl mx-auto px-4 pb-16">
          <h2 className="text-2xl md:text-3xl font-black text-white text-center mb-10">Cómo funciona en 4 pasos</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {STEPS.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-3 relative"
              >
                <div className="text-3xl">{step.icon}</div>
                <div className="text-xs font-mono text-yellow-500/60">{step.num}</div>
                <h3 className="font-bold text-white">{step.title}</h3>
                <p className="text-sm text-white/50 leading-relaxed">{step.desc}</p>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="absolute -right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-white/20 hidden md:block" />
                )}
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Ventajas ── */}
        <section className="container max-w-5xl mx-auto px-4 pb-16">
          <h2 className="text-2xl md:text-3xl font-black text-white text-center mb-10">¿Por qué es fácil recomendar Maris AI?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { icon: "🇪🇸", title: "La única en español", desc: "Tu audiencia hispanohablante no tiene otra opción igual. Lovable, Bolt y Base44 están en inglés. Maris AI es la referencia para España y Latinoamérica." },
              { icon: "⚡", title: "Demo en vivo que convierte", desc: "Puedes mostrar marisai.es/demo en directo en tu vídeo o directa. Tu audiencia ve cómo se crea una app real en minutos. Eso vende solo." },
              { icon: "💸", title: "Precio accesible = más ventas", desc: "Con el plan gratuito de 45 créditos y planes desde 19€/mes, la barrera de entrada es muy baja. Más registros = más comisiones para ti." },
              { icon: "🔄", title: "30% recurrente, no puntual", desc: "No cobras solo cuando alguien se registra. Cobras el 30% de CADA compra de créditos que haga tu referido. Para siempre." },
              { icon: "📊", title: "Panel en tiempo real", desc: "Ves exactamente cuántos referidos tienes, cuántos han pagado y cuánto has ganado. Sin misterios, todo transparente." },
              { icon: "🚀", title: "Producto que retiene", desc: "Una vez que alguien crea su app con Maris AI, vuelve a comprar créditos para mejorarla. Tus comisiones crecen sin que hagas nada más." },
            ].map((item, i) => (
              <div key={i} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-2 hover:border-yellow-500/20 transition">
                <div className="text-2xl">{item.icon}</div>
                <h3 className="font-bold text-white">{item.title}</h3>
                <p className="text-sm text-white/50 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Panel de afiliado (solo si está logado) ── */}
        {isSignedIn && (
          <section id="panel-afiliado" className="container max-w-3xl mx-auto px-4 pb-16">
            <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-8 space-y-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-6 w-6 text-yellow-400" />
                <h2 className="text-xl font-black text-white">Tu panel de afiliado</h2>
              </div>

              {isLoading ? (
                <div className="text-white/40 text-sm animate-pulse">Cargando tus datos…</div>
              ) : affiliateData?.code ? (
                <div className="space-y-5">
                  {/* Stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Referidos total", value: affiliateData.totalReferrals ?? 0, icon: Users },
                      { label: "Han pagado", value: affiliateData.paidReferrals ?? 0, icon: Euro },
                      { label: "Ganado total", value: `${(affiliateData.totalEarned ?? 0).toFixed(2)}€`, icon: TrendingUp },
                      { label: "Pendiente cobro", value: `${(affiliateData.balance ?? 0).toFixed(2)}€`, icon: Euro, highlight: true },
                    ].map((s, i) => (
                      <div key={i} className={`rounded-xl border p-3 text-center space-y-1 ${s.highlight ? "border-yellow-500/30 bg-yellow-500/10" : "border-white/[0.07] bg-white/[0.02]"}`}>
                        <s.icon className={`h-4 w-4 mx-auto ${s.highlight ? "text-yellow-400" : "text-white/40"}`} />
                        <div className={`text-lg font-black ${s.highlight ? "text-yellow-400" : "text-white"}`}>{s.value}</div>
                        <div className="text-[10px] text-white/40">{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Link */}
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-white/70">Tu link de afiliado</p>
                    <div className="flex gap-2">
                      <div className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm text-white/60 font-mono truncate">
                        {affiliateData.link}
                      </div>
                      <Button onClick={copyLink} variant="outline" className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 gap-2 shrink-0">
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copied ? "Copiado" : "Copiar"}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <a href={`https://twitter.com/intent/tweet?text=Crea%20tu%20app%20en%205%20minutos%20con%20IA%20en%20espa%C3%B1ol%20🚀%20${encodeURIComponent(affiliateData.link)}`} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="border-white/10 text-white/50 hover:text-white text-xs gap-1.5">
                          <Share2 className="h-3.5 w-3.5" /> Twitter / X
                        </Button>
                      </a>
                      <a href={`https://api.whatsapp.com/send?text=Mira%20esto%2C%20crea%20tu%20app%20en%205%20minutos%20con%20IA%20en%20espa%C3%B1ol%20👉%20${encodeURIComponent(affiliateData.link)}`} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="border-white/10 text-white/50 hover:text-white text-xs gap-1.5">
                          <ExternalLink className="h-3.5 w-3.5" /> WhatsApp
                        </Button>
                      </a>
                    </div>
                  </div>

                  {/* Solicitar cobro */}
                  {(affiliateData.balance ?? 0) >= 50 && !affiliateData.payoutRequested && (
                    <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 space-y-3">
                      <p className="text-sm font-semibold text-green-400">
                        🎉 Tienes {affiliateData.balance.toFixed(2)}€ disponibles para cobrar
                      </p>
                      {!payoutForm ? (
                        <Button onClick={() => setPayoutForm(true)} className="bg-green-600 hover:bg-green-500 text-white font-bold gap-2">
                          <Euro className="h-4 w-4" /> Solicitar cobro
                        </Button>
                      ) : (
                        <div className="space-y-3">
                          <input value={paypalEmail} onChange={e => setPaypalEmail(e.target.value)} placeholder="Tu email de PayPal (recomendado)" className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-green-500/50" />
                          <p className="text-xs text-white/40 text-center">— o —</p>
                          <input value={bankIban} onChange={e => setBankIban(e.target.value)} placeholder="Tu IBAN bancario (ES76 0049...)" className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-green-500/50" />
                          <div className="flex gap-2">
                            <Button onClick={requestPayout} disabled={submitting} className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold">
                              {submitting ? "Enviando…" : "Confirmar solicitud"}
                            </Button>
                            <Button onClick={() => setPayoutForm(false)} variant="outline" className="border-white/20 text-white">Cancelar</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {affiliateData.payoutRequested && (
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-blue-400">
                      ⏳ Solicitud de cobro pendiente. Te contactaremos en las próximas 48 horas.
                    </div>
                  )}
                  {(affiliateData.balance ?? 0) < 50 && !affiliateData.payoutRequested && (
                    <p className="text-xs text-white/30">
                      Necesitas 50€ mínimo para solicitar el cobro. Te faltan {(50 - (affiliateData.balance ?? 0)).toFixed(2)}€.
                    </p>
                  )}

                  {/* Últimas comisiones */}
                  {affiliateData.commissions?.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-white/60">Últimas comisiones</p>
                      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                        {affiliateData.commissions.slice(0, 5).map((c: any, i: number) => (
                          <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04] last:border-0">
                            <span className="text-sm text-white/60">{c.description}</span>
                            <span className="text-sm font-bold text-green-400">+{c.amount?.toFixed(2)}€</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center space-y-4 py-4">
                  <p className="text-white/60">Aún no tienes un código de afiliado. Genéralo ahora y empieza a ganar.</p>
                  <Button onClick={generateCode} disabled={isLoading} className="bg-yellow-500 hover:bg-yellow-400 text-black font-black gap-2">
                    <Zap className="h-5 w-5" />{isLoading ? "Generando…" : "Generar mi link de afiliado"}
                  </Button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── FAQs ── */}
        <section className="container max-w-3xl mx-auto px-4 pb-16">
          <h2 className="text-2xl font-black text-white text-center mb-8">Preguntas frecuentes</h2>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <details key={i} className="rounded-xl border border-white/[0.07] bg-white/[0.02] group">
                <summary className="p-5 font-semibold text-white cursor-pointer list-none flex justify-between items-center hover:text-yellow-400 transition">
                  <span>{faq.q}</span>
                  <ArrowRight className="h-4 w-4 text-white/40 group-open:rotate-90 transition-transform shrink-0 ml-4" />
                </summary>
                <div className="px-5 pb-5 text-sm text-white/60 leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
        </section>

        {/* ── CTA final ── */}
        {!isSignedIn && (
          <section className="container max-w-3xl mx-auto px-4 pb-20 text-center">
            <div className="rounded-2xl bg-gradient-to-br from-yellow-500/20 to-orange-500/10 border border-yellow-500/20 p-10 space-y-5">
              <h2 className="text-3xl font-black text-white">Empieza a ganar hoy</h2>
              <p className="text-white/60 max-w-md mx-auto">Regístrate gratis, genera tu link y empieza a compartirlo. Tus primeras comisiones pueden llegar esta misma semana.</p>
              <Link href="/sign-up">
                <Button size="lg" className="bg-yellow-500 hover:bg-yellow-400 text-black font-black gap-2 h-12 px-8 shadow-lg shadow-yellow-500/30">
                  <Rocket className="h-5 w-5" />Unirme al programa gratis
                </Button>
              </Link>
              <p className="text-xs text-white/30">Sin cuotas · Sin compromisos · Pago cuando quieras cobrar</p>
            </div>
          </section>
        )}

      </div>
    </Layout>
  );
}
