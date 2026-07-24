import { SignJWT, jwtVerify } from "jose";
import type { Request, Response } from "express";

// AUTH_SECRET debe ser una cadena aleatoria larga (ej. `openssl rand -hex 32`)
// configurada como variable de entorno en Coolify. Nunca hardcodear.
//
// IMPORTANTE: no se valida aquí arriba (nivel de módulo) a propósito. Si
// AUTH_SECRET falta y esto lanzara una excepción al importar el archivo,
// TODO el servidor Express se caería al arrancar (incluida la home pública,
// health checks, etc.) — no solo el login. En su lugar, la validación es
// perezosa: solo falla cuando de verdad se intenta crear/verificar una
// sesión, así el resto del sitio sigue vivo mientras se configura la env var.
function getSecret(): Uint8Array {
  const secretRaw = process.env.AUTH_SECRET;
  if (!secretRaw) {
    throw new Error(
      "AUTH_SECRET no está definida en las variables de entorno (Coolify). " +
        "El login no funcionará hasta que se configure.",
    );
  }
  return new TextEncoder().encode(secretRaw);
}

export const SESSION_COOKIE_NAME = "maris_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 días, igual que la sesión por defecto de Clerk

export interface SessionPayload {
  userId: string; // _id de Mongo (string) del usuario
  email: string;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub || typeof payload.email !== "string") return null;
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS * 1000,
    // El dominio se restringe vía env var para poder compartir la cookie
    // entre marisai.es y subdominios si hiciera falta.
    domain: process.env.SESSION_COOKIE_DOMAIN || undefined,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    domain: process.env.SESSION_COOKIE_DOMAIN || undefined,
    path: "/",
  });
}

export async function getSessionFromRequest(req: Request): Promise<SessionPayload | null> {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token || typeof token !== "string") return null;
  return verifySessionToken(token);
}
