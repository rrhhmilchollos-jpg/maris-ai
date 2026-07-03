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
    // Sincronización PEREZOSA del teléfono: ensureUser se ejecuta en CADA
    // petición autenticada (requireAuth la llama siempre) — llamar a la API
    // de Clerk en cada una sería un coste y una latencia innecesarios. Solo
    // se consulta a Clerk cuando de verdad falta el teléfono en nuestra
    // base de datos (usuarios creados antes de activar la verificación
    // obligatoria, o algún caso límite donde no se guardó la primera vez) —
    // una vez sincronizado, no se vuelve a llamar a Clerk por este motivo.
    if (!existing.phoneNumber) {
      try {
        const clerkUser = await clerkClient.users.getUser(clerkUserId);
        const phoneNumber = clerkUser.primaryPhoneNumber?.phoneNumber;
        if (phoneNumber) {
          await User.findByIdAndUpdate(clerkUserId, { $set: { phoneNumber } });
          existing.phoneNumber = phoneNumber;
        }
      } catch {
        // No crítico — si falla, simplemente no se sincroniza esta vez y se
        // reintentará en la siguiente petición autenticada de este usuario.
      }
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
  const phoneNumber = clerkUser.primaryPhoneNumber?.phoneNumber;

  // Compatibilidad con usuarios históricos: puede existir el mismo email con otro _id.
  // En ese caso no insertamos un duplicado que rompería el índice único de email; devolvemos
  // el registro existente y refrescamos metadatos no destructivos.
  const existingByEmail = email ? await User.findOne({ email }).lean<IUser>() : null;
  if (existingByEmail) {
    const updates: Partial<IUser> = {};
    if (fullName && !existingByEmail.fullName) updates.fullName = fullName;
    if (clerkUser.imageUrl && !existingByEmail.imageUrl) updates.imageUrl = clerkUser.imageUrl;
    if (phoneNumber && !existingByEmail.phoneNumber) updates.phoneNumber = phoneNumber;
    if (Object.keys(updates).length > 0 && existingByEmail._id) {
      await User.findByIdAndUpdate(existingByEmail._id, { $set: updates });
      Object.assign(existingByEmail, updates);
    }
    return ensureAdminCredits(existingByEmail);
  }
 
  // Lógica anti-abuso:
  // - Email: 1 cuenta por email, sin excepciones. Si el mismo email ya tiene créditos usados → 0 créditos.
  // - IP: NO bloqueamos por IP en el registro. Una familia puede tener N cuentas desde la misma IP.
  //   El bloqueo por IP solo se aplica manualmente por el admin (en casos de reembolso o abuso evidente).
  // - Una vez gastados los 45 créditos gratuitos (mismo valor que otorga el
  //   webhook de Clerk en el alta normal — ver clerkWebhook.ts), el usuario
  //   DEBE pagar para seguir generando.
  const emailAlreadyUsed = await User.findOne({ email, freeCreditsUsed: true }).lean();
  const alreadyUsed = !!emailAlreadyUsed;

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
        phoneNumber: phoneNumber ?? undefined,
        credits: isAdminEmail(email) ? 999999999 : (shouldGiveFreeCredits ? 45 : 0),
        planCredits: isAdminEmail(email) ? 0 : (shouldGiveFreeCredits ? 45 : 0),
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
