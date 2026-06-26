/**
 * analytics.ts — Eventos de conversión para Google Analytics 4
 *
 * Eventos configurados como conversiones en GA4 + Google Ads:
 * - sign_up       → usuario nuevo registrado (el más valioso)
 * - generate_app  → usuario lanzó su primera generación
 * - app_succeeded → app generada con éxito
 * - purchase      → usuario compró créditos
 *
 * Conversiones mejoradas (Enhanced Conversions):
 * - En trackSignUp se envía el email del usuario hasheado con SHA-256
 *   mediante gtag('set', 'user_data', ...) para maximizar la tasa de
 *   coincidencia en Google Ads y resolver el diagnóstico "Requiere atención".
 */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

function gtag(...args: any[]) {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag(...args);
  }
}

/**
 * Normaliza y hashea un email con SHA-256 para Conversiones mejoradas.
 * Normalización: minúsculas, sin espacios, sin puntos antes del dominio en gmail/googlemail.
 */
async function hashEmail(email: string): Promise<string> {
  // Normalizar
  let normalized = email.trim().toLowerCase();
  // Eliminar puntos antes del dominio en gmail.com y googlemail.com
  const [localPart, domain] = normalized.split("@");
  if (domain === "gmail.com" || domain === "googlemail.com") {
    normalized = localPart.replace(/\./g, "") + "@" + domain;
  }
  // SHA-256
  const msgBuffer = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Usuario nuevo registrado — el evento de conversión principal */
export async function trackSignUp(userId: string, method = "email", userEmail?: string) {
  // Conversiones mejoradas: enviar datos de usuario hasheados ANTES del evento de conversión
  if (userEmail) {
    try {
      const hashedEmail = await hashEmail(userEmail);
      gtag("set", "user_data", {
        sha256_email_address: hashedEmail,
      });
    } catch {
      // Si falla el hash, continuar sin datos mejorados (no bloquear la conversión)
    }
  }

  gtag("event", "sign_up", {
    method,
    user_id: userId,
  });

  // Conversión de Google Ads — Registro (label: bd7tCPjYwbwcEMfBkO9D)
  gtag("event", "conversion", {
    send_to: "AW-18218229959/bd7tCPjYwbwcEMfBkO9D",
    value: 1.0,
    currency: "EUR",
    user_id: userId,
  });
}

/** Usuario lanzó una generación de app */
export function trackGenerateApp(appKind: string, isFirstApp: boolean) {
  gtag("event", "generate_app", {
    app_kind: appKind,
    is_first_app: isFirstApp,
    event_category: "engagement",
  });

  if (isFirstApp) {
    // Primera generación = conversión valiosa para Ads
    gtag("event", "conversion", {
      send_to: "AW-18218229959/first_generate",
      event_category: "engagement",
    });
  }
}

/** App generada con éxito */
export function trackAppSucceeded(appKind: string, durationMs: number) {
  gtag("event", "app_succeeded", {
    app_kind: appKind,
    duration_seconds: Math.round(durationMs / 1000),
    event_category: "engagement",
    event_label: appKind,
  });
}

/** Usuario compró créditos */
export function trackPurchase(amountEur: number, credits: number, plan: string) {
  gtag("event", "purchase", {
    currency: "EUR",
    value: amountEur,
    items: [{
      item_id: plan,
      item_name: `Plan ${plan} — ${credits} créditos`,
      price: amountEur,
      quantity: 1,
    }],
  });
  // Google Ads purchase conversion
  gtag("event", "conversion", {
    send_to: "AW-18218229959/purchase",
    value: amountEur,
    currency: "EUR",
  });
}

/** Vista de página (SPA — wouter no la trackea automáticamente) */
export function trackPageView(path: string, title?: string) {
  gtag("event", "page_view", {
    page_path: path,
    page_title: title || document.title,
  });
}
