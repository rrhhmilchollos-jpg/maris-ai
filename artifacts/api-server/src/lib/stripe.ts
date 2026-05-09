import Stripe from "stripe";

// Stripe credentials via standard environment variables (Render/production).
// Previously used Replit connector — migrated to standard env vars.
export async function getStripe(): Promise<Stripe | null> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.warn("STRIPE_SECRET_KEY not set — Stripe disabled");
    return null;
  }
  return new Stripe(secretKey);
}

// priceId here is our internal package id used as a stable identifier.
// When real Stripe price IDs are needed, these can be mapped to them.
export const CREDIT_PACKAGES = [
  {
    id: "starter",
    priceId: "starter",
    name: "Starter",
    description:
      "Perfecto para probar Maris AI en un par de proyectos de fin de semana.",
    credits: 10,
    priceCents: 2000,
    currency: "eur",
    popular: false,
  },
  {
    id: "pro",
    priceId: "pro",
    name: "Pro",
    description:
      "Nuestro pack más popular: gasolina suficiente para un sprint de producto real.",
    credits: 50,
    priceCents: 8000,
    currency: "eur",
    popular: true,
  },
  {
    id: "studio",
    priceId: "studio",
    name: "Studio",
    description: "Para equipos que publican varias apps cada semana.",
    credits: 150,
    priceCents: 20000,
    currency: "eur",
    popular: false,
  },
  {
    id: "annual",
    priceId: "annual",
    name: "Annual",
    description:
      "12 meses de combustible al mejor precio. Ideal para creadores que envían apps cada semana.",
    credits: 600,
    priceCents: 39900,
    currency: "usd",
    popular: false,
  },
] as const;

export type CreditPackageDef = (typeof CREDIT_PACKAGES)[number];

export function findPackageByPriceId(priceId: string): CreditPackageDef | undefined {
  return CREDIT_PACKAGES.find((p) => p.priceId === priceId);
}
