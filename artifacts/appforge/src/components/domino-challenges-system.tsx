/**
 * DOMINO Chain - Sistema de Retos
 * Retos iniciales, gamificación y mecánicas de engagement
 */

import React, { useState, useEffect } from 'react';
import { Heart, Users, Leaf, Book, Dumbbell, Zap, Trophy, Lock, CheckCircle, Clock } from 'lucide-react';

// ============================================================================
// TIPOS Y INTERFACES
// ============================================================================

type ChallengeCategory = 'create' | 'exercise' | 'read' | 'meditate' | 'help' | 'share' | 'connect' | 'plant' | 'recycle' | 'sustainable';

interface Challenge {
  id: string;
  title: string;
  description: string;
  category: ChallengeCategory;
  difficulty: 'easy' | 'medium' | 'hard';
  timeLimit: number; // en minutos
  kindnessReward: number;
  platformReward: number; // Ganancia para la plataforma en %
  icon: React.ReactNode;
  color: string;
  completed: boolean;
  completedAt?: string;
  proof?: string; // URL de imagen/video como prueba
}

interface UserProgress {
  totalChallenges: number;
  completedChallenges: number;
  kindnessCredits: number;
  platformEarnings: number;
  streak: number;
  level: number;
}

// ============================================================================
// RETOS INICIALES
// ============================================================================

const INITIAL_CHALLENGES: Challenge[] = [
  // 🎨 CREAR (Create)
  {
    id: 'create-1',
    title: 'Crea una Obra de Arte',
    description: 'Dibuja, pinta o crea algo hermoso y comparte una foto',
    category: 'create',
    difficulty: 'easy',
    timeLimit: 60,
    kindnessReward: 50,
    platformReward: 5,
    icon: <span>🎨</span>,
    color: 'from-purple-500 to-pink-500',
    completed: false,
  },
  {
    id: 'create-2',
    title: 'Escribe una Carta de Gratitud',
    description: 'Escribe una carta sincera agradeciendo a alguien especial',
    category: 'create',
    difficulty: 'easy',
    timeLimit: 30,
    kindnessReward: 75,
    platformReward: 7,
    icon: <span>✍️</span>,
    color: 'from-blue-500 to-cyan-500',
    completed: false,
  },
  {
    id: 'create-3',
    title: 'Compón una Canción o Poema',
    description: 'Crea una canción, poema o verso original y comparte',
    category: 'create',
    difficulty: 'medium',
    timeLimit: 120,
    kindnessReward: 150,
    platformReward: 10,
    icon: <span>🎵</span>,
    color: 'from-indigo-500 to-purple-500',
    completed: false,
  },

  // 💪 EJERCITAR (Exercise)
  {
    id: 'exercise-1',
    title: 'Camina 30 Minutos',
    description: 'Realiza una caminata de 30 minutos y comparte tu ruta',
    category: 'exercise',
    difficulty: 'easy',
    timeLimit: 30,
    kindnessReward: 100,
    platformReward: 8,
    icon: <Dumbbell className="text-green-500" />,
    color: 'from-green-500 to-emerald-500',
    completed: false,
  },
  {
    id: 'exercise-2',
    title: 'Haz 50 Flexiones',
    description: 'Completa 50 flexiones y graba un video como prueba',
    category: 'exercise',
    difficulty: 'medium',
    timeLimit: 20,
    kindnessReward: 125,
    platformReward: 10,
    icon: <Dumbbell className="text-green-600" />,
    color: 'from-green-600 to-lime-500',
    completed: false,
  },
  {
    id: 'exercise-3',
    title: 'Clase de Yoga o Pilates',
    description: 'Completa una clase de yoga o pilates de 45 minutos',
    category: 'exercise',
    difficulty: 'hard',
    timeLimit: 45,
    kindnessReward: 200,
    platformReward: 15,
    icon: <Dumbbell className="text-green-700" />,
    color: 'from-lime-500 to-green-600',
    completed: false,
  },

  // 📚 LEER (Read)
  {
    id: 'read-1',
    title: 'Lee 30 Páginas',
    description: 'Lee 30 páginas de un libro y comparte tu opinión',
    category: 'read',
    difficulty: 'easy',
    timeLimit: 60,
    kindnessReward: 75,
    platformReward: 6,
    icon: <Book className="text-blue-500" />,
    color: 'from-blue-500 to-blue-600',
    completed: false,
  },
  {
    id: 'read-2',
    title: 'Termina un Libro',
    description: 'Completa la lectura de un libro entero',
    category: 'read',
    difficulty: 'hard',
    timeLimit: 480,
    kindnessReward: 300,
    platformReward: 20,
    icon: <Book className="text-blue-600" />,
    color: 'from-blue-600 to-indigo-500',
    completed: false,
  },

  // 🧘 MEDITAR (Meditate)
  {
    id: 'meditate-1',
    title: 'Meditación de 10 Minutos',
    description: 'Realiza una sesión de meditación de 10 minutos',
    category: 'meditate',
    difficulty: 'easy',
    timeLimit: 10,
    kindnessReward: 80,
    platformReward: 7,
    icon: <span>🧘</span>,
    color: 'from-orange-500 to-red-500',
    completed: false,
  },
  {
    id: 'meditate-2',
    title: 'Meditación Profunda de 30 Minutos',
    description: 'Realiza una meditación profunda de 30 minutos',
    category: 'meditate',
    difficulty: 'medium',
    timeLimit: 30,
    kindnessReward: 150,
    platformReward: 12,
    icon: <span>🧘‍♀️</span>,
    color: 'from-red-500 to-pink-500',
    completed: false,
  },

  // 🤝 AYUDAR (Help)
  {
    id: 'help-1',
    title: 'Ayuda a un Vecino',
    description: 'Ayuda a un vecino con una tarea y comparte la foto',
    category: 'help',
    difficulty: 'easy',
    timeLimit: 60,
    kindnessReward: 120,
    platformReward: 10,
    icon: <Users className="text-red-500" />,
    color: 'from-red-500 to-rose-500',
    completed: false,
  },
  {
    id: 'help-2',
    title: 'Voluntariado Comunitario',
    description: 'Participa en una actividad de voluntariado',
    category: 'help',
    difficulty: 'hard',
    timeLimit: 180,
    kindnessReward: 400,
    platformReward: 25,
    icon: <Users className="text-red-600" />,
    color: 'from-rose-500 to-pink-600',
    completed: false,
  },

  // 💬 COMPARTIR (Share)
  {
    id: 'share-1',
    title: 'Comparte una Historia Inspiradora',
    description: 'Comparte una historia que te inspire en redes sociales',
    category: 'share',
    difficulty: 'easy',
    timeLimit: 15,
    kindnessReward: 60,
    platformReward: 5,
    icon: <span>📱</span>,
    color: 'from-cyan-500 to-blue-500',
    completed: false,
  },
  {
    id: 'share-2',
    title: 'Crea un Meme Positivo',
    description: 'Crea y comparte un meme que haga reír positivamente',
    category: 'share',
    difficulty: 'medium',
    timeLimit: 30,
    kindnessReward: 100,
    platformReward: 8,
    icon: <span>😂</span>,
    color: 'from-blue-500 to-purple-500',
    completed: false,
  },

  // 🌍 CONECTAR (Connect)
  {
    id: 'connect-1',
    title: 'Llama a un Amigo Lejano',
    description: 'Llama a un amigo que no ves hace tiempo',
    category: 'connect',
    difficulty: 'easy',
    timeLimit: 30,
    kindnessReward: 90,
    platformReward: 7,
    icon: <span>📞</span>,
    color: 'from-teal-500 to-cyan-500',
    completed: false,
  },
  {
    id: 'connect-2',
    title: 'Organiza una Reunión',
    description: 'Organiza una reunión con amigos o familia',
    category: 'connect',
    difficulty: 'medium',
    timeLimit: 120,
    kindnessReward: 180,
    platformReward: 12,
    icon: <span>🎉</span>,
    color: 'from-cyan-500 to-teal-600',
    completed: false,
  },

  // 🌱 PLANTAR (Plant)
  {
    id: 'plant-1',
    title: 'Planta un Árbol',
    description: 'Planta un árbol o una planta y comparte la foto',
    category: 'plant',
    difficulty: 'easy',
    timeLimit: 30,
    kindnessReward: 150,
    platformReward: 12,
    icon: <Leaf className="text-green-500" />,
    color: 'from-green-500 to-teal-500',
    completed: false,
  },
  {
    id: 'plant-2',
    title: 'Crea un Huerto Urbano',
    description: 'Crea un pequeño huerto en tu balcón o patio',
    category: 'plant',
    difficulty: 'hard',
    timeLimit: 120,
    kindnessReward: 300,
    platformReward: 20,
    icon: <Leaf className="text-green-600" />,
    color: 'from-teal-500 to-green-600',
    completed: false,
  },

  // ♻️ RECICLAR (Recycle)
  {
    id: 'recycle-1',
    title: 'Recicla Correctamente',
    description: 'Recicla 10 kg de materiales y comparte evidencia',
    category: 'recycle',
    difficulty: 'easy',
    timeLimit: 60,
    kindnessReward: 100,
    platformReward: 8,
    icon: <span>♻️</span>,
    color: 'from-emerald-500 to-green-600',
    completed: false,
  },
  {
    id: 'recycle-2',
    title: 'Programa de Reciclaje Comunitario',
    description: 'Organiza un programa de reciclaje en tu comunidad',
    category: 'recycle',
    difficulty: 'hard',
    timeLimit: 180,
    kindnessReward: 350,
    platformReward: 25,
    icon: <span>♻️♻️</span>,
    color: 'from-green-600 to-emerald-700',
    completed: false,
  },

  // 🚴 SOSTENIBLE (Sustainable)
  {
    id: 'sustainable-1',
    title: 'Usa Transporte Sostenible',
    description: 'Usa bicicleta, transporte público o camina durante un día',
    category: 'sustainable',
    difficulty: 'easy',
    timeLimit: 480,
    kindnessReward: 120,
    platformReward: 10,
    icon: <span>🚴</span>,
    color: 'from-lime-500 to-green-500',
    completed: false,
  },
  {
    id: 'sustainable-2',
    title: 'Reduce tu Huella de Carbono',
    description: 'Implementa 5 cambios sostenibles en tu vida diaria',
    category: 'sustainable',
    difficulty: 'hard',
    timeLimit: 1440,
    kindnessReward: 400,
    platformReward: 30,
    icon: <span>🌍</span>,
    color: 'from-green-500 to-lime-600',
    completed: false,
  },
];

// ============================================================================
// COMPONENTES
// ============================================================================

/**
 * Tarjeta de Reto Individual
 */
export const ChallengeCard: React.FC<{
  challenge: Challenge;
  onComplete: (challengeId: string, proof?: string) => void;
  isLoading?: boolean;
}> = ({ challenge, onComplete, isLoading }) => {
  const [showProofInput, setShowProofInput] = useState(false);
  const [proofUrl, setProofUrl] = useState('');

  const handleComplete = () => {
    if (challenge.difficulty === 'easy') {
      onComplete(challenge.id, proofUrl);
      setShowProofInput(false);
    } else {
      setShowProofInput(true);
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    const colors: Record<string, string> = {
      easy: 'bg-green-100 text-green-800',
      medium: 'bg-yellow-100 text-yellow-800',
      hard: 'bg-red-100 text-red-800',
    };
    return colors[difficulty] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className={`bg-gradient-to-br ${challenge.color} p-6 rounded-lg shadow-lg text-white overflow-hidden relative`}>
      {challenge.completed && (
        <div className="absolute top-2 right-2 bg-green-500 rounded-full p-2">
          <CheckCircle size={24} />
        </div>
      )}

      <div className="flex items-start justify-between mb-4">
        <div className="text-4xl">{challenge.icon}</div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getDifficultyColor(challenge.difficulty)}`}>
          {challenge.difficulty.toUpperCase()}
        </span>
      </div>

      <h3 className="text-xl font-bold mb-2">{challenge.title}</h3>
      <p className="text-sm opacity-90 mb-4">{challenge.description}</p>

      <div className="flex items-center justify-between mb-4 text-sm">
        <div className="flex items-center space-x-1">
          <Clock size={16} />
          <span>{challenge.timeLimit} min</span>
        </div>
        <div className="flex items-center space-x-1">
          <Heart size={16} />
          <span>+{challenge.kindnessReward} créditos</span>
        </div>
      </div>

      {showProofInput && (
        <div className="mb-4 bg-white bg-opacity-20 p-3 rounded">
          <input
            type="text"
            placeholder="URL de foto/video como prueba"
            value={proofUrl}
            onChange={(e) => setProofUrl(e.target.value)}
            className="w-full px-3 py-2 rounded text-gray-800 text-sm"
          />
        </div>
      )}

      <button
        onClick={handleComplete}
        disabled={challenge.completed || isLoading}
        className={`w-full py-2 rounded-lg font-semibold transition ${
          challenge.completed
            ? 'bg-white bg-opacity-30 cursor-not-allowed'
            : 'bg-white text-gray-800 hover:bg-opacity-90'
        }`}
      >
        {challenge.completed ? '✓ Completado' : isLoading ? 'Procesando...' : 'Completar Reto'}
      </button>
    </div>
  );
};

/**
 * Lista de Retos Filtrada
 */
export const ChallengesList: React.FC<{
  challenges: Challenge[];
  onCompleteChallenge: (challengeId: string, proof?: string) => void;
  filter?: ChallengeCategory;
}> = ({ challenges, onCompleteChallenge, filter }) => {
  const filtered = filter ? challenges.filter((c) => c.category === filter) : challenges;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {filtered.map((challenge) => (
        <ChallengeCard
          key={challenge.id}
          challenge={challenge}
          onComplete={onCompleteChallenge}
        />
      ))}
    </div>
  );
};

/**
 * Barra de Progreso del Usuario
 */
export const ProgressBar: React.FC<{ progress: UserProgress }> = ({ progress }) => {
  const completionPercentage = (progress.completedChallenges / progress.totalChallenges) * 100;

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-800">Tu Progreso</h2>
        <div className="flex items-center space-x-2">
          <Trophy className="text-yellow-500" size={24} />
          <span className="text-2xl font-bold text-gray-800">Nivel {progress.level}</span>
        </div>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-4 mb-4 overflow-hidden">
        <div
          className="bg-gradient-to-r from-purple-600 to-pink-600 h-full transition-all duration-500"
          style={{ width: `${completionPercentage}%` }}
        />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-purple-600">{progress.completedChallenges}</p>
          <p className="text-sm text-gray-600">Completados</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-red-600">{progress.kindnessCredits}</p>
          <p className="text-sm text-gray-600">Créditos</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-orange-600">{progress.streak}</p>
          <p className="text-sm text-gray-600">Racha</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-green-600">${progress.platformEarnings}</p>
          <p className="text-sm text-gray-600">Ganancia</p>
        </div>
      </div>
    </div>
  );
};

export default {
  INITIAL_CHALLENGES,
  ChallengeCard,
  ChallengesList,
  ProgressBar,
};
