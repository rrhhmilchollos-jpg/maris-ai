/**
 * DOMINO Chain - Sistema de Retos de Baile y Batallas VS
 * Retos virales de baile con competencias en tiempo real
 */

import React, { useState, useEffect } from 'react';
import { Music, Users, Trophy, Flame, Heart, Share2, Play, Pause, Volume2, VolumeX } from 'lucide-react';

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

type DanceStyle = 'trending' | 'choreography' | 'freestyle' | 'group' | 'challenge';

interface DanceChallenge {
  id: string;
  title: string;
  description: string;
  style: DanceStyle;
  difficulty: 'easy' | 'medium' | 'hard';
  song: {
    title: string;
    artist: string;
    duration: number; // en segundos
    spotifyUrl?: string;
    youtubeUrl?: string;
  };
  choreography?: string; // URL a video de coreografía
  kindnessReward: number;
  platformReward: number;
  icon: string;
  color: string;
  trendingScore: number; // 0-100 (qué tan viral es)
  participantsCount: number;
  createdAt: Date;
}

interface DanceBattle {
  id: string;
  challengeId: string;
  participant1: {
    userId: string;
    username: string;
    avatar: string;
    videoUrl: string;
    votes: number;
  };
  participant2: {
    userId: string;
    username: string;
    avatar: string;
    videoUrl: string;
    votes: number;
  };
  status: 'ongoing' | 'voting' | 'completed';
  startedAt: Date;
  endedAt?: Date;
  totalVoters: number;
  winner?: 'participant1' | 'participant2' | 'tie';
  prizePool: number; // Créditos en juego
}

interface UserVote {
  userId: string;
  battleId: string;
  votedFor: 'participant1' | 'participant2';
  timestamp: Date;
  creditsEarned: number;
}

// ============================================================================
// RETOS DE BAILE INICIALES
// ============================================================================

export const DANCE_CHALLENGES: DanceChallenge[] = [
  // 🎵 TRENDING (Tendencias Virales)
  {
    id: 'dance-trending-1',
    title: 'Baile TikTok Viral #1',
    description: 'Baila el trend más viral del momento - ¡Todos lo están haciendo!',
    style: 'trending',
    difficulty: 'easy',
    song: {
      title: 'Levitating',
      artist: 'Dua Lipa',
      duration: 203,
      spotifyUrl: 'https://open.spotify.com/track/...',
      youtubeUrl: 'https://www.youtube.com/watch?v=...',
    },
    kindnessReward: 100,
    platformReward: 8,
    icon: '🎵',
    color: 'from-pink-500 to-purple-500',
    trendingScore: 95,
    participantsCount: 15000,
    createdAt: new Date(),
  },
  {
    id: 'dance-trending-2',
    title: 'Reto de Baile Instagram Reels',
    description: 'Participa en el reto de baile que está arrasando en Instagram',
    style: 'trending',
    difficulty: 'easy',
    song: {
      title: 'As It Was',
      artist: 'Harry Styles',
      duration: 173,
    },
    kindnessReward: 120,
    platformReward: 10,
    icon: '📱',
    color: 'from-purple-500 to-pink-500',
    trendingScore: 88,
    participantsCount: 12000,
    createdAt: new Date(),
  },
  {
    id: 'dance-trending-3',
    title: 'Baile Shuffle Challenge',
    description: 'Domina el shuffle - el baile más cool del momento',
    style: 'trending',
    difficulty: 'medium',
    song: {
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      duration: 200,
    },
    kindnessReward: 150,
    platformReward: 12,
    icon: '⚡',
    color: 'from-blue-500 to-cyan-500',
    trendingScore: 82,
    participantsCount: 8500,
    createdAt: new Date(),
  },

  // 💃 COREOGRAFÍA (Coreografías Completas)
  {
    id: 'dance-choreo-1',
    title: 'Coreografía K-POP Completa',
    description: 'Aprende y baila la coreografía completa de un hit K-POP',
    style: 'choreography',
    difficulty: 'hard',
    song: {
      title: 'Dynamite',
      artist: 'BTS',
      duration: 239,
    },
    choreography: 'https://www.youtube.com/watch?v=...',
    kindnessReward: 250,
    platformReward: 18,
    icon: '💃',
    color: 'from-red-500 to-pink-500',
    trendingScore: 75,
    participantsCount: 5000,
    createdAt: new Date(),
  },
  {
    id: 'dance-choreo-2',
    title: 'Baile Clásico - Salsa',
    description: 'Aprende los pasos básicos de salsa con coreografía profesional',
    style: 'choreography',
    difficulty: 'medium',
    song: {
      title: 'Vivir Mi Vida',
      artist: 'Marc Anthony',
      duration: 240,
    },
    choreography: 'https://www.youtube.com/watch?v=...',
    kindnessReward: 200,
    platformReward: 15,
    icon: '🔥',
    color: 'from-orange-500 to-red-500',
    trendingScore: 65,
    participantsCount: 3200,
    createdAt: new Date(),
  },
  {
    id: 'dance-choreo-3',
    title: 'Coreografía Hip-Hop Profesional',
    description: 'Domina la coreografía completa de un hit hip-hop',
    style: 'choreography',
    difficulty: 'hard',
    song: {
      title: 'Uptown Funk',
      artist: 'Mark Ronson ft. Bruno Mars',
      duration: 269,
    },
    choreography: 'https://www.youtube.com/watch?v=...',
    kindnessReward: 300,
    platformReward: 20,
    icon: '🎤',
    color: 'from-yellow-500 to-orange-500',
    trendingScore: 70,
    participantsCount: 4500,
    createdAt: new Date(),
  },

  // 🎭 FREESTYLE (Estilo Libre)
  {
    id: 'dance-freestyle-1',
    title: 'Baila Libremente - Canción Clásica',
    description: 'Baila como quieras a esta canción clásica - ¡Sin límites!',
    style: 'freestyle',
    difficulty: 'easy',
    song: {
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      duration: 354,
    },
    kindnessReward: 150,
    platformReward: 12,
    icon: '🎭',
    color: 'from-indigo-500 to-purple-500',
    trendingScore: 60,
    participantsCount: 2800,
    createdAt: new Date(),
  },
  {
    id: 'dance-freestyle-2',
    title: 'Freestyle - Canción Favorita',
    description: 'Elige tu canción favorita y baila como sientas',
    style: 'freestyle',
    difficulty: 'easy',
    song: {
      title: 'Your Song',
      artist: 'Elton John',
      duration: 228,
    },
    kindnessReward: 120,
    platformReward: 10,
    icon: '🎵',
    color: 'from-green-500 to-teal-500',
    trendingScore: 55,
    participantsCount: 2000,
    createdAt: new Date(),
  },

  // 👥 GRUPO (Bailes Grupales)
  {
    id: 'dance-group-1',
    title: 'Baile Grupal - Flash Mob',
    description: 'Organiza un flash mob con amigos - ¡Coreografía grupal!',
    style: 'group',
    difficulty: 'medium',
    song: {
      title: 'Don\'t Stop Me Now',
      artist: 'Queen',
      duration: 219,
    },
    kindnessReward: 300,
    platformReward: 20,
    icon: '👥',
    color: 'from-cyan-500 to-blue-500',
    trendingScore: 72,
    participantsCount: 6000,
    createdAt: new Date(),
  },
  {
    id: 'dance-group-2',
    title: 'Baile Sincronizado - Grupo de 4',
    description: 'Baila sincronizado con 3 amigos más - ¡Perfección total!',
    style: 'group',
    difficulty: 'hard',
    song: {
      title: 'Thriller',
      artist: 'Michael Jackson',
      duration: 357,
    },
    kindnessReward: 400,
    platformReward: 25,
    icon: '🧟',
    color: 'from-gray-700 to-gray-900',
    trendingScore: 80,
    participantsCount: 7500,
    createdAt: new Date(),
  },

  // 🏆 DESAFÍOS ESPECIALES
  {
    id: 'dance-challenge-1',
    title: 'Baile Sorpresa - Reto Aleatorio',
    description: 'Se te asignará una canción aleatoria - ¡Improvisa!',
    style: 'challenge',
    difficulty: 'hard',
    song: {
      title: 'Random Song',
      artist: 'Various',
      duration: 180,
    },
    kindnessReward: 350,
    platformReward: 22,
    icon: '🎲',
    color: 'from-red-500 to-yellow-500',
    trendingScore: 85,
    participantsCount: 9000,
    createdAt: new Date(),
  },
  {
    id: 'dance-challenge-2',
    title: 'Baile Dueto - Colaboración',
    description: 'Baila con un amigo en formato dueto - ¡Sincronización perfecta!',
    style: 'challenge',
    difficulty: 'medium',
    song: {
      title: 'Shallow',
      artist: 'Lady Gaga & Bradley Cooper',
      duration: 216,
    },
    kindnessReward: 280,
    platformReward: 18,
    icon: '💑',
    color: 'from-pink-500 to-red-500',
    trendingScore: 78,
    participantsCount: 5500,
    createdAt: new Date(),
  },
];

// ============================================================================
// COMPONENTES
// ============================================================================

/**
 * Tarjeta de Reto de Baile
 */
export const DanceChallengeCard: React.FC<{
  challenge: DanceChallenge;
  onStartChallenge: (challengeId: string) => void;
  onStartBattle: (challengeId: string) => void;
}> = ({ challenge, onStartChallenge, onStartBattle }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const getDifficultyColor = (difficulty: string) => {
    const colors: Record<string, string> = {
      easy: 'bg-green-100 text-green-800',
      medium: 'bg-yellow-100 text-yellow-800',
      hard: 'bg-red-100 text-red-800',
    };
    return colors[difficulty] || 'bg-gray-100 text-gray-800';
  };

  const getStyleBadge = (style: DanceStyle) => {
    const badges: Record<DanceStyle, string> = {
      trending: '🔥 Trending',
      choreography: '💃 Coreografía',
      freestyle: '🎭 Freestyle',
      group: '👥 Grupo',
      challenge: '🏆 Desafío',
    };
    return badges[style];
  };

  return (
    <div className={`bg-gradient-to-br ${challenge.color} p-6 rounded-lg shadow-lg text-white overflow-hidden`}>
      {/* Encabezado */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <span className="text-4xl">{challenge.icon}</span>
          <h3 className="text-xl font-bold mt-2">{challenge.title}</h3>
        </div>
        <div className="flex flex-col items-end space-y-2">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getDifficultyColor(challenge.difficulty)}`}>
            {challenge.difficulty.toUpperCase()}
          </span>
          <span className="text-xs bg-white bg-opacity-20 px-2 py-1 rounded">
            {getStyleBadge(challenge.style)}
          </span>
        </div>
      </div>

      {/* Descripción */}
      <p className="text-sm opacity-90 mb-4">{challenge.description}</p>

      {/* Información de la Canción */}
      <div className="bg-white bg-opacity-10 p-3 rounded mb-4">
        <p className="text-sm font-semibold">{challenge.song.title}</p>
        <p className="text-xs opacity-75">{challenge.song.artist}</p>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs">{Math.floor(challenge.song.duration / 60)}:{String(challenge.song.duration % 60).padStart(2, '0')}</span>
          <div className="flex space-x-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition"
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Estadísticas */}
      <div className="grid grid-cols-3 gap-2 mb-4 text-sm">
        <div className="text-center">
          <Heart size={16} className="mx-auto mb-1" />
          <p>+{challenge.kindnessReward}</p>
        </div>
        <div className="text-center">
          <Flame size={16} className="mx-auto mb-1" />
          <p>{challenge.trendingScore}% Viral</p>
        </div>
        <div className="text-center">
          <Users size={16} className="mx-auto mb-1" />
          <p>{(challenge.participantsCount / 1000).toFixed(1)}k</p>
        </div>
      </div>

      {/* Botones de Acción */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onStartChallenge(challenge.id)}
          className="bg-white text-gray-800 font-semibold py-2 rounded-lg hover:bg-opacity-90 transition"
        >
          Bailar Solo
        </button>
        <button
          onClick={() => onStartBattle(challenge.id)}
          className="bg-yellow-400 text-gray-800 font-semibold py-2 rounded-lg hover:bg-yellow-300 transition flex items-center justify-center space-x-1"
        >
          <Trophy size={16} />
          <span>VS Battle</span>
        </button>
      </div>
    </div>
  );
};

/**
 * Componente de Batalla VS
 */
export const DanceBattleComponent: React.FC<{
  battle: DanceBattle;
  currentUserId: string;
  onVote: (participantId: 'participant1' | 'participant2') => void;
}> = ({ battle, currentUserId, onVote }) => {
  const [hasVoted, setHasVoted] = useState(false);
  const [votedFor, setVotedFor] = useState<'participant1' | 'participant2' | null>(null);

  const handleVote = (participant: 'participant1' | 'participant2') => {
    if (!hasVoted) {
      onVote(participant);
      setHasVoted(true);
      setVotedFor(participant);
    }
  };

  const totalVotes = battle.participant1.votes + battle.participant2.votes;
  const p1Percentage = totalVotes > 0 ? (battle.participant1.votes / totalVotes) * 100 : 50;
  const p2Percentage = totalVotes > 0 ? (battle.participant2.votes / totalVotes) * 100 : 50;

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Encabezado */}
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white p-4">
        <h2 className="text-2xl font-bold flex items-center space-x-2">
          <Trophy size={24} />
          <span>BATALLA DE BAILE</span>
        </h2>
        <p className="text-sm opacity-90">Premio: {battle.prizePool} créditos</p>
      </div>

      {/* Participantes */}
      <div className="grid grid-cols-2 gap-4 p-6">
        {/* Participante 1 */}
        <div className={`text-center p-4 rounded-lg border-2 ${votedFor === 'participant1' ? 'border-purple-600 bg-purple-50' : 'border-gray-200'}`}>
          <img
            src={battle.participant1.avatar}
            alt={battle.participant1.username}
            className="w-16 h-16 rounded-full mx-auto mb-2"
          />
          <h3 className="font-bold text-gray-800">{battle.participant1.username}</h3>
          <video
            src={battle.participant1.videoUrl}
            className="w-full rounded-lg my-3 bg-gray-200"
            controls
          />
          <div className="mb-3">
            <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
              <div
                className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${p1Percentage}%` }}
              />
            </div>
            <p className="text-sm font-semibold text-gray-700">{battle.participant1.votes} votos ({p1Percentage.toFixed(0)}%)</p>
          </div>
          <button
            onClick={() => handleVote('participant1')}
            disabled={hasVoted}
            className={`w-full py-2 rounded-lg font-semibold transition ${
              votedFor === 'participant1'
                ? 'bg-purple-600 text-white'
                : hasVoted
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-purple-600 text-white hover:bg-purple-700'
            }`}
          >
            {votedFor === 'participant1' ? '✓ Votado' : hasVoted ? 'Ya votaste' : 'Votar'}
          </button>
        </div>

        {/* Participante 2 */}
        <div className={`text-center p-4 rounded-lg border-2 ${votedFor === 'participant2' ? 'border-pink-600 bg-pink-50' : 'border-gray-200'}`}>
          <img
            src={battle.participant2.avatar}
            alt={battle.participant2.username}
            className="w-16 h-16 rounded-full mx-auto mb-2"
          />
          <h3 className="font-bold text-gray-800">{battle.participant2.username}</h3>
          <video
            src={battle.participant2.videoUrl}
            className="w-full rounded-lg my-3 bg-gray-200"
            controls
          />
          <div className="mb-3">
            <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
              <div
                className="bg-pink-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${p2Percentage}%` }}
              />
            </div>
            <p className="text-sm font-semibold text-gray-700">{battle.participant2.votes} votos ({p2Percentage.toFixed(0)}%)</p>
          </div>
          <button
            onClick={() => handleVote('participant2')}
            disabled={hasVoted}
            className={`w-full py-2 rounded-lg font-semibold transition ${
              votedFor === 'participant2'
                ? 'bg-pink-600 text-white'
                : hasVoted
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-pink-600 text-white hover:bg-pink-700'
            }`}
          >
            {votedFor === 'participant2' ? '✓ Votado' : hasVoted ? 'Ya votaste' : 'Votar'}
          </button>
        </div>
      </div>

      {/* Información de la Batalla */}
      <div className="bg-gray-50 p-4 border-t">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-sm text-gray-600">Total de Votantes</p>
            <p className="text-2xl font-bold text-gray-800">{battle.totalVoters}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Estado</p>
            <p className="text-lg font-bold text-purple-600">{battle.status === 'voting' ? 'Votando' : battle.status === 'completed' ? 'Finalizada' : 'En Vivo'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Créditos en Juego</p>
            <p className="text-2xl font-bold text-green-600">+{battle.prizePool}</p>
          </div>
        </div>
      </div>

      {/* Botón de Compartir */}
      <div className="p-4 border-t">
        <button className="w-full bg-blue-600 text-white font-semibold py-2 rounded-lg hover:bg-blue-700 transition flex items-center justify-center space-x-2">
          <Share2 size={18} />
          <span>Compartir Batalla</span>
        </button>
      </div>
    </div>
  );
};

/**
 * Lista de Retos de Baile
 */
export const DanceChallengesList: React.FC<{
  challenges: DanceChallenge[];
  onStartChallenge: (challengeId: string) => void;
  onStartBattle: (challengeId: string) => void;
  filter?: DanceStyle;
}> = ({ challenges, onStartChallenge, onStartBattle, filter }) => {
  const filtered = filter ? challenges.filter((c) => c.style === filter) : challenges;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {filtered.map((challenge) => (
        <DanceChallengeCard
          key={challenge.id}
          challenge={challenge}
          onStartChallenge={onStartChallenge}
          onStartBattle={onStartBattle}
        />
      ))}
    </div>
  );
};

export default {
  DANCE_CHALLENGES,
  DanceChallengeCard,
  DanceBattleComponent,
  DanceChallengesList,
};
