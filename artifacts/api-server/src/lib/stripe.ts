import Stripe from "stripe";

// Stripe credentials via standard environment variables (Render/production).
export async function getStripe(): Promise<Stripe | null> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.warn("STRIPE_SECRET_KEY not set — Stripe disabled");
    return null;
  }
  return new Stripe(secretKey);
}

// ─── Planes de suscripción mensual ───────────────────────────────────────────
// Equivalente al modelo de Emergent.sh pero en euros.
//
// Plan Free  →  0€/mes    — 10 créditos (gratis, sin Stripe)
// Standard   →  20€/mes   — 100 créditos/mes
// Pro        →  200€/mes  — 750 créditos/mes + contexto 1M + agentes IA
// Team       →  250€/mes  — 1.250 créditos compartidos, hasta 5 miembros
// Enterprise →  contacto  — ilimitado, SSO, seguridad avanzada
//
// Paquetes extra (no caducan):
// Pack 50 cr →  8€        — créditos extra que no se reinician

export const CREDIT_PACKAGES = [
  // ── Suscripciones mensuales ──────────────────────────────────────────────
  {
    id: "standard",
    priceId: "standard",
    name: "Standard",
    description:
      "100 créditos/mes. Apps web y móviles, alojamiento privado e integración con GitHub.",
    credits: 100,
    priceCents: 2000,
    currency: "eur",
    popular: false,
    type: "subscription",
  },
  {
    id: "pro",
    priceId: "pro",
    name: "Pro",
    description:
      "750 créditos/mes. Ventana de contexto de 1M, agentes de IA personalizados y soporte prioritario.",
    credits: 750,
    priceCents: 20000,
    currency: "eur",
    popular: true,
    type: "subscription",
  },
  {
    id: "team",
    priceId: "team",
    name: "Team",
    description:
      "1.250 créditos/mes compartidos. Colaboración en tiempo real para hasta 5 miembros y facturación unificada.",
    credits: 1250,
    priceCents: 25000,
    currency: "eur",
    popular: false,
    type: "subscription",
  },
  {
    id: "enterprise",
    priceId: "enterprise",
    name: "Enterprise",
    description:
      "Créditos ilimitados, SSO, seguridad avanzada y soporte dedicado. Precio personalizado.",
    credits: 999999,
    priceCents: 0,
    currency: "eur",
    popular: false,
    type: "contact",
  },
  // ── Paquetes extra (no caducan, se acumulan) ─────────────────────────────
  {
    id: "pack-50",
    priceId: "pack-50",
    name: "Pack 50 créditos",
    description:
      "50 créditos extra que no caducan. Perfectos si se te acaban antes de que se renueve tu plan.",
    credits: 50,
    priceCents: 800,
    currency: "eur",
    popular: false,
    type: "topup",
  },
] as const;

export type CreditPackageDef = (typeof CREDIT_PACKAGES)[number];

export function findPackageByPriceId(priceId: string): CreditPackageDef | undefined {
  return CREDIT_PACKAGES.find((p) => p.priceId === priceId);
}
