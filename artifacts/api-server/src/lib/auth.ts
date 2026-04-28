import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "@workspace/db/schema";

type DbUser = typeof users.$inferSelect;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      dbUser?: DbUser;
    }
  }
}

export async function ensureUser(clerkUserId: string): Promise<DbUser> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, clerkUserId))
    .limit(1);
  if (existing[0]) return existing[0];

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    "";
  const fullName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    null;

  const inserted = await db
    .insert(users)
    .values({
      id: clerkUserId,
      email,
      fullName,
      imageUrl: clerkUser.imageUrl ?? null,
      credits: 3,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) return inserted[0];

  const refetch = await db
    .select()
    .from(users)
    .where(eq(users.id, clerkUserId))
    .limit(1);
  if (!refetch[0]) {
    throw new Error("Failed to provision user");
  }
  return refetch[0];
}

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const auth = getAuth(req);
  const claimUserId = auth?.sessionClaims?.userId;
  const userId = (typeof claimUserId === "string" ? claimUserId : undefined) || auth?.userId;
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
