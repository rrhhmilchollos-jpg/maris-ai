/**
 * affiliates.ts — Programa de afiliados de Maris AI
 *
 * Flujo completo:
 * 1. El usuario genera su código único en /api/affiliates/my-code
 * 2. Comparte el link marisai.es?ref=CÓDIGO
 * 3. El frontend guarda el ref en cookie/localStorage al aterrizar
 * 4. Al registrarse el nuevo usuario, POST /api/affiliates/track-signup
 *    guarda referredBy en su perfil
 * 5. Al pagar, el webhook de Viva.com llama a trackAffiliateCommission()
 *    que acredita el 30% al afiliado
 * 6. El afiliado ve sus comisiones en GET /api/affiliates/stats
 * 7. El afiliado solicita cobro con POST /api/affiliates/request-payout
 */

import { Router } from "express";
import { connectDB } from "../lib/db";
import { User, CreditTransaction } from "@workspace/db/schema";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import crypto from "crypto";

const router = Router();

export const AFFILIATE_COMMISSION_RATE = 0.30; // 30%
export const AFFILIATE_MIN_PAYOUT = 50; // 50€ mínimo para cobrar

// Generar código único de 8 caracteres alfanumérico
function generateCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// ── GET /api/affiliates/my-code ───────────────────────────────────────────────
// Devuelve (o crea) el código de afiliado del usuario actual
router.get("/my-code", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const user = await User.findById(req.userId).lean() as any;
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    if (user.referralCode) {
      return res.json({ code: user.referralCode, link: `https://www.marisai.es?ref=${user.referralCode}` });
    }

    // Generar código único
    let code = generateCode();
    let attempts = 0;
    while (await User.exists({ referralCode: code }) && attempts < 10) {
      code = generateCode();
      attempts++;
    }

    await User.findByIdAndUpdate(req.userId, { $set: { referralCode: code } });
    logger.info({ userId: req.userId, code }, "Affiliate: código generado");
    res.json({ code, link: `https://www.marisai.es?ref=${code}` });
  } catch (err: any) {
    logger.error({ err }, "affiliates/my-code error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── GET /api/affiliates/stats ─────────────────────────────────────────────────
// Estadísticas del afiliado: referidos, comisiones, cobros
router.get("/stats", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const user = await User.findById(req.userId).lean() as any;
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    // Contar referidos
    const totalReferrals = await User.countDocuments({ referredBy: req.userId });
    const paidReferrals = await User.countDocuments({ referredBy: req.userId, hasEverPaid: true });

    // Historial de comisiones (últimas 20)
    const commissions = await CreditTransaction.find({
      userId: req.userId,
      type: "affiliate_commission",
    }).sort({ createdAt: -1 }).limit(20).lean() as any[];

    res.json({
      code: user.referralCode || null,
      link: user.referralCode ? `https://www.marisai.es?ref=${user.referralCode}` : null,
      balance: user.affiliateBalance ?? 0,
      totalEarned: user.affiliateTotalEarned ?? 0,
      payoutRequested: user.affiliatePayoutRequested ?? false,
      totalReferrals,
      paidReferrals,
      minPayout: AFFILIATE_MIN_PAYOUT,
      commissionRate: AFFILIATE_COMMISSION_RATE,
      commissions: commissions.map((c: any) => ({
        amount: c.affiliateAmount,
        description: c.description,
        createdAt: c.createdAt,
      })),
    });
  } catch (err: any) {
    logger.error({ err }, "affiliates/stats error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── POST /api/affiliates/track-signup ────────────────────────────────────────
// Llamado al crear cuenta nueva cuando hay un ref en cookie/localStorage
// El frontend lo llama justo después del registro de Clerk
router.post("/track-signup", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const { referralCode } = req.body;
    if (!referralCode || typeof referralCode !== "string") {
      return res.json({ ok: false, reason: "No referral code" });
    }

    const user = await User.findById(req.userId).lean() as any;
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    // Ya tiene referido asignado
    if (user.referredBy) return res.json({ ok: false, reason: "Already tracked" });

    // No puede ser su propio código
    if (user.referralCode === referralCode.toUpperCase()) {
      return res.json({ ok: false, reason: "Own code" });
    }

    const referrer = await User.findOne({ referralCode: referralCode.toUpperCase() }).lean() as any;
    if (!referrer) return res.json({ ok: false, reason: "Code not found" });

    await User.findByIdAndUpdate(req.userId, { $set: { referredBy: String(referrer._id) } });
    logger.info({ userId: req.userId, referrerId: String(referrer._id), code: referralCode }, "Affiliate: signup tracked");
    res.json({ ok: true, referrerEmail: referrer.email?.replace(/(.{2}).*@/, "$1***@") });
  } catch (err: any) {
    logger.error({ err }, "affiliates/track-signup error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── POST /api/affiliates/request-payout ──────────────────────────────────────
// El afiliado solicita cobro de sus comisiones
router.post("/request-payout", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const user = await User.findById(req.userId).lean() as any;
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    const balance = user.affiliateBalance ?? 0;
    if (balance < AFFILIATE_MIN_PAYOUT) {
      return res.status(400).json({
        error: `Necesitas al menos ${AFFILIATE_MIN_PAYOUT}€ para solicitar el cobro. Tienes ${balance.toFixed(2)}€.`,
      });
    }
    if (user.affiliatePayoutRequested) {
      return res.status(400).json({ error: "Ya tienes una solicitud de cobro pendiente. Te contactaremos en 48h." });
    }

    const { paypalEmail, bankIban } = req.body;
    if (!paypalEmail && !bankIban) {
      return res.status(400).json({ error: "Indica tu email de PayPal o IBAN bancario para recibir el pago." });
    }

    await User.findByIdAndUpdate(req.userId, {
      $set: {
        affiliatePayoutRequested: true,
        affiliatePayoutData: { paypalEmail, bankIban, requestedAt: new Date(), amount: balance },
      },
    });

    logger.info({ userId: req.userId, balance, paypalEmail: !!paypalEmail, bankIban: !!bankIban }, "Affiliate: payout requested");
    res.json({ ok: true, message: `Solicitud de cobro de ${balance.toFixed(2)}€ recibida. Te contactaremos en las próximas 48 horas.` });
  } catch (err: any) {
    logger.error({ err }, "affiliates/request-payout error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── GET /api/admin/affiliates ─────────────────────────────────────────────────
// Panel admin: ver todos los afiliados y solicitudes de cobro pendientes
router.get("/admin/list", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const dbUser = await User.findById(req.userId).lean() as any;
    const { isAdminEmail } = await import("../lib/auth");
    if (!isAdminEmail(dbUser?.email)) return res.status(403).json({ error: "Forbidden" });

    const affiliates = await User.find({
      $or: [{ referralCode: { $exists: true, $ne: null } }, { affiliateTotalEarned: { $gt: 0 } }],
    }).select("email fullName referralCode affiliateBalance affiliateTotalEarned affiliatePayoutRequested createdAt").lean() as any[];

    const stats = await Promise.all(affiliates.map(async (a: any) => {
      const referrals = await User.countDocuments({ referredBy: String(a._id) });
      const paidReferrals = await User.countDocuments({ referredBy: String(a._id), hasEverPaid: true });
      return {
        id: String(a._id),
        email: a.email,
        name: a.fullName,
        code: a.referralCode,
        balance: a.affiliateBalance ?? 0,
        totalEarned: a.affiliateTotalEarned ?? 0,
        payoutRequested: a.affiliatePayoutRequested ?? false,
        referrals,
        paidReferrals,
      };
    }));

    res.json({ affiliates: stats });
  } catch (err: any) {
    logger.error({ err }, "admin/affiliates/list error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── POST /api/admin/affiliates/:id/approve-payout ────────────────────────────
// Admin marca el pago como enviado y resetea el balance
router.post("/admin/approve-payout/:id", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const dbUser = await User.findById(req.userId).lean() as any;
    const { isAdminEmail } = await import("../lib/auth");
    if (!isAdminEmail(dbUser?.email)) return res.status(403).json({ error: "Forbidden" });

    const affiliate = await User.findById(req.params.id).lean() as any;
    if (!affiliate) return res.status(404).json({ error: "Afiliado no encontrado" });

    const amount = affiliate.affiliateBalance ?? 0;
    await User.findByIdAndUpdate(req.params.id, {
      $set: { affiliateBalance: 0, affiliatePayoutRequested: false },
    });

    logger.info({ affiliateId: req.params.id, amount, adminId: req.userId }, "Admin: payout aprobado");
    res.json({ ok: true, amount, message: `Pago de ${amount.toFixed(2)}€ a ${affiliate.email} marcado como enviado.` });
  } catch (err: any) {
    logger.error({ err }, "admin/affiliates/approve-payout error");
    res.status(500).json({ error: "Error interno" });
  }
});

export default router;

/**
 * trackAffiliateCommission — llamado desde el webhook de Viva.com
 * cuando se confirma un pago de un usuario que fue referido por un afiliado.
 *
 * @param referredUserId — el userId del que pagó (el referido)
 * @param amountEuros — cantidad pagada en euros
 */
export async function trackAffiliateCommission(referredUserId: string, amountEuros: number): Promise<void> {
  try {
    await connectDB();
    const referredUser = await User.findById(referredUserId).select("referredBy email").lean() as any;
    if (!referredUser?.referredBy) return; // No tiene afiliado

    const commissionEuros = Math.round(amountEuros * AFFILIATE_COMMISSION_RATE * 100) / 100;
    if (commissionEuros <= 0) return;

    await User.findByIdAndUpdate(referredUser.referredBy, {
      $inc: { affiliateBalance: commissionEuros, affiliateTotalEarned: commissionEuros },
    });

    // Registrar la transacción para el historial del afiliado
    await CreditTransaction.create({
      userId: referredUser.referredBy,
      type: "affiliate_commission",
      credits: 0, // No son créditos, son euros
      affiliateAmount: commissionEuros,
      description: `Comisión 30% por pago de ${referredUser.email?.replace(/(.{3}).*@/, "$1***@")} — ${commissionEuros.toFixed(2)}€`,
      relatedUserId: referredUserId,
    });

    logger.info({
      referrerId: referredUser.referredBy,
      referredUserId,
      amountEuros,
      commissionEuros,
    }, "Affiliate: comisión acreditada");
  } catch (err) {
    logger.error({ err, referredUserId, amountEuros }, "trackAffiliateCommission error");
  }
}
