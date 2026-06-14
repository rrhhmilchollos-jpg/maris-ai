import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from "express-rate-limit";
import type { Request } from "express";

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const MAX_PER_WINDOW = Number(process.env.RATE_LIMIT_MAX) || 120;

const SKIP_PATHS = new Set<string>([
  "/api/healthz",
]);

/** Shared key generator: per authenticated user or per IP /64 prefix */
const keyGen = (req: Request): string => {
  const userId = (req as Request & { auth?: { userId?: string } }).auth?.userId;
  if (userId) return `u:${userId}`;
  return ipKeyGenerator(req.ip ?? "unknown");
};

/** Standard global rate limiter — 120 req / min */
export const apiRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_PER_WINDOW,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req: Request) => SKIP_PATHS.has(req.path),
  keyGenerator: keyGen,
  message: {
    error: "rate_limited",
    message: "Demasiadas peticiones. Espera un momento e inténtalo de nuevo.",
  },
});

/**
 * Strict limiter for AI generation endpoints — 10 req / min per user/IP.
 * Prevents abuse of expensive LLM calls.
 */
export const generateRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: keyGen,
  message: {
    error: "rate_limited",
    message: "Límite de generaciones alcanzado. Espera un minuto e inténtalo de nuevo.",
  },
});

/**
 * Auth-endpoint limiter — 20 req / 15 min per IP.
 * Protects against brute-force and credential stuffing.
 */
export const authRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
  message: {
    error: "rate_limited",
    message: "Demasiados intentos de autenticación. Espera 15 minutos.",
  },
});

/**
 * Admin-endpoint limiter — 240 req / min per user/IP.
 * El panel de admin hace polling de jobs (cada 3s) + logs del job
 * expandido (cada 2s) + otros refetches periódicos: ~58 req/min en estado
 * normal con UNA pestaña. Con varias pestañas del mismo admin (la clave es
 * por usuario, no por pestaña) se superaba fácilmente el límite anterior
 * de 60/min, causando 429 espurios en uso normal. 240/min sigue protegiendo
 * frente a bucles fuera de control sin bloquear el uso legítimo.
 */
export const adminRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: keyGen,
  message: {
    error: "rate_limited",
    message: "Demasiadas peticiones al panel de administración.",
  },
});
