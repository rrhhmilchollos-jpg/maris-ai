import { useEffect, useState } from "react";
import {
  useGetMe,
  useListCreditPackages,
  useCreateCheckoutSession,
  useListTransactions,
} from "@/lib/api-client";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Zap, Check, Crown, Info, Loader2, ArrowUpRight,
  ArrowDownRight, Sparkles, Users, Building2, Package,
  MessageCircle,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const KIND_LABELS: Record<string, string> = {
  purchase: "compra",
  usage: "uso",
  bonus: "bono",
};

const PLAN_ICONS: Record<string, React.ReactNode> = {
  free: <Sparkles className="h-5 w-5" />,
  standard: <Zap className="h-5 w-5" />,
  pro: <Crown className="h-5 w-5" />,
  team: <Users className="h-5 w-5" />,
  enterprise: <Building2 className="h-5 w-5" />,
  "topup-50": <Package className="h-5 w-5" />,
};

export default function BillingPage() {
  const { data: me, isLoading: meLoading } = useGetMe();
  const isAdmin = !!me?.isAdmin;
  const { data: packages, isLoading: packagesLoading } = useListCreditPackages();
  const { data: transactions, isLoading: txLoading } = useListTransactions();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("canceled") === "1") {
      setCancelNotice("Has cancelado el pago. Tu saldo no se ha modificado.");
      const url = new URL(window.location.href);
      url.searchParams.delete("canceled");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const checkoutMutation = useCreateCheckoutSession({
    mutation: {
      onSuccess: (data) => { window.location.href = data.url; },
      onError: () => {
        setCheckoutError("No hemos podido iniciar el pago. Inténtalo de nuevo en unos minutos.");
      },
    },
  });

  const handleBuy = (priceId: string) => {
    setCheckoutError(null);
    setCancelNotice(null);
    checkoutMutation.mutate({ data: { priceId, billingPeriod } });
  };

  const formatPrice = (cents: number, currency: string) => {
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: currency.toUpperCase(),
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(0)}€`;
    }
  };

  // Separa planes de suscripción y top-ups
  const subscriptionPlans = (packages ?? []).filter(
    (p: any) => p.type === "subscription" && p.id !== "free"
  );
  const topupPacks = (packages ?? []).filter((p: any) => p.type === "topup");
  const enterprisePlan = (packages ?? []).find((p: any) => p.type === "contact");

  return (
    <Layout>
      <div className="container max-w-6xl mx-auto px-4 py-12 space-y-16">

        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-sm text-primary font-medium mb-2">
            <Zap className="h-3.5 w-3.5" />
            Créditos Maris AI
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white">
            Planes simples y transparentes
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Paga solo por lo que usas. Chatear con el agente es gratis.
            Los créditos se consumen solo cuando la IA genera o despliega.
          </p>

          {/* Saldo actual */}
          {!meLoading && (
            <div className="inline-flex items-center gap-3 bg-card border border-white/10 rounded-2xl px-6 py-3 mt-2">
              <Zap className="h-5 w-5 text-primary" />
              <span className="text-muted-foreground text-sm">Tu saldo:</span>
              <span className="text-2xl font-bold font-mono text-white">
                {isAdmin ? "∞" : me?.credits}
              </span>
              <span className="text-muted-foreground text-sm">créditos</span>
            </div>
          )}
        </div>

        {isAdmin && (
          <Alert className="border-primary/30 bg-primary/5 max-w-2xl mx-auto">
            <Crown className="h-4 w-4 text-primary" />
            <AlertTitle>Modo propietario activo</AlertTitle>
            <AlertDescription>
              Tu cuenta tiene créditos ilimitados. Puedes generar todas las apps que quieras sin coste.
            </AlertDescription>
          </Alert>
        )}

        {cancelNotice && (
          <Alert className="bg-amber-500/10 border-amber-500/20 text-amber-200 max-w-2xl mx-auto">
            <Info className="h-4 w-4 text-amber-400" />
            <AlertTitle>Pago cancelado</AlertTitle>
            <AlertDescription>{cancelNotice}</AlertDescription>
          </Alert>
        )}

        {checkoutError && (
          <Alert className="bg-red-500/10 border-red-500/20 text-red-200 max-w-2xl mx-auto">
            <Info className="h-4 w-4 text-red-400" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{checkoutError}</AlertDescription>
          </Alert>
        )}

        {/* Toggle mensual / anual */}
        <div className="flex justify-center">
          <div className="flex items-center gap-1 bg-card border border-white/10 rounded-xl p-1">
            <button
              onClick={() => setBillingPeriod("monthly")}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                billingPeriod === "monthly"
                  ? "bg-primary text-white shadow"
                  : "text-muted-foreground hover:text-white"
              }`}
            >
              Mensual
            </button>
            <button
              onClick={() => setBillingPeriod("annual")}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                billingPeriod === "annual"
                  ? "bg-primary text-white shadow"
                  : "text-muted-foreground hover:text-white"
              }`}
            >
              Anual
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-2 py-0.5 font-semibold">
                −17%
              </span>
            </button>
          </div>
        </div>

        {/* Planes de suscripción */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {packagesLoading
            ? [1, 2, 3].map((i) => <Skeleton key={i} className="h-[480px] rounded-2xl" />)
            : subscriptionPlans.map((pkg: any) => {
                const isPopular = pkg.popular;
                const price = billingPeriod === "annual" && pkg.annualPriceCents
                  ? pkg.annualPriceCents
                  : pkg.priceCents;

                return (
                  <div
                    key={pkg.id}
                    className={`relative rounded-2xl p-6 flex flex-col gap-6 transition-all ${
                      isPopular
                        ? "bg-primary/10 border-2 border-primary shadow-[0_0_40px_-10px_rgba(139,92,246,0.4)]"
                        : "bg-card border border-white/10 hover:border-white/20"
                    }`}
                  >
                    {isPopular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                        <Badge className="bg-primary text-white font-semibold px-4 py-1 text-xs shadow-lg">
                          Más popular
                        </Badge>
                      </div>
                    )}

                    {/* Plan header */}
                    <div>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${
                        isPopular ? "bg-primary/20 text-primary" : "bg-white/5 text-muted-foreground"
                      }`}>
                        {PLAN_ICONS[pkg.id] ?? <Zap className="h-5 w-5" />}
                      </div>
                      <h3 className="text-xl font-bold text-white mb-1">{pkg.name}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{pkg.description}</p>
                    </div>

                    {/* Precio */}
                    <div>
                      <div className="flex items-end gap-1">
                        <span className="text-4xl font-bold text-white">
                          {formatPrice(price, pkg.currency)}
                        </span>
                        <span className="text-muted-foreground mb-1.5">/mes</span>
                      </div>
                      {billingPeriod === "annual" && pkg.annualPriceCents && (
                        <p className="text-xs text-emerald-400 mt-1">
                          Facturado anualmente · Ahorras {formatPrice((pkg.priceCents - pkg.annualPriceCents) * 12, pkg.currency)}/año
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-3 bg-white/5 rounded-lg px-3 py-2">
                        <Zap className="h-3.5 w-3.5 text-primary" />
                        <span className="text-sm font-semibold text-white font-mono">
                          {pkg.credits.toLocaleString("es-ES")} créditos/mes
                        </span>
                      </div>
                    </div>

                    {/* Features */}
                    {pkg.features && (
                      <ul className="space-y-2.5 flex-1">
                        {pkg.features.map((f: string) => (
                          <li key={f} className="flex items-start gap-2.5 text-sm">
                            <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                            <span className="text-muted-foreground">{f}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* CTA */}
                    <Button
                      onClick={() => handleBuy(pkg.priceId)}
                      disabled={checkoutMutation.isPending}
                      className={`w-full h-11 font-semibold ${
                        isPopular
                          ? "bg-primary hover:bg-primary/90 text-white"
                          : "bg-white/10 hover:bg-white/20 text-white border border-white/10"
                      }`}
                    >
                      {checkoutMutation.isPending
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : "Empezar ahora"}
                    </Button>
                  </div>
                );
              })}
        </div>

        {/* Enterprise */}
        {enterprisePlan && (
          <div className="rounded-2xl border border-white/10 bg-card p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-muted-foreground">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Enterprise</h3>
                <p className="text-sm text-muted-foreground">
                  Créditos ilimitados, SSO, seguridad avanzada y soporte dedicado. Precio personalizado.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {["Créditos ilimitados", "SSO", "Soporte dedicado"].map((f) => (
                <span key={f} className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-white/5 rounded-full px-3 py-1">
                  <Check className="h-3 w-3 text-primary" />{f}
                </span>
              ))}
              <Button
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10 gap-2"
                onClick={() => window.open("mailto:rrhh.milchollos@gmail.com?subject=Maris AI Enterprise", "_blank")}
              >
                <MessageCircle className="h-4 w-4" />
                Contactar
              </Button>
            </div>
          </div>
        )}

        {/* Créditos extra (top-ups) */}
        {topupPacks.length > 0 && (
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white">¿Te quedas sin créditos?</h2>
              <p className="text-muted-foreground mt-1">
                Compra créditos extra que nunca caducan y se acumulan con tu plan.
              </p>
            </div>
            <div className="flex justify-center">
              {topupPacks.map((pkg: any) => (
                <div
                  key={pkg.id}
                  className="rounded-2xl border border-white/10 bg-card p-6 flex items-center gap-6 max-w-md w-full"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                    <Package className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-bold text-white">{pkg.name}</h3>
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                        No caducan
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{pkg.description}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-2xl font-bold text-white">
                      {formatPrice(pkg.priceCents, pkg.currency)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pkg.credits} créditos
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleBuy(pkg.priceId)}
                      disabled={checkoutMutation.isPending}
                      className="mt-2 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
                    >
                      Comprar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cómo funcionan los créditos */}
        <div className="rounded-2xl border border-white/10 bg-card/50 p-8 space-y-6">
          <h2 className="text-xl font-bold text-white text-center">¿Cómo funcionan los créditos?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: <MessageCircle className="h-5 w-5 text-emerald-400" />,
                title: "Chatear es gratis",
                desc: "Conversar con el agente, hacer preguntas y planificar no consume créditos.",
                color: "bg-emerald-500/10 border-emerald-500/20",
              },
              {
                icon: <Zap className="h-5 w-5 text-primary" />,
                title: "Generación: 1-5 cr",
                desc: "Una landing page simple usa 1-2 créditos. Una app compleja con BD y auth usa 3-5.",
                color: "bg-primary/10 border-primary/20",
              },
              {
                icon: <Package className="h-5 w-5 text-amber-400" />,
                title: "Top-ups que duran",
                desc: "Los créditos de suscripción se reinician cada mes. Los top-ups nunca caducan.",
                color: "bg-amber-500/10 border-amber-500/20",
              },
            ].map((item) => (
              <div key={item.title} className={`rounded-xl border p-5 ${item.color}`}>
                <div className="mb-3">{item.icon}</div>
                <h3 className="font-semibold text-white mb-1">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Historial de transacciones */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Zap className="h-5 w-5 text-muted-foreground" />
            Historial de transacciones
          </h2>

          <div className="rounded-2xl border border-white/10 bg-card/30 overflow-hidden">
            {txLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : transactions && transactions.length > 0 ? (
              <Table>
                <TableHeader className="bg-black/20">
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Fecha</TableHead>
                    <TableHead className="text-muted-foreground">Descripción</TableHead>
                    <TableHead className="text-muted-foreground">Tipo</TableHead>
                    <TableHead className="text-right text-muted-foreground">Créditos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx: any) => (
                    <TableRow key={tx.id} className="border-white/5 hover:bg-white/[0.02]">
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(tx.createdAt), "d MMM yyyy HH:mm", { locale: es })}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">{tx.description}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`font-mono text-[10px] uppercase tracking-wider ${
                            tx.kind === "purchase"
                              ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                              : "border-primary/30 text-primary bg-primary/10"
                          }`}
                        >
                          {KIND_LABELS[tx.kind] ?? tx.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <div className={`flex items-center justify-end ${tx.amount > 0 ? "text-emerald-400" : "text-primary"}`}>
                          {tx.amount > 0
                            ? <ArrowUpRight className="h-3 w-3 mr-1" />
                            : <ArrowDownRight className="h-3 w-3 mr-1" />}
                          {tx.amount > 0 ? "+" : ""}{tx.amount}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-14 px-4">
                <Zap className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Aún no hay transacciones.</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </Layout>
  );
}
