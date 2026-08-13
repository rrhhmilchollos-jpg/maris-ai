/**
 * security.ts — Sistema de seguridad completo de Maris AI
 * 
 * Protege contra:
 * 1. Exfiltración de código (extracción masiva sin pasar por GitHub)
 * 2. Scraping de datos internos
 * 3. Inyección de rutas maliciosas (.env, /wp-admin, etc.)
 * 4. Honeypots para atrapar y registrar atacantes
 * 5. Bloqueo de IPs maliciosas
 * 6. Fingerprinting de solicitudes sospechosas
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

// ─── IP Block List (en memoria + persistible) ─────────────────────────────────
const BLOCKED_IPS = new Set<string>();
const SUSPICIOUS_IPS = new Map<string, { count: number; firstSeen: number; reasons: string[] }>();
const CODE_EXPORT_ATTEMPTS = new Map<string, { count: number; lastAttempt: number }>();

// IPs bloqueadas permanentemente tras X intentos
const BLOCK_THRESHOLD = 5;
const SUSPICIOUS_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

function getClientIP(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.headers["x-real-ip"] as string) ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function recordSuspicious(ip: string, reason: string, req: Request) {
  const now = Date.now();
  const existing = SUSPICIOUS_IPS.get(ip) || { count: 0, firstSeen: now, reasons: [] };

  // Reset if window expired
  if (now - existing.firstSeen > SUSPICIOUS_WINDOW_MS) {
    existing.count = 0;
    existing.firstSeen = now;
    existing.reasons = [];
  }

  existing.count++;
  if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
  SUSPICIOUS_IPS.set(ip, existing);

  logger.warn({
    ip,
    reason,
    count: existing.count,
    path: req.path,
    ua: req.headers["user-agent"]?.slice(0, 100),
    userId: (req as any).auth?.userId,
  }, `[SECURITY] Actividad sospechosa detectada`);

  // Auto-block after threshold
  if (existing.count >= BLOCK_THRESHOLD) {
    BLOCKED_IPS.add(ip);
    logger.error({ ip, reasons: existing.reasons }, `[SECURITY] IP BLOQUEADA AUTOMÁTICAMENTE`);

    // Alert admin via email if configured
    notifyAdmin(ip, existing.reasons, req).catch(() => {});
  }
}

async function notifyAdmin(ip: string, reasons: string[], req: Request) {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.RESEND_TO_EMAIL;
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey || !adminEmail) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Maris AI Security <onboarding@resend.dev>",
        to: [adminEmail],
        subject: `🚨 IP Bloqueada en Maris AI — ${ip}`,
        html: `
          <div style="font-family:monospace;background:#0a0a0f;color:#e2e8f0;padding:24px;border-radius:8px">
            <h2 style="color:#ef4444">🚨 ALERTA DE SEGURIDAD — MARIS AI</h2>
            <p><strong>IP bloqueada:</strong> ${ip}</p>
            <p><strong>Razones:</strong></p>
            <ul>${reasons.map(r => `<li style="color:#fca5a5">${r}</li>`).join("")}</ul>
            <p><strong>Ruta:</strong> ${req.path}</p>
            <p><strong>User-Agent:</strong> ${req.headers["user-agent"]?.slice(0, 200)}</p>
            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            <p style="color:#64748b;font-size:12px">La IP ha sido bloqueada automáticamente. Puedes desbloquearla desde el panel de admin.</p>
          </div>`,
      }),
    });
  } catch {}
}

// ─── 1. Middleware de IP Block ────────────────────────────────────────────────
export function ipBlockMiddleware(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIP(req);
  if (BLOCKED_IPS.has(ip)) {
    logger.warn({ ip, path: req.path }, "[SECURITY] Solicitud de IP bloqueada rechazada");
    return res.status(403).json({
      error: "access_denied",
      message: "Tu acceso ha sido restringido. Contacta con soporte si crees que es un error.",
    });
  }
  return next();
}

// ─── 2. Rutas trampa (Honeypots) ─────────────────────────────────────────────
const HONEYPOT_PATHS = [
  "/.env", "/.env.local", "/.env.production",
  "/wp-admin", "/wp-login.php", "/admin/config.php",
  "/api/admin/dump", "/api/admin/export-all", "/api/debug",
  "/config.json", "/database.yml", "/.git/config",
  "/actuator/env", "/api/v1/users/all", "/api/internal",
  "/api/keys", "/api/secrets", "/phpmyadmin",
  "/api/maris-ai/source", "/api/export-training-data",
  "/api/models/weights", "/api/clone",
];

export function honeypotMiddleware(req: Request, res: Response, next: NextFunction) {
  const path = req.path.toLowerCase();
  const isHoneypot = HONEYPOT_PATHS.some(hp => path === hp || path.startsWith(hp));

  if (isHoneypot) {
    const ip = getClientIP(req);
    recordSuspicious(ip, `Honeypot hit: ${req.path}`, req);

    // Respuesta falsa convincente para que el atacante pierda tiempo
    logger.error({ ip, path: req.path, ua: req.headers["user-agent"] }, "[SECURITY] HONEYPOT ACTIVADO");

    // Simulamos que existe pero tardamos en responder (tar pit)
    setTimeout(() => {
      res.status(200).json({
        // Datos falsos que parecen reales — trampa
        status: "ok",
        data: null,
        message: "Authorization required for this resource.",
        _trap: true, // interno — sabemos que fue un honeypot
      });
    }, 3000);
    return;
  }
  next();
}

// ─── 3. Detección de exfiltración de código ──────────────────────────────────
// Si un usuario hace demasiadas peticiones de código sin pasar por GitHub
export function codeExfiltrationMiddleware(req: Request, res: Response, next: NextFunction) {
  // Solo aplica a rutas de código
  const isCodeRoute = req.path.includes("/code") || req.path.includes("/download") ||
    req.path.includes("/export") || req.path.includes("/zip");

  if (!isCodeRoute) return next();

  const userId = (req as any).auth?.userId || getClientIP(req);
  const now = Date.now();
  const existing = CODE_EXPORT_ATTEMPTS.get(userId) || { count: 0, lastAttempt: 0 };

  // Reset si han pasado más de 1 hora
  if (now - existing.lastAttempt > 60 * 60 * 1000) existing.count = 0;

  existing.count++;
  existing.lastAttempt = now;
  CODE_EXPORT_ATTEMPTS.set(userId, existing);

  // Si intenta exportar más de 10 veces en 1 hora sin GitHub → sospechoso
  if (existing.count > 10) {
    const ip = getClientIP(req);
    recordSuspicious(ip, `Exfiltración de código: ${existing.count} intentos en 1h`, req);

    if (existing.count > 20) {
      return res.status(429).json({
        error: "export_limit_exceeded",
        message: "Has superado el límite de exportaciones. Usa el flujo de GitHub para exportar tu proyecto.",
        github: true,
      });
    }
  }

  next();
}

// ─── 4. Protección anti-scraping ─────────────────────────────────────────────
const SCRAPING_PATTERNS = [
  /python-requests/i, /scrapy/i, /curl\/[0-9]/i, /wget/i,
  /node-fetch/i, /axios\/[0-9]/i, /Go-http-client/i,
  /Java\/[0-9]/i, /libwww-perl/i, /LWP::/i,
  /bot/i, /spider/i, /crawler/i, /scraper/i,
];

const ALLOWED_BOT_UAS = [
  /googlebot/i, /bingbot/i, /yandexbot/i, /duckduckbot/i,
  /baiduspider/i, /facebookexternalhit/i, /twitterbot/i,
  /slackbot/i, /linkedinbot/i, /whatsapp/i,
  /zocoia/i, /claude/i, // zocoia crawlers
];

export function antiScrapingMiddleware(req: Request, res: Response, next: NextFunction) {
  const ua = req.headers["user-agent"] || "";
  const ip = getClientIP(req);

  // Allow known good bots
  if (ALLOWED_BOT_UAS.some(p => p.test(ua))) return next();

  // Detect suspicious user agents (permitir /preview para diagnósticos y iframes)
  if (SCRAPING_PATTERNS.some(p => p.test(ua))) {
    // Only block if they're hitting API routes
    if (req.path.startsWith("/api/") && !req.path.includes("/health") && !req.path.includes("/preview")) {
      recordSuspicious(ip, `Scraping UA detectado: ${ua.slice(0, 80)}`, req);
      return res.status(403).json({ error: "forbidden", message: "Access denied." });
    }
  }

  // Missing UA entirely on API routes = suspicious
  if (!ua && req.path.startsWith("/api/") && !req.path.includes("/health")) {
    recordSuspicious(ip, "Request sin User-Agent en ruta API", req);
  }

  next();
}

// ─── 5. Protección de headers de respuesta ────────────────────────────────────
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  // Remove server fingerprinting
  res.removeHeader("X-Powered-By");
  res.removeHeader("Server");

  // Anti-embedding (permitir embedding en iframes de preview y dominios propios)
  if (!_req.path.includes("/preview")) {
    res.setHeader("X-Frame-Options", "DENY");
  } else {
    res.setHeader("X-Frame-Options", "ALLOWALL");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");

  // Cache control para respuestas de API (no cachear datos de usuario)
  if (_req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
  }

  next();
}

// ─── 6. SQL/NoSQL injection detection ────────────────────────────────────────
const INJECTION_PATTERNS = [
  /\$where/i, /\$gt.*\$lt/i, /\{\s*"\$ne"/i,
  /drop\s+table/i, /union\s+select/i, /--\s*$/,
  /<script[^>]*>/i, /javascript:/i, /on\w+\s*=/i,
  /\.\.\//g, /etc\/passwd/i, /\/bin\/sh/i,
  /eval\s*\(/i, /exec\s*\(/i, /system\s*\(/i,
];

export function injectionDetectionMiddleware(req: Request, res: Response, next: NextFunction) {
  const payload = JSON.stringify({ body: req.body, query: req.query, params: req.params });

  const detected = INJECTION_PATTERNS.find(p => p.test(payload));
  if (detected) {
    const ip = getClientIP(req);
    recordSuspicious(ip, `Intento de inyección detectado en ${req.path}`, req);
    logger.error({ ip, path: req.path, pattern: detected.toString() }, "[SECURITY] INTENTO DE INYECCIÓN");
    return res.status(400).json({ error: "invalid_input", message: "Solicitud inválida." });
  }

  return next();
}

// ─── 7. Watermark en exports ──────────────────────────────────────────────────
export function generateWatermark(userId: string, appId: string): string {
  const ts = Date.now().toString(36);
  const payload = `${userId}:${appId}:${ts}`;
  // Simple but trackable — en producción usar crypto.createHmac
  const encoded = Buffer.from(payload).toString("base64").replace(/=/g, "");
  return `/* MARIS-AI-ORIGIN: ${encoded} | marisai.es | Unauthorized distribution violates ToS */`;
}

// ─── Admin endpoints ──────────────────────────────────────────────────────────
export function getSecurityStats() {
  return {
    blockedIPs: Array.from(BLOCKED_IPS),
    suspiciousIPs: Object.fromEntries(SUSPICIOUS_IPS),
    codeExportAttempts: Object.fromEntries(CODE_EXPORT_ATTEMPTS),
    totalBlocked: BLOCKED_IPS.size,
    totalSuspicious: SUSPICIOUS_IPS.size,
  };
}

export function unblockIP(ip: string): boolean {
  return BLOCKED_IPS.delete(ip);
}

export function blockIP(ip: string): void {
  BLOCKED_IPS.add(ip);
}
