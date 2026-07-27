/**
 * connectorCrypto.ts — Cifrado de credenciales de conectores.
 *
 * Las credenciales de servicios externos (tokens de Slack, API keys de
 * Notion…) se guardan en MongoDB SIEMPRE cifradas con AES-256-GCM. La clave
 * vive en la variable de entorno CONNECTOR_ENCRYPTION_KEY (cualquier string
 * largo y aleatorio; se deriva a 32 bytes con SHA-256, así no importa el
 * formato en que la generes).
 *
 * Decisión deliberada: si la variable NO está configurada, guardar
 * credenciales FALLA con un error claro en lugar de degradar a texto plano.
 * Un secreto de un cliente en texto plano en la base de datos es peor que
 * una feature que pide un paso de configuración.
 *
 * Generar una clave válida:  openssl rand -hex 32
 * Y añadirla como CONNECTOR_ENCRYPTION_KEY en Coolify/Render (ver PENDIENTES.md).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENV_KEY = "CONNECTOR_ENCRYPTION_KEY";

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(
      `Falta la variable de entorno ${ENV_KEY}. ` +
        `Genera una con "openssl rand -hex 32" y configúrala en el hosting ` +
        `(ver PENDIENTES.md, sección "Clave de cifrado de conectores"). ` +
        `Las credenciales de conectores no se guardan sin cifrar.`,
    );
    this.name = "EncryptionKeyMissingError";
  }
}

/** Deriva la clave AES de 32 bytes desde el secreto de entorno. */
function deriveKey(): Buffer {
  const secret = process.env[ENV_KEY];
  if (!secret || secret.trim().length < 16) throw new EncryptionKeyMissingError();
  return createHash("sha256").update(secret.trim()).digest();
}

/** ¿Está configurado el cifrado? (para que la UI pueda avisar antes de guardar) */
export function encryptionConfigured(): boolean {
  const secret = process.env[ENV_KEY];
  return Boolean(secret && secret.trim().length >= 16);
}

export interface EncryptedBlob {
  ciphertext: string; // base64
  iv: string;         // base64 (12 bytes, único por operación)
  authTag: string;    // base64 (16 bytes, integridad GCM)
}

/** Cifra un objeto de credenciales (Record<string,string>) a un blob AES-256-GCM. */
export function encryptCredentials(values: Record<string, string>): EncryptedBlob {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(values), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/** Descifra un blob a las credenciales originales. Lanza si la clave o el blob no cuadran. */
export function decryptCredentials(blob: EncryptedBlob): Record<string, string> {
  const key = deriveKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]);
  const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("Blob de credenciales corrupto");
  return parsed as Record<string, string>;
}
