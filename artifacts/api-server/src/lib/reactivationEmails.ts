/**
 * reactivationEmails.ts — Sistema automático de reactivación de clientes
 *
 * Envía emails personalizados a clientes que llevan días sin actividad
 * para incentivarlos a volver y continuar con sus proyectos.
 *
 * ESTRATEGIA DE EMAILS (igual que las grandes empresas):
 *   - from:     "Maris AI <soporte@marisai.es>"   ← remitente corporativo real
 *   - reply_to: "soporte@marisai.es"               ← el cliente responde a soporte
 *   - NO usar no-reply en emails al cliente — el cliente debe poder responder
 *
 * SECUENCIA DE REACTIVACIÓN:
 *   Día 3:  Email 1 — "¿Cómo va tu proyecto?" (suave, curiosidad)
 *   Día 7:  Email 2 — "Tu app te está esperando" (urgencia suave + valor)
 *   Día 14: Email 3 — "Últimos créditos antes de que caduquen" (FOMO)
 *   Día 30: Email 4 — Oferta especial de reactivación (descuento o créditos)
 *
 * Se ejecuta una vez al día desde index.ts.
 * Guarda en BD qué emails ya se enviaron para no duplicar.
 */

import { connectDB } from "./db";
import { User, GeneratedApp, GenerationJob } from "@workspace/db/schema";
import pino from "pino";

const log = pino({ name: "reactivation" });

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ReactivationContext {
  userEmail: string;
  userName: string;
  lastAppTitle: string;
  creditsLeft: number;
  daysSinceLastActivity: number;
  totalAppsGenerated: number;
}

// ─── Función principal de envío ──────────────────────────────────────────────

async function sendReactivationEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    log.warn("RESEND_API_KEY no configurada — email de reactivación no enviado");
    return false;
  }

  try {
    const body = {
      // Email corporativo real como remitente — el cliente puede responder
      from: "Maris AI <soporte@marisai.es>",
      reply_to: "soporte@marisai.es",
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    };
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    log.error({ err }, "Error enviando email de reactivación");
    return false;
  }
}

// ─── Templates de email ──────────────────────────────────────────────────────

function emailDay3(ctx: ReactivationContext): { subject: string; html: string; text: string } {
  const subject = `${ctx.userName.split(" ")[0]}, ¿cómo va "${ctx.lastAppTitle}"? 👋`;
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <tr><td style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:32px 36px;text-align:center">
    <div style="font-size:32px;margin-bottom:8px">👋</div>
    <h1 style="color:#ffffff;font-size:22px;margin:0;font-weight:700">Hola, ${ctx.userName.split(" ")[0]}</h1>
    <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:8px 0 0">Te echamos de menos en Maris AI</p>
  </td></tr>
  <tr><td style="padding:36px">
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 20px">Han pasado unos días desde que empezaste <strong>"${ctx.lastAppTitle}"</strong> con nosotros. ¿Todo bien?</p>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 24px">Muchos de nuestros clientes arrancan su app, la ven funcionar y después se quedan pensando en qué añadir. Es normal. Lo bueno es que puedes volver en cualquier momento y seguir exactamente donde lo dejaste.</p>
    <div style="background:#f9f7ff;border-radius:10px;padding:20px;margin:0 0 28px;border-left:4px solid #7c3aed">
      <p style="color:#5b21b6;font-size:15px;font-weight:600;margin:0 0 8px">Tu proyecto te espera:</p>
      <p style="color:#374151;font-size:14px;margin:0">📱 <strong>${ctx.lastAppTitle}</strong></p>
      <p style="color:#6b7280;font-size:13px;margin:6px 0 0">💳 Tienes <strong>${ctx.creditsLeft} créditos</strong> disponibles para continuar</p>
    </div>
    <table width="100%"><tr><td align="center">
      <a href="https://www.marisai.es/dashboard" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;box-shadow:0 4px 12px rgba(124,58,237,0.3)">
        Continuar con mi app →
      </a>
    </td></tr></table>
    <p style="color:#9ca3af;font-size:13px;text-align:center;margin:24px 0 0">¿Tienes dudas o necesitas ayuda? Responde a este correo directamente — te atendemos en español.</p>
  </td></tr>
  <tr><td style="background:#f9fafb;padding:20px 36px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="color:#9ca3af;font-size:12px;margin:0">Maris AI · <a href="https://www.marisai.es" style="color:#7c3aed;text-decoration:none">marisai.es</a> · soporte@marisai.es</p>
    <p style="color:#d1d5db;font-size:11px;margin:6px 0 0"><a href="https://www.marisai.es/unsubscribe" style="color:#d1d5db">Cancelar suscripción</a></p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
  const text = `Hola ${ctx.userName.split(" ")[0]},\n\nHan pasado unos días desde que empezaste "${ctx.lastAppTitle}". Tu proyecto te espera con ${ctx.creditsLeft} créditos disponibles.\n\nContinúa aquí: https://www.marisai.es/dashboard\n\n¿Tienes dudas? Responde a este email directamente.\n\nEl equipo de Maris AI\nsoporte@marisai.es`;
  return { subject, html, text };
}

function emailDay7(ctx: ReactivationContext): { subject: string; html: string; text: string } {
  const subject = `Tu app "${ctx.lastAppTitle}" te está esperando ⏰`;
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <tr><td style="background:linear-gradient(135deg,#0f172a,#1e1b4b);padding:32px 36px;text-align:center">
    <div style="font-size:40px;margin-bottom:12px">⏰</div>
    <h1 style="color:#ffffff;font-size:22px;margin:0;font-weight:700">Una semana sin vernos</h1>
    <p style="color:rgba(255,255,255,0.7);font-size:14px;margin:8px 0 0">${ctx.userName.split(" ")[0]}, tu app sigue lista para cuando quieras</p>
  </td></tr>
  <tr><td style="padding:36px">
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 20px">Llevas 7 días sin entrar a Maris AI. No pasa nada — sabemos lo ocupados que estáis los emprendedores.</p>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 24px">Pero queremos recordarte que <strong>"${ctx.lastAppTitle}"</strong> está exactamente como la dejaste, esperando que la lleves al siguiente nivel.</p>
    <div style="background:#fef3c7;border-radius:10px;padding:20px;margin:0 0 24px;border-left:4px solid #f59e0b">
      <p style="color:#92400e;font-size:15px;font-weight:600;margin:0 0 10px">¿Sabías que puedes hacer esto en 5 minutos?</p>
      <ul style="color:#374151;font-size:14px;margin:0;padding-left:18px;line-height:2">
        <li>Añadir autenticación con Google a tu app</li>
        <li>Conectar tu dominio personalizado</li>
        <li>Integrar pagos con Stripe</li>
        <li>Desplegar en producción con un clic</li>
      </ul>
    </div>
    <table width="100%"><tr><td align="center">
      <a href="https://www.marisai.es/dashboard" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;box-shadow:0 4px 12px rgba(245,158,11,0.3)">
        Volver a mi proyecto →
      </a>
    </td></tr></table>
    <p style="color:#6b7280;font-size:14px;text-align:center;margin:20px 0 0">Te quedan <strong>${ctx.creditsLeft} créditos</strong> disponibles · Soporte en español por WhatsApp y email</p>
  </td></tr>
  <tr><td style="background:#f9fafb;padding:20px 36px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="color:#9ca3af;font-size:12px;margin:0">Maris AI · <a href="https://www.marisai.es" style="color:#7c3aed;text-decoration:none">marisai.es</a> · soporte@marisai.es</p>
    <p style="color:#d1d5db;font-size:11px;margin:6px 0 0"><a href="https://www.marisai.es/unsubscribe" style="color:#d1d5db">Cancelar suscripción</a></p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
  const text = `${ctx.userName.split(" ")[0]},\n\nLlevas una semana sin entrar a Maris AI. Tu app "${ctx.lastAppTitle}" te espera con ${ctx.creditsLeft} créditos disponibles.\n\nEn 5 minutos puedes añadir autenticación, conectar tu dominio o integrar pagos.\n\nVuelve aquí: https://www.marisai.es/dashboard\n\nEl equipo de Maris AI\nsoporte@marisai.es`;
  return { subject, html, text };
}

function emailDay14(ctx: ReactivationContext): { subject: string; html: string; text: string } {
  const subject = `${ctx.userName.split(" ")[0]}, tus créditos están ahí pero el tiempo pasa 💳`;
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <tr><td style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:32px 36px;text-align:center">
    <div style="font-size:40px;margin-bottom:12px">💳</div>
    <h1 style="color:#ffffff;font-size:22px;margin:0;font-weight:700">${ctx.creditsLeft} créditos sin usar</h1>
    <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:8px 0 0">Llevan 14 días esperándote, ${ctx.userName.split(" ")[0]}</p>
  </td></tr>
  <tr><td style="padding:36px">
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 20px">Hace dos semanas que no nos vemos. Tienes <strong>${ctx.creditsLeft} créditos</strong> en tu cuenta de Maris AI que podrían estar construyendo algo increíble para ti.</p>
    <div style="background:#fff1f2;border-radius:10px;padding:24px;margin:0 0 24px;text-align:center;border:1px solid #fecaca">
      <p style="color:#991b1b;font-size:28px;font-weight:800;margin:0">${ctx.creditsLeft} créditos</p>
      <p style="color:#dc2626;font-size:14px;margin:6px 0 0">disponibles en tu cuenta</p>
      <p style="color:#6b7280;font-size:13px;margin:12px 0 0">Con estos créditos puedes generar ${Math.floor(ctx.creditsLeft / 10)} apps completas o hacer decenas de ediciones en "${ctx.lastAppTitle}"</p>
    </div>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px">Si tienes alguna duda sobre cómo continuar, escríbenos directamente respondiendo a este email. Te ayudamos en español, sin bots.</p>
    <table width="100%"><tr><td align="center">
      <a href="https://www.marisai.es/dashboard" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;box-shadow:0 4px 12px rgba(220,38,38,0.3)">
        Usar mis créditos ahora →
      </a>
    </td></tr></table>
  </td></tr>
  <tr><td style="background:#f9fafb;padding:20px 36px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="color:#9ca3af;font-size:12px;margin:0">Maris AI · <a href="https://www.marisai.es" style="color:#7c3aed;text-decoration:none">marisai.es</a> · soporte@marisai.es</p>
    <p style="color:#d1d5db;font-size:11px;margin:6px 0 0"><a href="https://www.marisai.es/unsubscribe" style="color:#d1d5db">Cancelar suscripción</a></p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
  const text = `${ctx.userName.split(" ")[0]},\n\nLlevas 14 días sin entrar a Maris AI. Tienes ${ctx.creditsLeft} créditos disponibles que podrían estar construyendo algo increíble.\n\n¿Tienes dudas? Responde a este email directamente y te ayudamos en español.\n\nVuelve aquí: https://www.marisai.es/dashboard\n\nEl equipo de Maris AI\nsoporte@marisai.es`;
  return { subject, html, text };
}

function emailDay30(ctx: ReactivationContext): { subject: string; html: string; text: string } {
  const subject = `Un mes después... 🎁 Tenemos algo para ti, ${ctx.userName.split(" ")[0]}`;
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <tr><td style="background:linear-gradient(135deg,#059669,#047857);padding:32px 36px;text-align:center">
    <div style="font-size:40px;margin-bottom:12px">🎁</div>
    <h1 style="color:#ffffff;font-size:22px;margin:0;font-weight:700">Un mes sin vernos</h1>
    <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:8px 0 0">Y queremos que vuelvas con algo especial</p>
  </td></tr>
  <tr><td style="padding:36px">
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 20px">Hola ${ctx.userName.split(" ")[0]}, ha pasado un mes desde tu última visita a Maris AI. Mucho ha mejorado desde entonces.</p>
    <div style="background:#ecfdf5;border-radius:10px;padding:24px;margin:0 0 24px;border:1px solid #a7f3d0;text-align:center">
      <p style="color:#065f46;font-size:18px;font-weight:700;margin:0 0 8px">🎁 25 créditos gratis</p>
      <p style="color:#047857;font-size:14px;margin:0 0 16px">Te los hemos añadido a tu cuenta como bienvenida de vuelta</p>
      <p style="color:#6b7280;font-size:13px;margin:0">Úsalos para continuar "${ctx.lastAppTitle}" o empezar algo nuevo</p>
    </div>
    <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px"><strong>Novedades desde que te fuiste:</strong></p>
    <ul style="color:#374151;font-size:14px;line-height:2;margin:0 0 24px;padding-left:18px">
      <li>🏗️ Nuevo orquestador por hitos — apps más complejas sin fallos</li>
      <li>⚡ Generación hasta 3x más rápida</li>
      <li>🔗 Desplegamos directamente a tu dominio personalizado</li>
      <li>💬 Soporte mejorado por WhatsApp en horario ampliado</li>
    </ul>
    <table width="100%"><tr><td align="center">
      <a href="https://www.marisai.es/dashboard" style="display:inline-block;background:linear-gradient(135deg,#059669,#047857);color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;box-shadow:0 4px 12px rgba(5,150,105,0.3)">
        Volver y usar mis 25 créditos →
      </a>
    </td></tr></table>
    <p style="color:#9ca3af;font-size:13px;text-align:center;margin:20px 0 0">¿Quieres saber más sobre las novedades? Responde a este email.</p>
  </td></tr>
  <tr><td style="background:#f9fafb;padding:20px 36px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="color:#9ca3af;font-size:12px;margin:0">Maris AI · <a href="https://www.marisai.es" style="color:#7c3aed;text-decoration:none">marisai.es</a> · soporte@marisai.es</p>
    <p style="color:#d1d5db;font-size:11px;margin:6px 0 0"><a href="https://www.marisai.es/unsubscribe" style="color:#d1d5db">Cancelar suscripción</a></p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
  const text = `${ctx.userName.split(" ")[0]},\n\nHa pasado un mes. Te hemos añadido 25 créditos gratis como bienvenida de vuelta.\n\nMuchas cosas han mejorado en Maris AI: generación más rápida, orquestador por hitos, dominios personalizados.\n\nVuelve aquí: https://www.marisai.es/dashboard\n\nEl equipo de Maris AI\nsoporte@marisai.es`;
  return { subject, html, text };
}

// ─── Tick diario de reactivación ─────────────────────────────────────────────

export async function runReactivationTick(): Promise<void> {
  if (process.env.REACTIVATION_EMAILS_ENABLED !== "true") return;

  try {
    await connectDB();
    const now = new Date();
    const sent = { day3: 0, day7: 0, day14: 0, day30: 0, skipped: 0 };

    // Buscar usuarios con actividad previa que llevan días sin generar nada
    // Excluir: admins, bots, cuentas sin email verificado, cuentas de demo
    const inactiveUsers = await User.find({
      email: { $exists: true, $ne: "", $not: /demo|test|noreply|no-reply/i },
      createdAt: { $lt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) },
      // No enviar a quien explícitamente se ha dado de baja
      reactivationUnsubscribed: { $ne: true },
    })
      .select("_id email fullName credits createdAt reactivationEmailsSent")
      .lean() as any[];

    for (const user of inactiveUsers) {
      try {
        // Buscar la última actividad del usuario (último job generado)
        const lastJob = await GenerationJob.findOne({ userId: String(user._id) })
          .sort({ createdAt: -1 })
          .select("createdAt")
          .lean() as any;

        if (!lastJob) continue; // nunca generó — no es cliente activo

        const lastActivity = new Date(lastJob.createdAt);
        const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000));

        // Solo los rangos exactos (tolerancia de ±1 día para no enviar 2 emails)
        const emailsAlreadySent: string[] = user.reactivationEmailsSent || [];
        let emailToSend: "day3" | "day7" | "day14" | "day30" | null = null;

        if (daysSince >= 3 && daysSince <= 5 && !emailsAlreadySent.includes("day3")) emailToSend = "day3";
        else if (daysSince >= 7 && daysSince <= 9 && !emailsAlreadySent.includes("day7")) emailToSend = "day7";
        else if (daysSince >= 14 && daysSince <= 16 && !emailsAlreadySent.includes("day14")) emailToSend = "day14";
        else if (daysSince >= 30 && daysSince <= 32 && !emailsAlreadySent.includes("day30")) emailToSend = "day30";

        if (!emailToSend) { sent.skipped++; continue; }

        // Obtener la última app del usuario para contexto personalizado
        const lastApp = await GeneratedApp.findOne({ userId: String(user._id) })
          .sort({ createdAt: -1 })
          .select("title")
          .lean() as any;

        const ctx: ReactivationContext = {
          userEmail: user.email,
          userName: user.fullName || user.email.split("@")[0] || "amigo",
          lastAppTitle: lastApp?.title || "tu proyecto",
          creditsLeft: user.credits ?? 0,
          daysSinceLastActivity: daysSince,
          totalAppsGenerated: 0,
        };

        // Generar y enviar el email
        let emailContent: { subject: string; html: string; text: string };
        if (emailToSend === "day3") emailContent = emailDay3(ctx);
        else if (emailToSend === "day7") emailContent = emailDay7(ctx);
        else if (emailToSend === "day14") emailContent = emailDay14(ctx);
        else emailContent = emailDay30(ctx);

        const ok = await sendReactivationEmail({ to: user.email, ...emailContent });

        if (ok) {
          // Marcar como enviado + añadir 25 créditos en el email del día 30
          const updates: any = {
            $addToSet: { reactivationEmailsSent: emailToSend },
            $set: { lastReactivationEmailAt: now },
          };
          if (emailToSend === "day30") {
            updates.$inc = { credits: 25 };
          }
          await User.findByIdAndUpdate(user._id, updates);
          sent[emailToSend]++;
          log.info({ email: user.email, emailToSend, daysSince }, "Email de reactivación enviado");
        }

        // Respetar rate limits de Resend — máx 2 emails/segundo
        await new Promise((r) => setTimeout(r, 600));
      } catch (userErr) {
        log.warn({ err: userErr, userId: String(user._id) }, "Error procesando usuario para reactivación");
      }
    }

    if (sent.day3 + sent.day7 + sent.day14 + sent.day30 > 0) {
      log.info(sent, "Tick de reactivación completado");
    }
  } catch (err) {
    log.error({ err }, "runReactivationTick: error general");
  }
}
