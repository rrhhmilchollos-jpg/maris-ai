import { useState } from "react";
import { 
  useGetMe, 
  useListCreditPackages, 
  useCreateCheckoutSession, 
  useListTransactions 
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CreditCard, Zap, Info, Loader2, ArrowUpRight, ArrowDownRight, Terminal } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const KIND_LABELS: Record<string, string> = {
  purchase: "compra",
  usage: "uso",
  bonus: "bono",
};

export default function BillingPage() {
  const { data: me, isLoading: meLoading } = useGetMe();
  const { data: packages, isLoading: packagesLoading } = useListCreditPackages();
  const { data: transactions, isLoading: txLoading } = useListTransactions();
  
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  
  const checkoutMutation = useCreateCheckoutSession({
    mutation: {
      onSuccess: (data) => {
        window.location.href = data.url;
      },
      onError: (err: any) => {
        if (err.message?.includes("503") || err.message?.toLowerCase().includes("stripe")) {
          setCheckoutError("Los pagos aún se están configurando. Vuelve a intentarlo más tarde.");
        } else {
          setCheckoutError(err.message || "No pudimos iniciar el pago.");
        }
      }
    }
  });

  const handleBuy = (priceId: string) => {
    setCheckoutError(null);
    checkoutMutation.mutate({ data: { priceId } });
  };

  return (
    <Layout>
      <div className="container max-w-5xl mx-auto px-4 py-10 space-y-12">
        
        {/* Encabezado y saldo */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Facturación y créditos</h1>
            <p className="text-muted-foreground">Gestiona tu saldo para seguir generando aplicaciones.</p>
          </div>
          
          <Card className="bg-card border-primary/20 shadow-[0_0_30px_-10px_rgba(var(--primary),0.3)]">
            <CardContent className="p-6 flex items-center gap-6">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Saldo disponible</p>
                {meLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-3xl font-mono font-bold text-white">
                    {me?.credits} <span className="text-lg font-sans font-normal text-muted-foreground">créditos</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {checkoutError && (
          <Alert variant="default" className="bg-amber-500/10 border-amber-500/20 text-amber-200">
            <Info className="h-4 w-4 text-amber-400" />
            <AlertTitle>Aviso</AlertTitle>
            <AlertDescription>{checkoutError}</AlertDescription>
          </Alert>
        )}

        {/* Paquetes */}
        <div>
          <h2 className="text-xl font-semibold mb-6 flex items-center">
            <CreditCard className="h-5 w-5 mr-2 text-muted-foreground" />
            Comprar créditos
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {packagesLoading ? (
              [1, 2, 3].map(i => <Skeleton key={i} className="h-[280px] w-full" />)
            ) : packages?.map(pkg => (
              <Card key={pkg.id} className={`relative flex flex-col ${pkg.popular ? 'border-primary shadow-lg shadow-primary/10' : 'border-white/5 bg-card/40'}`}>
                {pkg.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground font-semibold px-3 py-0.5">Más popular</Badge>
                  </div>
                )}
                <CardHeader className="text-center pt-8">
                  <CardTitle className="text-xl">{pkg.name}</CardTitle>
                  <CardDescription>{pkg.description}</CardDescription>
                  <div className="mt-4 text-4xl font-bold text-white">
                    ${(pkg.priceCents / 100).toFixed(2)}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex justify-center items-center pb-8">
                  <div className="flex items-center text-lg font-mono text-primary bg-primary/10 px-4 py-2 rounded-lg">
                    <Terminal className="h-4 w-4 mr-2" />
                    +{pkg.credits} apps
                  </div>
                </CardContent>
                <CardFooter>
                  <Button 
                    className={`w-full ${pkg.popular ? 'bg-primary hover:bg-primary/90 text-white' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
                    onClick={() => handleBuy(pkg.priceId)}
                    disabled={checkoutMutation.isPending}
                  >
                    {checkoutMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Comprar"}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>

        {/* Transacciones */}
        <div>
          <h2 className="text-xl font-semibold mb-6 flex items-center">
            <Terminal className="h-5 w-5 mr-2 text-muted-foreground" />
            Historial de transacciones
          </h2>
          
          <Card className="bg-card/30 border-white/5 overflow-hidden">
            {txLoading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : transactions && transactions.length > 0 ? (
              <Table>
                <TableHeader className="bg-black/20">
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead>Fecha</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map(tx => (
                    <TableRow key={tx.id} className="border-white/5 hover:bg-white/[0.02]">
                      <TableCell className="text-muted-foreground">
                        {format(new Date(tx.createdAt), "d MMM yyyy HH:mm", { locale: es })}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">{tx.description}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-wider ${
                          tx.kind === 'purchase' ? 'border-green-500/30 text-green-400 bg-green-500/10' : 
                          'border-primary/30 text-primary bg-primary/10'
                        }`}>
                          {KIND_LABELS[tx.kind] ?? tx.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <div className={`flex items-center justify-end ${tx.amount > 0 ? 'text-green-400' : 'text-primary'}`}>
                          {tx.amount > 0 ? <ArrowUpRight className="h-3 w-3 mr-1" /> : <ArrowDownRight className="h-3 w-3 mr-1" />}
                          {Math.abs(tx.amount)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12 px-4">
                <CreditCard className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Aún no hay transacciones.</p>
              </div>
            )}
          </Card>
        </div>
        
      </div>
    </Layout>
  );
}
