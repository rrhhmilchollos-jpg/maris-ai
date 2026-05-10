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

// Planes de Maris AI — estructura equivalente a Emergent.sh pero en euros.
export const CREDIT_PACKAGES = [
  {
    id: "standard",
    priceId: "standard",
    name: "Standard",
    description:
      "Construye apps web y móviles. Alojamiento privado e integración con GitHub.",
    credits: 100,
    priceCents: 1700,
    currency: "eur",
    popular: false,
  },
  {
    id: "pro",
    priceId: "pro",
    name: "Pro",
    description:
      "Ventana de contexto de 1M, crea agentes de IA personalizados y soporte prioritario.",
    credits: 750,
    priceCents: 16700,
    currency: "eur",
    popular: true,
  },
  {
    id: "team",
    priceId: "team",
    name: "Team",
    description:
      "Colaboración en tiempo real para hasta 5 miembros, facturación unificada.",
    credits: 1250,
    priceCents: 25000,
    currency: "eur",
    popular: false,
  },
  {
    id: "enterprise",
    priceId: "enterprise",
    name: "Enterprise",
    description:
      "Créditos ilimitados, SSO, seguridad avanzada y soporte dedicado.",
    credits: 999999,
    priceCents: 0,
    currency: "eur",
    popular: false,
  },
] as const;

export type CreditPackageDef = (typeof CREDIT_PACKAGES)[number];

export function findPackageByPriceId(priceId: string): CreditPackageDef | undefined {
  return CREDIT_PACKAGES.find((p) => p.priceId === priceId);
}
