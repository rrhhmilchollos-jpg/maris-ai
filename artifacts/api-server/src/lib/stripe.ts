import Stripe from "stripe";

async function fetchStripeSecretKey(): Promise<string | null> {
  // Usar STRIPE_SECRET_KEY directamente (recomendado para producción)
  if (process.env.STRIPE_SECRET_KEY) {
    return process.env.STRIPE_SECRET_KEY;
  }

  // Fallback: intentar obtener de variables de entorno alternativas
  const apiKey = process.env.MARIS_AI_STRIPE_KEY || process.env.STRIPE_API_KEY;
  if (apiKey) {
    return apiKey;
  }

  // Si no hay clave disponible, retornar null
  return null;
}

export async function getStripe(): Promise<Stripe | null> {
  const secretKey = await fetchStripeSecretKey();
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

export const KIND_COSTS = {
  "fullstack": 1,
  "landing": 1,
  "game-2d": 3,
  "game-3d": 5,
  "pwa": 3,
  "vue-3": 1,
  "sveltekit": 1,
  "nextjs": 2,
  "fastapi": 2,
  "django": 2,
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
    name: "Pro",
    price: 29,
    creditsPerMonth: MONTHLY_SUBSCRIPTION_CREDITS,
    stripePriceId: process.env.STRIPE_PRICE_PRO,
    features: ["100 créditos/mes", "Dominio Personalizado", "Sin Marca de Agua", "Soporte Prioritario"],
  },
];

export const CREDIT_PACKAGES = [
  {
    id: "pack-small",
    name: "Pequeño",
    credits: 50,
    priceCents: 1000,
    currency: "usd",
    priceId: process.env.STRIPE_PRICE_PACK_SMALL,
    description: "50 créditos extra",
  },
  {
    id: "pack-large",
    name: "Grande",
    credits: 200,
    priceCents: 3500,
    currency: "usd",
    priceId: process.env.STRIPE_PRICE_PACK_LARGE,
    description: "200 créditos extra",
  },
];

export function findPackageByPriceId(priceId: string) {
  return CREDIT_PACKAGES.find((p) => p.priceId === priceId);
}

export function getPlanByStripePriceId(priceId: string) {
  return SUBSCRIPTION_PLANS.find((p) => p.stripePriceId === priceId);
}

export async function getStripeCustomerIdForUser(userId: string): Promise<string | null> {
  // Implementar lógica para obtener el ID de cliente de Stripe desde la base de datos
  // Por ahora, retornar null
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
      customer_email: undefined, // Será establecido por el cliente
    });

    return session.url;
  } catch (error) {
    console.error("Error creating Stripe checkout session:", error);
    return null;
  }
}
