/**
 * Outbound notifications (Task #11).
 *
 * AppForge does not currently have an email provider wired up — Resend is
 * mentioned in the architect prompt as the preferred service but no
 * credentials are configured. Rather than block auto-publish on that
 * integration, we expose a thin facade here that LOGS the email contents in
 * a structured, grep-friendly way and returns. The day a real provider lands
 * (Resend, SendGrid, SES, …) it slots in here without touching the
 * evaluator. See replit.md → "Notificaciones (pendiente de email provider)".
 *
 * Structured log shape (deliberately stable so an external pipeline can pick
 * it up without parsing free-form messages):
 *   level=info msg="📬 email_pending" channel="email" template=<...> ...
 */
import type { Logger } from "pino";

type EmailRecipient = {
  to: string | null;
  recipientName: string | null;
};

type EmailLogPayload = {
  channel: "email";
  template: "auto_publish_ready" | "needs_review";
  to: string | null;
  recipientName: string | null;
  subject: string;
  bodyText: string;
};

function emit(log: Logger, payload: EmailLogPayload): void {
  // We intentionally use the `msg: "📬 email_pending"` literal so a future
  // grep/Loki query has a single anchor to filter on.
  if (!payload.to) {
    log.warn(
      payload,
      "📬 email_pending — no recipient address; falling back to log-only delivery",
    );
    return;
  }
  log.info(payload, "📬 email_pending");
}

/**
 * Notify the owner of an app that the autonomous evaluator approved their
 * generation and the app is now public at `url`.
 */
export async function sendAutoPublishEmail(opts: EmailRecipient & {
  appTitle: string;
  url: string;
  log: Logger;
}): Promise<void> {
  const { to, recipientName, appTitle, url, log } = opts;
  const greeting = recipientName ? `Hola ${recipientName.split(" ")[0]},` : "Hola,";
  const body =
    `${greeting}\n\n` +
    `Tu app "${appTitle}" pasó la evaluación visual y la he publicado por ti.\n\n` +
    `Ya está disponible aquí: ${url}\n\n` +
    `Comparte el enlace con quien quieras. Si necesitas seguir editando, ` +
    `entra al panel y la próxima vez que termines un cambio se volverá a ` +
    `desplegar sola.\n\n` +
    `— AppForge`;
  emit(log, {
    channel: "email",
    template: "auto_publish_ready",
    to,
    recipientName,
    subject: `🚀 ${appTitle} ya está publicada`,
    bodyText: body,
  });
}

/**
 * Notify the owner that the evaluator could not approve their app after the
 * retry budget; the app is now in needs_review state and waiting for them.
 */
export async function sendNeedsReviewEmail(opts: EmailRecipient & {
  appTitle: string;
  summary: string;
  log: Logger;
}): Promise<void> {
  const { to, recipientName, appTitle, summary, log } = opts;
  const greeting = recipientName ? `Hola ${recipientName.split(" ")[0]},` : "Hola,";
  const body =
    `${greeting}\n\n` +
    `Tu app "${appTitle}" no pasó la evaluación visual automática y no la he ` +
    `publicado.\n\nResumen del evaluador:\n${summary}\n\n` +
    `Entra al panel y pulsa "Reintentar generación" cuando quieras volver a ` +
    `intentarlo.\n\n— AppForge`;
  emit(log, {
    channel: "email",
    template: "needs_review",
    to,
    recipientName,
    subject: `⚠️ ${appTitle}: la evaluación visual la rechazó`,
    bodyText: body,
  });
}
