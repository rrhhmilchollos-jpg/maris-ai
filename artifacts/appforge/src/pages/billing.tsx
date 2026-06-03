import { useEffect, useState } from "react";
import { useGetMe, useListCreditPackages, useCreateCheckoutSession, useListTransactions } from "@/lib/api-client";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, Loader2, ArrowUpRight, ArrowDownRight, AlertCircle, X } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useLocation } from "wouter";

const KIND_LABELS: Record<string, string> = {
  purchase: "compra",
  usage: "uso",
  bonus: "bono",
};

export default function BillingPage() {
  const [, setLocation] = useLocation();
  const { data: me, isLoading: meLoading } = useGetMe();
  const { data: packages, isLoading: packagesLoading } = useListCreditPackages();
  const { data: transactions, isLoading: txLoading } = useListTransactions();
  
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [loadingPackageId, setLoadingPackageId] = useState<string | null>(null);

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
        if (raw.includes("503") || raw.toLowerCase().includes("stripe")) {
          setCheckoutError(
            "Los pagos aún se están configurando. Vuelve a intentarlo en unos minutos.",
          );
        } else {
          setCheckoutError(
            "No hemos podido iniciar el pago. Revisa tu conexión y prueba de nuevo en unos minutos.",
          );
        }
        setLoadingPackageId(null);
      },
    },
  });

  const handleBuyPackage = (priceId: string, packageId: string) => {
    setCheckoutError(null);
    setCancelNotice(null);
    setLoadingPackageId(packageId);
    checkoutMutation.mutate({ priceId });
  };

  const handleCustomBuy = async () => {
    const amount = parseFloat(customAmount);
    if (!customAmount || amount < 20) {
      setCheckoutError("El monto mínimo es 20€.");
      return;
    }

    setCheckoutError(null);
    setCancelNotice(null);
    setLoadingPackageId("custom");

    try {
      const data = await apiFetch<any>("/api/billing/custom-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountEur: amount }),
      });
      if (data.url) window.location.href = data.url;
    } catch (err: any) {
      setCheckoutError("Error de conexión. Intenta de nuevo.");
      setLoadingPackageId(null);
    }
  };

  const formatPrice = (amountCents: number) => {
    return `€${(amountCents / 100).toFixed(2)}`;
  };

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
        <div className="max-w-6xl mx-auto">
          
          {/* Modal Dialog */}
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <Card className="w-full max-w-4xl bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-700">
              
              {/* Header */}
              <div className="flex items-center justify-between p-8 border-b border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-lg">
                    <Plus className="h-7 w-7 text-white font-bold" strokeWidth={3} />
                  </div>
                  <h1 className="text-3xl font-bold text-slate-100">Comprar créditos</h1>
                </div>
                {/* ✅ Botón X con función de cerrar */}
                <button
                  onClick={() => setLocation("/dashboard")}
                  className="text-slate-400 hover:text-slate-300 transition-colors p-2 rounded-lg hover:bg-slate-800"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              {/* Content */}
              <div className="p-8">
                
                {/* Grid de Paquetes */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                  {packagesLoading ? (
                    [1, 2, 3, 4, 5, 6].map(i => (
                      <div key={i} className="h-56 bg-slate-800 rounded-xl animate-pulse" />
                    ))
                  ) : packages?.map(pkg => {
                    const isPopular = pkg.popular;
                    const price = formatPrice(pkg.priceCents);
                    const originalPrice = isPopular ? formatPrice(Math.floor(pkg.priceCents / 0.8)) : null;

                    return (
                      <div
                        key={pkg.id}
                        className={`relative rounded-2xl border-2 p-8 text-center transition-all duration-300 ${
                          isPopular
                            ? "border-green-400 bg-gradient-to-b from-slate-800 to-slate-800 shadow-lg shadow-green-500/30 scale-105"
                            : "border-slate-700 bg-slate-800 hover:border-slate-600 hover:shadow-md hover:shadow-slate-700/50"
                        }`}
                      >
                        {/* Badge "20% More" */}
                        {isPopular && (
                          <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                            <Badge className="bg-green-600 text-white font-bold px-4 py-1.5 text-xs uppercase tracking-wider rounded-full shadow-lg">
                              {pkg.description}
                            </Badge>
                          </div>
                        )}

                        {/* Créditos */}
                        <div className={`text-2xl font-bold mb-3 ${isPopular ? "text-slate-100" : "text-slate-200"}`}>
                          {pkg.credits.toLocaleString()} créditos
                        </div>

                        {/* Precio Original Tachado */}
                        {originalPrice && (
                          <div className="text-sm text-slate-500 line-through mb-2">
                            {originalPrice}
                          </div>
                        )}

                        {/* Precio */}
                        <div className="text-4xl font-bold mb-8 text-green-600">
                          {price}
                        </div>

                        {/* Botón */}
                        <Button
                          onClick={() => handleBuyPackage(pkg.priceId, pkg.id)}
                          disabled={loadingPackageId === pkg.id || checkoutMutation.isPending}
                          className={`w-full font-bold py-3 px-4 rounded-xl transition-all text-base uppercase tracking-wider ${
                            isPopular
                              ? "bg-green-600 hover:bg-green-700 text-white shadow-lg hover:shadow-xl"
                              : "bg-slate-700 hover:bg-slate-600 text-white"
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {loadingPackageId === pkg.id ? (
                            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                          ) : (
                            "Comprar ahora"
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>

                {/* Divider */}
                <div className="border-t border-slate-700 my-10 pt-10">
                  
                  {/* Monto Personalizado */}
                  <div>
                    <label className="text-sm font-bold text-slate-300 block mb-4 uppercase tracking-wider">
                      Monto personalizado
                    </label>
                    <div className="flex gap-3">
                      {/* ✅ Input con texto negro visible y mínimo 20€ */}
                      <div className="flex-1 relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg z-10">€</span>
                        <input
                          type="number"
                          placeholder="Mínimo 20€"
                          value={customAmount}
                          onChange={(e) => {
                            setCustomAmount(e.target.value);
                            setCheckoutError(null);
                          }}
                          className="w-full pl-10 pr-4 py-3 border-2 border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all text-base font-semibold text-slate-100 bg-slate-800 placeholder-slate-500"
                          min="20"
                          step="1"
                        />
                      </div>
                      {/* ✅ Botón solo dice "Comprar ahora" */}
                      <Button
                        onClick={handleCustomBuy}
                        disabled={!customAmount || parseFloat(customAmount) < 20 || loadingPackageId === "custom"}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold px-8 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all uppercase tracking-wider"
                      >
                        {loadingPackageId === "custom" ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          "Comprar ahora"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Alertas */}
                {cancelNotice && (
                  <Alert className="bg-amber-950 border-2 border-amber-700 text-amber-200 mt-6 rounded-xl">
                    <AlertCircle className="h-5 w-5 text-amber-400" />
                    <AlertTitle className="font-bold">Pago cancelado</AlertTitle>
                    <AlertDescription className="text-sm">{cancelNotice}</AlertDescription>
                  </Alert>
                )}

                {checkoutError && (
                  <Alert className="bg-red-950 border-2 border-red-700 text-red-200 mt-6 rounded-xl">
                    <AlertCircle className="h-5 w-5 text-red-400" />
                    <AlertTitle className="font-bold">Error</AlertTitle>
                    <AlertDescription className="text-sm">{checkoutError}</AlertDescription>
                  </Alert>
                )}
              </div>
            </Card>
          </div>

          {/* Historial de Transacciones */}
          <div className="mt-12 relative z-0">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center mr-3 shadow-lg">
                <ArrowDownRight className="h-5 w-5 text-white" />
              </div>
              Historial de transacciones
            </h2>

            <Card className="bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden backdrop-blur-sm">
              {txLoading ? (
                <div className="p-8 space-y-4">
                  {[1, 2, 3, 4].map(i => <div key={i} className="h-12 bg-slate-700 rounded-lg animate-pulse" />)}
                </div>
              ) : transactions && transactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-700 bg-slate-900/50">
                        <th className="py-4 px-6 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Fecha</th>
                        <th className="py-4 px-6 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Descripción</th>
                        <th className="py-4 px-6 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Tipo</th>
                        <th className="py-4 px-6 text-right text-xs font-bold uppercase tracking-wider text-slate-400">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx, idx) => (
                        <tr key={tx.id} className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${idx % 2 === 0 ? "bg-slate-800/20" : ""}`}>
                          <td className="py-4 px-6 text-sm text-slate-300">
                            {format(new Date(tx.createdAt), "d MMM yyyy HH:mm", { locale: es })}
                          </td>
                          <td className="py-4 px-6 font-semibold text-slate-100">{tx.description}</td>
                          <td className="py-4 px-6">
                            <Badge variant="outline" className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-lg ${
                              tx.kind === 'purchase' ? 'border-green-500/40 text-green-400 bg-green-500/10' : 
                              'border-blue-500/40 text-blue-400 bg-blue-500/10'
                            }`}>
                              {KIND_LABELS[tx.kind] ?? tx.kind}
                            </Badge>
                          </td>
                          <td className="py-4 px-6 text-right font-mono font-bold">
                            <div className={`flex items-center justify-end text-base ${tx.amount > 0 ? 'text-green-400' : 'text-blue-400'}`}>
                              {tx.amount > 0 ? <ArrowUpRight className="h-4 w-4 mr-1" /> : <ArrowDownRight className="h-4 w-4 mr-1" />}
                              {Math.abs(tx.amount).toLocaleString()}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-20 px-4">
                  <div className="h-20 w-20 rounded-full bg-slate-700/50 flex items-center justify-center mx-auto mb-6">
                    <ArrowDownRight className="h-10 w-10 text-slate-500/50" />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-200 mb-2">Sin actividad reciente</h3>
                  <p className="text-slate-400 max-w-xs mx-auto">Tus compras y consumos de créditos aparecerán aquí detallados.</p>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
