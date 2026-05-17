import { useState } from "react";
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

  const handleRemoveWatermark = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Crear sesión de Stripe
      const response = await fetch(`/api/watermark/${appId}/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Error al crear la sesión de pago");
      }

      const data = await response.json();

      // Redirigir a Stripe Checkout
      if (data.sessionUrl) {
        window.location.href = data.sessionUrl;
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
        Pago único: $9.99
      </p>
    </div>
  );
}
