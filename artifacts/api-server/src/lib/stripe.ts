import Stripe from "stripe";

// Stripe credentials come from the Replit Stripe connector (no manual API key
// in the environment). The connector proxy issues short-lived secrets that we
// fetch fresh on every call — never cache the key or the Stripe client.
async function fetchStripeSecretKey(): Promise<string | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) return null;

  // Use the production Stripe connection on the deployed app, dev otherwise.
  const targetEnvironment =
    process.env.REPLIT_DEPLOYMENT === "1" ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }

  if (!resp.ok) return null;

  const data = (await resp.json()) as {
    items?: Array<{ settings?: { secret?: string; publishable?: string } }>;
  };
  const secret = data.items?.[0]?.settings?.secret;
  return secret ?? null;
}

export async function getStripe(): Promise<Stripe | null> {
  const secretKey = await fetchStripeSecretKey();
  if (!secretKey) return null;
  // Always build a fresh client so rotated keys are picked up.
  // Use the SDK's default API version pinned by the installed stripe package.
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
      "Perfecto para probar AppForge en un par de proyectos de fin de semana.",
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
  // Annual mega-pack — best per-credit price (≈58% savings vs Pro per credit).
  // Pro:    50 credits / $80   = $1.60 per credit
  // Annual: 600 credits / $399 = $0.665 per credit  ⇒ 58.4% off Pro
  // Used as the headline "Plan Anual" upgrade modal on the dashboard.
  // Per task scope ("No se toca el plan anual"), this stays in USD as before.
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
