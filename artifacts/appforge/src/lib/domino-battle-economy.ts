/**
 * DOMINO Chain - Economía de Batallas VS
 * Sistema de apuestas, premios y distribución de créditos
 */

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export interface BattleEconomyConfig {
  // Premios base
  winnerPrizePercentage: number; // % del premio que recibe el ganador
  loserPrizePercentage: number; // % del premio que recibe el perdedor
  voterRewardPerVote: number; // Créditos que gana cada votante
  
  // Apuestas
  minBetAmount: number; // Mínimo de créditos para apostar
  maxBetAmount: number; // Máximo de créditos para apostar
  bettingCommissionPercentage: number; // % de comisión en apuestas
  
  // Multiplicadores
  underdog Multiplier: number; // Multiplicador si apuestas por el perdedor
  correctPredictionBonus: number; // Bonus si predices correctamente
  
  // Distribución de premios
  platformCut: number; // % que se queda la plataforma
  voterPoolPercentage: number; // % del premio para el pool de votantes
}

export interface BattleParticipant {
  userId: string;
  username: string;
  avatar: string;
  videoUrl: string;
  votes: number;
  finalScore: number; // Calculado por algoritmo
}

export interface BattleResult {
  battleId: string;
  winner: 'participant1' | 'participant2' | 'tie';
  participant1: BattleParticipant;
  participant2: BattleParticipant;
  totalVotes: number;
  totalBets: number;
  prizePool: number;
  platformEarnings: number;
  voterPoolEarnings: number;
  timestamp: Date;
}

export interface UserBet {
  userId: string;
  battleId: string;
  participantId: 'participant1' | 'participant2';
  amount: number;
  multiplier: number;
  potentialWinnings: number;
  actualWinnings?: number;
  status: 'pending' | 'won' | 'lost';
  timestamp: Date;
}

export interface BattleRewards {
  winnerReward: number;
  loserReward: number;
  voterRewards: Map<string, number>; // userId -> créditos
  platformEarnings: number;
}

// ============================================================================
// CONFIGURACIÓN POR DEFECTO
// ============================================================================

export const DEFAULT_BATTLE_ECONOMY_CONFIG: BattleEconomyConfig = {
  // Premios base
  winnerPrizePercentage: 70, // El ganador recibe 70% del premio
  loserPrizePercentage: 30, // El perdedor recibe 30% del premio
  voterRewardPerVote: 5, // 5 créditos por votar

  // Apuestas
  minBetAmount: 10,
  maxBetAmount: 5000,
  bettingCommissionPercentage: 10, // 10% de comisión en apuestas

  // Multiplicadores
  underdogMultiplier: 2.5, // Si apuestas por el perdedor, ganas 2.5x
  correctPredictionBonus: 50, // 50 créditos bonus si predices correctamente

  // Distribución
  platformCut: 20, // La plataforma se queda con 20% del premio total
  voterPoolPercentage: 10, // 10% del premio para repartir entre votantes
};

// ============================================================================
// CÁLCULOS DE PREMIOS
// ============================================================================

/**
 * Calcula el score final de un participante basado en votos y engagement
 */
export function calculateParticipantScore(
  votes: number,
  totalVotes: number,
  videoQuality: 'low' | 'medium' | 'high' = 'medium',
  engagement: number = 0 // Comentarios, shares, etc.
): number {
  let score = 0;

  // Puntuación por votos (máx 60 puntos)
  const votePercentage = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
  score += (votePercentage / 100) * 60;

  // Puntuación por calidad de video (máx 20 puntos)
  const qualityScores: Record<string, number> = {
    low: 5,
    medium: 12,
    high: 20,
  };
  score += qualityScores[videoQuality] || 12;

  // Puntuación por engagement (máx 20 puntos)
  score += Math.min(engagement * 2, 20);

  return Math.round(score);
}

/**
 * Determina el ganador de una batalla
 */
export function determineBattleWinner(
  participant1Votes: number,
  participant2Votes: number,
  p1Score: number,
  p2Score: number
): 'participant1' | 'participant2' | 'tie' {
  // Si hay empate en votos, usar score
  if (participant1Votes === participant2Votes) {
    if (p1Score > p2Score) return 'participant1';
    if (p2Score > p1Score) return 'participant2';
    return 'tie';
  }

  // Ganador por mayoría de votos
  return participant1Votes > participant2Votes ? 'participant1' : 'participant2';
}

/**
 * Calcula los premios de una batalla
 */
export function calculateBattleRewards(
  result: BattleResult,
  config: BattleEconomyConfig = DEFAULT_BATTLE_ECONOMY_CONFIG
): BattleRewards {
  const totalParticipants = 2;
  const baseReward = result.prizePool / totalParticipants;

  // Premios para ganador y perdedor
  const winnerReward = Math.floor(baseReward * (config.winnerPrizePercentage / 100));
  const loserReward = Math.floor(baseReward * (config.loserPrizePercentage / 100));

  // Premios para votantes
  const voterPoolAmount = Math.floor(result.prizePool * (config.voterPoolPercentage / 100));
  const rewardPerVoter = Math.floor(voterPoolAmount / result.totalVotes);

  const voterRewards = new Map<string, number>();
  // En una implementación real, aquí se distribuiría entre los votantes reales

  // Ganancias de la plataforma
  const platformEarnings = Math.floor(result.prizePool * (config.platformCut / 100));

  return {
    winnerReward,
    loserReward,
    voterRewards,
    platformEarnings,
  };
}

/**
 * Calcula las ganancias de una apuesta
 */
export function calculateBetWinnings(
  betAmount: number,
  participantWon: boolean,
  wasUnderdog: boolean,
  config: BattleEconomyConfig = DEFAULT_BATTLE_ECONOMY_CONFIG
): number {
  if (!participantWon) {
    return 0; // Apuesta perdida
  }

  let winnings = betAmount;

  // Aplicar multiplicador de underdog si aplica
  if (wasUnderdog) {
    winnings *= config.underdogMultiplier;
  }

  // Aplicar bonus de predicción correcta
  winnings += config.correctPredictionBonus;

  // Restar comisión
  const commission = winnings * (config.bettingCommissionPercentage / 100);
  winnings -= commission;

  return Math.floor(winnings);
}

/**
 * Calcula la comisión de apuesta
 */
export function calculateBettingCommission(
  betAmount: number,
  config: BattleEconomyConfig = DEFAULT_BATTLE_ECONOMY_CONFIG
): number {
  return Math.floor(betAmount * (config.bettingCommissionPercentage / 100));
}

/**
 * Valida si una apuesta es válida
 */
export function validateBet(
  amount: number,
  userBalance: number,
  config: BattleEconomyConfig = DEFAULT_BATTLE_ECONOMY_CONFIG
): { valid: boolean; error?: string } {
  if (amount < config.minBetAmount) {
    return { valid: false, error: `Apuesta mínima: ${config.minBetAmount} créditos` };
  }

  if (amount > config.maxBetAmount) {
    return { valid: false, error: `Apuesta máxima: ${config.maxBetAmount} créditos` };
  }

  if (amount > userBalance) {
    return { valid: false, error: 'Saldo insuficiente' };
  }

  return { valid: true };
}

// ============================================================================
// ANÁLISIS Y ESTADÍSTICAS
// ============================================================================

/**
 * Calcula las probabilidades de victoria basadas en votos
 */
export function calculateWinProbability(
  participant1Votes: number,
  participant2Votes: number
): { participant1: number; participant2: number } {
  const totalVotes = participant1Votes + participant2Votes;

  if (totalVotes === 0) {
    return { participant1: 50, participant2: 50 };
  }

  return {
    participant1: Math.round((participant1Votes / totalVotes) * 100),
    participant2: Math.round((participant2Votes / totalVotes) * 100),
  };
}

/**
 * Calcula el multiplicador de apuesta basado en probabilidades
 */
export function calculateBetMultiplier(
  participantVotes: number,
  totalVotes: number
): number {
  if (totalVotes === 0) return 1;

  const probability = participantVotes / totalVotes;

  // Multiplicador inverso: cuanto menor la probabilidad, mayor el multiplicador
  // Fórmula: 1 / probabilidad (con límites)
  const multiplier = 1 / probability;

  // Limitar entre 1x y 10x
  return Math.min(Math.max(multiplier, 1), 10);
}

/**
 * Genera estadísticas de batalla
 */
export function generateBattleStats(
  result: BattleResult,
  config: BattleEconomyConfig = DEFAULT_BATTLE_ECONOMY_CONFIG
): {
  winnerStats: any;
  loserStats: any;
  battleStats: any;
  platformStats: any;
} {
  const rewards = calculateBattleRewards(result, config);

  const totalVotes = result.participant1.votes + result.participant2.votes;
  const p1Percentage = totalVotes > 0 ? (result.participant1.votes / totalVotes) * 100 : 0;
  const p2Percentage = totalVotes > 0 ? (result.participant2.votes / totalVotes) * 100 : 0;

  const winner = result.winner === 'participant1' ? result.participant1 : result.participant2;
  const loser = result.winner === 'participant1' ? result.participant2 : result.participant1;

  return {
    winnerStats: {
      username: winner.username,
      votes: winner.votes,
      percentage: result.winner === 'participant1' ? p1Percentage : p2Percentage,
      reward: rewards.winnerReward,
      score: winner.finalScore,
    },
    loserStats: {
      username: loser.username,
      votes: loser.votes,
      percentage: result.winner === 'participant1' ? p2Percentage : p1Percentage,
      reward: rewards.loserReward,
      score: loser.finalScore,
    },
    battleStats: {
      totalVotes: result.totalVotes,
      totalBets: result.totalBets,
      prizePool: result.prizePool,
      voterPoolDistribution: Math.floor(result.prizePool * (config.voterPoolPercentage / 100)),
    },
    platformStats: {
      earnings: rewards.platformEarnings,
      bettingCommissions: Math.floor(result.totalBets * (config.bettingCommissionPercentage / 100)),
      totalIncome: rewards.platformEarnings + Math.floor(result.totalBets * (config.bettingCommissionPercentage / 100)),
    },
  };
}

/**
 * Calcula el ROI (Return on Investment) de una apuesta
 */
export function calculateBetROI(
  betAmount: number,
  winnings: number
): number {
  if (betAmount === 0) return 0;
  return ((winnings - betAmount) / betAmount) * 100;
}

export default {
  DEFAULT_BATTLE_ECONOMY_CONFIG,
  calculateParticipantScore,
  determineBattleWinner,
  calculateBattleRewards,
  calculateBetWinnings,
  calculateBettingCommission,
  validateBet,
  calculateWinProbability,
  calculateBetMultiplier,
  generateBattleStats,
  calculateBetROI,
};
