import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { connectDB } from "./db";
import { User, type IUser } from "@workspace/db/schema";
 
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
 
export async function ensureUser(clerkUserId: string): Promise<IUser> {
  await connectDB();
 
  // Try to find existing user
  const existing = await User.findById(clerkUserId).lean<IUser>();
  if (existing) return existing;
 
  // Fetch from Clerk
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    "";
  const fullName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || undefined;
 
  // Upsert — handles race conditions where two requests create the same user
  const user = await User.findByIdAndUpdate(
    clerkUserId,
    {
      $setOnInsert: {
        _id: clerkUserId,
        email,
        fullName,
        imageUrl: clerkUser.imageUrl ?? undefined,
        credits: 70,
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
    const user = await ensureUser(userId);
    req.userId = userId;
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
