/**
 * DOMINO Chain - Dashboard Personal del Usuario
 * Perfil, estadísticas, historial y logros
 */

import React, { useState } from 'react';
import { User, Share2, Users, TrendingUp, Gift, Trophy, Zap, Heart } from 'lucide-react';

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export interface UserProfile {
  id: string;
  username: string;
  avatar: string;
  email?: string;
  bio?: string;
  level: number;
  xp: number;
  totalXP: number;
  joinedAt: Date;
  followers: number;
  following: number;
  isVerified?: boolean;
  badge?: string;
}

export interface UserStatistics {
  giftsSent: number;
  giftsReceived: number;
  totalSpent: number;
  totalEarned: number;
  achievements: number;
  streak: number;
  rank: number;
  avgGiftValue: number;
}

export interface GiftHistory {
  id: string;
  type: 'sent' | 'received';
  giftName: string;
  giftIcon: string;
  fromUser?: string;
  toUser?: string;
  amount: number;
  timestamp: Date;
  message?: string;
}

// ============================================================================
// COMPONENTES
// ============================================================================

/**
 * Tarjeta de Perfil
 */
export const ProfileCard: React.FC<{
  profile: UserProfile;
  onFollow?: () => void;
  onShare?: () => void;
  isCurrentUser?: boolean;
}> = ({ profile, onFollow, onShare, isCurrentUser }) => {
  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600 relative overflow-hidden">
      {/* Fondo decorativo */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-purple-600 to-pink-600 opacity-10 rounded-full blur-3xl" />

      {/* Header */}
      <div className="flex items-start justify-between mb-4 relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-4xl">
            {profile.avatar}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-white">{profile.username}</h2>
              {profile.isVerified && <span className="text-blue-400">✓</span>}
            </div>
            <p className="text-gray-400 text-sm">{profile.email}</p>
            {profile.bio && <p className="text-gray-300 text-sm mt-1">{profile.bio}</p>}
          </div>
        </div>
        {profile.badge && <span className="text-3xl">{profile.badge}</span>}
      </div>

      {/* Nivel y XP */}
      <div className="bg-gray-800 rounded-lg p-4 mb-4 relative z-10">
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-400 text-sm">Nivel</span>
          <span className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            {profile.level}
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-600 to-pink-600 transition-all duration-300"
            style={{ width: `${(profile.xp / profile.totalXP) * 100}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {profile.xp} / {profile.totalXP} XP
        </p>
      </div>

      {/* Estadísticas rápidas */}
      <div className="grid grid-cols-3 gap-2 mb-4 relative z-10">
        <div className="bg-gray-800 rounded p-2 text-center">
          <p className="text-xs text-gray-400">Seguidores</p>
          <p className="text-lg font-bold text-white">{profile.followers}</p>
        </div>
        <div className="bg-gray-800 rounded p-2 text-center">
          <p className="text-xs text-gray-400">Siguiendo</p>
          <p className="text-lg font-bold text-white">{profile.following}</p>
        </div>
        <div className="bg-gray-800 rounded p-2 text-center">
          <p className="text-xs text-gray-400">Miembro desde</p>
          <p className="text-lg font-bold text-white">
            {profile.joinedAt.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })}
          </p>
        </div>
      </div>

      {/* Botones */}
      <div className="flex gap-2 relative z-10">
        {!isCurrentUser && (
          <button
            onClick={onFollow}
            className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white py-2 rounded-lg font-semibold transition flex items-center justify-center gap-2"
          >
            <Users size={16} />
            Seguir
          </button>
        )}
        <button
          onClick={onShare}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg font-semibold transition flex items-center justify-center gap-2"
        >
          <Share2 size={16} />
          Compartir
        </button>
      </div>
    </div>
  );
};

/**
 * Panel de Estadísticas
 */
export const StatisticsPanel: React.FC<{ stats: UserStatistics }> = ({ stats }) => {
  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <TrendingUp size={20} />
        Estadísticas
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* Regalos Enviados */}
        <div className="bg-gradient-to-br from-red-600 to-red-700 rounded-lg p-4">
          <p className="text-sm text-red-200 mb-1">Regalos Enviados</p>
          <p className="text-3xl font-bold text-white">{stats.giftsSent}</p>
          <p className="text-xs text-red-200 mt-2">Promedio: €{stats.avgGiftValue.toFixed(2)}</p>
        </div>

        {/* Regalos Recibidos */}
        <div className="bg-gradient-to-br from-pink-600 to-pink-700 rounded-lg p-4">
          <p className="text-sm text-pink-200 mb-1">Regalos Recibidos</p>
          <p className="text-3xl font-bold text-white">{stats.giftsReceived}</p>
          <p className="text-xs text-pink-200 mt-2">Valor total: €{stats.totalEarned.toFixed(2)}</p>
        </div>

        {/* Total Gastado */}
        <div className="bg-gradient-to-br from-yellow-600 to-yellow-700 rounded-lg p-4">
          <p className="text-sm text-yellow-200 mb-1">Total Gastado</p>
          <p className="text-3xl font-bold text-white">€{stats.totalSpent.toFixed(2)}</p>
          <p className="text-xs text-yellow-200 mt-2">Inversión</p>
        </div>

        {/* Logros */}
        <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-lg p-4">
          <p className="text-sm text-purple-200 mb-1">Logros</p>
          <p className="text-3xl font-bold text-white">{stats.achievements}</p>
          <p className="text-xs text-purple-200 mt-2">Desbloqueados</p>
        </div>

        {/* Racha */}
        <div className="bg-gradient-to-br from-orange-600 to-orange-700 rounded-lg p-4">
          <p className="text-sm text-orange-200 mb-1">Racha Actual</p>
          <p className="text-3xl font-bold text-white">{stats.streak} 🔥</p>
          <p className="text-xs text-orange-200 mt-2">Días consecutivos</p>
        </div>

        {/* Ranking */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg p-4">
          <p className="text-sm text-blue-200 mb-1">Ranking Global</p>
          <p className="text-3xl font-bold text-white">#{stats.rank}</p>
          <p className="text-xs text-blue-200 mt-2">Posición</p>
        </div>
      </div>
    </div>
  );
};

/**
 * Historial de Regalos
 */
export const GiftHistory: React.FC<{
  history?: GiftHistory[];
  limit?: number;
}> = ({ history = [], limit = 10 }) => {
  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Gift size={20} />
        Historial de Regalos
      </h3>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {history.slice(0, limit).length > 0 ? (
          history.slice(0, limit).map((entry) => (
            <div
              key={entry.id}
              className={`p-3 rounded-lg border-l-4 transition ${
                entry.type === 'sent'
                  ? 'bg-gray-800 border-red-500'
                  : 'bg-gray-800 border-green-500'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <span className="text-2xl">{entry.giftIcon}</span>
                  <div>
                    <p className="font-semibold text-white">{entry.giftName}</p>
                    <p className="text-xs text-gray-400">
                      {entry.type === 'sent' ? `→ ${entry.toUser}` : `← ${entry.fromUser}`}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-bold ${entry.type === 'sent' ? 'text-red-400' : 'text-green-400'}`}>
                    {entry.type === 'sent' ? '-' : '+'}€{entry.amount.toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-400">
                    {entry.timestamp.toLocaleTimeString('es-ES', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
              {entry.message && (
                <p className="text-xs text-gray-300 mt-2 italic">"{entry.message}"</p>
              )}
            </div>
          ))
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-400">Sin historial de regalos</p>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Dashboard Completo
 */
export const UserDashboard: React.FC<{
  profile: UserProfile;
  stats: UserStatistics;
  giftHistory?: GiftHistory[];
  isCurrentUser?: boolean;
  onFollow?: () => void;
  onShare?: () => void;
}> = ({ profile, stats, giftHistory = [], isCurrentUser, onFollow, onShare }) => {
  return (
    <div className="space-y-6">
      {/* Perfil */}
      <ProfileCard
        profile={profile}
        onFollow={onFollow}
        onShare={onShare}
        isCurrentUser={isCurrentUser}
      />

      {/* Estadísticas */}
      <StatisticsPanel stats={stats} />

      {/* Historial */}
      <GiftHistory history={giftHistory} />
    </div>
  );
};

/**
 * Generador de datos de ejemplo
 */
export function generateMockUserProfile(): UserProfile {
  return {
    id: 'user-123',
    username: 'CristalGaming',
    avatar: '👑',
    email: 'cristal@domino.dev',
    bio: '🎮 Streamer | 💜 Amante de los regalos | 🔥 Siempre en vivo',
    level: 25,
    xp: 8500,
    totalXP: 15000,
    joinedAt: new Date('2026-01-15'),
    followers: 2450,
    following: 180,
    isVerified: true,
    badge: '👑',
  };
}

export function generateMockUserStatistics(): UserStatistics {
  return {
    giftsSent: 1250,
    giftsReceived: 3450,
    totalSpent: 2500.5,
    totalEarned: 1850.75,
    achievements: 18,
    streak: 42,
    rank: 5,
    avgGiftValue: 2.0,
  };
}

export function generateMockGiftHistory(): GiftHistory[] {
  return [
    {
      id: '1',
      type: 'sent',
      giftName: 'Dragón',
      giftIcon: '🐉',
      toUser: 'VibeMaster',
      amount: 5.0,
      timestamp: new Date(Date.now() - 5 * 60000),
      message: '¡Eres increíble!',
    },
    {
      id: '2',
      type: 'received',
      giftName: 'Castillo Domino',
      giftIcon: '🏰',
      fromUser: 'LunaStars',
      amount: 50.0,
      timestamp: new Date(Date.now() - 15 * 60000),
    },
    {
      id: '3',
      type: 'sent',
      giftName: 'Cohete',
      giftIcon: '🚀',
      toUser: 'PhoenixRise',
      amount: 1.5,
      timestamp: new Date(Date.now() - 30 * 60000),
      message: 'Vamos a la fama',
    },
    {
      id: '4',
      type: 'received',
      giftName: 'Rey León',
      giftIcon: '🦁👑',
      fromUser: 'ThunderStrike',
      amount: 299.99,
      timestamp: new Date(Date.now() - 1 * 3600000),
    },
    {
      id: '5',
      type: 'sent',
      giftName: 'Unicornio',
      giftIcon: '🦄',
      toUser: 'SilverKnight',
      amount: 1.0,
      timestamp: new Date(Date.now() - 2 * 3600000),
    },
  ];
}

export default {
  ProfileCard,
  StatisticsPanel,
  GiftHistory,
  UserDashboard,
  generateMockUserProfile,
  generateMockUserStatistics,
  generateMockGiftHistory,
};
