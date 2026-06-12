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
  // Solo notificar si ha fallado más de 2 veces (evitar spam por fallos normales)
  if (retryCount < 2) return;

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

// ─── Notificaciones al usuario ────────────────────────────────────────────────

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
