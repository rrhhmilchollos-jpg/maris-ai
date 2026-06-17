/**
 * DOMINO Chain - Economía de Regalos en Vivo
 * Sistema de monetización directa durante batallas
 */

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export interface GiftEconomyConfig {
  // Distribución de ganancias
  creatorSharePercentage: number; // % que recibe el creador
  platformSharePercentage: number; // % que recibe la plataforma
  
  // Bonificaciones
  topDonatorBonus: number; // Bonus para el top donador
  streakBonus: number; // Bonus por donar consecutivamente
  
  // Límites y restricciones
  maxGiftValue: number; // Valor máximo de un regalo
  dailyGiftLimit: number; // Límite diario de gasto en regalos
  
  // Conversión
  creditToUSD: number; // 1 crédito = X USD
}

export interface GiftTransaction {
  id: string;
  giftId: string;
  senderId: string;
  receiverId: string;
  battleId: string;
  quantity: number;
  unitValue: number;
  totalValue: number;
  creatorEarnings: number;
  platformEarnings: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface CreatorGiftStats {
  totalGiftsReceived: number;
  totalGiftValue: number;
  totalEarnings: number;
  topGift: string;
  topDonator: string;
  averageGiftValue: number;
  lastUpdated: Date;
}

export interface DonatorStats {
  totalGiftsSent: number;
  totalSpent: number;
  favoriteRecipient: string;
  favoriteGift: string;
  averageGiftValue: number;
  lastUpdated: Date;
}

// ============================================================================
// CONFIGURACIÓN POR DEFECTO
// ============================================================================

export const DEFAULT_GIFT_ECONOMY_CONFIG: GiftEconomyConfig = {
  // Distribución: 50-50 entre creador y plataforma
  creatorSharePercentage: 50,
  platformSharePercentage: 50,

  // Bonificaciones
  topDonatorBonus: 100, // 100 créditos bonus para el top donador
  streakBonus: 10, // 10 créditos bonus por cada regalo consecutivo

  // Límites
  maxGiftValue: 10000,
  dailyGiftLimit: 50000,

  // Conversión
  creditToUSD: 0.01, // 1 crédito = $0.01 USD
};

// ============================================================================
// CÁLCULOS DE GANANCIAS
// ============================================================================

/**
 * Calcula las ganancias de un regalo
 */
export function calculateGiftEarnings(
  giftValue: number,
  quantity: number,
  config: GiftEconomyConfig = DEFAULT_GIFT_ECONOMY_CONFIG
): {
  totalValue: number;
  creatorEarnings: number;
  platformEarnings: number;
} {
  const totalValue = giftValue * quantity;

  const creatorEarnings = Math.floor(totalValue * (config.creatorSharePercentage / 100));
  const platformEarnings = Math.floor(totalValue * (config.platformSharePercentage / 100));

  return {
    totalValue,
    creatorEarnings,
    platformEarnings,
  };
}

/**
 * Convierte créditos de regalo a USD
 */
export function convertGiftCreditsToUSD(
  credits: number,
  config: GiftEconomyConfig = DEFAULT_GIFT_ECONOMY_CONFIG
): number {
  return credits * config.creditToUSD;
}

/**
 * Calcula el bonus del top donador
 */
export function calculateTopDonatorBonus(
  donatorRank: number,
  config: GiftEconomyConfig = DEFAULT_GIFT_ECONOMY_CONFIG
): number {
  if (donatorRank === 1) return config.topDonatorBonus * 3; // 3x para el #1
  if (donatorRank === 2) return config.topDonatorBonus * 2; // 2x para el #2
  if (donatorRank === 3) return config.topDonatorBonus; // 1x para el #3
  return 0;
}

/**
 * Calcula el bonus de racha de donaciones
 */
export function calculateStreakBonus(
  consecutiveGifts: number,
  config: GiftEconomyConfig = DEFAULT_GIFT_ECONOMY_CONFIG
): number {
  // Máximo 10 regalos consecutivos = 100 créditos bonus
  const streak = Math.min(consecutiveGifts, 10);
  return streak * config.streakBonus;
}

/**
 * Valida si un regalo puede ser enviado
 */
export function validateGiftTransaction(
  giftValue: number,
  quantity: number,
  userBalance: number,
  dailySpent: number,
  config: GiftEconomyConfig = DEFAULT_GIFT_ECONOMY_CONFIG
): { valid: boolean; error?: string } {
  const totalValue = giftValue * quantity;

  if (giftValue > config.maxGiftValue) {
    return { valid: false, error: `Valor máximo de regalo: ${config.maxGiftValue} créditos` };
  }

  if (totalValue > userBalance) {
    return { valid: false, error: 'Saldo insuficiente' };
  }

  if (dailySpent + totalValue > config.dailyGiftLimit) {
    const remaining = config.dailyGiftLimit - dailySpent;
    return { valid: false, error: `Límite diario alcanzado. Puedes gastar ${remaining} créditos más hoy.` };
  }

  return { valid: true };
}

// ============================================================================
// ANÁLISIS Y REPORTES
// ============================================================================

/**
 * Genera estadísticas de regalos para un creador
 */
export function generateCreatorGiftStats(
  transactions: GiftTransaction[],
  giftCatalog: Map<string, { name: string; value: number }>
): CreatorGiftStats {
  const totalGiftsReceived = transactions.length;
  const totalGiftValue = transactions.reduce((sum, t) => sum + t.totalValue, 0);
  const totalEarnings = transactions.reduce((sum, t) => sum + t.creatorEarnings, 0);

  // Encontrar regalo más popular
  const giftCounts: Record<string, number> = {};
  transactions.forEach((t) => {
    giftCounts[t.giftId] = (giftCounts[t.giftId] || 0) + t.quantity;
  });
  const topGift = Object.entries(giftCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || '';

  // Encontrar top donador
  const donatorCounts: Record<string, number> = {};
  transactions.forEach((t) => {
    donatorCounts[t.senderId] = (donatorCounts[t.senderId] || 0) + t.totalValue;
  });
  const topDonator = Object.entries(donatorCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || '';

  const averageGiftValue = totalGiftsReceived > 0 ? totalGiftValue / totalGiftsReceived : 0;

  return {
    totalGiftsReceived,
    totalGiftValue,
    totalEarnings,
    topGift,
    topDonator,
    averageGiftValue: Math.round(averageGiftValue),
    lastUpdated: new Date(),
  };
}

/**
 * Genera estadísticas de donaciones para un usuario
 */
export function generateDonatorStats(
  transactions: GiftTransaction[],
  giftCatalog: Map<string, { name: string; value: number }>
): DonatorStats {
  const totalGiftsSent = transactions.length;
  const totalSpent = transactions.reduce((sum, t) => sum + t.totalValue, 0);

  // Encontrar receptor favorito
  const recipientCounts: Record<string, number> = {};
  transactions.forEach((t) => {
    recipientCounts[t.receiverId] = (recipientCounts[t.receiverId] || 0) + t.totalValue;
  });
  const favoriteRecipient = Object.entries(recipientCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || '';

  // Encontrar regalo favorito
  const giftCounts: Record<string, number> = {};
  transactions.forEach((t) => {
    giftCounts[t.giftId] = (giftCounts[t.giftId] || 0) + 1;
  });
  const favoriteGift = Object.entries(giftCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || '';

  const averageGiftValue = totalGiftsSent > 0 ? totalSpent / totalGiftsSent : 0;

  return {
    totalGiftsSent,
    totalSpent,
    favoriteRecipient,
    favoriteGift,
    averageGiftValue: Math.round(averageGiftValue),
    lastUpdated: new Date(),
  };
}

/**
 * Calcula los ingresos de la plataforma por regalos
 */
export function calculatePlatformGiftIncome(
  transactions: GiftTransaction[]
): {
  totalIncome: number;
  totalCreatorPayouts: number;
  totalTransactions: number;
  averageTransactionValue: number;
} {
  const totalIncome = transactions.reduce((sum, t) => sum + t.platformEarnings, 0);
  const totalCreatorPayouts = transactions.reduce((sum, t) => sum + t.creatorEarnings, 0);
  const totalTransactions = transactions.length;
  const averageTransactionValue = totalTransactions > 0 ? (totalIncome + totalCreatorPayouts) / totalTransactions : 0;

  return {
    totalIncome,
    totalCreatorPayouts,
    totalTransactions,
    averageTransactionValue: Math.round(averageTransactionValue),
  };
}

/**
 * Proyecta ingresos futuros basado en datos históricos
 */
export function projectGiftIncome(
  transactions: GiftTransaction[],
  daysAhead: number = 30
): {
  projectedIncome: number;
  projectedCreatorPayouts: number;
  dailyAverage: number;
} {
  const platformStats = calculatePlatformGiftIncome(transactions);
  
  // Calcular promedio diario
  const uniqueDays = new Set(transactions.map(t => t.timestamp.toDateString())).size;
  const dailyAverage = uniqueDays > 0 ? platformStats.totalIncome / uniqueDays : 0;

  return {
    projectedIncome: dailyAverage * daysAhead,
    projectedCreatorPayouts: (platformStats.totalCreatorPayouts / uniqueDays) * daysAhead,
    dailyAverage: Math.round(dailyAverage),
  };
}

/**
 * Genera un leaderboard de top donadores
 */
export function generateTopDonatorsLeaderboard(
  transactions: GiftTransaction[],
  limit: number = 100
): Array<{
  userId: string;
  totalSpent: number;
  totalGifts: number;
  rank: number;
}> {
  const donatorStats: Record<string, { totalSpent: number; totalGifts: number }> = {};

  transactions.forEach((t) => {
    if (!donatorStats[t.senderId]) {
      donatorStats[t.senderId] = { totalSpent: 0, totalGifts: 0 };
    }
    donatorStats[t.senderId].totalSpent += t.totalValue;
    donatorStats[t.senderId].totalGifts += t.quantity;
  });

  return Object.entries(donatorStats)
    .map(([userId, stats], index) => ({
      userId,
      totalSpent: stats.totalSpent,
      totalGifts: stats.totalGifts,
      rank: index + 1,
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, limit);
}

/**
 * Genera un leaderboard de top receptores
 */
export function generateTopReceiversLeaderboard(
  transactions: GiftTransaction[],
  limit: number = 100
): Array<{
  userId: string;
  totalReceived: number;
  totalGifts: number;
  totalEarnings: number;
  rank: number;
}> {
  const receiverStats: Record<string, { totalReceived: number; totalGifts: number; totalEarnings: number }> = {};

  transactions.forEach((t) => {
    if (!receiverStats[t.receiverId]) {
      receiverStats[t.receiverId] = { totalReceived: 0, totalGifts: 0, totalEarnings: 0 };
    }
    receiverStats[t.receiverId].totalReceived += t.totalValue;
    receiverStats[t.receiverId].totalGifts += t.quantity;
    receiverStats[t.receiverId].totalEarnings += t.creatorEarnings;
  });

  return Object.entries(receiverStats)
    .map(([userId, stats], index) => ({
      userId,
      totalReceived: stats.totalReceived,
      totalGifts: stats.totalGifts,
      totalEarnings: stats.totalEarnings,
      rank: index + 1,
    }))
    .sort((a, b) => b.totalEarnings - a.totalEarnings)
    .slice(0, limit);
}

export default {
  DEFAULT_GIFT_ECONOMY_CONFIG,
  calculateGiftEarnings,
  convertGiftCreditsToUSD,
  calculateTopDonatorBonus,
  calculateStreakBonus,
  validateGiftTransaction,
  generateCreatorGiftStats,
  generateDonatorStats,
  calculatePlatformGiftIncome,
  projectGiftIncome,
  generateTopDonatorsLeaderboard,
  generateTopReceiversLeaderboard,
};
