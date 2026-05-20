import Stripe from "stripe";

async function fetchStripeSecretKey(): Promise<string | null> {
  if (process.env.STRIPE_SECRET_KEY) {
    return process.env.STRIPE_SECRET_KEY;
  }
  const apiKey = process.env.MARIS_AI_STRIPE_KEY || process.env.STRIPE_API_KEY;
  if (apiKey) {
    return apiKey;
  }
  return null;
}

export async function getStripe(): Promise<Stripe | null> {
  const secretKey = await fetchStripeSecretKey();
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

export const KIND_COSTS = {
  fullstack:    3, // Proyecto complejo full-stack
  landing:      1, // App simple / Landing
  vue:          2, // App mediana
  svelte:       2, // App mediana
  mobile:       2, // App mediana
  nextjs:       3, // Proyecto complejo
  "python-api": 3, // Proyecto complejo
  django:       3, // Proyecto complejo
  "hybrid-pwa": 3, // Proyecto complejo
  "game-2d":    3, // Proyecto complejo
  "game-3d":    5, // Proyecto muy complejo
} as const;

export const FREE_PLAN_CREDITS = 10;
export const MONTHLY_SUBSCRIPTION_CREDITS = 100;

export const SUBSCRIPTION_PLANS = [
  {
    id: "free",
    name: "Gratis",
    price: 0,
    creditsPerMonth: FREE_PLAN_CREDITS,
    features: ["10 créditos iniciales", "Subdominio Maris AI", "Soporte comunitario"],
  },
  {
    id: "pro",
    name: "Suscripción Pro",
    price: 25,
    creditsPerMonth: MONTHLY_SUBSCRIPTION_CREDITS,
    stripePriceId: process.env.STRIPE_PRICE_PRO,
    features: ["100 créditos/mes", "Dominio Personalizado", "Sin Marca de Agua", "Soporte Prioritario"],
  },
];

export const CREDIT_PACKAGES = [
  {
    id: "pack-100",
    name: "160 créditos",
    credits: 160,
    priceCents: 2000,   // 20€
    currency: "eur",
    priceId: process.env.STRIPE_PRICE_PACK_100,
    popular: false,
  },
  {
    id: "pack-250",
    name: "250 créditos",
    credits: 250,
    priceCents: 5000,   // 50€
    currency: "eur",
    priceId: process.env.STRIPE_PRICE_PACK_250,
    popular: false,
  },
  {
    id: "pack-500",
    name: "500 créditos",
    credits: 500,
    priceCents: 10000,  // 100€
    currency: "eur",
    priceId: process.env.STRIPE_PRICE_PACK_500,
    popular: false,
  },
  {
    id: "pack-1250",
    name: "1250 créditos",
    credits: 1250,
    priceCents: 25000,  // 250€
    currency: "eur",
    priceId: process.env.STRIPE_PRICE_PACK_1250,
    popular: false,
  },
  {
    id: "pack-3000",
    name: "3000 créditos",
    credits: 3000,
    priceCents: 50000,  // 500€
    currency: "eur",
    priceId: process.env.STRIPE_PRICE_PACK_3000,
    description: "20% More",
    popular: true,
  },
  {
    id: "pack-6000",
    name: "6000 créditos",
    credits: 6000,
    priceCents: 100000, // 1000€
    currency: "eur",
    priceId: process.env.STRIPE_PRICE_PACK_6000,
    description: "20% More",
    popular: true,
  },
];

export function findPackageByPriceId(priceId: string) {
  return CREDIT_PACKAGES.find((p) => p.priceId === priceId);
}

export function getPlanByStripePriceId(priceId: string) {
  return SUBSCRIPTION_PLANS.find((p) => p.stripePriceId === priceId);
}

export async function getStripeCustomerIdForUser(userId: string): Promise<string | null> {
  return null;
}

export async function createStripeCheckoutSession(
  userId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string | null> {
  const stripe = await getStripe();
  if (!stripe) return null;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: undefined,
    });
    return session.url;
  } catch (error) {
    console.error("Error creating Stripe checkout session:", error);
    return null;
  }
}
