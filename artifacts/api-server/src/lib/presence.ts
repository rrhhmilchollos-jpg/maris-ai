import type { Server as IOServer, Socket } from "socket.io";
import { logger } from "./logger";

/**
 * Presencia en tiempo real — saber qué usuarios tienen Maris AI abierto
 * AHORA MISMO, no solo "cuándo entraron por última vez" (lastLoginAt, que
 * ya existía pero no responde a esa pregunta).
 *
 * DISEÑO: mapa en memoria de socket.io, no Redis. Esto es seguro y
 * suficiente PORQUE Coolify está configurado con 1 sola réplica
 * (confirmado en el panel de Coolify: "Number of replicas: 1") — si en el
 * futuro se escala a más de una réplica, este mapa en memoria dejaría de
 * ser correcto (cada réplica vería solo sus propias conexiones) y
 * necesitaría moverse al adaptador de socket.io para Redis
 * (@socket.io/redis-adapter) para sincronizar presencia entre instancias.
 *
 * Un mismo usuario puede tener varias pestañas/dispositivos abiertos a la
 * vez — se cuenta por número de sockets activos, no por usuario, para que
 * cerrar una pestaña no marque al usuario como desconectado si todavía
 * tiene otra abierta.
 */

interface PresenceEntry {
  userId: string;
  email?: string;
  connectedAt: Date;
  lastActivityAt: Date;
  currentPage?: string;
}

// userId -> socketId -> datos de esa conexión concreta
const connections = new Map<string, Map<string, PresenceEntry>>();

export function registerConnection(userId: string, socketId: string, email?: string) {
  if (!connections.has(userId)) connections.set(userId, new Map());
  connections.get(userId)!.set(socketId, {
    userId,
    email,
    connectedAt: new Date(),
    lastActivityAt: new Date(),
  });
}

export function unregisterConnection(userId: string, socketId: string) {
  const userSockets = connections.get(userId);
  if (!userSockets) return;
  userSockets.delete(socketId);
  if (userSockets.size === 0) connections.delete(userId);
}

export function touchActivity(userId: string, socketId: string, currentPage?: string) {
  const entry = connections.get(userId)?.get(socketId);
  if (!entry) return;
  entry.lastActivityAt = new Date();
  if (currentPage) entry.currentPage = currentPage;
}

export function isUserOnline(userId: string): boolean {
  return connections.has(userId) && connections.get(userId)!.size > 0;
}

/** Lista de usuarios conectados ahora mismo, con el detalle de sus conexiones activas. */
export function listOnlineUsers(): Array<{
  userId: string;
  email?: string;
  sockets: number;
  connectedAt: Date;
  lastActivityAt: Date;
  currentPage?: string;
}> {
  const result: Array<{
    userId: string;
    email?: string;
    sockets: number;
    connectedAt: Date;
    lastActivityAt: Date;
    currentPage?: string;
  }> = [];
  for (const [userId, sockets] of connections.entries()) {
    if (sockets.size === 0) continue;
    // La conexión más antigua marca connectedAt; la actividad más reciente entre
    // todas sus pestañas marca lastActivityAt/currentPage.
    let earliestConnectedAt: Date | null = null;
    let latestActivityAt: Date | null = null;
    let email: string | undefined;
    let currentPage: string | undefined;
    for (const entry of sockets.values()) {
      if (!earliestConnectedAt || entry.connectedAt < earliestConnectedAt) earliestConnectedAt = entry.connectedAt;
      if (!latestActivityAt || entry.lastActivityAt > latestActivityAt) {
        latestActivityAt = entry.lastActivityAt;
        currentPage = entry.currentPage;
      }
      if (entry.email) email = entry.email;
    }
    result.push({
      userId,
      email,
      sockets: sockets.size,
      connectedAt: earliestConnectedAt!,
      lastActivityAt: latestActivityAt!,
      currentPage,
    });
  }
  // Más recientemente activos primero.
  result.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  return result;
}

export function onlineCount(): number {
  return connections.size;
}

/**
 * Conecta los manejadores de presencia a una instancia de socket.io ya
 * autenticada (ver index.ts — el middleware de socket.io adjunta
 * socket.data.userId antes de que estos handlers se ejecuten).
 */
export function attachPresenceHandlers(io: IOServer) {
  io.on("connection", (socket: Socket) => {
    const userId = socket.data.userId as string | undefined;
    const email = socket.data.email as string | undefined;
    if (!userId) {
      // No debería ocurrir si el middleware de autenticación funcionó,
      // pero por seguridad no registramos presencia sin userId real.
      socket.disconnect(true);
      return;
    }

    registerConnection(userId, socket.id, email);
    logger.info({ userId, socketId: socket.id, online: onlineCount() }, "Presence: usuario conectado");

    socket.on("presence:page", (page: string) => {
      if (typeof page === "string" && page.length < 300) {
        touchActivity(userId, socket.id, page);
      }
    });

    socket.on("disconnect", () => {
      unregisterConnection(userId, socket.id);
      logger.info({ userId, socketId: socket.id, online: onlineCount() }, "Presence: usuario desconectado");
    });
  });
}
