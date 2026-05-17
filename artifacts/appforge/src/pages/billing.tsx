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
import { CreditCard, Zap, Info, Loader2, ArrowUpRight, ArrowDownRight, Terminal, X } from "lucide-react";
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
  const [customAmount, setCustomAmount] = useState<string>("");
  const [showCustomInput, setShowCustomInput] = useState(false);

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
      <div className="container max-w-6xl mx-auto px-4 py-10">
        
        {/* Modal/Dialog de Compra de Créditos */}
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-2xl bg-white border-0 rounded-2xl shadow-2xl">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                  <Zap className="h-6 w-6 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900">Comprar créditos</h2>
              </div>
              <button className="text-gray-400 hover:text-gray-600">
                <X className="h-6 w-6" />
              </button>
            </CardHeader>

            <CardContent className="pt-8 pb-8">
              {/* Paquetes de Créditos */}
              <div className="grid grid-cols-3 gap-4 mb-8">
                {packagesLoading ? (
                  [1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-[200px] w-full rounded-xl" />)
                ) : packages?.map(pkg => (
                  <div 
                    key={pkg.id}
                    className={`relative rounded-xl border-2 p-6 text-center transition-all cursor-pointer ${
                      pkg.popular 
                        ? 'border-green-500 bg-green-50' 
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    {pkg.popular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Badge className="bg-green-600 text-white font-bold px-3 py-1 text-xs">
                          {pkg.description}
                        </Badge>
                      </div>
                    )}
                    
                    <div className={`text-2xl font-bold mb-2 ${pkg.popular ? 'text-gray-900' : 'text-gray-800'}`}>
                      {pkg.credits} créditos
                    </div>
                    
                    <div className={`text-3xl font-bold mb-6 ${pkg.popular ? 'text-green-600' : 'text-green-600'}`}>
                      {formatPrice(pkg.priceCents, pkg.currency)}
                    </div>

                    {pkg.popular && (
                      <div className="text-xs text-gray-500 line-through mb-4">
                        {formatPrice(Math.floor(pkg.priceCents * 1.25), pkg.currency)}
                      </div>
                    )}
                    
                    <Button
                      onClick={() => handleBuy(pkg.priceId)}
                      disabled={checkoutMutation.isPending}
                      className={`w-full font-bold py-2 rounded-lg transition-all ${
                        pkg.popular
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-gray-900 hover:bg-gray-800 text-white'
                      }`}
                    >
                      {checkoutMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                      ) : (
                        "Comprar ahora"
                      )}
                    </Button>
                  </div>
                ))}
              </div>

              {/* Monto Personalizado */}
              <div className="border-t border-gray-200 pt-8">
                <div className="text-sm font-semibold text-gray-700 mb-4">Monto personalizado</div>
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">€</span>
                    <input
                      type="number"
                      placeholder="Ingresa monto personalizado"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      min="1"
                    />
                  </div>
                  <Button
                    disabled={!customAmount || checkoutMutation.isPending}
                    className="bg-gray-400 hover:bg-gray-500 text-white font-bold px-6 rounded-lg disabled:opacity-50"
                  >
                    {checkoutMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      `Comprar 0 créditos`
                    )}
                  </Button>
                </div>
              </div>

              {cancelNotice && (
                <Alert variant="default" className="bg-amber-50 border-amber-200 text-amber-900 mt-6">
                  <Info className="h-4 w-4 text-amber-600" />
                  <AlertTitle>Pago cancelado</AlertTitle>
                  <AlertDescription>{cancelNotice}</AlertDescription>
                </Alert>
              )}

              {checkoutError && (
                <Alert variant="default" className="bg-red-50 border-red-200 text-red-900 mt-6">
                  <Info className="h-4 w-4 text-red-600" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{checkoutError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sección de Transacciones (debajo del modal) */}
        <div className="mt-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center">
            <Terminal className="h-6 w-6 mr-3 text-primary" />
            Historial de transacciones
          </h2>
          
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
