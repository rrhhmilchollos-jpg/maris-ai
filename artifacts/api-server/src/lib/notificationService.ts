/**
 * notificationService.ts — Alertas al CLIENTE sobre su consumo de créditos
 * (distinto de notify.ts, que avisa a los ADMINS de Maris AI).
 *
 * Reutiliza el sistema de notificaciones que YA EXISTE (UserNotification +
 * la campanita del layout, GET /api/notifications) — no se crea ningún
 * canal nuevo. Solo se añaden 3 disparadores nuevos, todos de solo lectura
 * respecto al saldo (nunca modifican créditos, solo avisan):
 *
 *  - checkLowBalance: saldo total bajó de 20 créditos.
 *  - checkSpikeRate: se han gastado más de 15 créditos en los últimos 5 min.
 *  - runExpirationNotificationsTick: al plan le quedan ≤48h para renovar
 *    (tick diario, mismo patrón que lib/freeCreditsRenewal.ts).
 */
import { User, CreditTransaction, UserNotification } from "@workspace/db/schema";
import { logger } from "./logger";

const LOW_BALANCE_THRESHOLD = 20;
const SPIKE_THRESHOLD_CREDITS = 15;
const SPIKE_WINDOW_MS = 5 * 60 * 1000;
// Evita spamear al cliente con la misma alerta una y otra vez mientras
// sigue por debajo del umbral / sigue gastando rápido.
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

async function alreadyNotifiedRecently(userId: string, type: string, withinMs: number): Promise<boolean> {
  const since = new Date(Date.now() - withinMs);
  const existing = await UserNotification.exists({ userId, type, createdAt: { $gte: since } });
  return !!existing;
}

/** Llamar justo después de un chargeCredits() exitoso, con el saldo ya actualizado. */
export async function checkLowBalance(userId: string, newBalance: number): Promise<void> {
  try {
    if (newBalance >= LOW_BALANCE_THRESHOLD) return;
    if (await alreadyNotifiedRecently(userId, "low_balance", DEDUPE_WINDOW_MS)) return;
    await UserNotification.create({
      userId,
      type: "low_balance",
      message: `Te quedan ${newBalance} créditos. Recarga para seguir generando sin interrupciones.`,
    });
  } catch (err) {
    logger.warn({ err, userId }, "[notificationService] checkLowBalance error (no bloqueante)");
  }
}

/** Llamar justo después de un chargeCredits() exitoso (mismo call site que checkLowBalance). */
export async function checkSpikeRate(userId: string): Promise<void> {
  try {
    if (await alreadyNotifiedRecently(userId, "credit_spike", DEDUPE_WINDOW_MS)) return;
    const since = new Date(Date.now() - SPIKE_WINDOW_MS);
    const recentUsage = await CreditTransaction.aggregate([
      { $match: { userId, kind: "usage", createdAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: { $abs: "$amount" } } } },
    ]);
    const totalSpent = recentUsage[0]?.total ?? 0;
    if (totalSpent < SPIKE_THRESHOLD_CREDITS) return;
    await UserNotification.create({
      userId,
      type: "credit_spike",
      message: `Se han gastado ${Math.round(totalSpent * 100) / 100} créditos en los últimos 5 minutos — un agente está trabajando intensamente en tu proyecto.`,
    });
  } catch (err) {
    logger.warn({ err, userId }, "[notificationService] checkSpikeRate error (no bloqueante)");
  }
}

/** Llamado por runTopUpExpirationTick (credits.ts) justo después de expirar el saldo top-up. */
export async function notifyTopUpExpired(userId: string, creditsLost: number): Promise<void> {
  try {
    await UserNotification.create({
      userId,
      type: "topup_expired",
      message: `${creditsLost} créditos de recarga caducaron (pasaron 30 días desde la compra).`,
    });
  } catch (err) {
    logger.warn({ err, userId }, "[notificationService] notifyTopUpExpired error (no bloqueante)");
  }
}

/** Tick diario — mismo patrón que runFreeCreditsRenewalTick / runRecurringBillingTick. */
export async function runExpirationNotificationsTick(): Promise<void> {
  try {
    const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const now = new Date();
    const users = await User.find(
      { plan: { $ne: "free" }, planExpiresAt: { $gte: now, $lte: in48h } },
      { _id: 1, planExpiresAt: 1 },
    ).lean();

    for (const u of users) {
      const alreadySent = await alreadyNotifiedRecently(String(u._id), "credit_expiring", 24 * 60 * 60 * 1000);
      if (alreadySent) continue;
      await UserNotification.create({
        userId: String(u._id),
        type: "credit_expiring",
        message: `Tu plan se renueva el ${new Date((u as any).planExpiresAt).toLocaleDateString("es-ES")}.`,
      });
    }

    // Aviso de créditos de recarga a punto de caducar (30 días desde la
    // compra) — mismo umbral de 48h, notificación distinta para no
    // confundir "se renueva tu plan" con "vas a perder saldo de recarga".
    const topUpUsers = await User.find(
      { topUpCreditsExpiresAt: { $gte: now, $lte: in48h }, credits: { $gt: 0 } },
      { _id: 1, topUpCreditsExpiresAt: 1, credits: 1, planCredits: 1 },
    ).lean();
    for (const u of topUpUsers) {
      const topUpPortion = Math.max(0, (u.credits ?? 0) - ((u as any).planCredits ?? 0));
      if (topUpPortion <= 0) continue;
      const alreadySent = await alreadyNotifiedRecently(String(u._id), "topup_expiring_soon", 24 * 60 * 60 * 1000);
      if (alreadySent) continue;
      await UserNotification.create({
        userId: String(u._id),
        type: "topup_expiring_soon",
        message: `Te quedan ${Math.round(topUpPortion * 100) / 100} créditos de recarga que caducan el ${new Date((u as any).topUpCreditsExpiresAt).toLocaleDateString("es-ES")}. Úsalos antes para no perderlos.`,
      });
    }

    logger.info({ count: users.length, topUpCount: topUpUsers.length }, "[notificationService] runExpirationNotificationsTick done");
  } catch (err) {
    logger.error({ err }, "[notificationService] runExpirationNotificationsTick error");
  }
}
