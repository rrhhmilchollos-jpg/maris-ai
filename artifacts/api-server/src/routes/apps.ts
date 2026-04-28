import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { requireAuth, isAdminEmail } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  generatedApps,
  users,
  creditTransactions,
  generationJobs,
} from "@workspace/db/schema";

type GeneratedAppRow = typeof generatedApps.$inferSelect;
type GenerationJobRow = typeof generationJobs.$inferSelect;
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

function serializeJob(row: GenerationJobRow) {
  return {
    id: row.id,
    status: row.status,
    phase: row.phase,
    progress: row.progress,
    appId: row.appId,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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

async function refundCredit(userId: string, jobId: number) {
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          credits: sql`${users.credits} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await tx.insert(creditTransactions).values({
        userId,
        kind: "refund",
        amount: 1,
        description: `Reembolso por generación fallida (job #${jobId})`,
      });
    });
  } catch (err) {
    logger.error({ err, userId, jobId }, "Failed to refund credit");
  }
}

async function runJob(jobId: number, userId: string, prompt: string, isAdmin: boolean) {
  try {
    await db
      .update(generationJobs)
      .set({
        status: "running",
        phase: "starting",
        progress: 5,
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, jobId));

    const payload = await generateApp(prompt, async (p) => {
      try {
        await db
          .update(generationJobs)
          .set({
            phase: p.phase,
            progress: p.progress,
            updatedAt: new Date(),
          })
          .where(eq(generationJobs.id, jobId));
      } catch (err) {
        logger.warn({ err, jobId }, "Failed to update job progress");
      }
    });

    // Atomic finalisation: insert app + mark job succeeded in one tx.
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(generatedApps)
        .values({
          userId,
          title: payload.title,
          description: payload.description,
          prompt,
          techStack: payload.techStack,
          frontendCode: payload.frontendCode,
          backendCode: payload.backendCode,
          status: "ready",
        })
        .returning();

      await tx
        .update(generationJobs)
        .set({
          status: "succeeded",
          phase: "ready",
          progress: 100,
          appId: inserted.id,
          updatedAt: new Date(),
        })
        .where(eq(generationJobs.id, jobId));

      // Replace the placeholder "reservation" ledger row with the final one.
      if (!isAdmin) {
        await tx
          .update(creditTransactions)
          .set({ description: `App generada: ${payload.title}` })
          .where(
            and(
              eq(creditTransactions.userId, userId),
              eq(
                creditTransactions.description,
                `Reserva de crédito para job #${jobId}`,
              ),
            ),
          );
      }
    });
  } catch (err) {
    logger.error({ err, jobId }, "Generation job failed");
    const detail = err instanceof Error ? err.message : "Error desconocido";
    try {
      await db
        .update(generationJobs)
        .set({
          status: "failed",
          phase: "failed",
          errorMessage: `Falló la generación: ${detail}`,
          updatedAt: new Date(),
        })
        .where(eq(generationJobs.id, jobId));
    } catch (updateErr) {
      logger.error({ updateErr, jobId }, "Failed to mark job as failed");
    }
    if (!isAdmin) {
      await refundCredit(userId, jobId);
    }
  }
}

/**
 * On server boot, mark any orphaned jobs (queued/running) as failed and refund
 * their credits. They were interrupted by a previous crash/restart and will
 * never finish on their own.
 */
export async function reclaimOrphanedJobs() {
  try {
    const orphaned = await db
      .select()
      .from(generationJobs)
      .where(
        sql`${generationJobs.status} IN ('queued', 'running')`,
      );
    if (orphaned.length === 0) return;
    logger.warn({ count: orphaned.length }, "Reclaiming orphaned generation jobs");
    for (const job of orphaned) {
      await db
        .update(generationJobs)
        .set({
          status: "failed",
          phase: "failed",
          errorMessage: "Interrumpido por reinicio del servidor.",
          updatedAt: new Date(),
        })
        .where(eq(generationJobs.id, job.id));
      // Refund only if a reservation row exists for this job (admins have none).
      const [reservation] = await db
        .select()
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.userId, job.userId),
            eq(
              creditTransactions.description,
              `Reserva de crédito para job #${job.id}`,
            ),
          ),
        )
        .limit(1);
      if (reservation) {
        await refundCredit(job.userId, job.id);
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to reclaim orphaned jobs");
  }
}

router.post("/generate", requireAuth, async (req: Request, res: Response) => {
  const prompt: unknown = req.body?.prompt;
  if (typeof prompt !== "string" || prompt.trim().length < 5) {
    res.status(400).json({ error: "El prompt debe tener al menos 5 caracteres." });
    return;
  }
  const userId = req.userId!;
  const user = req.dbUser!;
  const isAdmin = isAdminEmail(user.email);
  const cleanedPrompt = prompt.trim();

  if (!isAdmin && user.credits < 1) {
    res.status(402).json({
      error: "Te has quedado sin créditos. Compra más para seguir generando.",
    });
    return;
  }

  // For non-admins: atomically reserve 1 credit BEFORE enqueuing. This prevents
  // a user from racing N concurrent /generate calls with only 1 credit. If the
  // job later fails or is interrupted, refundCredit() restores it.
  let job;
  try {
    job = await db.transaction(async (tx) => {
      if (!isAdmin) {
        const updated = await tx
          .update(users)
          .set({
            credits: sql`${users.credits} - 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(users.id, userId), sql`${users.credits} >= 1`))
          .returning({ credits: users.credits });
        if (updated.length === 0) {
          throw new Error("INSUFFICIENT_CREDITS");
        }
      }
      const [created] = await tx
        .insert(generationJobs)
        .values({
          userId,
          prompt: cleanedPrompt,
          status: "queued",
          phase: "queued",
          progress: 0,
        })
        .returning();
      if (!isAdmin) {
        await tx.insert(creditTransactions).values({
          userId,
          kind: "usage",
          amount: -1,
          description: `Reserva de crédito para job #${created.id}`,
        });
      }
      return created;
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INSUFFICIENT_CREDITS") {
      res.status(402).json({
        error: "Te has quedado sin créditos. Compra más para seguir generando.",
      });
      return;
    }
    req.log.error({ err }, "Failed to enqueue generation job");
    res.status(500).json({ error: "No pudimos encolar la generación. Inténtalo otra vez." });
    return;
  }

  setImmediate(() => {
    runJob(job.id, userId, cleanedPrompt, isAdmin).catch((err) => {
      logger.error({ err, jobId: job.id }, "runJob threw unexpectedly");
    });
  });

  res.status(202).json(serializeJob(job));
});

router.get(
  "/generate/jobs/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const userId = req.userId!;
    const [row] = await db
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.id, id), eq(generationJobs.userId, userId)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(serializeJob(row));
  },
);

export default router;
