/**
 * analytics.ts — Eventos de conversión para Google Analytics 4
 *
 * Eventos configurados como conversiones en GA4 + Google Ads:
 * - sign_up       → usuario nuevo registrado (el más valioso)
 * - generate_app  → usuario lanzó su primera generación
 * - app_succeeded → app generada con éxito
 * - purchase      → usuario compró créditos
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

/** Usuario nuevo registrado — el evento de conversión principal */
export function trackSignUp(userId: string, method = "email") {
  gtag("event", "sign_up", {
    method,
    user_id: userId,
  });
  // También enviar a Google Ads como conversión
  gtag("event", "conversion", {
    send_to: "AW-18218229959/sign_up",
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
