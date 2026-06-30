/**
 * secretsCrypto.ts — cifrado real de los valores de las variables de
 * entorno (API keys, tokens) que el cliente introduce para su app.
 *
 * A petición explícita del usuario: las claves NUNCA se guardan en texto
 * plano en MongoDB. AES-256-GCM (cifrado autenticado, no solo cifrado
 * simple — detecta si el dato cifrado ha sido manipulado) con una clave
 * maestra única en variable de entorno (ENV_SECRETS_KEY), nunca en el
 * código ni en la base de datos.
 *
 * Formato almacenado: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
import crypto from "node:crypto";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recomendado para GCM

function getKey(): Buffer {
  const raw = process.env.ENV_SECRETS_KEY;
  if (!raw) {
    throw new Error(
      "ENV_SECRETS_KEY no configurada — no se pueden cifrar/descifrar variables de entorno de clientes. " +
      "Genera una con: openssl rand -hex 32",
    );
  }
  // Acepta tanto una clave hex de 64 caracteres (32 bytes) como cualquier
  // string — en ese caso se deriva una clave de 32 bytes con SHA-256 para
  // garantizar el tamaño exacto que exige AES-256, sin obligar a que la
  // variable de entorno tenga un formato rígido.
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Formato de secreto cifrado inválido");
  }
  const [ivHex, authTagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Enmascara un valor para mostrarlo en la interfaz sin revelar el secreto
 * real — ej. "sk-proj-AbCd...wXyZ" en vez del valor completo. Nunca se usa
 * el valor real en logs ni en respuestas de la API tras guardarse.
 */
export function maskSecret(plainText: string): string {
  if (plainText.length <= 8) return "••••••••";
  return `${plainText.slice(0, 4)}${"•".repeat(8)}${plainText.slice(-4)}`;
}

/**
 * Descifra de forma segura una lista de variables de entorno (con manejo
 * de errores por variable individual — si una está corrupta, no rompe el
 * deploy entero, simplemente se omite con un aviso en logs).
 */
export function decryptEnvVarsForDeploy(
  envVars: Array<{ name: string; encryptedValue?: string }>,
): Array<{ key: string; value: string }> {
  const result: Array<{ key: string; value: string }> = [];
  for (const ev of envVars) {
    if (!ev.encryptedValue) continue;
    try {
      result.push({ key: ev.name, value: decryptSecret(ev.encryptedValue) });
    } catch (err) {
      logger.warn({ err, name: ev.name }, "[secretsCrypto] No se pudo descifrar una variable de entorno — se omite del deploy");
    }
  }
  return result;
}
