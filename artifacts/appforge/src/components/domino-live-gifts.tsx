/**
 * DOMINO Chain - Sistema de Regalos en Vivo (Live Gifts)
 * Similar a TikTok - Monetización directa durante batallas
 */

import React, { useState, useEffect } from 'react';
import { Heart, Flame, Sparkles, Gift, Send, TrendingUp, Crown, AlertCircle } from 'lucide-react';

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export type GiftRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface Gift {
  id: string;
  name: string;
  description: string;
  icon: string; // Emoji o URL
  value: number; // Créditos
  rarity: GiftRarity;
  color: string; // Gradient color
  animation: string; // Tipo de animación
  soundEffect?: string; // URL del sonido
  particleEffect?: string; // Tipo de partículas
  multiplier?: number; // Multiplicador de valor
}

export interface LiveGiftTransaction {
  id: string;
  giftId: string;
  senderId: string;
  senderUsername: string;
  senderAvatar: string;
  receiverId: string;
  receiverUsername: string;
  battleId: string;
  quantity: number;
  totalValue: number;
  creatorEarnings: number;
  platformEarnings: number;
  timestamp: Date;
}

export interface GiftInventory {
  userId: string;
  gifts: Map<string, number>; // giftId -> cantidad
  totalSpent: number;
  totalReceived: number;
  favoriteGift?: string;
}

export interface TopDonator {
  userId: string;
  username: string;
  avatar: string;
  totalGiftsValue: number;
  giftsCount: number;
  rank: number;
  badge: string;
}

// ============================================================================
// CATÁLOGO DE REGALOS
// ============================================================================

export const GIFT_CATALOG: Gift[] = [
  // COMMON (1-10 créditos)
  {
    id: 'gift-rose',
    name: 'Rosa',
    description: 'Una hermosa rosa roja',
    icon: '🌹',
    value: 1,
    rarity: 'common',
    color: 'from-red-300 to-red-500',
    animation: 'float-up',
    particleEffect: 'rose-petals',
  },
  {
    id: 'gift-heart',
    name: 'Corazón',
    description: 'Un corazón lleno de amor',
    icon: '❤️',
    value: 5,
    rarity: 'common',
    color: 'from-pink-300 to-red-500',
    animation: 'pulse',
    particleEffect: 'hearts',
  },
  {
    id: 'gift-star',
    name: 'Estrella',
    description: 'Una estrella brillante',
    icon: '⭐',
    value: 10,
    rarity: 'common',
    color: 'from-yellow-300 to-yellow-500',
    animation: 'spin',
    particleEffect: 'sparkles',
  },

  // UNCOMMON (10-5 créditos)
  {
    id: 'gift-fire',
    name: 'Fuego',
    description: '¡Está muy caliente!',
    icon: '🔥',
    value: 25,
    rarity: 'uncommon',
    color: 'from-orange-400 to-red-600',
    animation: 'bounce',
    particleEffect: 'fire',
    soundEffect: 'fire-sound.mp3',
  },
  {
    id: 'gift-diamond',
    name: 'Diamante',
    description: 'Un diamante precioso',
    icon: '💎',
    value: 50,
    rarity: 'uncommon',
    color: 'from-cyan-300 to-blue-500',
    animation: 'rotate',
    particleEffect: 'diamonds',
    soundEffect: 'diamond-sound.mp3',
  },
  {
    id: 'gift-crown',
    name: 'Corona',
    description: 'Eres la reina/rey',
    icon: '👑',
    value: 50,
    rarity: 'uncommon',
    color: 'from-yellow-400 to-yellow-600',
    animation: 'wobble',
    particleEffect: 'gold-sparkles',
    soundEffect: 'crown-sound.mp3',
  },

  // RARE (50-200 créditos)
  {
    id: 'gift-unicorn',
    name: 'Unicornio',
    description: 'Un unicornio mágico',
    icon: '🦄',
    value: 100,
    rarity: 'rare',
    color: 'from-purple-400 to-pink-500',
    animation: 'fly',
    particleEffect: 'rainbow-sparkles',
    soundEffect: 'magic-sound.mp3',
  },
  {
    id: 'gift-rocket',
    name: 'Cohete',
    description: '¡Despega hacia la fama!',
    icon: '🚀',
    value: 150,
    rarity: 'rare',
    color: 'from-red-400 to-yellow-500',
    animation: 'launch',
    particleEffect: 'smoke-trail',
    soundEffect: 'rocket-sound.mp3',
  },
  {
    id: 'gift-airplane',
    name: 'Avión',
    description: 'Vuela alto',
    icon: '✈️',
    value: 200,
    rarity: 'rare',
    color: 'from-blue-300 to-blue-600',
    animation: 'fly-across',
    particleEffect: 'clouds',
    soundEffect: 'airplane-sound.mp3',
  },

  // EPIC (200-1000 créditos)
  {
    id: 'gift-dragon',
    name: 'Dragón',
    description: 'Un dragón épico',
    icon: '🐉',
    value: 500,
    rarity: 'epic',
    color: 'from-purple-600 to-red-600',
    animation: 'roar',
    particleEffect: 'fire-explosion',
    soundEffect: 'dragon-roar.mp3',
    multiplier: 1.5,
  },
  {
    id: 'gift-volcano',
    name: 'Volcán',
    description: 'Una erupción de pasión',
    icon: '🌋',
    value: 750,
    rarity: 'epic',
    color: 'from-red-600 to-yellow-600',
    animation: 'erupt',
    particleEffect: 'lava-explosion',
    soundEffect: 'volcano-sound.mp3',
    multiplier: 1.5,
  },
  {
    id: 'gift-spaceship',
    name: 'Nave Espacial',
    description: 'Viaja al espacio',
    icon: '🛸',
    value: 1000,
    rarity: 'epic',
    color: 'from-indigo-600 to-purple-600',
    animation: 'teleport',
    particleEffect: 'warp-effect',
    soundEffect: 'spaceship-sound.mp3',
    multiplier: 1.5,
  },

  // LEGENDARY (1000+ créditos)
  {
    id: 'gift-castle',
    name: 'Castillo Domino',
    description: 'El regalo supremo',
    icon: '🏰',
    value: 5000,
    rarity: 'legendary',
    color: 'from-yellow-500 via-red-500 to-purple-600',
    animation: 'build-up',
    particleEffect: 'fireworks',
    soundEffect: 'castle-sound.mp3',
    multiplier: 2,
  },
  {
    id: 'gift-crown-jewels',
    name: 'Joyas de la Corona',
    description: 'Lo más valioso',
    icon: '👑💎',
    value: 10000,
    rarity: 'legendary',
    color: 'from-yellow-400 via-purple-500 to-pink-600',
    animation: 'explode',
    particleEffect: 'mega-fireworks',
    soundEffect: 'epic-sound.mp3',
    multiplier: 2,
  },
];

// ============================================================================
// COMPONENTES
// ============================================================================

/**
 * Tienda de Regalos
 */
export const GiftShop: React.FC<{
  onSelectGift: (gift: Gift, quantity: number) => void;
  userBalance: number;
  isLoading?: boolean;
}> = ({ onSelectGift, userBalance, isLoading }) => {
  const [selectedRarity, setSelectedRarity] = useState<GiftRarity | 'all'>('all');
  const [quantity, setQuantity] = useState(1);
  const [selectedGift, setSelectedGift] = useState<Gift | null>(null);

  const filteredGifts = selectedRarity === 'all' 
    ? GIFT_CATALOG 
    : GIFT_CATALOG.filter(g => g.rarity === selectedRarity);

  const handleSendGift = (gift: Gift) => {
    if (gift.value * quantity <= userBalance) {
      onSelectGift(gift, quantity);
      setQuantity(1);
    }
  };

  const getRarityColor = (rarity: GiftRarity) => {
    const colors: Record<GiftRarity, string> = {
      common: 'bg-gray-100 text-gray-800',
      uncommon: 'bg-green-100 text-green-800',
      rare: 'bg-blue-100 text-blue-800',
      epic: 'bg-purple-100 text-purple-800',
      legendary: 'bg-yellow-100 text-yellow-800',
    };
    return colors[rarity];
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">🎁 Tienda de Regalos</h2>

      {/* Filtros de Rareza */}
      <div className="flex space-x-2 mb-6 overflow-x-auto pb-2">
        <button
          onClick={() => setSelectedRarity('all')}
          className={`px-4 py-2 rounded-full whitespace-nowrap transition ${
            selectedRarity === 'all'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
          }`}
        >
          Todos
        </button>
        {(['common', 'uncommon', 'rare', 'epic', 'legendary'] as GiftRarity[]).map((rarity) => (
          <button
            key={rarity}
            onClick={() => setSelectedRarity(rarity)}
            className={`px-4 py-2 rounded-full whitespace-nowrap transition ${
              selectedRarity === rarity
                ? `${getRarityColor(rarity)} border-2 border-current`
                : `${getRarityColor(rarity)} hover:opacity-80`
            }`}
          >
            {rarity.charAt(0).toUpperCase() + rarity.slice(1)}
          </button>
        ))}
      </div>

      {/* Grid de Regalos */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        {filteredGifts.map((gift) => (
          <div
            key={gift.id}
            onClick={() => setSelectedGift(gift)}
            className={`p-4 rounded-lg cursor-pointer transition transform hover:scale-105 ${
              selectedGift?.id === gift.id
                ? `bg-gradient-to-br ${gift.color} text-white border-4 border-white`
                : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            <div className="text-4xl mb-2 text-center">{gift.icon}</div>
            <p className="font-bold text-sm text-center">{gift.name}</p>
            <p className={`text-xs text-center mt-1 ${selectedGift?.id === gift.id ? 'text-white' : 'text-gray-600'}`}>
              {gift.value} créditos
            </p>
            <span className={`text-xs mt-2 inline-block px-2 py-1 rounded-full ${getRarityColor(gift.rarity)}`}>
              {gift.rarity}
            </span>
          </div>
        ))}
      </div>

      {/* Detalles y Envío */}
      {selectedGift && (
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-4 rounded-lg mb-4">
          <h3 className="font-bold text-lg mb-2">{selectedGift.name}</h3>
          <p className="text-gray-600 mb-3">{selectedGift.description}</p>

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-gray-600">Cantidad</p>
              <div className="flex items-center space-x-2 mt-1">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-2 py-1 bg-gray-300 rounded hover:bg-gray-400"
                >
                  −
                </button>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-12 text-center border border-gray-300 rounded"
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="px-2 py-1 bg-gray-300 rounded hover:bg-gray-400"
                >
                  +
                </button>
              </div>
            </div>

            <div className="text-right">
              <p className="text-sm text-gray-600">Costo Total</p>
              <p className="text-2xl font-bold text-purple-600">
                {selectedGift.value * quantity}
              </p>
              <p className={`text-xs mt-1 ${userBalance >= selectedGift.value * quantity ? 'text-green-600' : 'text-red-600'}`}>
                Tienes: {userBalance}
              </p>
            </div>
          </div>

          <button
            onClick={() => handleSendGift(selectedGift)}
            disabled={isLoading || userBalance < selectedGift.value * quantity}
            className={`w-full py-2 rounded-lg font-semibold transition flex items-center justify-center space-x-2 ${
              userBalance >= selectedGift.value * quantity
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:shadow-lg'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            <Send size={18} />
            <span>{isLoading ? 'Enviando...' : 'Enviar Regalo'}</span>
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Animación de Regalo en Vivo
 */
export const LiveGiftAnimation: React.FC<{
  gift: Gift;
  senderUsername: string;
  quantity: number;
  onComplete?: () => void;
}> = ({ gift, senderUsername, quantity, onComplete }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onComplete?.();
    }, 3000);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50">
      <div className={`animate-${gift.animation} text-8xl drop-shadow-lg`}>
        {gift.icon}
      </div>
      <div className="absolute bottom-20 text-center">
        <p className="text-white text-lg font-bold drop-shadow-lg">
          {senderUsername} envió {quantity}x {gift.name}
        </p>
      </div>

      {/* Partículas de efecto */}
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className={`absolute w-2 h-2 bg-${gift.color.split('-')[1]}-400 rounded-full animate-pulse`}
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animation: `float-up 2s ease-out forwards`,
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  );
};

/**
 * Leaderboard de Top Donadores
 */
export const TopDonatorsLeaderboard: React.FC<{
  donators: TopDonator[];
  currentUserId?: string;
}> = ({ donators, currentUserId }) => {
  const getRankBadge = (rank: number) => {
    const badges: Record<number, string> = {
      1: '🥇',
      2: '🥈',
      3: '🥉',
    };
    return badges[rank] || `#${rank}`;
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center space-x-2">
        <TrendingUp size={24} />
        <span>Top Donadores</span>
      </h2>

      <div className="space-y-3">
        {donators.slice(0, 10).map((donator) => (
          <div
            key={donator.userId}
            className={`flex items-center justify-between p-3 rounded-lg transition ${
              currentUserId === donator.userId
                ? 'bg-purple-100 border-2 border-purple-600'
                : 'bg-gray-50 hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center space-x-3 flex-1">
              <span className="text-2xl">{getRankBadge(donator.rank)}</span>
              <img
                src={donator.avatar}
                alt={donator.username}
                className="w-10 h-10 rounded-full"
              />
              <div className="flex-1">
                <p className="font-semibold text-gray-800">{donator.username}</p>
                <p className="text-xs text-gray-600">{donator.giftsCount} regalos</p>
              </div>
            </div>

            <div className="text-right">
              <p className="font-bold text-purple-600">{donator.totalGiftsValue.toLocaleString()}</p>
              <p className="text-xs text-gray-600">créditos</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Panel de Regalos Recibidos en Batalla
 */
export const BattleGiftsPanel: React.FC<{
  participant1Gifts: LiveGiftTransaction[];
  participant2Gifts: LiveGiftTransaction[];
  onSendGift?: (participantId: 'participant1' | 'participant2') => void;
}> = ({ participant1Gifts, participant2Gifts, onSendGift }) => {
  const calculateTotalValue = (gifts: LiveGiftTransaction[]) =>
    gifts.reduce((sum, g) => sum + g.totalValue, 0);

  const p1Total = calculateTotalValue(participant1Gifts);
  const p2Total = calculateTotalValue(participant2Gifts);
  const grandTotal = p1Total + p2Total;

  return (
    <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg p-4 mb-4">
      <h3 className="font-bold text-lg mb-3">🎁 Regalos en Vivo</h3>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Participante 1 */}
        <div className="bg-white bg-opacity-10 p-3 rounded-lg">
          <p className="text-sm opacity-90 mb-2">Participante 1</p>
          <p className="text-2xl font-bold">{p1Total.toLocaleString()}</p>
          <p className="text-xs opacity-75">{participant1Gifts.length} regalos</p>
          <button
            onClick={() => onSendGift?.('participant1')}
            className="mt-2 w-full bg-white text-purple-600 py-1 rounded text-sm font-semibold hover:bg-opacity-90 transition"
          >
            Enviar Regalo
          </button>
        </div>

        {/* Participante 2 */}
        <div className="bg-white bg-opacity-10 p-3 rounded-lg">
          <p className="text-sm opacity-90 mb-2">Participante 2</p>
          <p className="text-2xl font-bold">{p2Total.toLocaleString()}</p>
          <p className="text-xs opacity-75">{participant2Gifts.length} regalos</p>
          <button
            onClick={() => onSendGift?.('participant2')}
            className="mt-2 w-full bg-white text-purple-600 py-1 rounded text-sm font-semibold hover:bg-opacity-90 transition"
          >
            Enviar Regalo
          </button>
        </div>
      </div>

      {/* Barra de Progreso */}
      {grandTotal > 0 && (
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span>{(p1Total / grandTotal * 100).toFixed(0)}%</span>
            <span>Total: {grandTotal.toLocaleString()}</span>
            <span>{(p2Total / grandTotal * 100).toFixed(0)}%</span>
          </div>
          <div className="w-full bg-white bg-opacity-20 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-400 to-cyan-400 h-full transition-all duration-300"
              style={{ width: `${(p1Total / grandTotal) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default {
  GIFT_CATALOG,
  GiftShop,
  LiveGiftAnimation,
  TopDonatorsLeaderboard,
  BattleGiftsPanel,
};
