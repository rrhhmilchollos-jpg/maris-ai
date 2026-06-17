/**
 * DOMINO Chain - Controles Administrativos Exclusivos
 * Solo para rrhh.milchollos@gmail.com
 */

import React, { useState, useEffect } from 'react';
import { AlertCircle, Power, Lock, Shield, Activity, Zap } from 'lucide-react';

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export type AdminRole = 'owner' | 'moderator' | 'none';

export interface AdminUser {
  email: string;
  role: AdminRole;
  permissions: string[];
  createdAt: Date;
}

export interface GenerationSession {
  id: string;
  userId: string;
  appName: string;
  status: 'running' | 'paused' | 'stopped' | 'completed';
  progress: number; // 0-100
  startedAt: Date;
  estimatedCompletion?: Date;
  complexity: 'simple' | 'moderate' | 'complex';
}

// ============================================================================
// CONFIGURACIÓN DE ADMINISTRADORES
// ============================================================================

// LISTA BLANCA: Solo estos emails pueden usar controles administrativos
const ADMIN_WHITELIST: AdminUser[] = [
  {
    email: 'rrhh.milchollos@gmail.com',
    role: 'owner',
    permissions: [
      'stop-generation',
      'pause-generation',
      'view-all-sessions',
      'view-analytics',
      'manage-users',
      'emergency-shutdown',
    ],
    createdAt: new Date('2026-01-01'),
  },
];

// ============================================================================
// FUNCIONES DE VALIDACIÓN
// ============================================================================

/**
 * Verifica si un usuario es administrador
 */
export function isAdminUser(email: string): boolean {
  return ADMIN_WHITELIST.some((admin) => admin.email === email);
}

/**
 * Obtiene el rol de un usuario
 */
export function getUserRole(email: string): AdminRole {
  const admin = ADMIN_WHITELIST.find((a) => a.email === email);
  return admin?.role || 'none';
}

/**
 * Verifica si un usuario tiene una permisión específica
 */
export function hasPermission(email: string, permission: string): boolean {
  const admin = ADMIN_WHITELIST.find((a) => a.email === email);
  return admin?.permissions.includes(permission) || false;
}

/**
 * Valida que SOLO rrhh.milchollos@gmail.com pueda ejecutar una acción
 */
export function validateOwnerOnly(email: string, action: string): { valid: boolean; error?: string } {
  if (email !== 'rrhh.milchollos@gmail.com') {
    return {
      valid: false,
      error: `❌ Acción no autorizada. Solo el propietario puede ${action}.`,
    };
  }
  return { valid: true };
}

// ============================================================================
// COMPONENTES
// ============================================================================

/**
 * Botón de Parada de Emergencia (Solo para el propietario)
 */
export const EmergencyStopButton: React.FC<{
  userEmail: string;
  isGenerating: boolean;
  onStop: () => Promise<void>;
  isLoading?: boolean;
}> = ({ userEmail, isGenerating, onStop, isLoading }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const validation = validateOwnerOnly(userEmail, 'parar generaciones');

  if (!validation.valid) {
    return null; // No mostrar el botón si no es el propietario
  }

  const handleStop = async () => {
    setIsExecuting(true);
    try {
      await onStop();
      setShowConfirm(false);
    } finally {
      setIsExecuting(false);
    }
  };

  if (!isGenerating) {
    return null; // No mostrar si no hay generación en curso
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {showConfirm && (
        <div className="absolute bottom-16 right-0 bg-red-600 text-white p-4 rounded-lg shadow-lg mb-2 w-64">
          <p className="font-bold mb-3">⚠️ ¿Parar generación?</p>
          <p className="text-sm mb-4">Esta acción detendrá inmediatamente el proceso en curso.</p>
          <div className="flex space-x-2">
            <button
              onClick={handleStop}
              disabled={isExecuting}
              className="flex-1 bg-white text-red-600 py-2 rounded font-bold hover:bg-red-50 disabled:opacity-50"
            >
              {isExecuting ? 'Parando...' : 'Sí, Parar'}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              disabled={isExecuting}
              className="flex-1 bg-red-700 text-white py-2 rounded font-bold hover:bg-red-800 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setShowConfirm(!showConfirm)}
        disabled={isLoading || isExecuting}
        className="bg-gradient-to-r from-red-600 to-red-700 text-white px-6 py-3 rounded-full font-bold shadow-lg hover:shadow-xl hover:scale-105 transition transform disabled:opacity-50 flex items-center space-x-2"
      >
        <Power size={20} />
        <span>⏹️ Parar Ahora</span>
      </button>

      {/* Indicador de generación activa */}
      <div className="absolute -top-2 -right-2 flex items-center space-x-1 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold animate-pulse">
        <Activity size={12} />
        <span>Generando...</span>
      </div>
    </div>
  );
};

/**
 * Panel de Control Administrativo
 */
export const AdminControlPanel: React.FC<{
  userEmail: string;
  currentSessions: GenerationSession[];
  onStopSession: (sessionId: string) => Promise<void>;
  onPauseSession?: (sessionId: string) => Promise<void>;
}> = ({ userEmail, currentSessions, onStopSession, onPauseSession }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const validation = validateOwnerOnly(userEmail, 'acceder al panel de control');

  if (!validation.valid) {
    return null;
  }

  const activeSessions = currentSessions.filter((s) => s.status === 'running');

  return (
    <div className="fixed top-6 right-6 z-50">
      {/* Botón de Acceso */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-2 rounded-full shadow-lg hover:shadow-xl transition flex items-center space-x-2"
      >
        <Shield size={18} />
        <span>🔐 Admin</span>
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="absolute top-12 right-0 bg-white rounded-lg shadow-2xl p-6 w-96 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800 flex items-center space-x-2">
              <Shield size={20} />
              <span>Panel de Control</span>
            </h2>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </div>

          {/* Información del Usuario */}
          <div className="bg-purple-50 p-3 rounded-lg mb-4">
            <p className="text-sm text-gray-600">Usuario Autenticado</p>
            <p className="font-bold text-purple-600">{userEmail}</p>
            <p className="text-xs text-gray-500 mt-1">👑 Propietario (Acceso Total)</p>
          </div>

          {/* Sesiones Activas */}
          <div className="mb-4">
            <h3 className="font-bold text-gray-800 mb-2">
              Generaciones Activas ({activeSessions.length})
            </h3>

            {activeSessions.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No hay generaciones en curso</p>
            ) : (
              <div className="space-y-2">
                {activeSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`p-3 rounded-lg border-2 cursor-pointer transition ${
                      selectedSession === session.id
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-gray-200 bg-gray-50 hover:border-purple-400'
                    }`}
                    onClick={() => setSelectedSession(session.id)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-semibold text-gray-800">{session.appName}</p>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        session.complexity === 'complex'
                          ? 'bg-red-100 text-red-800'
                          : session.complexity === 'moderate'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {session.complexity}
                      </span>
                    </div>

                    {/* Barra de Progreso */}
                    <div className="mb-2">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600">Progreso</span>
                        <span className="font-bold text-purple-600">{session.progress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-purple-600 to-pink-600 h-full transition-all duration-300"
                          style={{ width: `${session.progress}%` }}
                        />
                      </div>
                    </div>

                    <p className="text-xs text-gray-500">
                      Iniciada: {session.startedAt.toLocaleTimeString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Acciones */}
          {selectedSession && (
            <div className="border-t pt-4">
              <h3 className="font-bold text-gray-800 mb-2">Acciones</h3>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    onStopSession(selectedSession);
                    setSelectedSession(null);
                  }}
                  className="w-full bg-red-600 text-white py-2 rounded-lg font-semibold hover:bg-red-700 transition flex items-center justify-center space-x-2"
                >
                  <Power size={16} />
                  <span>Parar Generación</span>
                </button>

                {onPauseSession && (
                  <button
                    onClick={() => {
                      onPauseSession(selectedSession);
                      setSelectedSession(null);
                    }}
                    className="w-full bg-yellow-600 text-white py-2 rounded-lg font-semibold hover:bg-yellow-700 transition flex items-center justify-center space-x-2"
                  >
                    <Zap size={16} />
                    <span>Pausar Generación</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Indicador de Acceso Restringido
 */
export const RestrictedAccessWarning: React.FC<{
  userEmail: string;
  action: string;
}> = ({ userEmail, action }) => {
  const validation = validateOwnerOnly(userEmail, action);

  if (validation.valid) {
    return null;
  }

  return (
    <div className="fixed top-6 left-6 bg-red-100 border-2 border-red-600 text-red-800 px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 z-50">
      <AlertCircle size={20} />
      <div>
        <p className="font-bold">Acceso Denegado</p>
        <p className="text-sm">{validation.error}</p>
      </div>
    </div>
  );
};

export default {
  ADMIN_WHITELIST,
  isAdminUser,
  getUserRole,
  hasPermission,
  validateOwnerOnly,
  EmergencyStopButton,
  AdminControlPanel,
  RestrictedAccessWarning,
};
