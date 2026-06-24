/**
 * clerkWebhook.ts — Webhook de Clerk para sincronizar usuarios automáticamente
 *
 * Cuando un usuario se registra en Clerk → se crea inmediatamente en MongoDB.
 * Así el panel admin siempre muestra el recuento real aunque no hayan generado nada.
 *
 * Eventos manejados:
 * - user.created  → crear usuario en MongoDB con 50 créditos gratuitos
 * - user.updated  → actualizar email/nombre si cambian
 * - user.deleted  → marcar como inactivo (no borrar datos)
 *
 * Configurar en Clerk Dashboard → Webhooks:
 * URL: https://maris-ai-api-server-production-fbad.up.railway.app/api/clerk/webhook
 * Eventos: user.created, user.updated, user.deleted
 * Signing Secret: guardar en env como CLERK_WEBHOOK_SECRET
 */

import { Router, type Request, type Response } from "express";
import { notifyAdminNewUser, notifyAdminUserDeleted, notifyAdminUserUpdated } from "../lib/notify";
import { connectDB } from "../lib/db";
import { User } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { isAdminEmail } from "../lib/auth";

const router = Router();

// Verificar firma del webhook de Clerk (svix)
async function verifyClerkWebhook(req: Request): Promise<any | null> {
  const secret = process.env.CLERK_WEBHOOK_SECRET;

  // Sin secret → aceptar siempre (configurar en producción para mayor seguridad)
  if (!secret) {
    logger.info("clerkWebhook: sin CLERK_WEBHOOK_SECRET — aceptando sin verificar firma");
    return req.body;
  }

  // Verificar con svix si está disponible, si no aceptar con cabecera básica
  try {
    const { Webhook } = await import("svix");
    const wh = new Webhook(secret);
    const payload = wh.verify(
      JSON.stringify(req.body),
      {
        "svix-id": req.headers["svix-id"] as string,
        "svix-timestamp": req.headers["svix-timestamp"] as string,
        "svix-signature": req.headers["svix-signature"] as string,
      }
    );
    return payload;
  } catch (svixErr: any) {
    // Si svix no está instalado, verificar con cabecera básica
    if (svixErr?.code === "ERR_MODULE_NOT_FOUND" || svixErr?.message?.includes("Cannot find")) {
      logger.warn("clerkWebhook: svix no instalado — verificando con cabecera básica");
      // Verificación mínima: que venga con las cabeceras de Clerk
      if (req.headers["svix-id"] && req.headers["svix-signature"]) {
        return req.body;
      }
      return null;
    }
    logger.warn({ err: svixErr }, "clerkWebhook: firma inválida");
    return null;
  }
}

router.post("/clerk/webhook", async (req: Request, res: Response): Promise<void> => {
  const payload = await verifyClerkWebhook(req);
  if (!payload) {
    res.status(400).json({ error: "Firma inválida" });
    return;
  }

  const { type, data } = payload as { type: string; data: any };
  logger.info({ type, userId: data?.id }, "clerkWebhook: evento recibido");

  await connectDB();

  try {
    switch (type) {
      case "user.created": {
        const clerkId = data.id as string;
        const email = data.email_addresses?.[0]?.email_address ?? "";
        const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ") || undefined;
        const imageUrl = data.image_url ?? undefined;

        if (!email) {
          logger.warn({ clerkId }, "clerkWebhook: user.created sin email — ignorado");
          break;
        }

        // Verificar si ya existe (por Clerk ID o por email)
        const existing = await User.findOne({ $or: [{ _id: clerkId }, { email }] }).lean();
        if (existing) {
          logger.info({ clerkId, email }, "clerkWebhook: usuario ya existe — ignorado");
          break;
        }

        const isAdmin = isAdminEmail(email);
        await User.create({
          _id: clerkId,
          email,
          fullName,
          imageUrl,
          credits: isAdmin ? 999999999 : 15,
          planCredits: isAdmin ? 0 : 50,
          freeCreditsUsed: !isAdmin,
          plan: "free",
          createdAt: new Date(data.created_at ?? Date.now()),
        });

        logger.info({ clerkId, email }, "clerkWebhook: usuario creado en MongoDB ✅");

        // Notificar al admin por email — nuevo usuario registrado
        notifyAdminNewUser({ userEmail: email, userId: clerkId }).catch(() => {});
        break;
      }

      case "user.updated": {
        const clerkId = data.id as string;
        const email = data.email_addresses?.[0]?.email_address ?? "";
        const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ") || undefined;
        const imageUrl = data.image_url ?? undefined;

        const updates: Record<string, any> = {};
        if (email) updates.email = email;
        if (fullName) updates.fullName = fullName;
        if (imageUrl) updates.imageUrl = imageUrl;

        if (Object.keys(updates).length > 0) {
          await User.findByIdAndUpdate(clerkId, { $set: updates });
          logger.info({ clerkId, updates: Object.keys(updates) }, "clerkWebhook: usuario actualizado ✅");
          notifyAdminUserUpdated({ userEmail: email, userId: clerkId, changes: Object.keys(updates).join(", ") }).catch(() => {});
        }
        break;
      }

      case "user.deleted": {
        const clerkId = data.id as string;
        // No borrar — solo marcar como inactivo para conservar historial
        await User.findByIdAndUpdate(clerkId, {
          $set: {
            isSuspended: true,
            suspendedAt: new Date(),
            suspendReason: "Cuenta eliminada desde Clerk",
          }
        });
        // Buscar email antes de marcar como eliminado
        const deletedUser = await User.findById(clerkId, { email: 1 }).lean() as any;
        logger.info({ clerkId }, "clerkWebhook: usuario marcado como eliminado ✅");
        notifyAdminUserDeleted({ userEmail: deletedUser?.email || "email desconocido", userId: clerkId }).catch(() => {});
        break;
      }

      default:
        logger.info({ type }, "clerkWebhook: evento no manejado — ignorado");
    }

    res.json({ ok: true, type });
  } catch (err) {
    logger.error({ err, type }, "clerkWebhook: error procesando evento");
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;
