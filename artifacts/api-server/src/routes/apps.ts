import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { requireAuth } from "../lib/auth";
import {
  generatedApps,
  users,
  creditTransactions,
} from "@workspace/db/schema";

type GeneratedAppRow = typeof generatedApps.$inferSelect;
import { generateApp } from "../lib/generate";

const router: IRouter = Router();

function serializeApp(row: GeneratedAppRow) {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    prompt: row.prompt,
    description: row.description,
    techStack: row.techStack,
    frontendCode: row.frontendCode,
    backendCode: row.backendCode,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/apps", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const rows = await db
    .select()
    .from(generatedApps)
    .where(eq(generatedApps.userId, userId))
    .orderBy(desc(generatedApps.createdAt));
  res.json(rows.map(serializeApp));
});

router.get("/apps/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid app id" });
    return;
  }
  const userId = req.userId!;
  const [row] = await db
    .select()
    .from(generatedApps)
    .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  res.json(serializeApp(row));
});

router.delete("/apps/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid app id" });
    return;
  }
  const userId = req.userId!;
  const result = await db
    .delete(generatedApps)
    .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
    .returning({ id: generatedApps.id });
  if (result.length === 0) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  res.status(204).end();
});

router.post("/generate", requireAuth, async (req: Request, res: Response) => {
  const prompt: unknown = req.body?.prompt;
  if (typeof prompt !== "string" || prompt.trim().length < 5) {
    res.status(400).json({ error: "Prompt must be at least 5 characters." });
    return;
  }
  const userId = req.userId!;
  const user = req.dbUser!;

  if (user.credits < 1) {
    res.status(402).json({
      error: "Out of credits. Purchase more to keep generating.",
    });
    return;
  }

  let payload;
  try {
    payload = await generateApp(prompt.trim());
  } catch (err) {
    req.log.error({ err }, "App generation failed");
    res.status(502).json({
      error:
        "AI generation failed. Please try again with a different prompt.",
    });
    return;
  }

  // Atomically deduct one credit only if balance still sufficient
  const updated = await db
    .update(users)
    .set({
      credits: sql`${users.credits} - 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, userId), sql`${users.credits} >= 1`))
    .returning({ credits: users.credits });

  if (updated.length === 0) {
    res.status(402).json({ error: "Out of credits." });
    return;
  }

  const [inserted] = await db
    .insert(generatedApps)
    .values({
      userId,
      title: payload.title,
      description: payload.description,
      prompt: prompt.trim(),
      techStack: payload.techStack,
      frontendCode: payload.frontendCode,
      backendCode: payload.backendCode,
      status: "ready",
    })
    .returning();

  await db.insert(creditTransactions).values({
    userId,
    kind: "usage",
    amount: -1,
    description: `Generated app: ${payload.title}`,
  });

  res.json(serializeApp(inserted));
});

export default router;
