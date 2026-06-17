/**
 * DOMINO Chain - Sistema de Gamificación Avanzada
 * Logros, Niveles, Badges y Recompensas
 */

import React, { useState, useEffect } from 'react';
import { Trophy, Star, Zap, Award, Lock, Unlock } from 'lucide-react';

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export type AchievementRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: AchievementRarity;
  requirement: number;
  type: 'gifts-sent' | 'gifts-received' | 'level-up' | 'streak' | 'spending' | 'challenge';
  reward: {
    xp: number;
    coins?: number;
    badge?: string;
  };
  unlockedAt?: Date;
}

export interface UserLevel {
  level: number;
  name: string;
  minXP: number;
  maxXP: number;
  title: string;
  color: string;
  badge: string;
  perks: string[];
}

export interface UserStats {
  userId: string;
  level: number;
  xp: number;
  totalXP: number;
  giftsSent: number;
  giftsReceived: number;
  achievements: Achievement[];
  badges: string[];
  streak: number;
  totalSpent: number;
}

// ============================================================================
// CATÁLOGO DE LOGROS
// ============================================================================

export const ACHIEVEMENTS_CATALOG: Achievement[] = [
  {
    id: 'first-gift',
    name: '🎁 Primer Regalo',
    description: 'Envía tu primer regalo',
    icon: '🎁',
    rarity: 'common',
    requirement: 1,
    type: 'gifts-sent',
    reward: { xp: 100, coins: 10 },
  },
  {
    id: 'gift-master',
    name: '🎁 Maestro de Regalos',
    description: 'Envía 100 regalos',
    icon: '🎁',
    rarity: 'rare',
    requirement: 100,
    type: 'gifts-sent',
    reward: { xp: 1000, coins: 500, badge: 'gift-master' },
  },
  {
    id: 'generous-soul',
    name: '💝 Alma Generosa',
    description: 'Envía 1000 regalos',
    icon: '💝',
    rarity: 'epic',
    requirement: 1000,
    type: 'gifts-sent',
    reward: { xp: 5000, coins: 2500, badge: 'generous-soul' },
  },
  {
    id: 'beloved',
    name: '❤️ Amado',
    description: 'Recibe 50 regalos',
    icon: '❤️',
    rarity: 'uncommon',
    requirement: 50,
    type: 'gifts-received',
    reward: { xp: 500, coins: 250 },
  },
  {
    id: 'celebrity',
    name: '⭐ Celebridad',
    description: 'Recibe 500 regalos',
    icon: '⭐',
    rarity: 'epic',
    requirement: 500,
    type: 'gifts-received',
    reward: { xp: 3000, coins: 1500, badge: 'celebrity' },
  },
  {
    id: 'big-spender',
    name: '💰 Gran Gastador',
    description: 'Gasta €100 en regalos',
    icon: '💰',
    rarity: 'rare',
    requirement: 10000,
    type: 'spending',
    reward: { xp: 2000, coins: 1000, badge: 'big-spender' },
  },
  {
    id: 'whale',
    name: '🐋 Ballena',
    description: 'Gasta €1000 en regalos',
    icon: '🐋',
    rarity: 'legendary',
    requirement: 100000,
    type: 'spending',
    reward: { xp: 10000, coins: 5000, badge: 'whale' },
  },
  {
    id: 'on-fire',
    name: '🔥 En Llamas',
    description: 'Mantén una racha de 7 días',
    icon: '🔥',
    rarity: 'uncommon',
    requirement: 7,
    type: 'streak',
    reward: { xp: 750, coins: 500 },
  },
  {
    id: 'unstoppable',
    name: '💪 Imparable',
    description: 'Mantén una racha de 30 días',
    icon: '💪',
    rarity: 'epic',
    requirement: 30,
    type: 'streak',
    reward: { xp: 5000, coins: 2500, badge: 'unstoppable' },
  },
  {
    id: 'level-10',
    name: '🏆 Nivel 10',
    description: 'Alcanza el nivel 10',
    icon: '🏆',
    rarity: 'uncommon',
    requirement: 10,
    type: 'level-up',
    reward: { xp: 1000, coins: 500 },
  },
  {
    id: 'level-50',
    name: '👑 Nivel 50',
    description: 'Alcanza el nivel 50',
    icon: '👑',
    rarity: 'epic',
    requirement: 50,
    type: 'level-up',
    reward: { xp: 10000, coins: 5000, badge: 'level-50' },
  },
  {
    id: 'max-level',
    name: '⚡ Nivel Máximo',
    description: 'Alcanza el nivel 100',
    icon: '⚡',
    rarity: 'legendary',
    requirement: 100,
    type: 'level-up',
    reward: { xp: 50000, coins: 25000, badge: 'max-level' },
  },
];

// ============================================================================
// SISTEMA DE NIVELES
// ============================================================================

export const USER_LEVELS: UserLevel[] = [
  {
    level: 1,
    name: 'Novato',
    minXP: 0,
    maxXP: 500,
    title: 'Novato',
    color: 'from-gray-400 to-gray-600',
    badge: '🌱',
    perks: [],
  },
  {
    level: 5,
    name: 'Aprendiz',
    minXP: 500,
    maxXP: 2000,
    title: 'Aprendiz',
    color: 'from-green-400 to-green-600',
    badge: '🌿',
    perks: ['Descuento 5% en regalos'],
  },
  {
    level: 10,
    name: 'Veterano',
    minXP: 2000,
    maxXP: 5000,
    title: 'Veterano',
    color: 'from-blue-400 to-blue-600',
    badge: '⚔️',
    perks: ['Descuento 10% en regalos', 'Acceso a regalos exclusivos'],
  },
  {
    level: 25,
    name: 'Maestro',
    minXP: 5000,
    maxXP: 15000,
    title: 'Maestro',
    color: 'from-purple-400 to-purple-600',
    badge: '🧙',
    perks: ['Descuento 15% en regalos', 'Regalos exclusivos', 'Insignia especial'],
  },
  {
    level: 50,
    name: 'Leyenda',
    minXP: 15000,
    maxXP: 50000,
    title: 'Leyenda',
    color: 'from-yellow-400 to-orange-600',
    badge: '👑',
    perks: ['Descuento 25% en regalos', 'Regalos legendarios exclusivos', 'Nombre destacado'],
  },
  {
    level: 100,
    name: 'Inmortal',
    minXP: 50000,
    maxXP: 999999,
    title: 'Inmortal',
    color: 'from-red-600 via-purple-600 to-blue-600',
    badge: '⚡',
    perks: ['Descuento 50% en regalos', 'Todos los regalos exclusivos', 'Aura especial'],
  },
];

// ============================================================================
// FUNCIONES DE CÁLCULO
// ============================================================================

export function calculateLevel(totalXP: number): number {
  let level = 1;
  for (const userLevel of USER_LEVELS) {
    if (totalXP >= userLevel.minXP && totalXP < userLevel.maxXP) {
      return userLevel.level;
    }
  }
  return 100;
}

export function getLevelInfo(level: number): UserLevel | undefined {
  return USER_LEVELS.find((l) => l.level === level);
}

export function getLevelProgress(totalXP: number): { current: number; next: number; percentage: number } {
  const level = calculateLevel(totalXP);
  const levelInfo = getLevelInfo(level);
  if (!levelInfo) return { current: 0, next: 0, percentage: 0 };

  const current = totalXP - levelInfo.minXP;
  const next = levelInfo.maxXP - levelInfo.minXP;
  const percentage = (current / next) * 100;

  return { current, next, percentage };
}

export function isAchievementUnlocked(achievement: Achievement, stats: UserStats): boolean {
  switch (achievement.type) {
    case 'gifts-sent':
      return stats.giftsSent >= achievement.requirement;
    case 'gifts-received':
      return stats.giftsReceived >= achievement.requirement;
    case 'spending':
      return stats.totalSpent >= achievement.requirement;
    case 'streak':
      return stats.streak >= achievement.requirement;
    case 'level-up':
      return stats.level >= achievement.requirement;
    default:
      return false;
  }
}

// ============================================================================
// COMPONENTES
// ============================================================================

export const AchievementCard: React.FC<{
  achievement: Achievement;
  unlocked: boolean;
  onClick?: () => void;
}> = ({ achievement, unlocked, onClick }) => {
  const rarityColors: Record<AchievementRarity, string> = {
    common: 'from-gray-400 to-gray-600',
    uncommon: 'from-green-400 to-green-600',
    rare: 'from-blue-400 to-blue-600',
    epic: 'from-purple-400 to-purple-600',
    legendary: 'from-yellow-400 to-red-600',
  };

  return (
    <div
      onClick={onClick}
      className={`p-4 rounded-lg cursor-pointer transition transform ${
        unlocked
          ? `bg-gradient-to-br ${rarityColors[achievement.rarity]} text-white scale-100 hover:scale-105`
          : 'bg-gray-700 text-gray-400 opacity-50 scale-95'
      }`}
    >
      <div className="text-4xl mb-2 text-center">{achievement.icon}</div>
      <p className="font-bold text-sm text-center">{achievement.name}</p>
      <p className="text-xs text-center mt-1 opacity-90">{achievement.description}</p>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span>+{achievement.reward.xp} XP</span>
        {!unlocked && <Lock size={14} />}
        {unlocked && <Unlock size={14} />}
      </div>
    </div>
  );
};

export const LevelPanel: React.FC<{ stats: UserStats }> = ({ stats }) => {
  const levelInfo = getLevelInfo(stats.level);
  const progress = getLevelProgress(stats.totalXP);

  if (!levelInfo) return null;

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-gray-400 text-sm">Nivel Actual</p>
          <h2 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            {stats.level}
          </h2>
        </div>
        <div className="text-5xl">{levelInfo.badge}</div>
      </div>

      <p className="text-white font-semibold mb-2">{levelInfo.title}</p>
      <p className="text-gray-400 text-sm mb-4">{levelInfo.name}</p>

      <div className="mb-4">
        <div className="flex justify-between mb-2">
          <span className="text-xs text-gray-400">Progreso</span>
          <span className="text-xs text-gray-400">
            {progress.current} / {progress.next}
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full bg-gradient-to-r ${levelInfo.color} transition-all duration-300`}
            style={{ width: `${Math.min(progress.percentage, 100)}%` }}
          />
        </div>
      </div>

      <div className="bg-gray-800 rounded p-3">
        <p className="text-sm font-semibold text-white mb-2">Ventajas:</p>
        {levelInfo.perks.length > 0 ? (
          <ul className="text-xs text-gray-300 space-y-1">
            {levelInfo.perks.map((perk, i) => (
              <li key={i} className="flex items-center">
                <Star size={12} className="mr-2 text-yellow-400" />
                {perk}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">Sin ventajas especiales</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="bg-gray-800 rounded p-3">
          <p className="text-xs text-gray-400">Regalos Enviados</p>
          <p className="text-lg font-bold text-white">{stats.giftsSent}</p>
        </div>
        <div className="bg-gray-800 rounded p-3">
          <p className="text-xs text-gray-400">Regalos Recibidos</p>
          <p className="text-lg font-bold text-white">{stats.giftsReceived}</p>
        </div>
        <div className="bg-gray-800 rounded p-3">
          <p className="text-xs text-gray-400">Racha Actual</p>
          <p className="text-lg font-bold text-white">{stats.streak} días 🔥</p>
        </div>
        <div className="bg-gray-800 rounded p-3">
          <p className="text-xs text-gray-400">Logros</p>
          <p className="text-lg font-bold text-white">{stats.achievements.length}</p>
        </div>
      </div>
    </div>
  );
};

export const AchievementsGallery: React.FC<{ stats: UserStats }> = ({ stats }) => {
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-4">
        🏆 Logros Desbloqueados
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        {ACHIEVEMENTS_CATALOG.map((achievement) => {
          const unlocked = isAchievementUnlocked(achievement, stats);
          return (
            <AchievementCard
              key={achievement.id}
              achievement={achievement}
              unlocked={unlocked}
              onClick={() => setSelectedAchievement(achievement)}
            />
          );
        })}
      </div>

      {selectedAchievement && (
        <div className="bg-gray-800 rounded-lg p-4 border border-purple-500">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-2xl">{selectedAchievement.icon}</p>
              <h3 className="text-lg font-bold text-white">{selectedAchievement.name}</h3>
            </div>
            <button
              onClick={() => setSelectedAchievement(null)}
              className="text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <p className="text-gray-300 mb-3">{selectedAchievement.description}</p>
          <div className="bg-gray-700 rounded p-3">
            <p className="text-sm text-gray-400 mb-2">Recompensas:</p>
            <div className="flex gap-2">
              <span className="text-xs bg-purple-600 text-white px-2 py-1 rounded">
                +{selectedAchievement.reward.xp} XP
              </span>
              {selectedAchievement.reward.coins && (
                <span className="text-xs bg-yellow-600 text-white px-2 py-1 rounded">
                  +{selectedAchievement.reward.coins} Monedas
                </span>
              )}
              {selectedAchievement.reward.badge && (
                <span className="text-xs bg-pink-600 text-white px-2 py-1 rounded">
                  Badge: {selectedAchievement.reward.badge}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default {
  ACHIEVEMENTS_CATALOG,
  USER_LEVELS,
  calculateLevel,
  getLevelInfo,
  getLevelProgress,
  isAchievementUnlocked,
  AchievementCard,
  LevelPanel,
  AchievementsGallery,
};
