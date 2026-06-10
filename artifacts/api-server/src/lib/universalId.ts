/**
 * universalId.ts — Sistema de IDs Universales de Maris AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Cada entidad del ecosistema de Maris AI tiene un ID único y trazable:
 *
 *   USR-<timestamp_base36>-<random6>   → Usuarios
 *   PRJ-<timestamp_base36>-<random6>   → Proyectos/Apps generadas
 *   MSG-<timestamp_base36>-<random6>   → Mensajes de chat
 *   JOB-<timestamp_base36>-<random6>   → Jobs de generación
 *   REV-<timestamp_base36>-<random6>   → Revisiones de código
 *   SES-<timestamp_base36>-<random6>   → Sesiones de usuario
 *   CRM-<timestamp_base36>-<random6>   → Registros CRM (leads, clientes, trabajadores)
 *   TKT-<timestamp_base36>-<random6>   → Tickets de soporte
 *
 * Formato: <PREFIX>-<timestamp_base36_8chars>-<random_6chars>
 * Ejemplo: USR-lzx4k8ab-f3k9p2
 *
 * Propiedades:
 *   - Ordenables por tiempo (timestamp en base36)
 *   - Legibles por humanos (prefijo descriptivo)
 *   - Únicos globalmente (random suffix de 6 chars)
 *   - Cortos (20-22 caracteres total)
 */

export type EntityPrefix =
  | "USR"   // Usuario
  | "PRJ"   // Proyecto/App generada
  | "MSG"   // Mensaje de chat
  | "JOB"   // Job de generación
  | "REV"   // Revisión de código
  | "SES"   // Sesión
  | "CRM"   // Registro CRM
  | "TKT"   // Ticket de soporte
  | "DEP"   // Deploy
  | "PAY"   // Pago/Transacción
  | "INV"   // Invitación
  | "WRK";  // Workspace/Equipo

const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomStr(len: number): string {
  let result = "";
  for (let i = 0; i < len; i++) {
    result += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return result;
}

/**
 * Genera un ID universal único para una entidad de Maris AI.
 * @param prefix - Prefijo de la entidad (USR, PRJ, MSG, etc.)
 * @returns ID en formato PREFIX-timestamp_base36-random6
 */
export function generateUniversalId(prefix: EntityPrefix): string {
  const ts = Date.now().toString(36).padStart(8, "0").slice(-8);
  const rand = randomStr(6);
  return `${prefix}-${ts}-${rand}`;
}

/**
 * Extrae el timestamp de un ID universal.
 * @param id - ID universal de Maris AI
 * @returns Date o null si el ID no es válido
 */
export function extractTimestamp(id: string): Date | null {
  const parts = id.split("-");
  if (parts.length !== 3) return null;
  const ts = parseInt(parts[1], 36);
  if (isNaN(ts)) return null;
  return new Date(ts);
}

/**
 * Valida si un string es un ID universal válido de Maris AI.
 */
export function isValidUniversalId(id: string): boolean {
  const VALID_PREFIXES: EntityPrefix[] = [
    "USR", "PRJ", "MSG", "JOB", "REV", "SES", "CRM", "TKT", "DEP", "PAY", "INV", "WRK"
  ];
  const parts = id.split("-");
  if (parts.length !== 3) return false;
  const [prefix, ts, rand] = parts;
  if (!VALID_PREFIXES.includes(prefix as EntityPrefix)) return false;
  if (!/^[0-9a-z]{8}$/.test(ts)) return false;
  if (!/^[0-9a-z]{6}$/.test(rand)) return false;
  return true;
}

/**
 * Obtiene el tipo de entidad a partir de un ID universal.
 */
export function getEntityType(id: string): EntityPrefix | null {
  const prefix = id.split("-")[0] as EntityPrefix;
  const VALID_PREFIXES: EntityPrefix[] = [
    "USR", "PRJ", "MSG", "JOB", "REV", "SES", "CRM", "TKT", "DEP", "PAY", "INV", "WRK"
  ];
  return VALID_PREFIXES.includes(prefix) ? prefix : null;
}

/**
 * Genera IDs para casos específicos del ecosistema Maris AI.
 */
export const MarisId = {
  user: () => generateUniversalId("USR"),
  project: () => generateUniversalId("PRJ"),
  message: () => generateUniversalId("MSG"),
  job: () => generateUniversalId("JOB"),
  revision: () => generateUniversalId("REV"),
  session: () => generateUniversalId("SES"),
  crm: () => generateUniversalId("CRM"),
  ticket: () => generateUniversalId("TKT"),
  deploy: () => generateUniversalId("DEP"),
  payment: () => generateUniversalId("PAY"),
  invite: () => generateUniversalId("INV"),
  workspace: () => generateUniversalId("WRK"),
};

export default MarisId;
