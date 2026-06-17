/**
 * DOMINO Chain - Sistema Económico
 * Monetización para la plataforma + Recompensas para usuarios
 */

// ============================================================================
// TIPOS Y INTERFACES
// ============================================================================

export interface EconomyConfig {
  // Recompensas para usuarios
  kindnessCreditsMultiplier: number; // Multiplicador base de créditos
  premiumMultiplier: number; // Multiplicador para usuarios premium
  
  // Monetización de la plataforma
  platformCommissionPercentage: number; // % de comisión en transacciones
  premiumSubscriptionPrice: number; // Precio mensual de suscripción premium
  
  // Conversión de créditos a dinero real
  kindnessCreditsToUSD: number; // 1 crédito = X USD
  minimumWithdrawal: number; // Mínimo para retirar dinero
  
  // Bonificaciones y promociones
  referralBonus: number; // Bonus por referir a un amigo
  streakBonus: number; // Bonus por mantener racha
  weeklyChallengeBudget: number; // Presupuesto semanal para retos
}

export interface UserEconomyProfile {
  userId: string;
  kindnessCredits: number;
  usdBalance: number;
  totalEarned: number;
  totalSpent: number;
  isPremium: boolean;
  premiumExpiresAt?: Date;
  referralCode: string;
  referrals: number;
  streak: number;
  lastChallengeDate: Date;
  withdrawalHistory: Withdrawal[];
  transactionHistory: Transaction[];
}

export interface Transaction {
  id: string;
  type: 'challenge_completion' | 'referral' | 'premium_purchase' | 'withdrawal' | 'bonus' | 'purchase';
  amount: number;
  currency: 'kindness_credits' | 'usd';
  description: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface Withdrawal {
  id: string;
  amount: number;
  method: 'bank_transfer' | 'paypal' | 'stripe';
  status: 'pending' | 'completed' | 'failed';
  requestedAt: Date;
  completedAt?: Date;
  failureReason?: string;
}

export interface PlatformMetrics {
  totalUsersActive: number;
  totalKindnessCreditsIssued: number;
  totalPlatformEarnings: number;
  totalUserWithdrawals: number;
  averageUserEarnings: number;
  premiumSubscribers: number;
}

// ============================================================================
// CONFIGURACIÓN POR DEFECTO
// ============================================================================

export const DEFAULT_ECONOMY_CONFIG: EconomyConfig = {
  // Recompensas para usuarios
  kindnessCreditsMultiplier: 1.0,
  premiumMultiplier: 1.5, // Los usuarios premium ganan 50% más

  // Monetización de la plataforma
  platformCommissionPercentage: 15, // La plataforma se queda con el 15% de cada transacción
  premiumSubscriptionPrice: 9.99, // $9.99 USD/mes

  // Conversión de créditos a dinero real
  kindnessCreditsToUSD: 0.01, // 1 crédito = $0.01 USD (100 créditos = $1)
  minimumWithdrawal: 1000, // Mínimo 1000 créditos ($10) para retirar

  // Bonificaciones
  referralBonus: 500, // 500 créditos por cada referral exitoso
  streakBonus: 100, // 100 créditos bonus por cada día de racha
  weeklyChallengeBudget: 50000, // $500 USD/semana para distribuir en retos
};

// ============================================================================
// CÁLCULOS ECONÓMICOS
// ============================================================================

/**
 * Calcula la recompensa de créditos para un reto completado
 */
export function calculateChallengeReward(
  baseReward: number,
  isPremium: boolean,
  streak: number,
  config: EconomyConfig = DEFAULT_ECONOMY_CONFIG
): number {
  let reward = baseReward * config.kindnessCreditsMultiplier;

  // Aplicar multiplicador premium
  if (isPremium) {
    reward *= config.premiumMultiplier;
  }

  // Aplicar bonus de racha (máximo 2x)
  const streakMultiplier = Math.min(1 + streak * 0.1, 2);
  reward *= streakMultiplier;

  return Math.floor(reward);
}

/**
 * Calcula la ganancia de la plataforma por un reto
 */
export function calculatePlatformEarnings(
  userReward: number,
  config: EconomyConfig = DEFAULT_ECONOMY_CONFIG
): number {
  const usdValue = userReward * config.kindnessCreditsToUSD;
  const platformEarnings = usdValue * (config.platformCommissionPercentage / 100);
  return parseFloat(platformEarnings.toFixed(2));
}

/**
 * Convierte créditos de bondad a USD
 */
export function convertCreditsToUSD(
  credits: number,
  config: EconomyConfig = DEFAULT_ECONOMY_CONFIG
): number {
  return credits * config.kindnessCreditsToUSD;
}

/**
 * Calcula la comisión de retiro
 */
export function calculateWithdrawalFee(
  amount: number,
  method: 'bank_transfer' | 'paypal' | 'stripe'
): { fee: number; net: number } {
  const feePercentages: Record<string, number> = {
    bank_transfer: 1, // 1% para transferencia bancaria
    paypal: 2.2, // 2.2% para PayPal
    stripe: 2.9, // 2.9% para Stripe
  };

  const feePercentage = feePercentages[method] || 2;
  const fee = amount * (feePercentage / 100);
  const net = amount - fee;

  return {
    fee: parseFloat(fee.toFixed(2)),
    net: parseFloat(net.toFixed(2)),
  };
}

/**
 * Calcula el bonus de referral
 */
export function calculateReferralBonus(
  referrals: number,
  config: EconomyConfig = DEFAULT_ECONOMY_CONFIG
): number {
  // Bonus escalonado: más referrals = mayor multiplicador
  let multiplier = 1;
  if (referrals >= 10) multiplier = 1.5;
  if (referrals >= 25) multiplier = 2;
  if (referrals >= 50) multiplier = 2.5;

  return Math.floor(config.referralBonus * multiplier * referrals);
}

/**
 * Calcula el precio con descuento para usuarios premium
 */
export function calculatePremiumPrice(
  baseChallengeReward: number,
  isPremium: boolean,
  config: EconomyConfig = DEFAULT_ECONOMY_CONFIG
): number {
  if (!isPremium) return baseChallengeReward;

  // Los usuarios premium pagan menos por retos premium
  return Math.floor(baseChallengeReward * 0.85); // 15% de descuento
}

// ============================================================================
// GESTIÓN DE TRANSACCIONES
// ============================================================================

/**
 * Crea una transacción de recompensa por reto
 */
export function createChallengeRewardTransaction(
  userId: string,
  challengeId: string,
  challengeTitle: string,
  reward: number
): Transaction {
  return {
    id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'challenge_completion',
    amount: reward,
    currency: 'kindness_credits',
    description: `Reto completado: ${challengeTitle}`,
    timestamp: new Date(),
    metadata: { challengeId, userId },
  };
}

/**
 * Crea una transacción de referral
 */
export function createReferralTransaction(
  userId: string,
  referredUserId: string,
  bonus: number
): Transaction {
  return {
    id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'referral',
    amount: bonus,
    currency: 'kindness_credits',
    description: `Bonus de referral - Usuario referido: ${referredUserId}`,
    timestamp: new Date(),
    metadata: { userId, referredUserId },
  };
}

/**
 * Crea una transacción de suscripción premium
 */
export function createPremiumTransaction(
  userId: string,
  price: number,
  months: number
): Transaction {
  return {
    id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'premium_purchase',
    amount: price,
    currency: 'usd',
    description: `Suscripción Premium - ${months} mes(es)`,
    timestamp: new Date(),
    metadata: { userId, months },
  };
}

/**
 * Crea una transacción de retiro
 */
export function createWithdrawalTransaction(
  userId: string,
  amount: number,
  method: 'bank_transfer' | 'paypal' | 'stripe'
): { transaction: Transaction; withdrawal: Withdrawal } {
  const withdrawalId = `wd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const transaction: Transaction = {
    id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'withdrawal',
    amount,
    currency: 'usd',
    description: `Retiro de fondos - Método: ${method}`,
    timestamp: new Date(),
    metadata: { userId, method, withdrawalId },
  };

  const withdrawal: Withdrawal = {
    id: withdrawalId,
    amount,
    method,
    status: 'pending',
    requestedAt: new Date(),
  };

  return { transaction, withdrawal };
}

// ============================================================================
// ANÁLISIS Y REPORTES
// ============================================================================

/**
 * Calcula las métricas de la plataforma
 */
export function calculatePlatformMetrics(
  users: UserEconomyProfile[],
  config: EconomyConfig = DEFAULT_ECONOMY_CONFIG
): PlatformMetrics {
  const totalUsersActive = users.filter((u) => u.lastChallengeDate > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length;
  const totalKindnessCreditsIssued = users.reduce((sum, u) => sum + u.kindnessCredits, 0);
  const totalPlatformEarnings = users.reduce((sum, u) => sum + u.totalSpent * (config.platformCommissionPercentage / 100), 0);
  const totalUserWithdrawals = users.reduce((sum, u) => sum + u.withdrawalHistory.filter((w) => w.status === 'completed').reduce((s, w) => s + w.amount, 0), 0);
  const premiumSubscribers = users.filter((u) => u.isPremium).length;
  const averageUserEarnings = users.length > 0 ? users.reduce((sum, u) => sum + u.totalEarned, 0) / users.length : 0;

  return {
    totalUsersActive,
    totalKindnessCreditsIssued,
    totalPlatformEarnings: parseFloat(totalPlatformEarnings.toFixed(2)),
    totalUserWithdrawals: parseFloat(totalUserWithdrawals.toFixed(2)),
    averageUserEarnings: parseFloat(averageUserEarnings.toFixed(2)),
    premiumSubscribers,
  };
}

/**
 * Genera un reporte de ingresos por usuario
 */
export function generateUserIncomeReport(user: UserEconomyProfile): {
  totalEarned: number;
  totalSpent: number;
  netBalance: number;
  monthlyAverage: number;
  topTransactionType: string;
} {
  const netBalance = user.totalEarned - user.totalSpent;
  const monthsActive = Math.max(1, Math.floor((Date.now() - user.transactionHistory[0]?.timestamp.getTime() || Date.now()) / (30 * 24 * 60 * 60 * 1000)));
  const monthlyAverage = user.totalEarned / monthsActive;

  // Encontrar tipo de transacción más común
  const transactionCounts: Record<string, number> = {};
  user.transactionHistory.forEach((t) => {
    transactionCounts[t.type] = (transactionCounts[t.type] || 0) + 1;
  });
  const topTransactionType = Object.entries(transactionCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || 'unknown';

  return {
    totalEarned: user.totalEarned,
    totalSpent: user.totalSpent,
    netBalance,
    monthlyAverage: parseFloat(monthlyAverage.toFixed(2)),
    topTransactionType,
  };
}

/**
 * Genera un reporte de ingresos de la plataforma
 */
export function generatePlatformIncomeReport(
  users: UserEconomyProfile[],
  config: EconomyConfig = DEFAULT_ECONOMY_CONFIG
): {
  totalRevenue: number;
  premiumRevenue: number;
  commissionRevenue: number;
  projectedMonthlyRevenue: number;
  profitMargin: number;
} {
  const premiumRevenue = users.filter((u) => u.isPremium).length * config.premiumSubscriptionPrice;
  const commissionRevenue = users.reduce((sum, u) => sum + u.totalSpent * (config.platformCommissionPercentage / 100), 0);
  const totalRevenue = premiumRevenue + commissionRevenue;

  // Proyectar ingresos mensuales (asumiendo 30 días)
  const projectedMonthlyRevenue = totalRevenue * 30;

  // Margen de ganancia (asumiendo 30% de costos operacionales)
  const operationalCosts = totalRevenue * 0.3;
  const profitMargin = ((totalRevenue - operationalCosts) / totalRevenue) * 100;

  return {
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    premiumRevenue: parseFloat(premiumRevenue.toFixed(2)),
    commissionRevenue: parseFloat(commissionRevenue.toFixed(2)),
    projectedMonthlyRevenue: parseFloat(projectedMonthlyRevenue.toFixed(2)),
    profitMargin: parseFloat(profitMargin.toFixed(2)),
  };
}

export default {
  DEFAULT_ECONOMY_CONFIG,
  calculateChallengeReward,
  calculatePlatformEarnings,
  convertCreditsToUSD,
  calculateWithdrawalFee,
  calculateReferralBonus,
  calculatePremiumPrice,
  createChallengeRewardTransaction,
  createReferralTransaction,
  createPremiumTransaction,
  createWithdrawalTransaction,
  calculatePlatformMetrics,
  generateUserIncomeReport,
  generatePlatformIncomeReport,
};
