import Stripe from "stripe";

export async function getStripe(): Promise<Stripe | null> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.warn("STRIPE_SECRET_KEY not set — Stripe disabled");
    return null;
  }
  return new Stripe(secretKey);
}

// ─── Modelo de créditos de Maris AI ──────────────────────────────────────────
// Equivalente exacto al modelo de Emergent.sh pero en euros.
//
// CRÉDITOS POR TIPO DE ACCIÓN:
//   - Chatear con el agente        → GRATIS (0 créditos)
//   - App simple (landing, tool)   → 1-2 créditos
//   - App media (fullstack, vue)   → 3-5 créditos
//   - App compleja (mobile, 3D)    → 5-10 créditos
//
// CRÉDITOS MENSUALES: se reinician cada ciclo de facturación.
// TOP-UPS: no caducan nunca, se consumen antes que los mensuales.

export const CREDIT_PACKAGES = [
  // ── Plan Free (sin Stripe, se asigna automáticamente al registrarse) ──────
  {
    id: "free",
    priceId: "free",
    name: "Free",
    description: "10 créditos al mes para probar la plataforma. Sin tarjeta.",
    credits: 10,
    priceCents: 0,
    currency: "eur",
    popular: false,
    type: "subscription",
    badge: null,
  },
  // ── Suscripciones de pago ────────────────────────────────────────────────
  {
    id: "standard",
    priceId: process.env.STRIPE_PRICE_STANDARD ?? "standard",
    name: "Standard",
    description: "Apps web y móviles, alojamiento privado e integración con GitHub.",
    credits: 100,
    priceCents: 2000,       // 20€/mes
    annualPriceCents: 1700, // 17€/mes facturado anualmente
    currency: "eur",
    popular: false,
    type: "subscription",
    badge: null,
    features: [
      "100 créditos/mes",
      "Apps web y móviles",
      "Alojamiento privado",
      "Integración con GitHub",
      "Soporte por email",
    ],
  },
  {
    id: "pro",
    priceId: process.env.STRIPE_PRICE_PRO ?? "pro",
    name: "Pro",
    description: "Para builders serios. Contexto 1M, agentes personalizados y soporte prioritario.",
    credits: 750,
    priceCents: 20000,       // 200€/mes
    annualPriceCents: 16700, // 167€/mes facturado anualmente
    currency: "eur",
    popular: true,
    type: "subscription",
    badge: "Más popular",
    features: [
      "750 créditos/mes",
      "Todo lo de Standard",
      "Ventana de contexto 1M",
      "Agentes de IA personalizados",
      "Soporte prioritario",
    ],
  },
  {
    id: "team",
    priceId: process.env.STRIPE_PRICE_TEAM ?? "team",
    name: "Team",
    description: "Créditos compartidos, colaboración en tiempo real para hasta 5 miembros.",
    credits: 1250,
    priceCents: 30000,       // 300€/mes
    annualPriceCents: 25000, // 250€/mes facturado anualmente
    currency: "eur",
    popular: false,
    type: "subscription",
    badge: null,
    features: [
      "1.250 créditos/mes compartidos",
      "Todo lo de Pro",
      "Hasta 5 miembros",
      "Facturación unificada",
      "Panel de administración de equipo",
    ],
  },
  {
    id: "enterprise",
    priceId: "enterprise",
    name: "Enterprise",
    description: "Créditos ilimitados, SSO, seguridad avanzada y soporte dedicado.",
    credits: 999999,
    priceCents: 0,
    currency: "eur",
    popular: false,
    type: "contact",
    badge: null,
    features: [
      "Créditos ilimitados",
      "Todo lo de Team",
      "SSO y captura de dominio",
      "Permisos por roles",
      "Soporte dedicado",
    ],
  },
  // ── Top-up (no caducan nunca) ────────────────────────────────────────────
  {
    id: "topup-50",
    priceId: process.env.STRIPE_PRICE_TOPUP ?? "topup-50",
    name: "Pack 50 créditos",
    description: "Créditos extra que nunca caducan. Perfectos cuando se agota el plan.",
    credits: 50,
    priceCents: 800, // 8€
    currency: "eur",
    popular: false,
    type: "topup",
    badge: "No caducan",
    features: [
      "50 créditos que no caducan",
      "Se acumulan con tu plan",
      "Se consumen antes que los mensuales",
    ],
  },
] as const;

export type CreditPackageDef = (typeof CREDIT_PACKAGES)[number];

export function findPackageByPriceId(priceId: string): CreditPackageDef | undefined {
  return CREDIT_PACKAGES.find((p) => p.priceId === priceId);
}
