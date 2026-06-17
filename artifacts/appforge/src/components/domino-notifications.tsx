/**
 * DOMINO Chain - Sistema de Notificaciones en Vivo
 * Alertas de regalos, logros, rankings y eventos
 */

import React, { useState, useEffect } from 'react';
import { Bell, X, Gift, Trophy, TrendingUp, Zap, Heart } from 'lucide-react';

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export type NotificationType = 'gift' | 'achievement' | 'ranking' | 'challenge' | 'competition' | 'milestone';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  icon: string;
  timestamp: Date;
  read: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
  color?: string;
}

// ============================================================================
// FUNCIONES AUXILIARES
// ============================================================================

export function getNotificationIcon(type: NotificationType): string {
  const icons: Record<NotificationType, string> = {
    gift: '🎁',
    achievement: '🏆',
    ranking: '📊',
    challenge: '⚡',
    competition: '🔥',
    milestone: '⭐',
  };
  return icons[type];
}

export function getNotificationColor(type: NotificationType): string {
  const colors: Record<NotificationType, string> = {
    gift: 'from-red-600 to-pink-600',
    achievement: 'from-purple-600 to-purple-700',
    ranking: 'from-blue-600 to-blue-700',
    challenge: 'from-yellow-600 to-yellow-700',
    competition: 'from-orange-600 to-orange-700',
    milestone: 'from-green-600 to-green-700',
  };
  return colors[type];
}

export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Hace unos segundos';
  if (minutes < 60) return `Hace ${minutes}m`;
  if (hours < 24) return `Hace ${hours}h`;
  if (days < 7) return `Hace ${days}d`;
  return date.toLocaleDateString('es-ES');
}

// ============================================================================
// COMPONENTES
// ============================================================================

/**
 * Toast de Notificación (Aparece en la esquina)
 */
export const NotificationToast: React.FC<{
  notification: Notification;
  onClose?: () => void;
  autoClose?: number;
}> = ({ notification, onClose, autoClose = 5000 }) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (autoClose) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onClose?.();
      }, autoClose);
      return () => clearTimeout(timer);
    }
  }, [autoClose, onClose]);

  if (!isVisible) return null;

  const color = getNotificationColor(notification.type);

  return (
    <div
      className={`fixed bottom-4 right-4 bg-gradient-to-r ${color} text-white rounded-lg shadow-2xl p-4 max-w-sm animate-slide-in-right z-50`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{notification.icon}</span>
        <div className="flex-1">
          <h4 className="font-bold text-sm">{notification.title}</h4>
          <p className="text-xs opacity-90 mt-1">{notification.message}</p>
          {notification.action && (
            <button
              onClick={notification.action.onClick}
              className="text-xs font-semibold mt-2 hover:underline"
            >
              {notification.action.label}
            </button>
          )}
        </div>
        <button
          onClick={() => {
            setIsVisible(false);
            onClose?.();
          }}
          className="text-white hover:opacity-75 transition"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

/**
 * Tarjeta de Notificación (para lista)
 */
export const NotificationCard: React.FC<{
  notification: Notification;
  onRead?: () => void;
  onDelete?: () => void;
}> = ({ notification, onRead, onDelete }) => {
  const color = getNotificationColor(notification.type);

  return (
    <div
      className={`p-4 rounded-lg border-l-4 transition ${
        notification.read
          ? 'bg-gray-800 border-gray-600'
          : `bg-gradient-to-r ${color} border-white`
      }`}
      onClick={onRead}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <span className="text-2xl">{notification.icon}</span>
          <div>
            <h4 className={`font-bold ${notification.read ? 'text-gray-300' : 'text-white'}`}>
              {notification.title}
            </h4>
            <p className={`text-sm mt-1 ${notification.read ? 'text-gray-400' : 'text-white opacity-90'}`}>
              {notification.message}
            </p>
            <p className={`text-xs mt-2 ${notification.read ? 'text-gray-500' : 'text-white opacity-75'}`}>
              {formatTimeAgo(notification.timestamp)}
            </p>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
          className="text-gray-400 hover:text-white transition"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

/**
 * Panel de Notificaciones
 */
export const NotificationsPanel: React.FC<{
  notifications?: Notification[];
  onMarkAsRead?: (notificationId: string) => void;
  onDelete?: (notificationId: string) => void;
  onMarkAllAsRead?: () => void;
}> = ({ notifications = [], onMarkAsRead, onDelete, onMarkAllAsRead }) => {
  const [filter, setFilter] = useState<NotificationType | 'all'>('all');

  const filteredNotifications = filter === 'all'
    ? notifications
    : notifications.filter((n) => n.type === filter);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="bg-gradient-to-br from-gray-900 to-black rounded-lg p-6 border border-purple-600">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 flex items-center gap-2">
          <Bell size={24} />
          Notificaciones
          {unreadCount > 0 && (
            <span className="bg-red-600 text-white text-xs px-2 py-1 rounded-full">
              {unreadCount}
            </span>
          )}
        </h2>
        {unreadCount > 0 && (
          <button
            onClick={onMarkAllAsRead}
            className="text-sm text-purple-400 hover:text-purple-300 transition"
          >
            Marcar todo como leído
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition ${
            filter === 'all'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
          }`}
        >
          Todas
        </button>
        {(['gift', 'achievement', 'ranking', 'challenge', 'competition', 'milestone'] as NotificationType[]).map(
          (type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition ${
                filter === type
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
              }`}
            >
              {getNotificationIcon(type)}
            </button>
          )
        )}
      </div>

      {/* Lista de notificaciones */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredNotifications.length > 0 ? (
          filteredNotifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onRead={() => onMarkAsRead?.(notification.id)}
              onDelete={() => onDelete?.(notification.id)}
            />
          ))
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-400">No hay notificaciones</p>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Badge de Notificaciones (para header)
 */
export const NotificationBadge: React.FC<{
  count: number;
  onClick?: () => void;
}> = ({ count, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="relative p-2 text-gray-400 hover:text-white transition"
    >
      <Bell size={20} />
      {count > 0 && (
        <span className="absolute top-0 right-0 bg-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
};

/**
 * Generador de notificaciones de ejemplo
 */
export function generateMockNotifications(): Notification[] {
  return [
    {
      id: '1',
      type: 'gift',
      title: '🎁 ¡Recibiste un regalo!',
      message: 'CristalGaming te envió un Dragón (€5.00)',
      icon: '🎁',
      timestamp: new Date(Date.now() - 5 * 60000),
      read: false,
      color: 'from-red-600 to-pink-600',
    },
    {
      id: '2',
      type: 'achievement',
      title: '🏆 ¡Logro desbloqueado!',
      message: 'Alcanzaste el nivel 10 - Veterano',
      icon: '🏆',
      timestamp: new Date(Date.now() - 15 * 60000),
      read: false,
      color: 'from-purple-600 to-purple-700',
    },
    {
      id: '3',
      type: 'ranking',
      title: '📊 ¡Subiste en el ranking!',
      message: 'Ahora eres #5 en regalos enviados',
      icon: '📊',
      timestamp: new Date(Date.now() - 30 * 60000),
      read: false,
      color: 'from-blue-600 to-blue-700',
    },
    {
      id: '4',
      type: 'challenge',
      title: '⚡ Desafío completado',
      message: 'Completaste "Repartidor Diario" +200 XP',
      icon: '⚡',
      timestamp: new Date(Date.now() - 1 * 3600000),
      read: true,
      color: 'from-yellow-600 to-yellow-700',
    },
    {
      id: '5',
      type: 'competition',
      title: '🔥 ¡Competencia en vivo!',
      message: 'Únete a "Rush de Legendarios" - Premios: €500',
      icon: '🔥',
      timestamp: new Date(Date.now() - 2 * 3600000),
      read: true,
      color: 'from-orange-600 to-orange-700',
    },
    {
      id: '6',
      type: 'milestone',
      title: '⭐ ¡Hito alcanzado!',
      message: 'Enviaste 1000 regalos - Alma Generosa',
      icon: '⭐',
      timestamp: new Date(Date.now() - 24 * 3600000),
      read: true,
      color: 'from-green-600 to-green-700',
    },
  ];
}

export default {
  getNotificationIcon,
  getNotificationColor,
  formatTimeAgo,
  NotificationToast,
  NotificationCard,
  NotificationsPanel,
  NotificationBadge,
  generateMockNotifications,
};
