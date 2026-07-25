import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Resend } from "resend";
import { User, type IUser } from "@workspace/db/schema";
import { connectDB } from "../lib/db";
import { isAdminEmail } from "../lib/auth";
import { createSessionToken, setSessionCookie, clearSessionCookie } from "../lib/session";
import { MarisId, generateUserId } from "../lib/universalId";
import { logger } from "../lib/logger";

const router = Router();

// IMPORTANTE: Vercel, para proyectos creados a partir de abril de 2026 (o con
// la opción activada), respeta las cabeceras Cache-Control del origen en
// rewrites externos y puede cachear la respuesta en su CDN. Sin esto, una
// respuesta de /api/auth/login o /api/auth/me podría quedar cacheada sin su
// Set-Cookie (o servirse cacheada a otro usuario), dejando el login roto de
// forma intermitente y muy difícil de diagnosticar. Se fuerza no-store en
// TODA la ruta de auth, sin excepción.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  next();
});

// IMPORTANTE: `new Resend(...)` lanza una excepción de inmediato si no hay
// API key disponible (ni por parámetro ni por env var). Si esto se
// instanciara aquí arriba a nivel de módulo, la falta de RESEND_API_KEY
// tumbaría TODO el servidor al arrancar, no solo el envío de emails.
// Se crea de forma perezosa, solo cuando de verdad hace falta enviar algo.
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Maris AI <no-reply@marisai.es>";
const APP_URL = process.env.APP_URL || "https://marisai.es";
const FREE_PLAN_CREDITS = 65; // mismo valor que auth.ts/credits.ts/payments.ts

const BCRYPT_ROUNDS = 12;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createUserRecord(params: {
  email: string;
  fullName?: string;
  imageUrl?: string;
  passwordHash?: string;
  oauthProvider?: { provider: "google" | "github"; providerAccountId: string };
}): Promise<IUser> {
  await connectDB();
  const { email, fullName, imageUrl, passwordHash, oauthProvider } = params;

  const emailAlreadyUsed = await User.findOne({ email, freeCreditsUsed: true }).lean();
  const shouldGiveFreeCredits = !isAdminEmail(email) && !emailAlreadyUsed;

  const newId = await generateUserId().catch(() => MarisId.user());

  const user = await User.create({
    _id: newId,
    email,
    fullName,
    imageUrl,
    passwordHash,
    oauthProviders: oauthProvider ? [oauthProvider] : [],
    credits: isAdminEmail(email) ? 999999999 : shouldGiveFreeCredits ? FREE_PLAN_CREDITS : 0,
    planCredits: isAdminEmail(email) ? 0 : shouldGiveFreeCredits ? FREE_PLAN_CREDITS : 0,
    planExpiresAt:
      isAdminEmail(email) || !shouldGiveFreeCredits
        ? undefined
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    freeCreditsUsed: shouldGiveFreeCredits,
    marisId: newId,
  });

  return user.toObject();
}

// ─── Registro por email/contraseña ────────────────────────────────────────
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password, fullName } = req.body ?? {};
    if (!email || typeof email !== "string" || !password || password.length < 8) {
      res.status(400).json({ error: "Email y contraseña (mínimo 8 caracteres) son obligatorios" });
      return;
    }
    await connectDB();
    const existing = await User.findOne({ email: email.toLowerCase() }).lean();
    if (existing) {
      res.status(409).json({ error: "Ya existe una cuenta con ese email" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await createUserRecord({ email: email.toLowerCase(), fullName, passwordHash });
    const token = await createSessionToken({ userId: String(user._id), email: user.email });
    setSessionCookie(res, token);
    res.status(201).json({ user: { id: user._id, email: user.email, fullName: user.fullName } });
  } catch (err) {
    logger.error({ err }, "auth/register error");
    res.status(500).json({ error: "No se pudo completar el registro" });
  }
});

// ─── Login por email/contraseña ───────────────────────────────────────────
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: "Email y contraseña son obligatorios" });
      return;
    }
    await connectDB();
    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) {
      res.status(401).json({ error: "Credenciales incorrectas" });
      return;
    }
    // Cuenta migrada desde Clerk sin contraseña migrable: obligar a reset.
    if (!user.passwordHash) {
      res.status(403).json({
        error: "Necesitas establecer una nueva contraseña para tu cuenta",
        code: "PASSWORD_RESET_REQUIRED",
      });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Credenciales incorrectas" });
      return;
    }
    const token = await createSessionToken({ userId: String(user._id), email: user.email });
    setSessionCookie(res, token);
    res.json({ user: { id: user._id, email: user.email, fullName: user.fullName } });
  } catch (err) {
    logger.error({ err }, "auth/login error");
    res.status(500).json({ error: "No se pudo iniciar sesión" });
  }
});

router.post("/logout", (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ─── Recuperación de contraseña (también usada para el corte de Clerk) ────
router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body ?? {};
    if (!email) {
      res.status(400).json({ error: "Email obligatorio" });
      return;
    }
    await connectDB();
    // findOneAndUpdate en vez de findOne + user.save(): esto último provocaba
    // un VersionError de Mongoose en producción cuando otro proceso (p. ej.
    // ensureAdminCredits, que se ejecuta en cada request autenticada) tocaba
    // el mismo documento de usuario entre la lectura y el guardado. Al ser
    // una operación atómica de una sola escritura, no compite por versión.
    const rawToken = crypto.randomBytes(32).toString("hex");
    const user = await User.findOneAndUpdate(
      { email: String(email).toLowerCase() },
      {
        $set: {
          passwordResetTokenHash: hashToken(rawToken),
          passwordResetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hora
        },
      },
      { new: true },
    );
    // Responder igual exista o no el usuario, para no filtrar qué emails están registrados.
    if (user) {
      const resetUrl = `${APP_URL}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;
      const { error: resendError } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: user.email,
        subject: "Restablece tu contraseña de Maris AI",
        html: `<p>Hemos actualizado nuestro sistema de acceso. Por favor establece una nueva contraseña para seguir usando tu cuenta:</p>
               <p><a href="${resetUrl}">${resetUrl}</a></p>
               <p>Este enlace caduca en 1 hora. Si no lo solicitaste, ignora este mensaje.</p>`,
      });
      // El SDK de Resend NO lanza excepción si el envío falla — devuelve
      // { data: null, error: {...} }. Sin este log, un fallo (dominio sin
      // verificar, remitente rechazado, etc.) pasaba completamente
      // desapercibido: el usuario nunca recibía el email y el backend
      // respondía como si todo hubiera ido bien.
      if (resendError) {
        logger.error({ resendError, to: user.email }, "Resend rechazó el envío del email de reset de contraseña");
      }
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "auth/forgot-password error");
    res.status(500).json({ error: "No se pudo procesar la solicitud" });
  }
});

router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { email, token, newPassword } = req.body ?? {};
    if (!email || !token || !newPassword || newPassword.length < 8) {
      res.status(400).json({ error: "Datos incompletos o contraseña demasiado corta (mínimo 8)" });
      return;
    }
    await connectDB();
    const tokenHash = hashToken(token);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // findOneAndUpdate atómico (ver el mismo comentario en /forgot-password):
    // evita el VersionError de Mongoose por condiciones de carrera con otros
    // procesos que tocan el mismo documento de usuario (p. ej. ensureAdminCredits).
    const user = await User.findOneAndUpdate(
      {
        email: String(email).toLowerCase(),
        passwordResetTokenHash: tokenHash,
        passwordResetTokenExpiresAt: { $gt: new Date() },
      },
      {
        $set: { passwordHash, needsPasswordReset: false },
        $unset: { passwordResetTokenHash: "", passwordResetTokenExpiresAt: "" },
      },
      { new: true },
    );
    if (!user) {
      res.status(400).json({ error: "Enlace inválido o caducado" });
      return;
    }

    const sessionToken = await createSessionToken({ userId: String(user._id), email: user.email });
    setSessionCookie(res, sessionToken);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "auth/reset-password error");
    res.status(500).json({ error: "No se pudo restablecer la contraseña" });
  }
});

// ─── OAuth: Google ─────────────────────────────────────────────────────────
router.get("/google", (req: Request, res: Response) => {
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get("/google/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.cookies?.oauth_state) {
      res.redirect(`${APP_URL}/sign-in?error=oauth_state_mismatch`);
      return;
    }
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: "authorization_code",
        code: String(code),
      }),
    }).then((r) => r.json() as Promise<any>);

    const profile = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenRes.access_token}` },
    }).then((r) => r.json() as Promise<any>);

    if (!profile.email) {
      res.redirect(`${APP_URL}/sign-in?error=oauth_no_email`);
      return;
    }

    await connectDB();
    let user = await User.findOne({ email: profile.email.toLowerCase() });
    if (!user) {
      user = (await createUserRecord({
        email: profile.email.toLowerCase(),
        fullName: profile.name,
        imageUrl: profile.picture,
        oauthProvider: { provider: "google", providerAccountId: profile.sub },
      })) as unknown as InstanceType<typeof User>;
    } else if (!user.oauthProviders?.some((p) => p.provider === "google")) {
      user.oauthProviders = [...(user.oauthProviders || []), { provider: "google", providerAccountId: profile.sub }];
      await user.save();
    }

    const sessionToken = await createSessionToken({ userId: String(user._id), email: user.email });
    setSessionCookie(res, sessionToken);
    res.clearCookie("oauth_state");
    res.redirect(`${APP_URL}/dashboard`);
  } catch (err) {
    logger.error({ err }, "auth/google/callback error");
    res.redirect(`${APP_URL}/sign-in?error=oauth_failed`);
  }
});

// ─── OAuth: GitHub ──────────────────────────────────────────────────────────
router.get("/github", (req: Request, res: Response) => {
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: process.env.GITHUB_REDIRECT_URI!,
    scope: "read:user user:email",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

router.get("/github/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.cookies?.oauth_state) {
      res.redirect(`${APP_URL}/sign-in?error=oauth_state_mismatch`);
      return;
    }
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        redirect_uri: process.env.GITHUB_REDIRECT_URI,
        code,
      }),
    }).then((r) => r.json() as Promise<any>);

    const ghHeaders = { Authorization: `Bearer ${tokenRes.access_token}`, "User-Agent": "MarisAI" };
    const profile = await fetch("https://api.github.com/user", { headers: ghHeaders }).then((r) => r.json() as Promise<any>);
    let email: string | undefined = profile.email;
    if (!email) {
      const emails = await fetch("https://api.github.com/user/emails", { headers: ghHeaders }).then((r) => r.json() as Promise<any>);
      email = Array.isArray(emails) ? emails.find((e: any) => e.primary)?.email || emails[0]?.email : undefined;
    }
    if (!email) {
      res.redirect(`${APP_URL}/sign-in?error=oauth_no_email`);
      return;
    }

    await connectDB();
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = (await createUserRecord({
        email: email.toLowerCase(),
        fullName: profile.name || profile.login,
        imageUrl: profile.avatar_url,
        oauthProvider: { provider: "github", providerAccountId: String(profile.id) },
      })) as unknown as InstanceType<typeof User>;
    } else if (!user.oauthProviders?.some((p) => p.provider === "github")) {
      user.oauthProviders = [...(user.oauthProviders || []), { provider: "github", providerAccountId: String(profile.id) }];
      await user.save();
    }

    const sessionToken = await createSessionToken({ userId: String(user._id), email: user.email });
    setSessionCookie(res, sessionToken);
    res.clearCookie("oauth_state");
    res.redirect(`${APP_URL}/dashboard`);
  } catch (err) {
    logger.error({ err }, "auth/github/callback error");
    res.redirect(`${APP_URL}/sign-in?error=oauth_failed`);
  }
});

router.get("/me", async (req: Request, res: Response) => {
  const { getSessionFromRequest } = await import("../lib/session");
  const session = await getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const user = await User.findById(session.userId).lean();
  if (!user) {
    // DIAGNÓSTICO TEMPORAL: la sesión es válida (el JWT verifica bien),
    // pero no existe ningún documento en `users` con este _id. Esto pasa
    // si el _id que se firmó en el token (en login/register/reset-password)
    // ya no corresponde a un usuario real — p. ej. cuenta duplicada de la
    // época de Clerk que se borró o nunca se unificó correctamente.
    logger.warn(
      { sessionUserId: session.userId, sessionEmail: session.email },
      "[DIAG sesión] JWT válido pero no existe ningún usuario con ese _id en MongoDB",
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ user: { id: user._id, email: user.email, fullName: user.fullName, isAdmin: isAdminEmail(user.email) } });
});

export default router;
