import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient = new Stripe(key);
  return stripeClient;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// priceId here is our internal package id used as a stable identifier.
// When real Stripe price IDs are needed, these can be mapped to them.
export const CREDIT_PACKAGES = [
  {
    id: "starter",
    priceId: "starter",
    name: "Starter",
    description: "Great for trying out AppForge on a few weekend projects.",
    credits: 10,
    priceCents: 2000,
    currency: "usd",
    popular: false,
  },
  {
    id: "pro",
    priceId: "pro",
    name: "Pro",
    description: "Our most popular pack — enough fuel for a real product sprint.",
    credits: 50,
    priceCents: 8000,
    currency: "usd",
    popular: true,
  },
  {
    id: "studio",
    priceId: "studio",
    name: "Studio",
    description: "For teams shipping multiple apps every week.",
    credits: 150,
    priceCents: 20000,
    currency: "usd",
    popular: false,
  },
] as const;

export type CreditPackageDef = (typeof CREDIT_PACKAGES)[number];

export function findPackageByPriceId(priceId: string): CreditPackageDef | undefined {
  return CREDIT_PACKAGES.find((p) => p.priceId === priceId);
}
