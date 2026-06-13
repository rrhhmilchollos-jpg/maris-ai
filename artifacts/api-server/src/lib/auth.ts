import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { connectDB } from "./db";
import { User, type IUser } from "@workspace/db/schema";
import { MarisId, generateUserId } from "./universalId";
 
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

export async function ensureUser(clerkUserId: string, ip?: string): Promise<IUser> {
  await connectDB();
 
  // Ruta principal: el usuario actual ya está guardado con el ID de Clerk como _id.
  const existing = await User.findById(clerkUserId).lean<IUser>();
  if (existing) {
    // Actualizar IP y timestamp del último login
    if (ip && (existing.lastLoginIp !== ip || !existing.lastLoginAt)) {
      await User.findByIdAndUpdate(clerkUserId, {
        $set: { lastLoginIp: ip, lastLoginAt: new Date() }
      });
    }
    return ensureAdminCredits(existing);
  }
 
  // Si no existe por _id, obtenemos el email desde Clerk antes de crear nada.
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    "";
  const fullName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || undefined;

  // Compatibilidad con usuarios históricos: puede existir el mismo email con otro _id.
  // En ese caso no insertamos un duplicado que rompería el índice único de email; devolvemos
  // el registro existente y refrescamos metadatos no destructivos.
  const existingByEmail = email ? await User.findOne({ email }).lean<IUser>() : null;
  if (existingByEmail) {
    const updates: Partial<IUser> = {};
    if (fullName && !existingByEmail.fullName) updates.fullName = fullName;
    if (clerkUser.imageUrl && !existingByEmail.imageUrl) updates.imageUrl = clerkUser.imageUrl;
    if (Object.keys(updates).length > 0 && existingByEmail._id) {
      await User.findByIdAndUpdate(existingByEmail._id, { $set: updates });
      Object.assign(existingByEmail, updates);
    }
    return ensureAdminCredits(existingByEmail);
  }
 
  // Lógica anti-abuso: verificar si el email o la IP ya han recibido créditos gratuitos.
  // NOTA: Solo bloqueamos si hay 3+ cuentas desde la misma IP (permite familias/hogares).
  // El email sí bloquea siempre (no debería haber dos cuentas con el mismo email).
  const emailAlreadyUsed = await User.findOne({ email, freeCreditsUsed: true }).lean();
  const ipAbuseCount = ip ? await User.countDocuments({ registrationIp: ip, freeCreditsUsed: true }) : 0;
  const alreadyUsed = emailAlreadyUsed || ipAbuseCount >= 3;

  const shouldGiveFreeCredits = !isAdminEmail(email) && !alreadyUsed;

  // Upsert — handles race conditions where two requests create the same user.
  const user = await User.findByIdAndUpdate(
    clerkUserId,
    {
      $setOnInsert: {
        _id: clerkUserId,
        email,
        fullName,
        imageUrl: clerkUser.imageUrl ?? undefined,
        credits: isAdminEmail(email) ? 999999999 : (shouldGiveFreeCredits ? 50 : 0),
        planCredits: isAdminEmail(email) ? 0 : (shouldGiveFreeCredits ? 50 : 0),
        freeCreditsUsed: shouldGiveFreeCredits,
        registrationIp: ip,
        // ID Universal Maris AI — generado automáticamente al crear el usuario
        // Formato: USR-001, USR-002 ... (secuencial, legible para soporte)
        marisId: await generateUserId().catch(() => MarisId.user()),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean<IUser>();
 
  if (!user) {
    throw new Error("Failed to provision user");
  }
  return user;
}
 
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const auth = getAuth(req);
  const claimUserId = auth?.sessionClaims?.userId;
  const userId =
    (typeof claimUserId === "string" ? claimUserId : undefined) || auth?.userId;
 
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
 
  try {
    const user = await ensureUser(userId, req.ip);
    req.userId = String(user._id ?? userId);
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
