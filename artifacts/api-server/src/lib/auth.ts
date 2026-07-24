import type { Request, Response, NextFunction } from "express";
import { connectDB } from "./db";
import { User, type IUser } from "@workspace/db/schema";
import { getSessionFromRequest } from "./session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      dbUser?: IUser;
    }
  }
}

// Email del propietario de Maris AI. Siempre es admin: créditos ilimitados,
// sin límites de uso, dominio propio gratis.
const OWNER_EMAIL = "rrhh.milchollos@gmail.com";

function adminEmailSet(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  set.add(OWNER_EMAIL);
  return set;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmailSet().has(email.toLowerCase());
}

async function ensureAdminCredits(user: IUser): Promise<IUser> {
  // Solo inicializar créditos si la cuenta admin es nueva (credits === 0).
  // Si el admin ya tiene créditos asignados (aunque sean pocos), no se sobreescriben,
  // permitiendo ajustar libremente el saldo desde el panel de administración.
  if (isAdminEmail(user.email) && user.credits === 0 && user._id) {
    await User.findByIdAndUpdate(user._id, { $set: { credits: 999999999 } });
    user.credits = 999999999;
  }
  return user;
}

// A diferencia del ensureUser() de la era Clerk, esta versión YA NO crea
// usuarios sobre la marcha llamando a un proveedor externo: la creación de
// la cuenta ocurre explícitamente en routes/authRoutes.ts (registro,
// callback de OAuth). Aquí solo cargamos el usuario ya existente a partir
// del _id que viene firmado en la cookie de sesión (ver lib/session.ts).
// Si no existe, algo está mal (sesión válida pero usuario borrado) y se
// devuelve null para que requireAuth responda 401.
export async function ensureUser(userId: string, ip?: string): Promise<IUser | null> {
  await connectDB();

  const existing = await User.findById(userId).lean<IUser>();
  if (!existing) return null;

  if (ip && (existing.lastLoginIp !== ip || !existing.lastLoginAt)) {
    await User.findByIdAndUpdate(userId, {
      $set: { lastLoginIp: ip, lastLoginAt: new Date() },
    });
    existing.lastLoginIp = ip;
    existing.lastLoginAt = new Date();
  }

  return ensureAdminCredits(existing);
}

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const session = await getSessionFromRequest(req);

  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await ensureUser(session.userId, req.ip);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = String(user._id ?? session.userId);
    req.dbUser = user;
    next();
  } catch (err) {
    req.log.error({ err }, "ensureUser failed");
    res.status(500).json({ error: "Failed to load user" });
  }
};

export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.dbUser || !isAdminEmail(req.dbUser.email)) {
    res.status(403).json({ error: "Acceso solo para administradores" });
    return;
  }
  next();
};
