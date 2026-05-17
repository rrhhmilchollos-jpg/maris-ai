import Stripe from "stripe";

async function fetchStripeSecretKey(): Promise<string | null> {
  // Usar STRIPE_SECRET_KEY directamente si está disponible (Render)
  if (process.env.STRIPE_SECRET_KEY) {
    return process.env.STRIPE_SECRET_KEY;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) return null;

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
  return new Stripe(secretKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANES DE SUSCRIPCIÓN MENSUAL (modelo Emergent clonado en euros)
// Los créditos del plan caducan al final del ciclo mensual.
// Los créditos comprados (top-ups) NO caducan nunca.
// ─────────────────────────────────────────────────────────────────────────────

export type PlanId = "free" | "standard" | "pro" | "team";

export interface PlanDef {
  id: PlanId;
  name: string;
  description: string;
  priceMonthCents: number;    // precio mensual en céntimos de euro
  currency: "eur";
  creditsPerMonth: number;    // créditos que se dan cada mes (caducan)
  popular: boolean;
  features: string[];
  // Price ID de Stripe (se configura en el dashboard de Stripe)
  // Si es null, el plan es gratuito y no necesita suscripción
  stripePriceId: string | null;
}

export const SUBSCRIPTION_PLANS: PlanDef[] = [
  {
    id: "free",
    name: "Gratis",
    description: "Para explorar Maris AI y hacer tus primeros prototipos.",
    priceMonthCents: 0,
    currency: "eur",
    creditsPerMonth: 100,
179	    popular: false,
180	    stripePriceId: null,
181	    features: [
182	      "100 créditos mensuales",
      "Apps públicas",
      "Acceso al generador básico",
    ],
  },
  {
    id: "standard",
    name: "Standard",
    description: "Para proyectos reales y sprints de producto.",
    priceMonthCents: 1900,   // 19 €/mes
    currency: "eur",
    creditsPerMonth: 100,
    popular: false,
    stripePriceId: process.env.STRIPE_PRICE_STANDARD ?? null,
    features: [
      "100 créditos mensuales",
      "Proyectos privados",
      "Integración con GitHub",
      "Soporte prioritario",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "Para creadores que publican varias apps cada semana.",
    priceMonthCents: 18500,  // 185 €/mes
    currency: "eur",
    creditsPerMonth: 750,
    popular: true,
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
    features: [
      "750 créditos mensuales",
      "Agentes personalizados",
      "Ventana de contexto 1M tokens",
      "Modelos premium (Claude Sonnet 4.6)",
      "Soporte dedicado",
    ],
  },
  {
    id: "team",
    name: "Team",
    description: "Créditos compartidos para equipos que construyen juntos.",
    priceMonthCents: 28000,  // 280 €/mes
    currency: "eur",
    creditsPerMonth: 1250,
    popular: false,
    stripePriceId: process.env.STRIPE_PRICE_TEAM ?? null,
    features: [
      "1.250 créditos mensuales compartidos",
      "Hasta 5 miembros",
      "Panel de equipo",
      "Facturación unificada",
      "SLA garantizado",
    ],
  },
];

export function getPlanById(planId: string): PlanDef {
  return SUBSCRIPTION_PLANS.find((p) => p.id === planId) ?? SUBSCRIPTION_PLANS[0];
}

export function getPlanByStripePriceId(priceId: string): PlanDef | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.stripePriceId === priceId);
}

// ─────────────────────────────────────────────────────────────────────────────
// PACKS DE CRÉDITOS (top-ups) — NO caducan nunca
// ─────────────────────────────────────────────────────────────────────────────

export const CREDIT_PACKAGES = [
  {
    id: "starter",
    priceId: "starter",
    name: "Starter",
    description: "Perfecto para probar Maris AI en un par de proyectos de fin de semana.",
    credits: 10,
    priceCents: 2000,   // 20 €
    currency: "eur",
    popular: false,
  },
  {
    id: "pro",
    priceId: "pro",
    name: "Pro",
    description: "Nuestro pack más popular: gasolina suficiente para un sprint de producto real.",
    credits: 50,
    priceCents: 8000,   // 80 €
    currency: "eur",
    popular: true,
  },
  {
    id: "studio",
    priceId: "studio",
    name: "Studio",
    description: "Para equipos que publican varias apps cada semana.",
    credits: 150,
    priceCents: 20000,  // 200 €
    currency: "eur",
    popular: false,
  },
  {
    id: "annual",
    priceId: "annual",
    name: "Annual",
    description: "12 meses de combustible al mejor precio. Ideal para creadores que envían apps cada semana.",
    credits: 600,
    priceCents: 39900,  // 399 €
    currency: "eur",
    popular: false,
  },
] as const;

export type CreditPackageDef = (typeof CREDIT_PACKAGES)[number];

export function findPackageByPriceId(priceId: string): CreditPackageDef | undefined {
  return CREDIT_PACKAGES.find((p) => p.priceId === priceId);
}

// ─────────────────────────────────────────────────────────────────────────────
// COSTES EN CRÉDITOS POR TIPO DE ACCIÓN
// Inspirado en la lógica de Emergent.sh
// ─────────────────────────────────────────────────────────────────────────────

export const ACTION_COSTS = {
  // Generación de apps por tipo
  "app:landing":       1,   // Landing page simple
  "app:fullstack":     1,   // App fullstack básica
  "app:vue":           1,
  "app:svelte":        1,
  "app:mobile":        2,   // App móvil
  "app:nextjs":        2,
  "app:python-api":    2,
  "app:django":        2,
  "app:hybrid-pwa":    3,   // PWA híbrida
  "app:game-2d":       3,   // Juego 2D
  "app:game-3d":       5,   // Juego 3D (más pesado)

  // Ediciones
  "edit:cosmetic":     0,   // Cambios visuales menores (gratis)
  "edit:feature":      1,   // Nueva funcionalidad
  "edit:bug":          1,   // Corrección de bug

  // Operaciones especiales
  "deploy:vercel":     1,   // Despliegue en Vercel
  "image:generate":    1,   // Generación de imagen con IA
} as const;

export type ActionCostKey = keyof typeof ACTION_COSTS;

export function getActionCost(action: ActionCostKey): number {
  return ACTION_COSTS[action] ?? 1;
}

// Mapa legacy para compatibilidad con el campo `kind` de GenerationJob
export const KIND_COSTS: Record<string, number> = {
  fullstack:    ACTION_COSTS["app:fullstack"],
  landing:      ACTION_COSTS["app:landing"],
  vue:          ACTION_COSTS["app:vue"],
  svelte:       ACTION_COSTS["app:svelte"],
  mobile:       ACTION_COSTS["app:mobile"],
  nextjs:       ACTION_COSTS["app:nextjs"],
  "python-api": ACTION_COSTS["app:python-api"],
  django:       ACTION_COSTS["app:django"],
  "hybrid-pwa": ACTION_COSTS["app:hybrid-pwa"],
  "game-2d":    ACTION_COSTS["app:game-2d"],
  "game-3d":    ACTION_COSTS["app:game-3d"],
};
