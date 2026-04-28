import { Router, type IRouter } from "express";
import { eq, sql, count, gte, desc } from "drizzle-orm";
import { db } from "../lib/db";
import { requireAuth, requireAdmin, isAdminEmail } from "../lib/auth";
import {
  users,
  generatedApps,
  creditTransactions,
} from "@workspace/db/schema";

const router: IRouter = Router();

router.use("/admin", requireAuth, requireAdmin);

router.get("/admin/overview", async (_req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [usersTotal] = await db.select({ total: count() }).from(users);
  const [appsTotal] = await db.select({ total: count() }).from(generatedApps);
  const [appsWeek] = await db
    .select({ total: count() })
    .from(generatedApps)
    .where(gte(generatedApps.createdAt, sevenDaysAgo));
  const [creditsOutstanding] = await db
    .select({ total: sql<number>`COALESCE(SUM(${users.credits}), 0)::int` })
    .from(users);

  const txns = await db.select().from(creditTransactions);
  let creditsSpentTotal = 0;
  let creditsPurchasedTotal = 0;
  for (const t of txns) {
    if (t.kind === "usage") creditsSpentTotal += Math.abs(t.amount);
    if (t.kind === "purchase") creditsPurchasedTotal += t.amount;
  }

  res.json({
    totalUsers: usersTotal?.total ?? 0,
    totalApps: appsTotal?.total ?? 0,
    appsLast7Days: appsWeek?.total ?? 0,
    creditsOutstanding: creditsOutstanding?.total ?? 0,
    creditsSpentTotal,
    creditsPurchasedTotal,
    revenueCentsTotal: 0,
  });
});

router.get("/admin/users", async (_req, res) => {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      imageUrl: users.imageUrl,
      credits: users.credits,
      createdAt: users.createdAt,
      appsGenerated: sql<number>`COALESCE(COUNT(${generatedApps.id}), 0)::int`,
    })
    .from(users)
    .leftJoin(generatedApps, eq(generatedApps.userId, users.id))
    .groupBy(users.id)
    .orderBy(desc(users.createdAt));

  res.json(
    rows.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      imageUrl: u.imageUrl,
      credits: u.credits,
      appsGenerated: u.appsGenerated,
      isAdmin: isAdminEmail(u.email),
      createdAt: u.createdAt.toISOString(),
    })),
  );
});

router.post("/admin/users/:id/credits", async (req, res) => {
  const targetId = req.params.id;
  const body = req.body as { delta?: number; reason?: string };
  const delta = Number.isInteger(body?.delta) ? Number(body.delta) : 0;
  if (!delta) {
    res.status(400).json({ error: "El campo delta es obligatorio y distinto de cero" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // Atomic lock + update + ledger inside a single transaction to prevent
    // lost-update races when two admins adjust the same user simultaneously.
    const locked = await tx.execute(
      sql`SELECT id, email, full_name, image_url, credits, created_at
          FROM users WHERE id = ${targetId} FOR UPDATE`,
    );
    const row = (locked.rows ?? locked)[0] as
      | { id: string; email: string; full_name: string | null; image_url: string | null; credits: number; created_at: Date }
      | undefined;
    if (!row) return null;

    const newBalance = Math.max(0, row.credits + delta);
    const actualDelta = newBalance - row.credits;

    if (actualDelta !== 0) {
      await tx
        .update(users)
        .set({ credits: newBalance, updatedAt: new Date() })
        .where(eq(users.id, targetId));

      await tx.insert(creditTransactions).values({
        userId: targetId,
        amount: actualDelta,
        kind: actualDelta > 0 ? "bonus" : "usage",
        description: body.reason?.trim() || "Ajuste manual del administrador",
      });
    }

    return { row, newBalance };
  });

  if (!result) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  const [appsCount] = await db
    .select({ total: count() })
    .from(generatedApps)
    .where(eq(generatedApps.userId, targetId));

  res.json({
    id: result.row.id,
    email: result.row.email,
    fullName: result.row.full_name,
    imageUrl: result.row.image_url,
    credits: result.newBalance,
    appsGenerated: appsCount?.total ?? 0,
    isAdmin: isAdminEmail(result.row.email),
    createdAt: new Date(result.row.created_at).toISOString(),
  });
});

router.get("/admin/apps", async (_req, res) => {
  const rows = await db
    .select({
      id: generatedApps.id,
      userId: generatedApps.userId,
      userEmail: users.email,
      title: generatedApps.title,
      description: generatedApps.description,
      techStack: generatedApps.techStack,
      status: generatedApps.status,
      createdAt: generatedApps.createdAt,
    })
    .from(generatedApps)
    .leftJoin(users, eq(users.id, generatedApps.userId))
    .orderBy(desc(generatedApps.createdAt))
    .limit(200);

  res.json(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail,
      title: r.title,
      description: r.description,
      techStack: Array.isArray(r.techStack) ? r.techStack : [],
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

export default router;
