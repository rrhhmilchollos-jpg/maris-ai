import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 bg-card/60 border-white/10">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">404 — Página no encontrada</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            Lo sentimos, no pudimos encontrar la página que buscas.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
