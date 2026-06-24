/**
 * notify.ts — Sistema de notificaciones de Maris AI
 *
 * Envía emails via Resend a los admins cuando hay problemas urgentes:
 *  - Generación fallida de un cliente
 *  - Error de recarga de créditos
 *  - Ticket de soporte nuevo
 *  - Job zombie repetido
 *
 * Destinatarios admin: ADMIN_ALERT_EMAILS (var de entorno, separados por coma)
 * Default: soportemarisai@gmail.com, rrhh.milchollos@gmail.com
 */
import type { Logger } from "pino";
import pino from "pino";

const log = pino({ name: "notify" });

// ─── Destinatarios admin ─────────────────────────────────────────────────────

function getAdminEmails(): string[] {
  const env = process.env.ADMIN_ALERT_EMAILS;
  if (env) return env.split(",").map(e => e.trim()).filter(Boolean);
  return ["soportemarisai@gmail.com", "rrhh.milchollos@gmail.com"];
}

// ─── Envío base via Resend ───────────────────────────────────────────────────

async function sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    log.warn({ subject: opts.subject }, "notify: RESEND_API_KEY no configurada — email no enviado");
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "Maris AI Alertas <alertas@marisai.es>",
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      log.warn({ status: res.status, err, subject: opts.subject }, "notify: Resend error");
      return false;
    }
    log.info({ to: opts.to, subject: opts.subject }, "notify: email enviado ✅");
    return true;
  } catch (err) {
    log.warn({ err, subject: opts.subject }, "notify: excepción enviando email");
    return false;
  }
}

// ─── Template HTML base ───────────────────────────────────────────────────────

function alertHtml(opts: {
  emoji: string;
  title: string;
  urgency: "🔴 URGENTE" | "🟡 AVISO" | "🟢 INFO";
  fields: Array<{ label: string; value: string }>;
  actionUrl?: string;
  actionLabel?: string;
}): string {
  const urgencyColor = opts.urgency.includes("URGENTE") ? "#ef4444" : opts.urgency.includes("AVISO") ? "#f59e0b" : "#10b981";
  const fields = opts.fields.map(f =>
    `<tr><td style="padding:4px 12px 4px 0;color:#9ca3af;font-size:13px;white-space:nowrap">${f.label}</td><td style="padding:4px 0;color:#f3f4f6;font-size:13px">${f.value}</td></tr>`
  ).join("");
  const action = opts.actionUrl
    ? `<p style="margin:20px 0 0"><a href="${opts.actionUrl}" style="background:#7c3aed;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">${opts.actionLabel || "Ver en panel"}</a></p>`
    : "";
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,sans-serif">
<div style="max-width:540px;margin:32px auto;background:#111;border:1px solid #222;border-radius:12px;overflow:hidden">
  <div style="background:${urgencyColor}20;border-bottom:1px solid ${urgencyColor}30;padding:16px 24px;display:flex;align-items:center;gap:12px">
    <span style="font-size:24px">${opts.emoji}</span>
    <div>
      <div style="color:${urgencyColor};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">${opts.urgency}</div>
      <div style="color:#f3f4f6;font-size:15px;font-weight:600;margin-top:2px">${opts.title}</div>
    </div>
  </div>
  <div style="padding:20px 24px">
    <table style="width:100%;border-collapse:collapse">${fields}</table>
    ${action}
  </div>
  <div style="padding:12px 24px;border-top:1px solid #222;color:#4b5563;font-size:11px">
    Maris AI · Panel admin: <a href="https://www.marisai.es/admin" style="color:#7c3aed">marisai.es/admin</a>
  </div>
</div></body></html>`;
}

// ─── Notificaciones al admin ─────────────────────────────────────────────────

/**
 * Generación fallida — se llama cuando un job termina en error
 */
export async function notifyAdminJobFailed(opts: {
  userEmail: string;
  userId: string;
  jobId: string;
  appId?: string;
  prompt: string;
  errorMessage?: string;
  retryCount?: number;
}): Promise<void> {
  const { userEmail, userId, jobId, appId, prompt, errorMessage, retryCount = 0 } = opts;
  // Notificar desde el primer fallo — el admin debe saber inmediatamente
  if (retryCount < 1) return;

  const cleanPrompt = prompt.replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/, "").slice(0, 200);
  const panelUrl = `https://www.marisai.es/admin`;
  const jobDirectUrl = `https://www.marisai.es/admin?jobId=${jobId}`;

  await sendEmail({
    to: getAdminEmails(),
    subject: `🔴 Generación fallida x${retryCount} — ${userEmail}`,
    html: alertHtml({
      emoji: "⚠️",
      title: `Generación fallida repetida`,
      urgency: "🔴 URGENTE",
      fields: [
        { label: "📧 Email cliente", value: `<strong>${userEmail}</strong>` },
        { label: "🆔 User ID", value: userId },
        { label: "🔁 Intentos fallidos", value: `<strong style="color:#ef4444">${retryCount}x</strong>` },
        { label: "📝 Prompt", value: cleanPrompt + (prompt.length > 200 ? "…" : "") },
        { label: "❌ Error", value: `<code style="color:#f87171;font-size:12px">${(errorMessage || "desconocido").slice(0, 300)}</code>` },
        { label: "🔧 Job ID", value: `<code style="font-size:11px">${jobId}</code>` },
        ...(appId ? [{ label: "📦 App ID", value: `<code style="font-size:11px">${appId}</code>` }] : []),
        { label: "🕐 Hora (España)", value: new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "medium" }) },
      ],
      actionUrl: panelUrl,
      actionLabel: "🔍 Ir al panel admin",
    }),
    text: `🔴 URGENTE: Generación fallida x${retryCount}\n\nCliente: ${userEmail}\nUser ID: ${userId}\nJob ID: ${jobId}\n${appId ? `App ID: ${appId}\n` : ""}Prompt: ${cleanPrompt}\nError: ${errorMessage || "desconocido"}\n\nPanel: ${panelUrl}`,
  });
}

/**
 * Error de pago/créditos — fallo en recarga o webhook Stripe
 */
export async function notifyAdminPaymentError(opts: {
  userEmail?: string;
  userId?: string;
  event: string;
  error: string;
  stripeSessionId?: string;
}): Promise<void> {
  const { userEmail, event, error, stripeSessionId } = opts;

  await sendEmail({
    to: getAdminEmails(),
    subject: `🔴 Error de pago — ${userEmail || "usuario desconocido"}`,
    html: alertHtml({
      emoji: "💳",
      title: "Error en proceso de pago",
      urgency: "🔴 URGENTE",
      fields: [
        { label: "Cliente", value: userEmail || "(desconocido)" },
        { label: "Evento", value: event },
        { label: "Error", value: error.slice(0, 300) },
        { label: "Stripe Session", value: stripeSessionId || "—" },
        { label: "Hora", value: new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) },
      ],
      actionUrl: "https://dashboard.stripe.com",
      actionLabel: "Ver en Stripe",
    }),
    text: `ERROR DE PAGO\nCliente: ${userEmail}\nEvento: ${event}\nError: ${error}`,
  });
}

/**
 * Nuevo ticket de soporte
 */
export async function notifyAdminSupportTicket(opts: {
  userEmail?: string;
  subject: string;
  message: string;
  ticketId: string;
}): Promise<void> {
  const { userEmail, subject, message, ticketId } = opts;

  await sendEmail({
    to: getAdminEmails(),
    subject: `🎫 Ticket soporte: ${subject}`,
    html: alertHtml({
      emoji: "🎫",
      title: `Nuevo ticket de soporte`,
      urgency: "🟡 AVISO",
      fields: [
        { label: "Cliente", value: userEmail || "(desconocido)" },
        { label: "Asunto", value: subject },
        { label: "Mensaje", value: message.slice(0, 400) },
        { label: "Ticket ID", value: ticketId },
        { label: "Hora", value: new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) },
      ],
      actionUrl: "https://www.marisai.es/admin",
      actionLabel: "Ver en panel admin",
    }),
    text: `TICKET SOPORTE\nCliente: ${userEmail}\nAsunto: ${subject}\nMensaje: ${message}\nID: ${ticketId}`,
  });
}

/**
 * Usuario nuevo registrado (info)
 */
export async function notifyAdminNewUser(opts: {
  userEmail: string;
  userId: string;
}): Promise<void> {
  await sendEmail({
    to: getAdminEmails(),
    subject: `🟢 Nuevo usuario — ${opts.userEmail}`,
    html: alertHtml({
      emoji: "👤",
      title: "Nuevo usuario registrado",
      urgency: "🟢 INFO",
      fields: [
        { label: "Email", value: opts.userEmail },
        { label: "ID", value: opts.userId },
        { label: "Hora", value: new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) },
      ],
      actionUrl: "https://www.marisai.es/admin",
    }),
    text: `Nuevo usuario: ${opts.userEmail} (${opts.userId})`,
  });
}

// ─── Notificaciones de actividad de usuarios (tiempo real) ───────────────────

export async function notifyAdminUserActivity(opts: {
  event: string;
  emoji: string;
  userEmail: string;
  userId: string;
  details?: Record<string, string>;
}): Promise<void> {
  const { event, emoji, userEmail, userId, details = {} } = opts;
  const hora = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
  const fields = [
    { label: "Email", value: userEmail },
    { label: "ID", value: userId },
    { label: "Hora", value: hora },
    ...Object.entries(details).map(([label, value]) => ({ label, value })),
  ];
  await sendEmail({
    to: getAdminEmails(),
    subject: `${emoji} ${event} — ${userEmail}`,
    html: alertHtml({ emoji, title: event, urgency: "📡 ACTIVIDAD", fields, actionUrl: "https://www.marisai.es/admin" }),
    text: `${event}: ${userEmail} (${userId}) — ${hora}`,
  });
}

export async function notifyAdminUserDeleted(opts: { userEmail: string; userId: string }): Promise<void> {
  await notifyAdminUserActivity({ event: "Usuario eliminó su cuenta", emoji: "🗑️", ...opts });
}

export async function notifyAdminUserUpdated(opts: { userEmail: string; userId: string; changes: string }): Promise<void> {
  await notifyAdminUserActivity({ event: "Usuario actualizó su perfil", emoji: "✏️", ...opts, details: { Cambios: opts.changes } });
}

export async function notifyAdminPaymentSuccess(opts: { userEmail: string; userId: string; credits: number; amount?: string }): Promise<void> {
  await notifyAdminUserActivity({
    event: "💳 Pago recibido — créditos comprados",
    emoji: "💰",
    ...opts,
    details: { Créditos: `+${opts.credits}`, Importe: opts.amount || "—" },
  });
}

export async function notifyAdminSubscriptionRenewed(opts: { userEmail: string; userId: string; plan: string; credits: number }): Promise<void> {
  await notifyAdminUserActivity({
    event: "🔄 Suscripción renovada",
    emoji: "🔄",
    ...opts,
    details: { Plan: opts.plan, Créditos: `${opts.credits}/mes` },
  });
}

export async function notifyAdminAppGenerated(opts: { userEmail: string; userId: string; appTitle: string; credits: number }): Promise<void> {
  await notifyAdminUserActivity({
    event: "🚀 App generada por usuario",
    emoji: "🚀",
    ...opts,
    details: { App: opts.appTitle, "Créditos usados": String(opts.credits) },
  });
}

export async function notifyAdminAppDeployed(opts: { userEmail: string; userId: string; appTitle: string; url: string }): Promise<void> {
  await notifyAdminUserActivity({
    event: "🌐 App desplegada",
    emoji: "🌐",
    ...opts,
    details: { App: opts.appTitle, URL: opts.url },
  });
}

export async function notifyAdminCreditsLow(opts: { userEmail: string; userId: string; creditsLeft: number }): Promise<void> {
  if (opts.creditsLeft > 3) return; // Solo avisar cuando quedan muy pocos
  await notifyAdminUserActivity({
    event: "⚠️ Usuario con pocos créditos",
    emoji: "⚠️",
    ...opts,
    details: { "Créditos restantes": String(opts.creditsLeft) },
  });
}

// ─── Notificaciones al usuario ────────────────────────────────────────────────

/**
 * Email de disculpas al cliente — se envía desde el panel admin
 * cuando un proyecto ha tenido problemas y ya está resuelto
 */
export async function sendApologyEmail(opts: {
  userEmail: string;
  userName?: string;
  appTitle?: string;
  dashboardUrl?: string;
  creditsCompensation?: number;
}): Promise<boolean> {
  const { userEmail, userName, appTitle, dashboardUrl = "https://www.marisai.es/dashboard", creditsCompensation = 0 } = opts;
  const firstName = userName ? userName.split(" ")[0] : null;
  const greeting = firstName ? `Hola ${firstName},` : "Hola,";
  const appDesc = appTitle ? `tu app <strong style="color:#f3f4f6">"${appTitle}"</strong>` : "tu proyecto";
  const appDescPlain = appTitle ? `"${appTitle}"` : "tu proyecto";
  const creditsBlock = creditsCompensation > 0 ? `
    <div style="background:linear-gradient(135deg,#7c3aed15,#a855f715);border:1px solid #7c3aed40;border-radius:10px;padding:18px 20px;margin:20px 0;display:flex;align-items:center;gap:14px">
      <div style="font-size:28px;line-height:1">🎁</div>
      <div>
        <div style="color:#a78bfa;font-weight:700;font-size:14px;margin-bottom:3px">+${creditsCompensation} créditos añadidos a tu cuenta</div>
        <div style="color:#9ca3af;font-size:13px">Como compensación por las molestias, hemos añadido créditos extra para que puedas seguir creando sin límites.</div>
      </div>
    </div>` : "";

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#09090f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#09090f;padding:40px 16px">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

      <!-- LOGO -->
      <tr><td style="padding-bottom:28px;text-align:center">
        <div style="display:inline-flex;align-items:center;gap:8px">
          <div style="width:32px;height:32px;background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;line-height:32px;text-align:center">✦</div>
          <span style="color:#f3f4f6;font-size:18px;font-weight:700;letter-spacing:-0.3px">Maris AI</span>
        </div>
      </td></tr>

      <!-- CARD PRINCIPAL -->
      <tr><td style="background:#111118;border:1px solid #1f1f2e;border-radius:16px;overflow:hidden">

        <!-- HEADER GRADIENTE -->
        <div style="background:linear-gradient(135deg,#7c3aed22 0%,#0ea5e915 50%,#10b98112 100%);border-bottom:1px solid #1f1f2e;padding:36px 36px 28px">
          <div style="font-size:42px;margin-bottom:14px;line-height:1">✅</div>
          <div style="color:#f3f4f6;font-size:22px;font-weight:800;letter-spacing:-0.5px;line-height:1.3;margin-bottom:6px">
            Tu app está lista y funciona perfectamente
          </div>
          <div style="color:#6b7280;font-size:14px">Nuestro equipo de soporte ha resuelto el problema</div>
        </div>

        <!-- BODY -->
        <div style="padding:32px 36px;color:#9ca3af;font-size:14px;line-height:1.8">

          <p style="margin:0 0 16px;color:#d1d5db">${greeting}</p>

          <p style="margin:0 0 16px">En primer lugar, queremos pedirte <strong style="color:#f3f4f6">disculpas sinceras</strong> por la experiencia que has tenido. Sabemos que tu tiempo es valioso y que confiar en Maris AI para construir ${appDesc} es algo que nos tomamos muy en serio.</p>

          <p style="margin:0 0 20px">Nuestro equipo de soporte ha revisado el problema, aplicado las correcciones necesarias y verificado que todo funciona correctamente. <strong style="color:#10b981">${appDesc} ya está disponible en tu panel</strong>, lista para que la explores, edites y publiques.</p>

          <!-- STATUS BOX -->
          <div style="background:#10b98108;border:1px solid #10b98125;border-radius:10px;padding:16px 20px;margin:0 0 20px">
            <div style="color:#10b981;font-weight:600;font-size:13px;margin-bottom:6px;display:flex;align-items:center;gap:6px">
              <span>●</span> Estado del proyecto
            </div>
            <div style="color:#d1d5db;font-size:13px">
              ${appTitle ? `"${appTitle}"` : "Tu proyecto"} — <span style="color:#10b981;font-weight:600">Activo y listo para usar</span>
            </div>
          </div>

          ${creditsBlock}

          <!-- CTA -->
          <div style="text-align:center;margin:28px 0">
            <a href="${dashboardUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:-0.2px;box-shadow:0 4px 24px #7c3aed40">
              Ver mi app en el panel →
            </a>
          </div>

          <!-- FEATURES -->
          <div style="background:#ffffff06;border:1px solid #1f1f2e;border-radius:10px;padding:20px;margin:0 0 24px">
            <div style="color:#f3f4f6;font-weight:600;font-size:13px;margin-bottom:14px">Con Maris AI puedes seguir:</div>
            <div style="display:grid;gap:10px">
              <div style="color:#9ca3af;font-size:13px">🚀 <strong style="color:#d1d5db">Generando nuevas apps</strong> — desde landing pages hasta apps completas con backend</div>
              <div style="color:#9ca3af;font-size:13px">✏️ <strong style="color:#d1d5db">Editando con IA</strong> — pide cualquier cambio en lenguaje natural</div>
              <div style="color:#9ca3af;font-size:13px">🌐 <strong style="color:#d1d5db">Publicando en segundos</strong> — despliegue automático a Vercel con un clic</div>
              <div style="color:#9ca3af;font-size:13px">💜 <strong style="color:#d1d5db">Soporte prioritario</strong> — responde a este email y te atendemos de inmediato</div>
            </div>
          </div>

          <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Si tienes cualquier otra duda o necesitas ayuda adicional, no dudes en abrir un ticket de soporte desde tu panel — estaremos encantados de ayudarte.</p>

          <p style="margin:20px 0 0;color:#d1d5db">Gracias de corazón por confiar en Maris AI. 💜<br>
          <span style="color:#6b7280">— El equipo de soporte de Maris AI</span></p>
        </div>

        <!-- FOOTER -->
        <div style="border-top:1px solid #1f1f2e;padding:16px 36px;background:#0d0d15">
          <div style="color:#374151;font-size:11px;text-align:center">
            Maris AI · <a href="https://www.marisai.es" style="color:#7c3aed;text-decoration:none">marisai.es</a>
            · <a href="https://www.marisai.es/dashboard" style="color:#7c3aed;text-decoration:none">Panel</a>
            · Soporte: <a href="mailto:soportemarisai@gmail.com" style="color:#7c3aed;text-decoration:none">soportemarisai@gmail.com</a>
          </div>
        </div>

      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return sendEmail({
    to: [userEmail],
    subject: `✅ ${appTitle ? '"' + appTitle + '" lista' : "Tu app está lista"} — problema resuelto por soporte`,
    html,
    text: `${greeting}\n\nQueremos pedirte disculpas sinceras por los problemas que experimentaste. ${appDescPlain} ya está lista y disponible en tu panel.${creditsCompensation > 0 ? "\n\nComo compensación hemos añadido " + creditsCompensation + " créditos a tu cuenta." : ""}\n\nAccede aquí: ${dashboardUrl}\n\nGracias por confiar en Maris AI.\n\nEl equipo de Maris AI`,
  });
}

export async function sendAutoPublishEmail(opts: {
  to: string | null; recipientName: string | null;
  appTitle: string; url: string; log: Logger;
}): Promise<void> {
  if (!opts.to) return;
  const greeting = opts.recipientName ? `Hola ${opts.recipientName.split(" ")[0]},` : "Hola,";
  await sendEmail({
    to: [opts.to],
    subject: `🚀 ${opts.appTitle} ya está publicada`,
    html: alertHtml({
      emoji: "🚀", title: `${opts.appTitle} ya está publicada`, urgency: "🟢 INFO",
      fields: [{ label: "URL", value: opts.url }],
      actionUrl: opts.url, actionLabel: "Ver tu app",
    }),
    text: `${greeting}\n\nTu app "${opts.appTitle}" está publicada: ${opts.url}\n\n— Maris AI`,
  });
}

export async function sendNeedsReviewEmail(opts: {
  to: string | null; recipientName: string | null;
  appTitle: string; summary: string; log: Logger;
}): Promise<void> {
  if (!opts.to) return;
  await sendEmail({
    to: [opts.to],
    subject: `⚠️ ${opts.appTitle}: revisión necesaria`,
    html: alertHtml({
      emoji: "⚠️", title: `Revisión necesaria`, urgency: "🟡 AVISO",
      fields: [
        { label: "App", value: opts.appTitle },
        { label: "Resumen", value: opts.summary.slice(0, 300) },
      ],
      actionUrl: "https://www.marisai.es/dashboard", actionLabel: "Ir al panel",
    }),
    text: `Tu app "${opts.appTitle}" necesita revisión.\n\n${opts.summary}\n\n— Maris AI`,
  });
}

export async function sendSupportTicketCreatedEmail(opts: {
  to: string | null; userEmail?: string | null;
  subject: string; message: string; ticketId: string; log: Logger;
}): Promise<void> {
  // Notificar también a los admins
  await notifyAdminSupportTicket({
    userEmail: opts.userEmail || undefined,
    subject: opts.subject,
    message: opts.message,
    ticketId: opts.ticketId,
  });
}
