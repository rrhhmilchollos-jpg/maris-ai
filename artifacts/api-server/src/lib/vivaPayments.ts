/**
 * vivaPayments.ts
 *
 * Integración con Viva.com Smart Checkout (pagos con tarjeta vía OAuth2).
 * Pensada como alternativa/complemento a Stripe para el mercado español,
 * usando la cuenta de comercio real del usuario en Viva.com.
 *
 * Flujo:
 * 1. getAccessToken() — obtiene un Bearer token vía client_credentials
 *    (cacheado en memoria mientras sea válido, igual que el resto de
 *    clientes de integración del proyecto).
 * 2. createPaymentOrder() — crea la orden de pago (POST /checkout/v2/orders)
 *    y devuelve la URL de Smart Checkout a la que redirigir al cliente.
 * 3. verifyTransaction() — tras el webhook o el retorno del cliente,
 *    confirma el estado real de la transacción vía API antes de dar
 *    por válido el pago (nunca fiarse solo de la redirección del navegador).
 *
 * IMPORTANTE — no existe forma de distinguir tarjetas prepago/regalo de
 * tarjetas de débito/crédito normales vía la API de Viva (confirmado en su
 * documentación oficial): técnicamente son tarjetas Visa/Mastercard igual
 * que cualquier otra, la diferencia la decide el banco emisor del cliente,
 * no Viva ni este código. No se intenta filtrar esto aquí.
 */
import { logger } from "./logger";

const IS_PRODUCTION = process.env.NODE_ENV === "production" && process.env.VIVA_USE_DEMO !== "true";

const VIVA_ACCOUNTS_URL = IS_PRODUCTION
  ? "https://accounts.vivapayments.com/connect/token"
  : "https://demo-accounts.vivapayments.com/connect/token";

const VIVA_API_URL = IS_PRODUCTION
  ? "https://api.vivapayments.com"
  : "https://demo-api.vivapayments.com";

const VIVA_CHECKOUT_URL = IS_PRODUCTION
  ? "https://www.vivapayments.com/web/checkout"
  : "https://demo.vivapayments.com/web/checkout";

export interface VivaPaymentOrderRequest {
  amount: number; // En céntimos — ej. 999 = 9,99€
  customerTrns: string; // Descripción mostrada al cliente
  merchantTrns?: string; // Referencia interna corta
  customerEmail?: string;
  customerFullName?: string;
  requestLang?: string; // ej. "es-ES"
  sourceCode?: string; // Si tienes varios "payment sources" configurados en Viva
  /** true para el primer pago de una suscripción — el cliente da su
   *  consentimiento explícito en Smart Checkout para que se le cobre de
   *  nuevo en el futuro sin estar presente. Confirmado contra la
   *  documentación oficial de Viva: solo los métodos de pago que soportan
   *  recurrencia se muestran al cliente cuando este flag está activo (en
   *  la práctica, tarjeta — que es la única forma de pago que aceptamos). */
  allowRecurring?: boolean;
}

export interface VivaTransaction {
  transactionId: string;
  orderCode: number;
  statusId: string; // F = Finished (pago completado con éxito)
  amount: number;
  email?: string;
  fullName?: string;
  cardNumber?: string;
  cardTypeId?: number; // 0=Visa, 1=Mastercard, 2=Diners, 3=Amex, 6=Maestro... (NO confirmado oficialmente, ver lib/payments.ts)
  /** La referencia que NOSOTROS pusimos al crear la orden (createPaymentOrder)
   *  — fuente de verdad para saber qué se está pagando al confirmar el pago. */
  merchantTrns?: string;
  /** Solo relevante para pagos recurrentes — el sourceCode usado en el pago
   *  inicial debe reutilizarse en cada cobro mensual siguiente. */
  sourceCode?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Obtiene un access token OAuth2 vía client_credentials, cacheado en
 * memoria del proceso mientras quede vigente (los tokens de Viva duran
 * 3600s; renovamos con 60s de margen de seguridad).
 */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const clientId = process.env.VIVA_SMART_CHECKOUT_CLIENT_ID;
  const clientSecret = process.env.VIVA_SMART_CHECKOUT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("VIVA_SMART_CHECKOUT_CLIENT_ID / VIVA_SMART_CHECKOUT_CLIENT_SECRET no configuradas");
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(VIVA_ACCOUNTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Viva OAuth2 token request failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    // Margen de 60s para evitar usar un token que expire a mitad de una llamada.
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

/**
 * Crea una orden de pago en Viva Smart Checkout y devuelve la URL a la que
 * redirigir al cliente para completar el pago con tarjeta.
 */
export async function createPaymentOrder(opts: VivaPaymentOrderRequest): Promise<{ orderCode: number; checkoutUrl: string }> {
  const token = await getAccessToken();

  const payload: Record<string, unknown> = {
    amount: opts.amount,
    customerTrns: opts.customerTrns,
    merchantTrns: opts.merchantTrns,
    paymentTimeout: 1800, // 30 minutos para completar el pago
    disableWallet: true, // Solo tarjeta — sin Viva Wallet, según lo pedido
    disableCash: true, // Sin pago en efectivo (Viva Spot)
  };
  if (opts.allowRecurring) payload.allowRecurring = true;
  if (opts.customerEmail || opts.customerFullName) {
    payload.customer = {
      email: opts.customerEmail,
      fullName: opts.customerFullName,
      requestLang: opts.requestLang || "es-ES",
    };
  }
  if (opts.sourceCode) payload.sourceCode = opts.sourceCode;

  const res = await fetch(`${VIVA_API_URL}/checkout/v2/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, body: text }, "Viva createPaymentOrder failed");
    throw new Error(`Viva createPaymentOrder failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { orderCode: number };
  return {
    orderCode: data.orderCode,
    checkoutUrl: `${VIVA_CHECKOUT_URL}?ref=${data.orderCode}`,
  };
}

/**
 * Confirma el estado real de una transacción vía API — nunca fiarse solo
 * de la redirección del navegador del cliente (puede manipularse) ni de un
 * webhook sin verificar; esto es la fuente de verdad real.
 */
export async function verifyTransaction(transactionId: string): Promise<VivaTransaction | null> {
  const token = await getAccessToken();

  const res = await fetch(`${VIVA_API_URL}/checkout/v2/transactions/${transactionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    const text = await res.text().catch(() => "");
    throw new Error(`Viva verifyTransaction failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as any;
  return {
    transactionId: data.transactionId ?? transactionId,
    orderCode: data.orderCode,
    statusId: data.statusId,
    amount: data.amount,
    email: data.email,
    fullName: data.fullName,
    cardNumber: data.cardNumber,
    cardTypeId: data.cardTypeId,
    merchantTrns: data.merchantTrns,
    sourceCode: data.sourceCode,
  };
}

/** statusId "F" = Finished — el único valor que representa un pago completado con éxito. */
export function isTransactionPaid(tx: VivaTransaction): boolean {
  return tx.statusId === "F";
}

/**
 * Cobra un pago recurrente (la cuota mensual de una suscripción) referenciando
 * el transactionId del PRIMER pago — el que el cliente autorizó explícitamente
 * con allowRecurring=true en Smart Checkout. Confirmado contra la
 * documentación oficial de Viva.com: a diferencia de Stripe, Viva no tiene un
 * objeto "Subscription" que se cobre solo — cada cuota es una transacción
 * NUEVA creada por el comercio (nosotros) referenciando esa transacción
 * inicial, vía POST /api/transactions/{parentTransactionId} con Basic Auth
 * (Nº de comerciante : Clave API — NO el OAuth2 de Smart Checkout, son
 * credenciales y endpoints distintos, igual que ya distingue
 * vivaWebhook.ts para la verificación del webhook).
 */
export async function chargeRecurringPayment(opts: {
  parentTransactionId: string;
  amount: number; // céntimos
  customerTrns: string;
  merchantTrns?: string;
  sourceCode?: string; // DEBE ser el mismo sourceCode que el pago inicial, o se cobra en el source por defecto
}): Promise<{ transactionId: string; statusId: string } | null> {
  const merchantId = process.env.VIVA_MERCHANT_ID;
  const apiKey = process.env.VIVA_API_KEY;
  if (!merchantId || !apiKey) {
    throw new Error("VIVA_MERCHANT_ID / VIVA_API_KEY no configuradas — no se puede cobrar el pago recurrente");
  }
  const basicAuth = Buffer.from(`${merchantId}:${apiKey}`).toString("base64");

  const payload: Record<string, unknown> = {
    amount: opts.amount,
    customerTrns: opts.customerTrns,
    merchantTrns: opts.merchantTrns,
  };
  if (opts.sourceCode) payload.sourceCode = opts.sourceCode;

  const res = await fetch(`${VIVA_API_URL}/api/transactions/${opts.parentTransactionId}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, body: text, parentTransactionId: opts.parentTransactionId }, "Viva chargeRecurringPayment failed");
    return null;
  }

  const data = (await res.json()) as { TransactionId?: string; StatusId?: string; ErrorCode?: number };
  if (!data.TransactionId || data.ErrorCode) {
    logger.warn({ data, parentTransactionId: opts.parentTransactionId }, "Viva chargeRecurringPayment returned an error in the response body");
    return null;
  }
  return { transactionId: data.TransactionId, statusId: data.StatusId ?? "" };
}

/**
 * Reembolsa (total o parcialmente) una transacción real vía la API de
 * Viva.com — "Cancel transaction" (DELETE /api/transactions/:id), la misma
 * que se usa para reembolsos manuales desde el panel de Viva, confirmada
 * contra la documentación oficial: developer.viva.com/tutorials/payments/issue-a-refund
 *
 * IMPORTANTE — requisito de la propia Viva: hay que tener "Allow refunds"
 * activado en Ajustes > API Access de la cuenta de Viva para que esto
 * funcione (si no, Viva devuelve un error explícito, no falla en silencio).
 */
export async function refundTransaction(opts: {
  transactionId: string;
  amountCents: number; // importe a reembolsar, en céntimos (puede ser parcial)
  sourceCode?: string;
}): Promise<{ ok: true; refundTransactionId: string } | { ok: false; error: string }> {
  const merchantId = process.env.VIVA_MERCHANT_ID;
  const apiKey = process.env.VIVA_API_KEY;
  if (!merchantId || !apiKey) {
    return { ok: false, error: "VIVA_MERCHANT_ID / VIVA_API_KEY no configuradas — no se puede reembolsar." };
  }
  const basicAuth = Buffer.from(`${merchantId}:${apiKey}`).toString("base64");

  const params = new URLSearchParams({ amount: String(Math.round(opts.amountCents)) });
  if (opts.sourceCode) params.set("sourceCode", opts.sourceCode);

  const res = await fetch(`${VIVA_API_URL}/api/transactions/${opts.transactionId}?${params.toString()}`, {
    method: "DELETE",
    headers: { Authorization: `Basic ${basicAuth}` },
  });

  const data = (await res.json().catch(() => ({}))) as { TransactionId?: string; ErrorCode?: number; ErrorText?: string };

  if (!res.ok || data.ErrorCode) {
    logger.error({ status: res.status, data, transactionId: opts.transactionId }, "Viva refundTransaction failed");
    return { ok: false, error: data.ErrorText || `Viva respondió ${res.status}` };
  }

  logger.info({ transactionId: opts.transactionId, refundTransactionId: data.TransactionId }, "Reembolso ejecutado correctamente vía Viva.com");
  return { ok: true, refundTransactionId: data.TransactionId || opts.transactionId };
}
