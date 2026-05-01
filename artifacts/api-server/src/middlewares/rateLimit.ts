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

export const apiRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_PER_WINDOW,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req: Request) => SKIP_PATHS.has(req.path),
  keyGenerator: (req: Request) => {
    const userId = (req as Request & { auth?: { userId?: string } }).auth?.userId;
    if (userId) return `u:${userId}`;
    // ipKeyGenerator collapses an IPv6 address down to its /64 prefix so we
    // don't rate-limit per individual IPv6 (those rotate per request) nor
    // bucket every v6 user under the literal string "unknown".
    return ipKeyGenerator(req.ip ?? "unknown");
  },
  message: {
    error: "rate_limited",
    message: "Demasiadas peticiones. Espera un momento e inténtalo de nuevo.",
  },
});
