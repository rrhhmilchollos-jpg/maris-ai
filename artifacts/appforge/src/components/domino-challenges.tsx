/**
 * DOMINO Chain - Desafíos Interactivos y Competencias
 * Desafíos diarios, semanales y competencias en tiempo real
 */

import React, { useState, useEffect } from 'react';
import { Zap, Target, Trophy, Clock, Gift, Flame } from 'lucide-react';

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export type ChallengeType = 'daily' | 'weekly' | 'seasonal' | 'limited-time';
export type ChallengeDifficulty = 'easy' | 'medium' | 'hard' | 'extreme';

export interface Challenge {
  id: string;
  title: string;
  description: string;
  icon: string;
  type: ChallengeType;
  difficulty: ChallengeDifficulty;
  objective: string;
  target: number;
  reward: {
    xp: number;
    coins: number;
    badge?: string;
  };
  timeRemaining?: number; // segundos
  progress?: number; // 0-100
  completed?: boolean;
  startedAt?: Date;
  endsAt?: Date;
}

export interface CompetitionEntry {
  userId: string;
  username: string;
  avatar: string;
  score: number;
  rank: number;
  badge?: string;
}

export interface Competition {
  id: string;
  title: string;
  description: string;
  icon: string;
  type: 'gifts-sent' | 'gifts-received' | 'spending' | 'custom';
  participants: CompetitionEntry[];
  prizePool: {
    first: { xp: number; coins: number };
    second: { xp: number; coins: number };
    third: { xp: number; coins: number };
  };
  timeRemaining?: number;
  startedAt?: Date;
  endsAt?: Date;
  isActive: boolean;
}

// ============================================================================
// CATÁLOGO DE DESAFÍOS
// ============================================================================

export const CHALLENGES_CATALOG: Challenge[] = [
  // Desafíos Diarios
  {
    id: 'daily-sender',
    title: '🎁 Repartidor Diario',
    description: 'Envía 10 regalos hoy',
    icon: '🎁',
    type: 'daily',
    difficulty: 'easy',
    objective: 'Envía 10 regalos',
    target: 10,
    reward: { xp: 200, coins: 100 },
    progress: 0,
  },
  {
    id: 'daily-spender',
    title: '💰 Gran Gastador Diario',
    description: 'Gasta €5 en regalos hoy',
    icon: '💰',
    type: 'daily',
    difficulty: 'medium',
    objective: 'Gasta €5',
    target: 500, // centavos
    reward: { xp: 300, coins: 150 },
    progress: 0,
  },
  {
    id: 'daily-legend',
    title: '⭐ Envía un Regalo Legendario',
    description: 'Envía un regalo de rareza legendaria',
    icon: '⭐',
    type: 'daily',
    difficulty: 'hard',
    objective: 'Envía 1 regalo legendario',
    target: 1,
    reward: { xp: 500, coins: 500, badge: 'legend-sender' },
    progress: 0,
  },

  // Desafíos Semanales
  {
    id: 'weekly-master',
    title: '🏆 Maestro de Regalos Semanal',
    description: 'Envía 100 regalos esta semana',
    icon: '🏆',
    type: 'weekly',
    difficulty: 'medium',
    objective: 'Envía 100 regalos',
    target: 100,
    reward: { xp: 1000, coins: 500, badge: 'weekly-master' },
    progress: 0,
  },
  {
    id: 'weekly-beloved',
    title: '❤️ Amado de la Semana',
    description: 'Recibe 50 regalos esta semana',
    icon: '❤️',
    type: 'weekly',
    difficulty: 'medium',
    objective: 'Recibe 50 regalos',
    target: 50,
    reward: { xp: 800, coins: 400 },
    progress: 0,
  },
  {
    id: 'weekly-whale',
    title: '🐋 Ballena de la Semana',
    description: 'Gasta €50 en regalos esta semana',
    icon: '🐋',
    type: 'weekly',
    difficulty: 'hard',
    objective: 'Gasta €50',
    target: 5000, // centavos
    reward: { xp: 2000, coins: 1000, badge: 'weekly-whale' },
    progress: 0,
  },

  // Desafíos de Tiempo Limitado
  {
    id: 'limited-legendary-rush',
    title: '⚡ Rush de Legendarios',
    description: 'Envía 5 regalos legendarios en 24 horas',
    icon: '⚡',
    type: 'limited-time',
    difficulty: 'extreme',
    objective: 'Envía 5 legendarios',
    target: 5,
    reward: { xp: 5000, coins: 2500, badge: 'legendary-rush' },
    progress: 0,
  },
  {
    id: 'limited-speed-challenge',
    title: '🚀 Desafío de Velocidad',
    description: 'Envía 50 regalos en 12 horas',
    icon: '🚀',
    type: 'limited-time',
    difficulty: 'hard',
    objective: 'Envía 50 regalos',
    target: 50,
    reward: { xp: 2000, coins: 1000, badge: 'speed-demon' },
    progress: 0,
  },

  // Desafíos Estacionales
  {
    id: 'seasonal-summer',
    title: '☀️ Verano 2026',
    description: 'Sé la estrella del verano: envía 500 regalos',
    icon: '☀️',
    type: 'seasonal',
    difficulty: 'extreme',
    objective: 'Envía 500 regalos',
    target: 500,
    reward: { xp: 10000, coins: 5000, badge: 'summer-star' },
    progress: 0,
  },
];

// ============================================================================
// FUNCIONES AUXILIARES
// ============================================================================

export function getDifficultyColor(difficulty: ChallengeDifficulty): string {
  const colors: Record<ChallengeDifficulty, string> = {
    easy: 'from-green-400 to-green-600',
    medium: 'from-blue-400 to-blue-600',
    hard: 'from-purple-400 to-purple-600',
    extreme: 'from-red-600 to-red-800',
  };
  return colors[difficulty];
}

export function getDifficultyLabel(difficulty: ChallengeDifficulty): string {
  const labels: Record<ChallengeDifficulty, string> = {
    easy: 'Fácil',
    medium: 'Medio',
    hard: 'Difícil',
    extreme: 'Extremo',
  };
  return labels[difficulty];
}

export function getTypeLabel(type: ChallengeType): string {
  const labels: Record<ChallengeType, string> = {
    daily: 'Diario',
    weekly: 'Semanal',
    seasonal: 'Estacional',
    'limited-time': 'Tiempo Limitado',
  };
  return labels[type];
}

export function formatTimeRemaining(seconds?: number): string {
  if (!seconds) return 'Activo';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// ============================================================================
// COMPONENTES
// ============================================================================

/**
 * Tarjeta de Desafío
 */
export const ChallengeCard: React.FC<{
  challenge: Challenge;
  onAccept?: () => void;
  onClaim?: () => void;
}> = ({ challenge, onAccept, onClaim }) => {
  const difficultyColor = getDifficultyColor(challenge.difficulty);
  const isCompleted = challenge.completed || (challenge.progress === 100);

  return (
    <div
      className={`p-4 rounded-lg border-2 transition transform hover:scale-105 ${
        isCompleted
          ? 'bg-gradient-to-br from-green-900 to-green-800 border-green-500'
          : `bg-gradient-to-br from-gray-800 to-gray-900 border-gray-600`
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-3xl">{challenge.icon}</span>
          <div>
            <h3 className="font-bold text-white">{challenge.title}</h3>
            <p className="text-xs text-gray-400">{getTypeLabel(challenge.type)}</p>
          </div>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full bg-gradient-to-r ${difficultyColor} text-white font-semibold`}>
          {getDifficultyLabel(challenge.difficulty)}
        </span>
      </div>

      {/* Descripción */}
      <p className="text-sm text-gray-300 mb-3">{challenge.description}</p>

      {/* Progreso */}
      {challenge.progress !== undefined && (
        <div className="mb-3">
          <div className="flex justify-between mb-1">
            <span className="text-xs text-gray-400">Progreso</span>
            <span className="text-xs text-gray-400">{challenge.progress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${difficultyColor} transition-all duration-300`}
              style={{ width: `${challenge.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Recompensas */}
      <div className="bg-gray-700 rounded p-2 mb-3">
        <p className="text-xs text-gray-400 mb-1">Recompensas:</p>
        <div className="flex gap-2">
          <span className="text-xs bg-purple-600 text-white px-2 py-1 rounded">
            +{challenge.reward.xp} XP
          </span>
          <span className="text-xs bg-yellow-600 text-white px-2 py-1 rounded">
            +{challenge.reward.coins} €
          </span>
          {challenge.reward.badge && (
            <span className="text-xs bg-pink-600 text-white px-2 py-1 rounded">
              🏆 {challenge.reward.badge}
            </span>
          )}
        </div>
      </div>

      {/* Tiempo restante y botón */}
      <div className="flex items-center justify-between">
        {challenge.timeRemaining && (
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Clock size={12} />
            {formatTimeRemaining(challenge.timeRemaining)}
          </span>
        )}
        {isCompleted ? (
          <button
            onClick={onClaim}
            className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white px-3 py-1 rounded text-sm font-semibold transition"
          >
            ✓ Completado
          </button>
        ) : (
          <button
            onClick={onAccept}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-3 py-1 rounded text-sm font-semibold transition"
          >
            Aceptar
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Panel de Desafíos
 */
export const ChallengesPanel: React.FC<{
  challenges?: Challenge[];
  onAcceptChallenge?: (challengeId: string) => void;
  onClaimReward?: (challengeId: string) => void;
}> = ({ challenges = CHALLENGES_CATALOG, onAcceptChallenge, onClaimReward }) => {
  const [selectedType, setSelectedType] = useState<ChallengeType>('daily');

  const filteredChallenges = challenges.filter((c) => c.type === selectedType);

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-4">
        ⚡ Desafíos Activos
      </h2>

      {/* Filtros */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {(['daily', 'weekly', 'seasonal', 'limited-time'] as ChallengeType[]).map((type) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`px-4 py-2 rounded-full whitespace-nowrap transition font-semibold ${
              selectedType === type
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
            }`}
          >
            {getTypeLabel(type)}
          </button>
        ))}
      </div>

      {/* Grid de desafíos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredChallenges.map((challenge) => (
          <ChallengeCard
            key={challenge.id}
            challenge={challenge}
            onAccept={() => onAcceptChallenge?.(challenge.id)}
            onClaim={() => onClaimReward?.(challenge.id)}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * Tarjeta de Competencia
 */
export const CompetitionCard: React.FC<{
  competition: Competition;
  currentUserId?: string;
  onJoin?: () => void;
}> = ({ competition, currentUserId, onJoin }) => {
  const topThree = competition.participants.slice(0, 3);

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-6 border-2 border-yellow-500">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-2xl font-bold text-white flex items-center gap-2">
            {competition.icon} {competition.title}
          </h3>
          <p className="text-gray-400 text-sm mt-1">{competition.description}</p>
        </div>
        {competition.isActive && (
          <span className="bg-gradient-to-r from-red-600 to-red-700 text-white px-3 py-1 rounded-full text-xs font-semibold animate-pulse">
            🔴 En Vivo
          </span>
        )}
      </div>

      {/* Top 3 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {topThree.map((entry, i) => (
          <div
            key={entry.userId}
            className={`bg-gradient-to-br rounded-lg p-3 text-center border-2 ${
              i === 0
                ? 'from-yellow-600 to-yellow-700 border-yellow-400'
                : i === 1
                ? 'from-gray-600 to-gray-700 border-gray-400'
                : 'from-orange-600 to-orange-700 border-orange-400'
            }`}
          >
            <div className="text-3xl mb-1">
              {['🥇', '🥈', '🥉'][i]}
            </div>
            <p className="text-lg font-bold text-white">{entry.avatar}</p>
            <p className="text-xs text-white font-semibold truncate">{entry.username}</p>
            <p className="text-lg font-bold text-white mt-1">{entry.score}</p>
          </div>
        ))}
      </div>

      {/* Premios */}
      <div className="bg-gray-700 rounded p-3 mb-4">
        <p className="text-sm font-semibold text-white mb-2">💰 Premios:</p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-yellow-400 font-bold">🥇 1º</p>
            <p className="text-white">{competition.prizePool.first.xp} XP</p>
            <p className="text-white">{competition.prizePool.first.coins} €</p>
          </div>
          <div>
            <p className="text-gray-300 font-bold">🥈 2º</p>
            <p className="text-white">{competition.prizePool.second.xp} XP</p>
            <p className="text-white">{competition.prizePool.second.coins} €</p>
          </div>
          <div>
            <p className="text-orange-400 font-bold">🥉 3º</p>
            <p className="text-white">{competition.prizePool.third.xp} XP</p>
            <p className="text-white">{competition.prizePool.third.coins} €</p>
          </div>
        </div>
      </div>

      {/* Botón */}
      <button
        onClick={onJoin}
        className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white py-2 rounded-lg font-semibold transition"
      >
        {competition.isActive ? '⚡ Unirse Ahora' : '📅 Próximamente'}
      </button>
    </div>
  );
};

/**
 * Panel de Competencias
 */
export const CompetitionsPanel: React.FC<{
  competitions?: Competition[];
  currentUserId?: string;
  onJoinCompetition?: (competitionId: string) => void;
}> = ({ competitions = [], currentUserId, onJoinCompetition }) => {
  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-4">
        🏆 Competencias en Vivo
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {competitions.map((competition) => (
          <CompetitionCard
            key={competition.id}
            competition={competition}
            currentUserId={currentUserId}
            onJoin={() => onJoinCompetition?.(competition.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default {
  CHALLENGES_CATALOG,
  getDifficultyColor,
  getDifficultyLabel,
  getTypeLabel,
  formatTimeRemaining,
  ChallengeCard,
  ChallengesPanel,
  CompetitionCard,
  CompetitionsPanel,
};
