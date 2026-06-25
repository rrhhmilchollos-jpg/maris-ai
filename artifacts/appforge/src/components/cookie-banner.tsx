import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Cookie, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

function updateGoogleConsent(granted: boolean) {
  try {
    if (typeof (window as any).gtag === "function") {
      (window as any).gtag("consent", "update", {
        ad_storage: granted ? "granted" : "denied",
        analytics_storage: granted ? "granted" : "denied",
        ad_user_data: granted ? "granted" : "denied",
        ad_personalization: granted ? "granted" : "denied",
      });
    }
  } catch {
    // Consent Mode debe ser best-effort y no bloquear la UI.
  }
}

export function CookieBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("maris-ai-cookie-consent");
    if (!consent) {
      const timer = setTimeout(() => setIsVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const acceptCookies = () => {
    localStorage.setItem("maris-ai-cookie-consent", "accepted");
    updateGoogleConsent(true);
    setIsVisible(false);
  };

  const declineCookies = () => {
    localStorage.setItem("maris-ai-cookie-consent", "declined");
    updateGoogleConsent(false);
    setIsVisible(false);
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-0 left-0 right-0 z-[100] p-4 md:p-6"
        >
          <div className="mx-auto max-w-4xl">
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f12]/95 p-6 shadow-2xl backdrop-blur-md md:p-8">
              <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
              
              <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                  <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary">
                    <Cookie className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Configuración de Cookies</h3>
                    <p className="mt-1 text-sm leading-relaxed text-white/70">
                      Utilizamos cookies propias y de terceros para mejorar tu experiencia, analizar el tráfico y mostrarte contenido personalizado. Puedes aceptarlas todas o configurar tus preferencias. Consulta nuestra{" "}
                      <Link href="/legal/cookies" className="text-violet-300 hover:text-white underline">
                        Política de Cookies
                      </Link>.
                    </p>
                  </div>
                </div>

                <div className="flex w-full flex-col gap-3 sm:flex-row md:w-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={declineCookies}
                    className="h-10 text-muted-foreground hover:bg-white/5 hover:text-white"
                  >
                    Solo necesarias
                  </Button>
                  <Button
                    size="sm"
                    onClick={acceptCookies}
                    className="h-10 bg-primary px-6 font-semibold text-white hover:bg-primary/90"
                  >
                    Aceptar todas
                  </Button>
                </div>
              </div>

              <button
                onClick={() => setIsVisible(false)}
                className="absolute right-4 top-4 text-muted-foreground transition-colors hover:text-white"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
