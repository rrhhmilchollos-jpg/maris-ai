import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";

interface WatermarkRemovalButtonProps {
  appId: string;
  onRemovalSuccess?: () => void;
}

export function WatermarkRemovalButton({
  appId,
  onRemovalSuccess,
}: WatermarkRemovalButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al volver de Viva Smart Checkout, la URL de retorno (configurada en el
  // panel de Viva) trae "?t=<transactionId>" añadido automáticamente —
  // confirmado contra la documentación oficial de Viva.com. Verificamos el
  // pago real contra la API (nunca fiarse solo de que la redirección haya
  // ocurrido) antes de quitar la marca de agua en la UI.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const transactionId = params.get("t");
    if (!transactionId) return;

    (async () => {
      try {
        const response = await fetch(`/api/watermark/${appId}/verify-removal-viva`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionId }),
        });
        const data = await response.json();
        if (response.ok && data.success) {
          onRemovalSuccess?.();
        }
      } catch {
        // Silencioso — si falla, el usuario sigue viendo el botón y puede reintentar.
      } finally {
        // Limpiar el parámetro de la URL para no re-verificar en cada refresco.
        const url = new URL(window.location.href);
        url.searchParams.delete("t");
        url.searchParams.delete("s");
        window.history.replaceState({}, "", url.toString());
      }
    })();
  }, [appId, onRemovalSuccess]);

  const handleRemoveWatermark = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Crear orden de pago en Viva.com (la pasarela real de Maris AI)
      const response = await fetch(`/api/watermark/${appId}/remove-viva`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Error al crear la orden de pago");
      }

      const data = await response.json();

      // Redirigir a Viva Smart Checkout
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}
      <Button
        onClick={handleRemoveWatermark}
        disabled={isLoading}
        className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white gap-2"
        size="sm"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Procesando...
          </>
        ) : (
          <>
            <X className="h-4 w-4" />
            Eliminar Marca de Agua
          </>
        )}
      </Button>
      <p className="text-xs text-gray-500 text-center">
        Pago único: 9,99€
      </p>
    </div>
  );
}
