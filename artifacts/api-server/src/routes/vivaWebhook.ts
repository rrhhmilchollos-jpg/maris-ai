/**
 * vivaWebhook.ts
 *
 * Webhook de Viva.com — confirma pagos en tiempo real (en paralelo a la
 * verificación al volver el cliente desde Smart Checkout), para que el
 * sistema reaccione aunque el cliente cierre la pestaña antes de volver a
 * Maris AI o pierda la conexión a mitad del redirect.
 *
 * Flujo de configuración (lo hace el usuario manualmente en su panel de
 * Viva.com → Acceso a la API → Webhooks → Crear webhook):
 * 1. Viva llama a este endpoint con GET para verificarlo — debe responder
 *    con la misma "Key" que devuelve GET /api/messages/config/token
 *    (autenticado con Basic Auth: Nº identificación del comerciante : Clave API).
 * 2. Tras verificar, Viva permite activar el evento "Transaction Payment
 *    Created" — a partir de ahí, cada pago real dispara un POST aquí.
 */
import { Router, type Request, type Response } from "express";
import { GeneratedApp } from "@workspace/db/schema";
import { verifyTransaction, isTransactionPaid } from "../lib/vivaPayments";
import { logger } from "../lib/logger";

export const vivaWebhookRouter = Router();

const VIVA_IS_PRODUCTION = process.env.NODE_ENV === "production" && process.env.VIVA_USE_DEMO !== "true";
// IMPORTANTE: el endpoint de verificación de webhooks vive en un dominio
// DISTINTO al de la API de pagos (api.vivapayments.com, usado en
// lib/vivaPayments.ts para crear órdenes y verificar transacciones).
// CONFIRMADO contra el código fuente real del paquete oficial de la
// comunidad (sebdesign/laravel-viva-payments, Client::PRODUCTION_URL) tras
// que la URL api.vivapayments.com/api/messages/config/token devolviera
// 404 real en producción — esa ruta simplemente no existe en ese dominio.
const VIVA_WEBHOOK_BASE_URL = VIVA_IS_PRODUCTION
  ? "https://www.vivapayments.com"
  : "https://demo.vivapayments.com";

/**
 * GET /api/webhooks/viva — usado por Viva.com solo durante el paso de
 * "Verificar" al crear el webhook en el panel. Debe devolver la misma
 * "Key" que el endpoint oficial de verificación, autenticado con las
 * credenciales reales del comercio (Merchant ID + Clave API, NO las de
 * Smart Checkout — son credenciales distintas).
 */
vivaWebhookRouter.get("/webhooks/viva", async (_req: Request, res: Response) => {
  try {
    const merchantId = process.env.VIVA_MERCHANT_ID;
    const apiKey = process.env.VIVA_API_KEY;
    if (!merchantId || !apiKey) {
      logger.error("VIVA_MERCHANT_ID / VIVA_API_KEY no configuradas — no se puede verificar el webhook");
      return res.status(500).json({ error: "Webhook no configurado" });
    }

    const basicAuth = Buffer.from(`${merchantId}:${apiKey}`).toString("base64");
    const tokenRes = await fetch(`${VIVA_WEBHOOK_BASE_URL}/api/messages/config/token`, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => "");
      logger.error({ status: tokenRes.status, body: text }, "Viva webhook verification key request failed");
      return res.status(500).json({ error: "No se pudo obtener la clave de verificación" });
    }
    const data = (await tokenRes.json()) as { Key: string };
    return res.json({ Key: data.Key });
  } catch (err) {
    logger.error({ err }, "Error verifying Viva webhook");
    return res.status(500).json({ error: "Error interno" });
  }
});

/**
 * POST /api/webhooks/viva — recibe eventos reales de "Transaction Payment
 * Created" (EventTypeId 1796), en paralelo a la confirmación en
 * /billing/confirm cuando el cliente vuelve del checkout — para que el
 * sistema reaccione aunque el cliente cierre la pestaña antes de volver.
 *
 * Distingue el tipo de pago por el prefijo de MerchantTrns (el mismo valor
 * que nosotros mismos pusimos al crear la orden — ver vivaPayments.ts /
 * routes/billing.ts):
 *   - "watermark_removal:<appId>"                  → quitar marca de agua
 *   - "topup:<userId>:<packageId>:<credits>"        → top-up de pack
 *   - "topup-custom:<userId>:<credits>"             → top-up personalizado
 *   - "subscription:<userId>:<planId>"              → primer pago de suscripción
 *
 * Viva exige responder 2xx siempre que se reciba correctamente el evento,
 * sin importar si encontramos o no algo que hacer con él — de lo contrario
 * reintenta 24 veces durante 24h.
 */
vivaWebhookRouter.post("/webhooks/viva", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      EventData?: { StatusId?: string; MerchantTrns?: string; TransactionId?: string; OrderCode?: number; SourceCode?: string };
      EventTypeId?: number;
    };

    // 1796 = Transaction Payment Created (pago completado con éxito)
    if (body.EventTypeId === 1796 && body.EventData?.StatusId === "F") {
      const merchantTrns = body.EventData.MerchantTrns || "";
      const transactionId = body.EventData.TransactionId;
      const orderCode = body.EventData.OrderCode;

      // ENCONTRADO A PETICIÓN DEL USUARIO (auditoría de seguridad real):
      // este webhook procesaba pagos SOLO confiando en el propio cuerpo
      // de la petición POST (StatusId === "F") -- sin ninguna verificación
      // de IP, firma, ni llamada real a la API de Viva. A diferencia de
      // /billing/confirm (que SÍ llama a verifyTransaction() +
      // isTransactionPaid() antes de dar nada por bueno), cualquiera que
      // conociera esta URL podía enviar un payload fabricado con un
      // MerchantTrns tipo "topup:USER_ID:pack-100:160" y TransactionId
      // inventado, y el sistema concedía los créditos sin comprobar que
      // el pago hubiera ocurrido de verdad -- fallo de seguridad real con
      // impacto económico directo (créditos gratis sin pagar). Se añade
      // aquí EXACTAMENTE la misma verificación que ya usa /billing/confirm,
      // como debió tener desde el principio.
      if (!transactionId) {
        logger.warn({ merchantTrns, orderCode }, "Webhook de Viva sin TransactionId -- ignorado, no se puede verificar");
        res.status(200).json({ received: true, verified: false });
        return;
      }
      let verifiedTx;
      try {
        verifiedTx = await verifyTransaction(transactionId);
      } catch (err) {
        logger.error({ err, transactionId, merchantTrns }, "No se pudo verificar la transacción del webhook de Viva contra su API real -- ignorado por seguridad");
        res.status(200).json({ received: true, verified: false });
        return;
      }
      if (!verifiedTx || !isTransactionPaid(verifiedTx)) {
        logger.warn({ transactionId, merchantTrns }, "Webhook de Viva con transactionId que NO verifica como pagado en la API real -- ignorado, posible intento de fraude");
        res.status(200).json({ received: true, verified: false });
        return;
      }

      const watermarkMatch = merchantTrns.match(/^watermark_removal:(.+)$/);
      if (watermarkMatch) {
        const appId = watermarkMatch[1];
        await GeneratedApp.updateOne(
          { _id: appId },
          { hasWatermark: false, watermarkRemovalVivaOrderCode: null },
        );
        logger.info({ appId, transactionId }, "Watermark eliminada vía webhook de Viva.com");
      }

      // Mismo patrón que watermark_removal arriba: procesamos en segundo
      // plano (independiente de que el cliente haya vuelto o no a la web)
      // reutilizando EXACTAMENTE la misma lógica que /billing/confirm —
      // creditPurchase ya es idempotente por (userId, vivaOrderCode), así
      // que si el cliente SÍ vuelve a la web y /confirm ya lo procesó, este
      // webhook simplemente no duplica nada (alreadyProcessed:true).
      const topupMatch = merchantTrns.match(/^topup(-custom)?:([^:]+):(?:([^:]+):)?(\d+)$/);
      if (topupMatch) {
        const [, isCustom, userId, packageId, creditsStr] = topupMatch;
        const credits = Number(creditsStr);
        if (userId && Number.isFinite(credits) && credits > 0) {
          const { creditPurchase } = await import("../lib/credits");
          const { CREDIT_PACKAGES } = await import("../lib/payments");
          const { User } = await import("@workspace/db/schema");
          // Mismo cálculo determinista que en /billing/confirm — ver el
          // comentario extenso ahí. Nunca se usa el `amount` que devuelve
          // Viva para esto, por la ambigüedad de unidades sin confirmar.
          const priceCents = isCustom
            ? credits * 20
            : CREDIT_PACKAGES.find((p) => p.id === packageId)?.priceCents;
          const result = await creditPurchase({
            userId,
            amount: credits,
            vivaOrderCode: String(orderCode ?? transactionId ?? merchantTrns),
            description: `Top-up de ${credits} créditos (Viva.com, vía webhook)`,
            priceCents,
            gateway: "viva",
            vivaTransactionId: transactionId,
          });
          if (!result.alreadyProcessed) {
            await User.findByIdAndUpdate(userId, {
              $set: { hasEverPaid: true },
              $setOnInsert: { firstPaidAt: new Date() },
            });
            // Acreditar comisión al afiliado si este usuario fue referido
            try {
              const { trackAffiliateCommission } = await import("./affiliates");
              // Estimar el importe en euros a partir de los créditos
              // (aprox. 0.10€ por crédito — ajustar si cambian los precios)
              const estimatedEuros = credits * 0.10;
              await trackAffiliateCommission(userId, estimatedEuros);
            } catch (affErr) {
              logger.warn({ affErr, userId }, "Affiliate commission tracking failed (non-critical)");
            }
          }
          logger.info({ userId, credits, transactionId, alreadyProcessed: result.alreadyProcessed }, "Top-up confirmado vía webhook de Viva.com");
        }
      }

      const subMatch = merchantTrns.match(/^subscription:([^:]+):([^:]+)$/);
      if (subMatch) {
        const [, userId, planId] = subMatch;
        if (userId && planId && transactionId) {
          const { SUBSCRIPTION_PLANS } = await import("../lib/payments");
          const { grantPlanCredits } = await import("../lib/credits");
          const { User } = await import("@workspace/db/schema");
          const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
          if (plan) {
            const currentUser = await User.findById(userId, { vivaInitialTransactionId: 1 }).lean() as any;
            if (currentUser?.vivaInitialTransactionId !== transactionId) {
              const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
              await grantPlanCredits({
                clerkUserId: userId,
                planId: plan.id,
                creditsPerMonth: plan.creditsPerMonth,
                periodEnd,
                vivaInitialTransactionId: transactionId,
                vivaSourceCode: body.EventData?.SourceCode,
              });
              await User.findByIdAndUpdate(userId, {
                $set: { isPremium: true, hasEverPaid: true },
                $setOnInsert: { firstPaidAt: new Date() },
              });
              logger.info({ userId, planId, transactionId }, "Suscripción activada vía webhook de Viva.com");
            }
          }
        }
      }
    }

    return res.status(200).json({ message: "ok" });
  } catch (err) {
    logger.error({ err }, "Error processing Viva webhook");
    // Aun con error interno, respondemos 200 para evitar reintentos
    // infinitos sobre un evento que ya hemos podido procesar parcialmente;
    // el log de arriba queda como rastro para investigar manualmente.
    return res.status(200).json({ message: "ok" });
  }
});
