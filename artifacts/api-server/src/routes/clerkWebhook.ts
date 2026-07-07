/**
 * clerkWebhook.ts — Webhook de Clerk para sincronizar usuarios automáticamente
 *
 * Cuando un usuario se registra en Clerk → se crea inmediatamente en MongoDB.
 * Así el panel admin siempre muestra el recuento real aunque no hayan generado nada.
 *
 * Eventos manejados:
 * - user.created  → crear usuario en MongoDB con 65 créditos gratuitos
 * - user.updated  → actualizar email/nombre si cambian
 * - user.deleted  → marcar como inactivo (no borrar datos)
 *
 * Configurar en Clerk Dashboard → Webhooks:
 * URL: https://maris-ai-api-server-production-fbad.up.railway.app/api/clerk/webhook
 * Eventos: user.created, user.updated, user.deleted
 * Signing Secret: guardar en env como CLERK_WEBHOOK_SECRET
 */

import { Router, type Request, type Response } from "express";
import { notifyAdminNewUser, notifyAdminUserDeleted, notifyAdminUserUpdated, sendWelcomeEmail } from "../lib/notify";
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
    // ENCONTRADO A PETICIÓN DEL USUARIO (auditoría de seguridad, mismo
    // hallazgo que el webhook de Viva): este respaldo aceptaba el webhook
    // con solo comprobar que las CABECERAS svix-id/svix-signature
    // estuvieran presentes -- sin validar que el VALOR de la firma fuera
    // correcto. Cualquiera podía falsificarlo con valores inventados, sin
    // necesitar conocer el secreto real. Confirmado que 'svix' SÍ está
    // instalado como dependencia real del proyecto (package.json), así
    // que este camino no debería activarse en la práctica -- pero por
    // defensa en profundidad, se falla cerrado (rechazar) en vez de
    // degradar a una comprobación que no verifica nada de verdad.
    if (svixErr?.code === "ERR_MODULE_NOT_FOUND" || svixErr?.message?.includes("Cannot find")) {
      logger.error("clerkWebhook: svix no disponible en tiempo de ejecución -- rechazando el webhook por seguridad, en vez de aceptarlo con una comprobación débil");
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
        // A petición explícita del usuario, tras confirmar que Clerk YA tiene
        // verificación de teléfono por SMS OTP nativa (User & Authentication →
        // Phone, en el panel de Clerk) — NO se construye un sistema de OTP
        // propio en paralelo (eso crearía una segunda fuente de verdad sobre
        // quién es el usuario). El campo phoneNumber ya existía en el schema
        // de User pero nunca se rellenaba porque el webhook no leía
        // data.phone_numbers del payload real de Clerk. Esto solo conecta el
        // dato que Clerk YA capturó y verificó por su cuenta — el número
        // principal del usuario, si proporcionó uno.
        const phoneNumber = data.phone_numbers?.[0]?.phone_number ?? undefined;

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
          phoneNumber,
          credits: isAdmin ? 999999999 : 65,
          planCredits: isAdmin ? 0 : 65,
          freeCreditsUsed: !isAdmin,
          plan: "free",
          // Igual que en ensureUser() (lib/auth.ts) — arranca el ciclo
          // mensual de caducidad de créditos del plan gratis desde el alta.
          planExpiresAt: isAdmin ? undefined : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          createdAt: new Date(data.created_at ?? Date.now()),
        });

        logger.info({ clerkId, email }, "clerkWebhook: usuario creado en MongoDB ✅");

        // Notificar al admin por email — nuevo usuario registrado
        notifyAdminNewUser({ userEmail: email, userId: clerkId }).catch(() => {});

        // A petición explícita del usuario: correo de bienvenida REAL al
        // cliente (hasta hoy solo existían notificaciones al admin, ningún
        // correo automático dirigido al usuario que se acaba de registrar).
        // Best-effort: si falla (Resend caído, RESEND_API_KEY no
        // configurada), NUNCA debe bloquear ni revertir la creación del
        // usuario, que ya ocurrió arriba.
        if (!isAdmin) {
          sendWelcomeEmail({ userEmail: email, userName: fullName, credits: 65 }).catch((err) => {
            logger.warn({ err, clerkId, email }, "clerkWebhook: fallo enviando correo de bienvenida — usuario creado igualmente");
          });
        }
        break;
      }

      case "user.updated": {
        const clerkId = data.id as string;
        const email = data.email_addresses?.[0]?.email_address ?? "";
        const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ") || undefined;
        const imageUrl = data.image_url ?? undefined;
        const phoneNumber = data.phone_numbers?.[0]?.phone_number ?? undefined;

        const updates: Record<string, any> = {};
        if (email) updates.email = email;
        if (fullName) updates.fullName = fullName;
        if (imageUrl) updates.imageUrl = imageUrl;
        if (phoneNumber) updates.phoneNumber = phoneNumber;

        if (Object.keys(updates).length > 0) {
          await User.findByIdAndUpdate(clerkId, { $set: updates });
          logger.info({ clerkId, updates: Object.keys(updates) }, "clerkWebhook: usuario actualizado ✅");
          notifyAdminUserUpdated({ userEmail: email, userId: clerkId, changes: Object.keys(updates).join(", ") }).catch(() => {});
        }
        break;
      }

      case "user.deleted": {
        const clerkId = data.id as string;
        // Buscar email ANTES de marcar como eliminado
        const deletedUser = await User.findById(clerkId, { email: 1, fullName: 1 }).lean() as any;
        const deletedEmail = deletedUser?.email || "email desconocido";
        const deletedName = deletedUser?.fullName || "Usuario";

        // Marcar como inactivo — NO borrar datos (RGPD: derecho al olvido se gestiona manualmente)
        await User.findByIdAndUpdate(clerkId, {
          $set: {
            isSuspended: true,
            suspendedAt: new Date(),
            suspendReason: "Cuenta eliminada desde Clerk — pendiente revisión de soporte",
          }
        });

        logger.info({ clerkId, email: deletedEmail }, "clerkWebhook: usuario marcado como eliminado ✅");

        // Notificar al admin URGENTE
        notifyAdminUserDeleted({ userEmail: deletedEmail, userId: clerkId }).catch(() => {});

        // Enviar email al usuario explicando el proceso
        if (deletedUser?.email) {
          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey) {
            fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: process.env.RESEND_FROM_EMAIL || "Maris AI <soporte@marisai.es>",
                to: [deletedEmail],
                subject: "Solicitud de eliminación de cuenta recibida — Maris AI",
                html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f0f12;color:#e2e8f0;padding:24px;border-radius:12px">
                  <h2 style="color:#fff">Hemos recibido tu solicitud</h2>
                  <p>Hola ${deletedName},</p>
                  <p>Hemos recibido tu solicitud de eliminación de cuenta. Nuestro equipo la procesará en un plazo máximo de <strong style="color:#a855f7">48 horas hábiles</strong>.</p>
                  <p>Si necesitas acelerar el proceso o tienes dudas, contacta con nosotros:</p>
                  <ul>
                    <li>📧 <a href="mailto:soporte@marisai.es" style="color:#a855f7">soporte@marisai.es</a></li>
                    <li>🎫 Crea un ticket en <a href="https://www.marisai.es/dashboard" style="color:#a855f7">marisai.es/dashboard</a></li>
                  </ul>
                  <p style="color:#64748b;font-size:13px">Conforme al RGPD, eliminaremos todos tus datos personales en el plazo indicado.</p>
                  <p>— Equipo Maris AI</p>
                </div>`,
              }),
            }).catch(() => {});
          }
        }
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
