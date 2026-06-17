/**
 * DOMINO Chain - Leaderboards Globales en Tiempo Real
 * Rankings por categoría con actualizaciones en vivo
 */

import React, { useState, useEffect } from 'react';
import { Trophy, TrendingUp, Flame, Heart, Zap } from 'lucide-react';

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export type LeaderboardType = 'gifts-sent' | 'gifts-received' | 'spending' | 'level' | 'achievements' | 'weekly';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar?: string;
  value: number;
  badge?: string;
  level?: number;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: number;
}

export interface LeaderboardData {
  type: LeaderboardType;
  title: string;
  icon: string;
  description: string;
  entries: LeaderboardEntry[];
  lastUpdated: Date;
  period?: 'all-time' | 'monthly' | 'weekly' | 'daily';
}

// ============================================================================
// DATOS SIMULADOS DE LEADERBOARDS
// ============================================================================

export const generateMockLeaderboards = (): Record<LeaderboardType, LeaderboardData> => {
  const mockUsers = [
    { id: '1', name: 'CristalGaming', avatar: '👑' },
    { id: '2', name: 'VibeMaster', avatar: '🎵' },
    { id: '3', name: 'LunaStars', avatar: '⭐' },
    { id: '4', name: 'PhoenixRise', avatar: '🔥' },
    { id: '5', name: 'SilverKnight', avatar: '⚔️' },
    { id: '6', name: 'GoldenHeart', avatar: '💛' },
    { id: '7', name: 'NeonDreams', avatar: '💜' },
    { id: '8', name: 'ThunderStrike', avatar: '⚡' },
    { id: '9', name: 'ShadowNinja', avatar: '🥷' },
    { id: '10', name: 'CosmicWave', avatar: '🌊' },
  ];

  return {
    'gifts-sent': {
      type: 'gifts-sent',
      title: 'Regalos Enviados',
      icon: '🎁',
      description: 'Los usuarios que más regalos han enviado',
      period: 'all-time',
      lastUpdated: new Date(),
      entries: mockUsers.map((user, i) => ({
        rank: i + 1,
        userId: user.id,
        username: user.name,
        avatar: user.avatar,
        value: Math.floor(Math.random() * 5000) + 1000,
        badge: i < 3 ? ['🥇', '🥈', '🥉'][i] : undefined,
        trend: ['up', 'down', 'stable'][Math.floor(Math.random() * 3)] as any,
        trendValue: Math.floor(Math.random() * 100),
      })),
    },
    'gifts-received': {
      type: 'gifts-received',
      title: 'Regalos Recibidos',
      icon: '❤️',
      description: 'Los usuarios más queridos',
      period: 'all-time',
      lastUpdated: new Date(),
      entries: mockUsers.map((user, i) => ({
        rank: i + 1,
        userId: user.id,
        username: user.name,
        avatar: user.avatar,
        value: Math.floor(Math.random() * 3000) + 500,
        badge: i < 3 ? ['🥇', '🥈', '🥉'][i] : undefined,
        trend: ['up', 'down', 'stable'][Math.floor(Math.random() * 3)] as any,
        trendValue: Math.floor(Math.random() * 50),
      })),
    },
    spending: {
      type: 'spending',
      title: 'Mayor Gasto',
      icon: '💰',
      description: 'Los mayores inversores en regalos',
      period: 'monthly',
      lastUpdated: new Date(),
      entries: mockUsers.map((user, i) => ({
        rank: i + 1,
        userId: user.id,
        username: user.name,
        avatar: user.avatar,
        value: Math.floor(Math.random() * 50000) + 10000,
        badge: i === 0 ? '🐋' : undefined,
        trend: ['up', 'down', 'stable'][Math.floor(Math.random() * 3)] as any,
        trendValue: Math.floor(Math.random() * 1000),
      })),
    },
    level: {
      type: 'level',
      title: 'Nivel Más Alto',
      icon: '🏆',
      description: 'Los usuarios de mayor nivel',
      period: 'all-time',
      lastUpdated: new Date(),
      entries: mockUsers.map((user, i) => ({
        rank: i + 1,
        userId: user.id,
        username: user.name,
        avatar: user.avatar,
        value: 100 - i * 5,
        level: 100 - i * 5,
        badge: i < 3 ? ['🥇', '🥈', '🥉'][i] : undefined,
        trend: 'stable' as any,
      })),
    },
    achievements: {
      type: 'achievements',
      title: 'Logros Desbloqueados',
      icon: '🎖️',
      description: 'Los usuarios con más logros',
      period: 'all-time',
      lastUpdated: new Date(),
      entries: mockUsers.map((user, i) => ({
        rank: i + 1,
        userId: user.id,
        username: user.name,
        avatar: user.avatar,
        value: 50 - i * 3,
        badge: i < 3 ? ['🥇', '🥈', '🥉'][i] : undefined,
        trend: ['up', 'down', 'stable'][Math.floor(Math.random() * 3)] as any,
        trendValue: Math.floor(Math.random() * 5),
      })),
    },
    weekly: {
      type: 'weekly',
      title: 'Ranking Semanal',
      icon: '🔥',
      description: 'Top 10 de esta semana',
      period: 'weekly',
      lastUpdated: new Date(),
      entries: mockUsers.map((user, i) => ({
        rank: i + 1,
        userId: user.id,
        username: user.name,
        avatar: user.avatar,
        value: Math.floor(Math.random() * 1000),
        badge: i < 3 ? ['🥇', '🥈', '🥉'][i] : undefined,
        trend: ['up', 'down', 'stable'][Math.floor(Math.random() * 3)] as any,
        trendValue: Math.floor(Math.random() * 20),
      })),
    },
  };
};

// ============================================================================
// COMPONENTES
// ============================================================================

/**
 * Fila de Leaderboard
 */
export const LeaderboardRow: React.FC<{
  entry: LeaderboardEntry;
  type: LeaderboardType;
  isCurrentUser?: boolean;
}> = ({ entry, type, isCurrentUser }) => {
  const getRankColor = (rank: number) => {
    if (rank === 1) return 'from-yellow-400 to-yellow-600';
    if (rank === 2) return 'from-gray-300 to-gray-500';
    if (rank === 3) return 'from-orange-400 to-orange-600';
    return 'from-gray-600 to-gray-800';
  };

  const getTrendIcon = (trend?: string) => {
    if (trend === 'up') return '📈';
    if (trend === 'down') return '📉';
    return '➡️';
  };

  const formatValue = (value: number, type: LeaderboardType) => {
    if (type === 'spending') {
      return `€${(value / 100).toFixed(2)}`;
    }
    return value.toString();
  };

  return (
    <div
      className={`flex items-center justify-between p-4 rounded-lg mb-2 transition ${
        isCurrentUser
          ? 'bg-gradient-to-r from-purple-600 to-pink-600 border-2 border-white'
          : 'bg-gray-800 hover:bg-gray-700'
      }`}
    >
      <div className="flex items-center gap-3 flex-1">
        {/* Posición */}
        <div className={`bg-gradient-to-br ${getRankColor(entry.rank)} text-white font-bold w-10 h-10 rounded-full flex items-center justify-center`}>
          {entry.badge || entry.rank}
        </div>

        {/* Avatar y nombre */}
        <div className="flex items-center gap-2">
          <span className="text-2xl">{entry.avatar}</span>
          <div>
            <p className={`font-semibold ${isCurrentUser ? 'text-white' : 'text-gray-200'}`}>
              {entry.username}
              {isCurrentUser && ' (Tú)'}
            </p>
            {entry.level && (
              <p className={`text-xs ${isCurrentUser ? 'text-purple-200' : 'text-gray-400'}`}>
                Nivel {entry.level}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Valor */}
      <div className="text-right">
        <p className={`font-bold text-lg ${isCurrentUser ? 'text-white' : 'text-gray-300'}`}>
          {formatValue(entry.value, type)}
        </p>
        {entry.trendValue && (
          <p className={`text-xs flex items-center justify-end gap-1 ${
            entry.trend === 'up' ? 'text-green-400' : entry.trend === 'down' ? 'text-red-400' : 'text-gray-400'
          }`}>
            {getTrendIcon(entry.trend)} {entry.trendValue}
          </p>
        )}
      </div>
    </div>
  );
};

/**
 * Leaderboard Completo
 */
export const LeaderboardView: React.FC<{
  data: LeaderboardData;
  currentUserId?: string;
  onUserClick?: (userId: string) => void;
}> = ({ data, currentUserId, onUserClick }) => {
  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            {data.icon} {data.title}
          </h2>
          <p className="text-gray-400 text-sm mt-1">{data.description}</p>
        </div>
        {data.period && (
          <span className="bg-purple-600 text-white px-3 py-1 rounded-full text-xs font-semibold">
            {data.period === 'all-time' && 'Todo el tiempo'}
            {data.period === 'monthly' && 'Este mes'}
            {data.period === 'weekly' && 'Esta semana'}
            {data.period === 'daily' && 'Hoy'}
          </span>
        )}
      </div>

      {/* Top 3 Destacados */}
      {data.entries.slice(0, 3).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {data.entries.slice(0, 3).map((entry, i) => (
            <div
              key={entry.userId}
              className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-4 border-2 border-yellow-500 text-center cursor-pointer hover:scale-105 transition"
              onClick={() => onUserClick?.(entry.userId)}
            >
              <div className="text-4xl mb-2">
                {['🥇', '🥈', '🥉'][i]}
              </div>
              <p className="text-xl font-bold text-white mb-1">{entry.avatar} {entry.username}</p>
              <p className="text-2xl font-bold text-yellow-400">
                {data.type === 'spending' ? `€${(entry.value / 100).toFixed(2)}` : entry.value}
              </p>
              {entry.level && (
                <p className="text-sm text-gray-400 mt-2">Nivel {entry.level}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lista completa */}
      <div className="space-y-2">
        {data.entries.map((entry) => (
          <div
            key={entry.userId}
            onClick={() => onUserClick?.(entry.userId)}
            className="cursor-pointer"
          >
            <LeaderboardRow
              entry={entry}
              type={data.type}
              isCurrentUser={entry.userId === currentUserId}
            />
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-gray-700">
        <p className="text-xs text-gray-400 text-center">
          Última actualización: {data.lastUpdated.toLocaleTimeString('es-ES')}
        </p>
      </div>
    </div>
  );
};

/**
 * Selector de Leaderboards
 */
export const LeaderboardSelector: React.FC<{
  leaderboards: Record<LeaderboardType, LeaderboardData>;
  selectedType: LeaderboardType;
  onSelect: (type: LeaderboardType) => void;
  currentUserId?: string;
}> = ({ leaderboards, selectedType, onSelect, currentUserId }) => {
  const types: LeaderboardType[] = ['gifts-sent', 'gifts-received', 'spending', 'level', 'achievements', 'weekly'];

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {types.map((type) => (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className={`px-4 py-2 rounded-full whitespace-nowrap transition font-semibold ${
              selectedType === type
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
            }`}
          >
            {leaderboards[type].icon} {leaderboards[type].title}
          </button>
        ))}
      </div>

      {/* Leaderboard View */}
      <LeaderboardView
        data={leaderboards[selectedType]}
        currentUserId={currentUserId}
      />
    </div>
  );
};

/**
 * Mini Leaderboard (para sidebar)
 */
export const MiniLeaderboard: React.FC<{
  data: LeaderboardData;
  limit?: number;
}> = ({ data, limit = 5 }) => {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
        {data.icon} {data.title}
      </h3>
      <div className="space-y-2">
        {data.entries.slice(0, limit).map((entry) => (
          <div key={entry.userId} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-yellow-400">#{entry.rank}</span>
              <span className="text-lg">{entry.avatar}</span>
              <span className="text-sm text-gray-300 truncate">{entry.username}</span>
            </div>
            <span className="text-sm font-bold text-white">
              {data.type === 'spending' ? `€${(entry.value / 100).toFixed(2)}` : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default {
  generateMockLeaderboards,
  LeaderboardRow,
  LeaderboardView,
  LeaderboardSelector,
  MiniLeaderboard,
};
