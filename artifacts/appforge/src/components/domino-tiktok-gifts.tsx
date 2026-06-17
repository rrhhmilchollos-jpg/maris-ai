/**
 * DOMINO Chain - Regalos Estilo TikTok con Precios Reales
 * Precios en Euros (€) - Efectos Interactivos
 */

import React, { useState, useEffect } from 'react';
import { Send, Sparkles, Heart, Flame } from 'lucide-react';

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export type GiftRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface TikTokGift {
  id: string;
  name: string;
  description: string;
  icon: string; // Emoji
  coins: number; // Monedas TikTok (1 moneda = €0.01)
  priceEUR: number; // Precio en Euros
  rarity: GiftRarity;
  color: string;
  animation: string;
  soundEffect?: string;
  particleEffect?: string;
  popularity: number; // 0-100 (qué tan popular es)
}

export interface GiftAnimationEffect {
  type: 'float' | 'spin' | 'bounce' | 'explode' | 'rain' | 'fireworks' | 'hearts' | 'stars';
  duration: number; // ms
  intensity: number; // 0-100
  color: string;
}

// ============================================================================
// CATÁLOGO DE REGALOS TIKTOK (PRECIOS REALES)
// ============================================================================

export const TIKTOK_GIFT_CATALOG: TikTokGift[] = [
  // COMMON (Regalos básicos)
  {
    id: 'rose',
    name: 'Rosa',
    description: 'Una hermosa rosa roja',
    icon: '🌹',
    coins: 1,
    priceEUR: 0.01,
    rarity: 'common',
    color: 'from-red-300 to-red-500',
    animation: 'float-up',
    particleEffect: 'rose-petals',
    popularity: 95,
  },
  {
    id: 'heart',
    name: 'Corazón',
    description: 'Un corazón lleno de amor',
    icon: '❤️',
    coins: 5,
    priceEUR: 0.05,
    rarity: 'common',
    color: 'from-pink-300 to-red-500',
    animation: 'pulse',
    particleEffect: 'hearts',
    popularity: 98,
  },
  {
    id: 'star',
    name: 'Estrella',
    description: 'Una estrella brillante',
    icon: '⭐',
    coins: 10,
    priceEUR: 0.10,
    rarity: 'common',
    color: 'from-yellow-300 to-yellow-500',
    animation: 'spin',
    particleEffect: 'sparkles',
    popularity: 92,
  },

  // UNCOMMON
  {
    id: 'fire',
    name: 'Fuego',
    description: '¡Está muy caliente!',
    icon: '🔥',
    coins: 25,
    priceEUR: 0.25,
    rarity: 'uncommon',
    color: 'from-orange-400 to-red-600',
    animation: 'bounce',
    particleEffect: 'fire',
    soundEffect: 'fire-sound.mp3',
    popularity: 88,
  },
  {
    id: 'diamond',
    name: 'Diamante',
    description: 'Un diamante precioso',
    icon: '💎',
    coins: 50,
    priceEUR: 0.50,
    rarity: 'uncommon',
    color: 'from-cyan-300 to-blue-500',
    animation: 'rotate',
    particleEffect: 'diamonds',
    soundEffect: 'diamond-sound.mp3',
    popularity: 85,
  },
  {
    id: 'crown',
    name: 'Corona',
    description: 'Eres la reina/rey',
    icon: '👑',
    coins: 50,
    priceEUR: 0.50,
    rarity: 'uncommon',
    color: 'from-yellow-400 to-yellow-600',
    animation: 'wobble',
    particleEffect: 'gold-sparkles',
    soundEffect: 'crown-sound.mp3',
    popularity: 82,
  },
  {
    id: 'bear',
    name: 'Oso',
    description: 'Un oso adorable',
    icon: '🐻',
    coins: 99,
    priceEUR: 0.99,
    rarity: 'uncommon',
    color: 'from-amber-400 to-amber-600',
    animation: 'wave',
    particleEffect: 'confetti',
    popularity: 79,
  },

  // RARE
  {
    id: 'unicorn',
    name: 'Unicornio',
    description: 'Un unicornio mágico',
    icon: '🦄',
    coins: 100,
    priceEUR: 1.00,
    rarity: 'rare',
    color: 'from-purple-400 to-pink-500',
    animation: 'fly',
    particleEffect: 'rainbow-sparkles',
    soundEffect: 'magic-sound.mp3',
    popularity: 91,
  },
  {
    id: 'rocket',
    name: 'Cohete',
    description: '¡Despega hacia la fama!',
    icon: '🚀',
    coins: 150,
    priceEUR: 1.50,
    rarity: 'rare',
    color: 'from-red-400 to-yellow-500',
    animation: 'launch',
    particleEffect: 'smoke-trail',
    soundEffect: 'rocket-sound.mp3',
    popularity: 87,
  },
  {
    id: 'airplane',
    name: 'Avión',
    description: 'Vuela alto',
    icon: '✈️',
    coins: 200,
    priceEUR: 2.00,
    rarity: 'rare',
    color: 'from-blue-300 to-blue-600',
    animation: 'fly-across',
    particleEffect: 'clouds',
    soundEffect: 'airplane-sound.mp3',
    popularity: 76,
  },
  {
    id: 'yacht',
    name: 'Yate',
    description: 'Lujo en el agua',
    icon: '⛵',
    coins: 299,
    priceEUR: 2.99,
    rarity: 'rare',
    color: 'from-blue-400 to-cyan-500',
    animation: 'sail',
    particleEffect: 'waves',
    soundEffect: 'water-sound.mp3',
    popularity: 72,
  },

  // EPIC
  {
    id: 'dragon',
    name: 'Dragón',
    description: 'Un dragón épico',
    icon: '🐉',
    coins: 500,
    priceEUR: 5.00,
    rarity: 'epic',
    color: 'from-purple-600 to-red-600',
    animation: 'roar',
    particleEffect: 'fire-explosion',
    soundEffect: 'dragon-roar.mp3',
    popularity: 89,
  },
  {
    id: 'volcano',
    name: 'Volcán',
    description: 'Una erupción de pasión',
    icon: '🌋',
    coins: 750,
    priceEUR: 7.50,
    rarity: 'epic',
    color: 'from-red-600 to-yellow-600',
    animation: 'erupt',
    particleEffect: 'lava-explosion',
    soundEffect: 'volcano-sound.mp3',
    popularity: 81,
  },
  {
    id: 'spaceship',
    name: 'Nave Espacial',
    description: 'Viaja al espacio',
    icon: '🛸',
    coins: 999,
    priceEUR: 9.99,
    rarity: 'epic',
    color: 'from-indigo-600 to-purple-600',
    animation: 'teleport',
    particleEffect: 'warp-effect',
    soundEffect: 'spaceship-sound.mp3',
    popularity: 77,
  },
  {
    id: 'lion',
    name: 'León',
    description: 'El rey de la selva',
    icon: '🦁',
    coins: 1299,
    priceEUR: 12.99,
    rarity: 'epic',
    color: 'from-yellow-600 to-orange-600',
    animation: 'roar',
    particleEffect: 'mane-fire',
    soundEffect: 'lion-roar.mp3',
    popularity: 84,
  },

  // LEGENDARY
  {
    id: 'castle',
    name: 'Castillo Domino',
    description: 'El regalo supremo',
    icon: '🏰',
    coins: 5000,
    priceEUR: 50.00,
    rarity: 'legendary',
    color: 'from-yellow-500 via-red-500 to-purple-600',
    animation: 'build-up',
    particleEffect: 'fireworks',
    soundEffect: 'castle-sound.mp3',
    popularity: 93,
  },
  {
    id: 'crown-jewels',
    name: 'Joyas de la Corona',
    description: 'Lo más valioso',
    icon: '👑💎',
    coins: 9999,
    priceEUR: 99.99,
    rarity: 'legendary',
    color: 'from-yellow-400 via-purple-500 to-pink-600',
    animation: 'explode',
    particleEffect: 'mega-fireworks',
    soundEffect: 'epic-sound.mp3',
    popularity: 96,
  },
  {
    id: 'lion-king',
    name: 'Rey León',
    description: 'El regalo más épico',
    icon: '🦁👑',
    coins: 29999,
    priceEUR: 299.99,
    rarity: 'legendary',
    color: 'from-amber-600 via-red-600 to-purple-600',
    animation: 'roar-epic',
    particleEffect: 'ultimate-fireworks',
    soundEffect: 'king-roar.mp3',
    popularity: 94,
  },
];

// ============================================================================
// EFECTOS VISUALES INTERACTIVOS
// ============================================================================

/**
 * Animación de Regalo Interactiva (Estilo TikTok)
 */
export const InteractiveGiftAnimation: React.FC<{
  gift: TikTokGift;
  senderUsername: string;
  quantity: number;
  onComplete?: () => void;
}> = ({ gift, senderUsername, quantity, onComplete }) => {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number }>>([]);

  useEffect(() => {
    // Crear partículas
    const newParticles = Array.from({ length: 30 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
    }));
    setParticles(newParticles);

    // Auto-completar después de 3 segundos
    const timer = setTimeout(() => {
      onComplete?.();
    }, 3000);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50">
      {/* Fondo degradado */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-600/20 to-pink-600/20 backdrop-blur-sm" />

      {/* Emoji del regalo (animado) */}
      <div className={`animate-${gift.animation} text-9xl drop-shadow-2xl`}>
        {gift.icon}
      </div>

      {/* Información del regalo */}
      <div className="absolute bottom-32 text-center">
        <p className="text-white text-2xl font-bold drop-shadow-lg">
          {senderUsername} envió {quantity}x {gift.name}
        </p>
        <p className="text-white text-lg drop-shadow-lg mt-2">
          €{(gift.priceEUR * quantity).toFixed(2)}
        </p>
      </div>

      {/* Partículas de efecto */}
      {particles.map((particle) => (
        <div
          key={particle.id}
          className={`absolute w-3 h-3 rounded-full animate-pulse`}
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            background: `hsl(${Math.random() * 360}, 100%, 50%)`,
            animation: `float-up 2s ease-out forwards`,
            animationDelay: `${particle.id * 0.05}s`,
          }}
        />
      ))}

      {/* Efecto de brillo */}
      <div className="absolute inset-0 animate-pulse opacity-50">
        <div className={`absolute inset-0 bg-gradient-to-r ${gift.color} blur-3xl`} />
      </div>
    </div>
  );
};

/**
 * Tienda de Regalos Interactiva (Estilo TikTok)
 */
export const TikTokGiftShop: React.FC<{
  onSelectGift: (gift: TikTokGift, quantity: number) => void;
  userBalance: number;
  isLoading?: boolean;
}> = ({ onSelectGift, userBalance, isLoading }) => {
  const [selectedRarity, setSelectedRarity] = useState<GiftRarity | 'all'>('all');
  const [quantity, setQuantity] = useState(1);
  const [selectedGift, setSelectedGift] = useState<TikTokGift | null>(null);
  const [hoveredGift, setHoveredGift] = useState<string | null>(null);

  const filteredGifts = selectedRarity === 'all'
    ? TIKTOK_GIFT_CATALOG
    : TIKTOK_GIFT_CATALOG.filter((g) => g.rarity === selectedRarity);

  const handleSendGift = (gift: TikTokGift) => {
    const totalCost = gift.coins * quantity;
    if (totalCost <= userBalance) {
      onSelectGift(gift, quantity);
      setQuantity(1);
      setSelectedGift(null);
    }
  };

  const getRarityColor = (rarity: GiftRarity) => {
    const colors: Record<GiftRarity, string> = {
      common: 'bg-gray-100 text-gray-800 border-gray-300',
      uncommon: 'bg-green-100 text-green-800 border-green-300',
      rare: 'bg-blue-100 text-blue-800 border-blue-300',
      epic: 'bg-purple-100 text-purple-800 border-purple-300',
      legendary: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    };
    return colors[rarity];
  };

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg shadow-2xl p-6 border border-purple-600">
      <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-4">
        🎁 Tienda de Regalos TikTok
      </h2>

      {/* Filtros de Rareza */}
      <div className="flex space-x-2 mb-6 overflow-x-auto pb-2">
        <button
          onClick={() => setSelectedRarity('all')}
          className={`px-4 py-2 rounded-full whitespace-nowrap transition font-semibold ${
            selectedRarity === 'all'
              ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
              : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
          }`}
        >
          Todos
        </button>
        {(['common', 'uncommon', 'rare', 'epic', 'legendary'] as GiftRarity[]).map((rarity) => (
          <button
            key={rarity}
            onClick={() => setSelectedRarity(rarity)}
            className={`px-4 py-2 rounded-full whitespace-nowrap transition font-semibold border-2 ${
              selectedRarity === rarity
                ? `${getRarityColor(rarity)} border-current`
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
            onMouseEnter={() => setHoveredGift(gift.id)}
            onMouseLeave={() => setHoveredGift(null)}
            onClick={() => setSelectedGift(gift)}
            className={`p-4 rounded-lg cursor-pointer transition transform ${
              selectedGift?.id === gift.id
                ? `bg-gradient-to-br ${gift.color} text-white border-4 border-white scale-105`
                : `bg-gray-800 hover:bg-gray-700 border-2 border-gray-600 ${
                    hoveredGift === gift.id ? 'scale-105' : ''
                  }`
            }`}
          >
            <div className="text-5xl mb-2 text-center animate-bounce">{gift.icon}</div>
            <p className="font-bold text-sm text-center">{gift.name}</p>
            <p className={`text-xs text-center mt-1 ${
              selectedGift?.id === gift.id ? 'text-white' : 'text-gray-400'
            }`}>
              €{gift.priceEUR.toFixed(2)}
            </p>
            <div className="mt-2 flex items-center justify-between">
              <span className={`text-xs px-2 py-1 rounded-full ${getRarityColor(gift.rarity)}`}>
                {gift.rarity}
              </span>
              <span className="text-xs text-yellow-400">🔥 {gift.popularity}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Detalles y Envío */}
      {selectedGift && (
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-4 rounded-lg mb-4 border border-purple-600">
          <h3 className="font-bold text-lg text-white mb-2">{selectedGift.name}</h3>
          <p className="text-gray-300 mb-3">{selectedGift.description}</p>

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-gray-400">Cantidad</p>
              <div className="flex items-center space-x-2 mt-1">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 text-white"
                >
                  −
                </button>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-12 text-center border border-gray-600 rounded bg-gray-700 text-white"
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 text-white"
                >
                  +
                </button>
              </div>
            </div>

            <div className="text-right">
              <p className="text-sm text-gray-400">Costo Total</p>
              <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                €{(selectedGift.priceEUR * quantity).toFixed(2)}
              </p>
              <p className={`text-xs mt-1 ${userBalance >= selectedGift.coins * quantity ? 'text-green-400' : 'text-red-400'}`}>
                Tienes: €{(userBalance * 0.01).toFixed(2)}
              </p>
            </div>
          </div>

          <button
            onClick={() => handleSendGift(selectedGift)}
            disabled={isLoading || userBalance < selectedGift.coins * quantity}
            className={`w-full py-3 rounded-lg font-bold transition flex items-center justify-center space-x-2 text-lg ${
              userBalance >= selectedGift.coins * quantity
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:shadow-lg hover:scale-105'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Send size={20} />
            <span>{isLoading ? 'Enviando...' : 'Enviar Regalo'}</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default {
  TIKTOK_GIFT_CATALOG,
  InteractiveGiftAnimation,
  TikTokGiftShop,
};
