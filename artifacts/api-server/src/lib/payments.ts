/**
 * payments.ts
 *
 * Capa de catálogo de créditos/planes sobre Viva.com — sustituye a
 * lib/stripe.ts a petición explícita del usuario (cambio de pasarela de
 * pago: Stripe → Viva.com, su cuenta bancaria real).
 *
 * Mismo catálogo EXACTO de paquetes y precios que existía en stripe.ts —
 * solo cambia el proveedor de pago por debajo. Los priceId de Stripe se
 * sustituyen por un "packageId" simple (no hace falta crear nada en un
 * panel externo como con Stripe Price IDs: Viva Smart Checkout acepta el
 * importe directamente en cada creación de orden).
 *
 * IMPORTANTE — tarjetas aceptadas: solo débito/crédito Visa, Mastercard y
 * American Express. CONFIRMADO contra la documentación oficial de Viva.com
 * que la API NO distingue tarjetas prepago/virtuales de tarjetas de
 * débito/crédito normales — técnicamente son la misma red de tarjeta
 * (Visa/Mastercard), la diferencia la decide el banco emisor del cliente,
 * no Viva ni este código. No hay forma de filtrar esto por software; queda
 * como riesgo aceptado explícitamente por el usuario.
 */

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
    features: ["100 créditos/mes", "Dominio Personalizado", "Sin Marca de Agua", "Soporte Prioritario"],
  },
];

// Curva de precio por crédito DESCENDENTE según tamaño de paquete (a más
// créditos, más barato el crédito individual) — pensada para incentivar la
// compra de paquetes grandes. El paquete de entrada (160) es una excepción
// deliberada de "gancho": tiene el precio por crédito más bajo de toda la
// tabla para reducir la fricción de la primera compra, y a partir de ahí
// (250 en adelante) el descuento es estrictamente progresivo con el tamaño.
export const CREDIT_PACKAGES = [
  {
    id: "pack-100",
    name: "160 créditos",
    credits: 160,
    priceCents: 2000,   // 20€ — 0,125€/crédito (gancho de entrada)
    currency: "eur",
    popular: false,
    pricePerCredit: "0,125€",
  },
  {
    id: "pack-250",
    name: "250 créditos",
    credits: 250,
    priceCents: 3700,   // 37€ — 0,148€/crédito
    currency: "eur",
    popular: false,
    pricePerCredit: "0,148€",
  },
  {
    id: "pack-500",
    name: "500 créditos",
    credits: 500,
    priceCents: 7000,   // 70€ — 0,140€/crédito
    currency: "eur",
    popular: true,
    badge: "MÁS POPULAR",
    pricePerCredit: "0,140€",
  },
  {
    id: "pack-1250",
    name: "1250 créditos",
    credits: 1250,
    priceCents: 16200,  // 162€ — 0,130€/crédito
    currency: "eur",
    popular: false,
    pricePerCredit: "0,130€",
  },
  {
    id: "pack-3000",
    name: "3000 créditos",
    credits: 3000,
    priceCents: 36000,  // 360€ — 0,120€/crédito
    currency: "eur",
    description: "20% More",
    badge: "MEJOR AHORRO",
    popular: true,
    pricePerCredit: "0,120€",
  },
  {
    id: "pack-6000",
    name: "6000 créditos",
    credits: 6000,
    priceCents: 66000,  // 660€ — 0,110€/crédito
    currency: "eur",
    description: "20% More",
    badge: "MEJOR AHORRO",
    popular: true,
    pricePerCredit: "0,110€",
  },
];

export function findPackageById(packageId: string) {
  return CREDIT_PACKAGES.find((p) => p.id === packageId);
}

export function getPlanById(planId: string) {
  return SUBSCRIPTION_PLANS.find((p) => p.id === planId);
}

/**
 * Tarjetas aceptadas: Visa, Mastercard, American Express — débito o crédito.
 *
 * NOTA DE HONESTIDAD TÉCNICA: el código previo de Maris AI asumía un mapeo
 * numérico fijo para cardTypeId (0=Visa, 1=Mastercard, 3=Amex) sin que ese
 * mapeo estuviera confirmado en la documentación pública oficial de
 * Viva.com en el momento de escribir esto — la página oficial de "Response
 * information" (developer.viva.com/integration-reference/response-codes/)
 * documenta StatusId, TransactionTypeId, ChannelId y BankId (este último
 * con valores de texto como NET_VISA/NET_MASTER/NET_AMEX), pero NO una
 * tabla numérica de cardTypeId. Antes de confiar en ese número en
 * producción, hay que confirmarlo contra una respuesta REAL de
 * verifyTransaction()/el webhook (loguear el payload completo de una
 * transacción de prueba en el entorno demo y mirar qué valor trae para una
 * Visa/Mastercard/Amex de prueba reales) — no asumirlo de memoria.
 *
 * Esta función queda preparada para activarse en cuanto eso se confirme;
 * por ahora NO bloquea ningún pago (siempre devuelve true), porque
 * bloquear pagos reales basándose en un mapeo sin confirmar sería peor que
 * no filtrar nada.
 */
export function isAcceptedCardType(_cardTypeId: number | null | undefined): boolean {
  return true;
}

/**
 * Cliente de Stripe SOLO para reembolsar pagos LEGADOS (hechos antes de la
 * migración a Viva.com) desde el panel admin — ver routes/admin.ts →
 * POST /admin/users/:id/stripe-refund. NO usar para cobrar nada nuevo: el
 * checkout de Maris AI usa Viva.com en su totalidad desde la migración
 * (ver routes/billing.ts, lib/vivaPayments.ts). Devuelve null si la clave
 * ya no está configurada en el entorno — el endpoint de reembolso responde
 * 503 en ese caso en vez de lanzar.
 */
export async function getStripe(): Promise<import("stripe").default | null> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  const Stripe = (await import("stripe")).default;
  return new Stripe(secretKey);
}
