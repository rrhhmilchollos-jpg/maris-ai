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
 * POST /api/webhooks/viva — recibe eventos reales. Por ahora solo nos
 * interesa "Transaction Payment Created" (EventTypeId 1796) para confirmar
 * pagos de eliminación de marca de agua, identificados por el prefijo
 * "watermark_removal:" en merchantTrns (el mismo valor que enviamos al
 * crear la orden en vivaPayments.ts).
 *
 * Viva exige responder 2xx siempre que se reciba correctamente el evento,
 * sin importar si encontramos o no algo que hacer con él — de lo contrario
 * reintenta 24 veces durante 24h.
 */
vivaWebhookRouter.post("/webhooks/viva", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      EventData?: { StatusId?: string; MerchantTrns?: string; TransactionId?: string };
      EventTypeId?: number;
    };

    // 1796 = Transaction Payment Created (pago completado con éxito)
    if (body.EventTypeId === 1796 && body.EventData?.StatusId === "F") {
      const merchantTrns = body.EventData.MerchantTrns || "";
      const match = merchantTrns.match(/^watermark_removal:(.+)$/);
      if (match) {
        const appId = match[1];
        await GeneratedApp.updateOne(
          { _id: appId },
          { hasWatermark: false, watermarkRemovalVivaOrderCode: null },
        );
        logger.info({ appId, transactionId: body.EventData.TransactionId }, "Watermark eliminada vía webhook de Viva.com");
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
