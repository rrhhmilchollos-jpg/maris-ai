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
    // ⚠️ ENCONTRADO A PETICION DEL USUARIO: esta conversion NO EXISTE en la
    // cuenta real de Google Ads (confirmado revisando Herramientas >
    // Conversiones -- solo existen "Compra", "Registro", "Interaccion" y
    // "Visualizaciones sucesivas en YouTube"). Google Ads recibe este
    // evento y lo descarta en silencio porque "AW-18218229959/first_generate"
    // no es una etiqueta real de ninguna conversion configurada.
    // PENDIENTE DE DECISION DEL USUARIO: o se crea "Primera generacion"
    // como conversion nueva en Google Ads y se sustituye este texto por la
    // etiqueta real que te den, o se elimina este bloque si no interesa
    // trackear esto por separado del registro.
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
  // ENCONTRADO A PETICION DEL USUARIO: la conversion "Compra" en la cuenta
  // real de Google Ads esta configurada como IMPORTADA desde GA4 (Fuente:
  // Google Analytics, Evento de GA4: "purchase") -- NO necesita ni usa una
  // etiqueta directa "AW-XXX/YYYY" de Google Ads. El bloque que habia aqui
  // antes (gtag('event','conversion',{send_to:'AW-18218229959/purchase'}))
  // era redundante Y tenia una etiqueta inventada que Google Ads ignoraba
  // en silencio -- eliminado. El evento GA4 "purchase" de arriba (ya
  // corregido para llevar el importe real, antes siempre era 0€) es ahora
  // la unica fuente, tal y como espera la conversion real configurada.
}

/** Vista de página (SPA — wouter no la trackea automáticamente) */
export function trackPageView(path: string, title?: string) {
  gtag("event", "page_view", {
    page_path: path,
    page_title: title || document.title,
  });
}
