import { useEffect, useState } from "react";
import { 
  useGetMe, 
  useListCreditPackages, 
  useCreateCheckoutSession, 
  useListTransactions 
} from "@/lib/api-client";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CreditCard, Zap, Info, Loader2, ArrowUpRight, ArrowDownRight, Terminal, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const KIND_LABELS: Record<string, string> = {
  purchase: "compra",
  usage: "uso",
  bonus: "bono",
};

export default function BillingPage() {
  const { data: me, isLoading: meLoading } = useGetMe();
  const isAdmin = !!me?.isAdmin;
  const { data: packages, isLoading: packagesLoading } = useListCreditPackages();
  const { data: transactions, isLoading: txLoading } = useListTransactions();
  
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("canceled") === "1") {
      setCancelNotice(
        "Has cancelado el pago. Tu saldo no se ha modificado. Si quieres, puedes intentarlo de nuevo cuando estés listo.",
      );
      const url = new URL(window.location.href);
      url.searchParams.delete("canceled");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const checkoutMutation = useCreateCheckoutSession({
    mutation: {
      onSuccess: (data) => {
        window.location.href = data.url;
      },
      onError: (err: any) => {
        const raw = (err?.message || "").toString();
        if (raw.includes("503") || raw.toLowerCase().includes("stripe") || raw.toLowerCase().includes("conectad")) {
          setCheckoutError(
            "Los pagos aún se están configurando. Vuelve a intentarlo en unos minutos.",
          );
        } else {
          setCheckoutError(
            "No hemos podido iniciar el pago. Revisa tu conexión y prueba de nuevo en unos minutos.",
          );
        }
      },
    },
  });

  const handleBuy = (priceId: string) => {
    setCheckoutError(null);
    setCancelNotice(null);
    checkoutMutation.mutate({ data: { priceId } });
  };

  const formatPrice = (amountCents: number, currency: string) => {
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: currency.toUpperCase(),
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amountCents / 100);
    } catch {
      return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase() === 'EUR' ? '€' : currency.toUpperCase()}`;
    }
  };

  return (
    <Layout>
      <div className="container max-w-5xl mx-auto px-4 py-10 space-y-12">
        
        {/* Encabezado y saldo */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Facturación y créditos</h1>
            <p className="text-muted-foreground text-lg">Gestiona tu saldo para seguir impulsando tu creatividad con IA.</p>
          </div>
          
          <Card className="bg-card border-primary/20 shadow-[0_0_40px_-15px_rgba(var(--primary),0.4)] overflow-hidden relative">
            <div className="absolute top-0 right-0 p-1">
              <div className="bg-primary/10 rounded-bl-xl p-1">
                <Zap className="h-4 w-4 text-primary animate-pulse" />
              </div>
            </div>
            <CardContent className="p-8 flex items-center gap-6">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                <Zap className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Saldo disponible</p>
                {meLoading ? (
                  <Skeleton className="h-10 w-32" />
                ) : (
                  <div className="text-4xl font-mono font-bold text-white flex items-baseline gap-2">
                    {isAdmin ? "∞" : me?.credits} 
                    <span className="text-base font-sans font-medium text-muted-foreground uppercase tracking-tight">créditos</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {isAdmin && (
          <Alert className="border-primary/30 bg-primary/5 py-6">
            <Zap className="h-5 w-5 text-primary" />
            <AlertTitle className="text-lg font-bold text-primary mb-1">Modo propietario activo</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Tu cuenta tiene créditos ilimitados. Puedes generar todas las aplicaciones que quieras sin coste. Esta sección sigue disponible si quieres comprar paquetes o revisar el historial.
            </AlertDescription>
          </Alert>
        )}

        {cancelNotice && (
          <Alert variant="default" className="bg-amber-500/10 border-amber-500/20 text-amber-200">
            <Info className="h-4 w-4 text-amber-400" />
            <AlertTitle>Pago cancelado</AlertTitle>
            <AlertDescription>{cancelNotice}</AlertDescription>
          </Alert>
        )}

        {checkoutError && (
          <Alert variant="default" className="bg-amber-500/10 border-amber-500/20 text-amber-200">
            <Info className="h-4 w-4 text-amber-400" />
            <AlertTitle>Aviso</AlertTitle>
            <AlertDescription>{checkoutError}</AlertDescription>
          </Alert>
        )}

        {/* Paquetes */}
        <div>
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">Elige tu potencia</h2>
            <p className="text-muted-foreground">Paquetes de créditos adicionales que nunca expiran.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {packagesLoading ? (
              [1, 2, 3].map(i => <Skeleton key={i} className="h-[400px] w-full rounded-2xl" />)
            ) : packages?.map(pkg => (
              <Card key={pkg.id} className={`relative flex flex-col transition-all duration-300 hover:scale-[1.02] ${pkg.popular ? 'border-primary ring-1 ring-primary/50 bg-primary/5 shadow-2xl shadow-primary/20' : 'border-white/10 bg-card/40'}`}>
                {pkg.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-primary text-primary-foreground font-bold px-4 py-1 rounded-full shadow-lg">MÁS POPULAR</Badge>
                  </div>
                )}
                <CardHeader className="text-center pt-10 pb-6">
                  <CardTitle className="text-2xl font-bold mb-1">{pkg.name}</CardTitle>
                  <CardDescription className="text-muted-foreground">{pkg.description}</CardDescription>
                  <div className="mt-6 flex items-baseline justify-center gap-1">
                    <span className="text-5xl font-extrabold text-white tracking-tighter">
                      {formatPrice(pkg.priceCents, pkg.currency)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 px-8 pb-8">
                  <div className="space-y-4 mb-8">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                      <span className="text-sm font-medium">+{pkg.credits} créditos instantáneos</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                      <span className="text-sm font-medium">Válido para apps Fullstack</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                      <span className="text-sm font-medium">Créditos sin caducidad</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                      <span className="text-sm font-medium">Soporte prioritario</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-center text-sm font-mono text-primary bg-primary/10 px-4 py-3 rounded-xl border border-primary/20">
                    <Terminal className="h-4 w-4 mr-2" />
                    ~{Math.floor(pkg.credits / 1)} aplicaciones
                  </div>
                </CardContent>
                <CardFooter className="px-8 pb-10 pt-0">
                  <Button 
                    className={`w-full h-12 text-lg font-bold rounded-xl transition-all ${pkg.popular ? 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/30' : 'bg-white/10 hover:bg-white/20 text-white'}`}
                    onClick={() => handleBuy(pkg.priceId)}
                    disabled={checkoutMutation.isPending}
                  >
                    {checkoutMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Empezar ahora"}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>

        {/* Transacciones */}
        <div className="pt-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold flex items-center">
              <Terminal className="h-6 w-6 mr-3 text-primary" />
              Historial de transacciones
            </h2>
          </div>
          
          <Card className="bg-card/30 border-white/10 overflow-hidden rounded-2xl">
            {txLoading ? (
              <div className="p-8 space-y-4">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
              </div>
            ) : transactions && transactions.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-white/[0.03]">
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="py-4 px-6 font-bold uppercase tracking-wider text-[10px] text-muted-foreground">Fecha</TableHead>
                      <TableHead className="py-4 px-6 font-bold uppercase tracking-wider text-[10px] text-muted-foreground">Descripción</TableHead>
                      <TableHead className="py-4 px-6 font-bold uppercase tracking-wider text-[10px] text-muted-foreground">Tipo</TableHead>
                      <TableHead className="py-4 px-6 text-right font-bold uppercase tracking-wider text-[10px] text-muted-foreground">Monto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map(tx => (
                      <TableRow key={tx.id} className="border-white/5 hover:bg-white/[0.02] transition-colors">
                        <TableCell className="py-4 px-6 text-muted-foreground text-sm">
                          {format(new Date(tx.createdAt), "d MMM yyyy HH:mm", { locale: es })}
                        </TableCell>
                        <TableCell className="py-4 px-6 font-semibold text-foreground">{tx.description}</TableCell>
                        <TableCell className="py-4 px-6">
                          <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-md ${
                            tx.kind === 'purchase' ? 'border-green-500/40 text-green-400 bg-green-500/10' : 
                            'border-primary/40 text-primary bg-primary/10'
                          }`}>
                            {KIND_LABELS[tx.kind] ?? tx.kind}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4 px-6 text-right font-mono font-bold">
                          <div className={`flex items-center justify-end text-base ${tx.amount > 0 ? 'text-green-400' : 'text-primary'}`}>
                            {tx.amount > 0 ? <ArrowUpRight className="h-4 w-4 mr-1" /> : <ArrowDownRight className="h-4 w-4 mr-1" />}
                            {Math.abs(tx.amount)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-20 px-4">
                <div className="h-20 w-20 rounded-full bg-white/[0.03] flex items-center justify-center mx-auto mb-6">
                  <CreditCard className="h-10 w-10 text-muted-foreground/20" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Sin actividad reciente</h3>
                <p className="text-muted-foreground max-w-xs mx-auto">Tus compras y consumos de créditos aparecerán aquí detallados.</p>
              </div>
            )}
          </Card>
        </div>
        
      </div>
    </Layout>
  );
}
