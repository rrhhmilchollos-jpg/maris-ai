/**
 * ReviewInviteModal — Invitación a dejar reseña tras generar/desplegar una app.
 *
 * Flujo: el usuario puntúa 1-5 estrellas + texto opcional -> POST /api/reviews.
 * La reseña SIEMPRE queda "pending" (o "flagged" si el filtro de palabras
 * prohibidas del backend detecta algo) hasta que un admin la aprueba desde
 * el panel de moderación. Nunca se publica en directo desde aquí.
 */
import React, { useState } from "react";
import { X, Star, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-client";

interface ReviewInviteModalProps {
  open: boolean;
  onClose: () => void;
  relatedAppId?: string;
  source?: string; // "post_generation" | "dashboard" | "email_invite"
}

interface CreateReviewResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

export function ReviewInviteModal({ open, onClose, relatedAppId, source = "dashboard" }: ReviewInviteModalProps) {
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (rating < 1) {
      toast({ title: "Selecciona una puntuación", variant: "destructive" });
      return;
    }
    if (body.trim().length < 10) {
      toast({ title: "Cuéntanos un poco más (mínimo 10 caracteres)", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<CreateReviewResponse>("/api/reviews", {
        method: "POST",
        body: JSON.stringify({ rating, body, source, relatedAppId }),
      });
      if (res.success) {
        setSubmitted(true);
      } else {
        toast({ title: res.error || "No se pudo enviar la reseña", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: err?.message || "Error al enviar la reseña", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-violet-500/20 bg-neutral-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            {submitted ? "¡Gracias!" : "¿Qué te ha parecido Maris AI?"}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>

        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400" />
            <p className="text-neutral-300">
              Tu reseña se está revisando y se publicará muy pronto. ¡Gracias por ayudarnos a crecer!
            </p>
            <button
              onClick={onClose}
              className="mt-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-neutral-400 mb-4">
              Tu opinión ayuda a otros emprendedores a decidir si Maris AI es para ellos.
            </p>

            <div className="flex items-center justify-center gap-1 mb-4">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                  aria-label={`${star} estrellas`}
                  className="p-1"
                >
                  <Star
                    className={`w-8 h-8 transition-colors ${
                      star <= (hoverRating || rating) ? "fill-amber-400 text-amber-400" : "text-neutral-600"
                    }`}
                  />
                </button>
              ))}
            </div>

            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Cuéntanos tu experiencia con Maris AI..."
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-white placeholder:text-neutral-500 focus:border-violet-500 focus:outline-none resize-none"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-neutral-400 hover:text-white transition-colors"
              >
                Ahora no
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors disabled:opacity-60"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Enviar reseña
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
