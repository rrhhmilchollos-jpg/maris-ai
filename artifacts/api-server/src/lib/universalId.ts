/**
 * universalId.ts — Sistema de IDs Universales de Maris AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Sistema de identificación legible para soporte y trazabilidad:
 *
 *   USR-001, USR-002, USR-003 ...    → Usuarios (secuencial global)
 *   APP-USR001-001, APP-USR001-002   → Apps del usuario USR-001
 *   APP-USR002-001, APP-USR002-002   → Apps del usuario USR-002
 *
 * Así, cuando un cliente reporta un problema:
 *   - Buscas su email → encuentras su ID: USR-042
 *   - Ves todas sus apps: APP-USR042-001, APP-USR042-002, APP-USR042-003
 *   - El cliente dice "tengo un problema con mi tercera app" → APP-USR042-003
 *
 * Para IDs internos de alta frecuencia (mensajes, jobs) se usa UUID corto.
 */

import { randomBytes } from "crypto";

// ─── Contadores secuenciales (en memoria, respaldados en MongoDB) ─────────────

let _userCounter = 0;
let _counterLoaded = false;

/**
 * Formatea un número como ID de usuario: 1 → "001", 42 → "042", 1000 → "1000"
 */
function formatUserNum(n: number): string {
  if (n < 10) return `00${n}`;
  if (n < 100) return `0${n}`;
  return `${n}`;
}

/**
 * Formatea un número como ID de app dentro de un usuario: 1 → "001"
 */
function formatAppNum(n: number): string {
  if (n < 10) return `00${n}`;
  if (n < 100) return `0${n}`;
  return `${n}`;
}

/**
 * Genera un ID de usuario secuencial legible: USR-001, USR-002 ...
 * El número se obtiene del contador de MongoDB (campo `userCount` en la colección `counters`).
 * Si MongoDB no está disponible, usa timestamp como fallback.
 */
export async function generateUserId(db?: any): Promise<string> {
  if (db) {
    try {
      const result = await db.collection("counters").findOneAndUpdate(
        { _id: "users" },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" }
      );
      const seq = result?.seq ?? result?.value?.seq ?? 1;
      return `USR-${formatUserNum(seq)}`;
    } catch {
      // fallback
    }
  }
  // Fallback: timestamp comprimido (no secuencial pero único)
  const ts = Date.now().toString().slice(-6);
  return `USR-${ts}`;
}

/**
 * Genera un ID de app vinculado al usuario: APP-USR001-001
 * @param userMarisId - ID del usuario (ej: "USR-001")
 * @param db - Conexión a MongoDB para contador secuencial
 */
export async function generateAppId(userMarisId: string, db?: any): Promise<string> {
  // Extraer el número de usuario del ID (USR-001 → "001")
  const userNum = userMarisId.replace("USR-", "").replace("-", "");

  if (db) {
    try {
      const counterKey = `apps_${userMarisId}`;
      const result = await db.collection("counters").findOneAndUpdate(
        { _id: counterKey },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" }
      );
      const seq = result?.seq ?? result?.value?.seq ?? 1;
      return `APP-USR${userNum}-${formatAppNum(seq)}`;
    } catch {
      // fallback
    }
  }
  // Fallback: timestamp
  const ts = Date.now().toString().slice(-3);
  return `APP-USR${userNum}-${ts}`;
}

/**
 * Genera un ID de usuario SÍNCRONO (sin DB) usando timestamp.
 * Usar solo cuando no hay acceso a MongoDB (ej: tests, seeds).
 */
export function generateUserIdSync(): string {
  const ts = Date.now().toString().slice(-6);
  return `USR-${ts}`;
}

/**
 * Genera un ID de app SÍNCRONO (sin DB).
 * Usar solo cuando no hay acceso a MongoDB.
 */
export function generateAppIdSync(userMarisId: string): string {
  const userNum = userMarisId.replace("USR-", "").replace("-", "");
  const ts = Date.now().toString().slice(-3);
  return `APP-USR${userNum}-${ts}`;
}

/**
 * Genera un ID corto para entidades de alta frecuencia (mensajes, jobs, etc.)
 * Formato: MSG-<8chars_hex>
 */
export function generateShortId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

/**
 * Extrae el ID de usuario de un ID de app.
 * "APP-USR042-003" → "USR-042"
 */
export function extractUserIdFromAppId(appId: string): string | null {
  const match = appId.match(/^APP-USR(\d+)-\d+$/);
  if (!match) return null;
  return `USR-${match[1]}`;
}

/**
 * Extrae el número de app de un ID de app.
 * "APP-USR042-003" → 3
 */
export function extractAppNumber(appId: string): number | null {
  const match = appId.match(/^APP-USR\d+-(\d+)$/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * Valida si un string es un ID de usuario válido.
 * "USR-001" → true, "USR-1234567" → true
 */
export function isValidUserId(id: string): boolean {
  return /^USR-\d{3,}$/.test(id);
}

/**
 * Valida si un string es un ID de app válido.
 * "APP-USR001-001" → true
 */
export function isValidAppId(id: string): boolean {
  return /^APP-USR\d{3,}-\d{3,}$/.test(id);
}

/**
 * Helper principal — compatibilidad con código existente que usa MarisId.user() / MarisId.project()
 * NOTA: Estos son síncronos (sin DB). Para IDs secuenciales reales usar generateUserId(db) y generateAppId(userMarisId, db)
 */
export const MarisId = {
  /** Genera USR-<timestamp6> (síncrono, sin DB) */
  user: () => generateUserIdSync(),
  /** Genera APP-USR<ts>-<ts3> (síncrono, sin DB) */
  project: (userMarisId?: string) => generateAppIdSync(userMarisId ?? "USR-000"),
  /** Genera MSG-<hex8> */
  message: () => generateShortId("MSG"),
  /** Genera JOB-<hex8> */
  job: () => generateShortId("JOB"),
  /** Genera REV-<hex8> */
  revision: () => generateShortId("REV"),
  /** Genera SES-<hex8> */
  session: () => generateShortId("SES"),
  /** Genera CRM-<hex8> */
  crm: () => generateShortId("CRM"),
  /** Genera TKT-<hex8> */
  ticket: () => generateShortId("TKT"),
};

export default MarisId;
