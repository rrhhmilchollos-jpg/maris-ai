import { useEffect } from "react";
import { useLocation } from "wouter";
import { useConfirmCheckout, getGetMeQueryKey, getGetMyStatsQueryKey, getListTransactionsQueryKey } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { motion } from "framer-motion";

export default function BillingSuccessPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  const searchParams = new URLSearchParams(window.location.search);
  const sessionId = searchParams.get("session_id");

  const confirmMutation = useConfirmCheckout({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
      }
    }
  });

  useEffect(() => {
    if (sessionId && !confirmMutation.isPending && !confirmMutation.isSuccess && !confirmMutation.isError) {
      confirmMutation.mutate({ data: { sessionId } });
    }
  }, [sessionId, confirmMutation]);

  return (
    <Layout>
      <div className="container max-w-md mx-auto px-4 py-20 flex justify-center items-center min-h-[60vh]">
        <Card className="w-full bg-card/60 backdrop-blur border-white/10 shadow-2xl relative overflow-hidden">
          
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-accent"></div>

          {confirmMutation.isPending || (!sessionId) ? (
            <CardContent className="pt-12 pb-8 flex flex-col items-center text-center">
              <Loader2 className="h-16 w-16 text-primary animate-spin mb-6" />
              <CardTitle className="text-2xl mb-2">Confirmando pago</CardTitle>
              <CardDescription>Estamos verificando tu transacción y agregando los créditos a tu cuenta.</CardDescription>
            </CardContent>
          ) : confirmMutation.isError ? (
            <CardContent className="pt-12 pb-8 flex flex-col items-center text-center">
              <XCircle className="h-16 w-16 text-destructive mb-6" />
              <CardTitle className="text-2xl mb-2 text-foreground">No pudimos verificar el pago</CardTitle>
              <CardDescription className="mb-6">{confirmMutation.error?.message || "Ocurrió un error al verificar tu pago."}</CardDescription>
              <Button onClick={() => setLocation("/billing")} variant="outline">Volver a facturación</Button>
            </CardContent>
          ) : (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
            >
              <CardHeader className="text-center pt-10">
                <div className="mx-auto bg-green-500/10 h-20 w-20 rounded-full flex items-center justify-center mb-6">
                  <CheckCircle2 className="h-10 w-10 text-green-400" />
                </div>
                <CardTitle className="text-3xl text-white mb-2">¡Pago exitoso!</CardTitle>
                <CardDescription className="text-base">
                  Tus créditos ya están disponibles en tu cuenta.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center pb-2">
                <div className="bg-background/50 rounded-lg p-4 font-mono text-primary border border-primary/20 inline-block mx-auto mb-4">
                  +{confirmMutation.data?.creditsAdded} créditos
                </div>
                <p className="text-sm text-muted-foreground">
                  Nuevo saldo: <strong className="text-foreground">{confirmMutation.data?.newBalance}</strong>
                </p>
              </CardContent>
              <CardFooter className="flex justify-center pb-10 pt-6">
                <Button onClick={() => setLocation("/dashboard")} className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20">
                  Volver al panel
                </Button>
              </CardFooter>
            </motion.div>
          )}
        </Card>
      </div>
    </Layout>
  );
}
