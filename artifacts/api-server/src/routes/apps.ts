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
  appMessages,
} from "@workspace/db/schema";

type GeneratedAppRow = typeof generatedApps.$inferSelect;
type GenerationJobRow = typeof generationJobs.$inferSelect;
type AppMessageRow = typeof appMessages.$inferSelect;
import { generateApp, patchBundle, type GenLanguage } from "../lib/generate";
import { generateAppImages } from "../lib/imageAgent";
import { streamAppZip } from "../lib/exportZip";
import { buildDeployHtml, makeSlug } from "../lib/deployBundle";
import { pushAppToGitHub } from "../lib/githubPush";
import { validateBundle, type BuildIssue } from "../lib/validate";

const router: IRouter = Router();

/** Coder models the user is allowed to choose from in the dashboard. */
const ALLOWED_CODER_MODELS = new Set(["auto", "gemini-2.5-flash", "claude-sonnet-4-6"]);
/** Source-language choices the user can pick at generation time. */
const ALLOWED_LANGUAGES = new Set<GenLanguage>(["typescript", "javascript"]);

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
    coderModel: row.coderModel,
    language: row.language,
    publicSlug: row.publicSlug,
    githubRepoUrl: row.githubRepoUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Build the full public deploy URL from a slug, using the first
 * REPLIT_DOMAINS entry. Falls back to a relative `/p/<slug>` if the env var
 * isn't set so callers always get a usable string in dev.
 */
function publicUrlFor(slug: string): string {
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const host = domains[0];
  return host ? `https://${host}/p/${slug}` : `/p/${slug}`;
}

function serializeMessage(row: AppMessageRow) {
  return {
    id: row.id,
    appId: row.appId,
    role: row.role,
    content: row.content,
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

async function runJob(
  jobId: number,
  userId: string,
  prompt: string,
  isAdmin: boolean,
  editAppId: number | undefined,
  coderModel: string,
  language: GenLanguage,
) {
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

    let previous: import("../lib/generate").PreviousApp | undefined;
    if (editAppId) {
      const [row] = await db
        .select()
        .from(generatedApps)
        .where(and(eq(generatedApps.id, editAppId), eq(generatedApps.userId, userId)))
        .limit(1);
      if (row) {
        previous = {
          title: row.title,
          description: row.description,
          techStack: row.techStack ?? [],
          frontendCode: row.frontendCode,
          backendCode: row.backendCode,
        };
      }
    }

    const payload = await generateApp(
      prompt,
      async (p) => {
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
      },
      previous,
      coderModel,
      language,
    );

    // Atomic finalisation: insert/update app + mark job succeeded in one tx.
    await db.transaction(async (tx) => {
      let resultAppId: number;
      if (editAppId) {
        const updatedRows = await tx
          .update(generatedApps)
          .set({
            title: payload.title,
            description: payload.description,
            techStack: payload.techStack,
            frontendCode: payload.frontendCode,
            backendCode: payload.backendCode,
            status: "ready",
          })
          .where(and(eq(generatedApps.id, editAppId), eq(generatedApps.userId, userId)))
          .returning();
        if (updatedRows.length === 0) {
          // App was deleted (or ownership changed) between enqueue and finalize.
          throw new Error("APP_NO_LONGER_AVAILABLE");
        }
        const updated = updatedRows[0];
        resultAppId = updated.id;
        // Append assistant message acknowledging the change.
        await tx.insert(appMessages).values({
          appId: resultAppId,
          role: "assistant",
          content: `Aplicado: ${payload.description}`,
        });
      } else {
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
            // Persist the model the user picked at creation time so subsequent
            // edits on this app reuse it. Defaults to "auto" when the user
            // doesn't override.
            coderModel,
            // Same idea for the source language — locked at creation, all
            // edits reuse the same JS/TS choice.
            language,
          })
          .returning();
        resultAppId = inserted.id;
        // Seed initial assistant message for the chat history.
        await tx.insert(appMessages).values([
          { appId: resultAppId, role: "user", content: prompt },
          {
            appId: resultAppId,
            role: "assistant",
            content: `He generado "${payload.title}". ${payload.description}`,
          },
        ]);
      }

      await tx
        .update(generationJobs)
        .set({
          status: "succeeded",
          phase: "ready",
          progress: 100,
          appId: resultAppId,
          updatedAt: new Date(),
        })
        .where(eq(generationJobs.id, jobId));

      // Replace the placeholder "reservation" ledger row with the final one.
      if (!isAdmin) {
        await tx
          .update(creditTransactions)
          .set({
            description: editAppId
              ? `Edición de app: ${payload.title}`
              : `App generada: ${payload.title}`,
          })
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

interface EnqueueExtras {
  // Optional: a chat user message to persist atomically with the job. If the
  // enqueue (credit reservation, etc.) fails, the message is rolled back too.
  chatMessage?: { appId: number; content: string };
}

async function enqueueGeneration(
  req: Request,
  res: Response,
  cleanedPrompt: string,
  editAppId: number | undefined,
  extras?: EnqueueExtras,
  coderModelOverride?: string,
  languageOverride?: GenLanguage,
) {
  const userId = req.userId!;
  const user = req.dbUser!;
  const isAdmin = isAdminEmail(user.email);
  // Resolve which Coder model + source language this run should use:
  //   - For an edit, prefer the app's own stored preferences (model + language).
  //   - For a new generation, take whatever the client passed (validated below).
  //   - Default to "auto" / "typescript".
  let coderModel = "auto";
  let language: GenLanguage = "typescript";
  if (editAppId) {
    const [editing] = await db
      .select({
        coderModel: generatedApps.coderModel,
        language: generatedApps.language,
      })
      .from(generatedApps)
      .where(eq(generatedApps.id, editAppId))
      .limit(1);
    if (editing?.coderModel) coderModel = editing.coderModel;
    if (editing?.language && ALLOWED_LANGUAGES.has(editing.language as GenLanguage)) {
      language = editing.language as GenLanguage;
    }
  } else {
    if (coderModelOverride && ALLOWED_CODER_MODELS.has(coderModelOverride)) {
      coderModel = coderModelOverride;
    }
    if (languageOverride && ALLOWED_LANGUAGES.has(languageOverride)) {
      language = languageOverride;
    }
  }

  if (!isAdmin && user.credits < 1) {
    res.status(402).json({
      error: "Te has quedado sin créditos. Compra más para seguir generando.",
    });
    return;
  }

  // For edits, refuse if there's already an in-flight job on this app to avoid
  // last-writer-wins races. The UI also blocks the chat input but a second
  // tab / API client could try otherwise.
  if (editAppId) {
    const inFlight = await db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.appId, editAppId),
          sql`${generationJobs.status} IN ('queued', 'running')`,
        ),
      )
      .limit(1);
    if (inFlight.length > 0) {
      res.status(409).json({
        error: "Ya hay un cambio en curso para esta app. Espera a que termine.",
      });
      return;
    }
  }

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
          appId: editAppId ?? null,
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
      // Persist the chat message in the same tx so it never lingers without a job.
      if (extras?.chatMessage) {
        await tx.insert(appMessages).values({
          appId: extras.chatMessage.appId,
          role: "user",
          content: extras.chatMessage.content,
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
    runJob(job.id, userId, cleanedPrompt, isAdmin, editAppId, coderModel, language).catch((err) => {
      logger.error({ err, jobId: job.id }, "runJob threw unexpectedly");
    });
  });

  res.status(202).json(serializeJob(job));
}

router.post("/generate", requireAuth, async (req: Request, res: Response) => {
  const prompt: unknown = req.body?.prompt;
  const appIdRaw: unknown = req.body?.appId;
  const coderModelRaw: unknown = req.body?.coderModel;
  const languageRaw: unknown = req.body?.language;
  if (typeof prompt !== "string" || prompt.trim().length < 5) {
    res.status(400).json({ error: "El prompt debe tener al menos 5 caracteres." });
    return;
  }
  const userId = req.userId!;
  const cleanedPrompt = prompt.trim();
  let editAppId: number | undefined;
  if (typeof appIdRaw === "number" && Number.isInteger(appIdRaw)) {
    const [owned] = await db
      .select({ id: generatedApps.id })
      .from(generatedApps)
      .where(and(eq(generatedApps.id, appIdRaw), eq(generatedApps.userId, userId)))
      .limit(1);
    if (!owned) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    editAppId = appIdRaw;
  }
  // Only honor coderModel + language for *new* generations; edits inherit the
  // app's stored preferences.
  const coderModelOverride =
    typeof coderModelRaw === "string" && ALLOWED_CODER_MODELS.has(coderModelRaw)
      ? coderModelRaw
      : undefined;
  const languageOverride =
    typeof languageRaw === "string" && ALLOWED_LANGUAGES.has(languageRaw as GenLanguage)
      ? (languageRaw as GenLanguage)
      : undefined;
  await enqueueGeneration(
    req,
    res,
    cleanedPrompt,
    editAppId,
    undefined,
    coderModelOverride,
    languageOverride,
  );
});

/**
 * Replace placeholder image URLs (Unsplash/picsum) in the app's frontend bundle
 * with real images generated by the Nano Banana Pro image agent. Synchronous —
 * the front end shows a spinner while we wait. Capped at 4 images per call.
 */
router.post(
  "/apps/:id/generate-images",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid app id" });
      return;
    }
    const userId = req.userId!;
    const [owned] = await db
      .select({ id: generatedApps.id })
      .from(generatedApps)
      .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
      .limit(1);
    if (!owned) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    try {
      const result = await generateAppImages(id);
      res.json(result);
    } catch (err) {
      req.log.error({ err, appId: id }, "Image generation failed");
      res.status(500).json({
        error:
          "No pudimos generar imágenes: " +
          (err instanceof Error ? err.message : "error desconocido"),
      });
    }
  },
);

/**
 * Update the per-app Coder model preference. Subsequent edits will use it.
 */
router.patch("/apps/:id/model", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid app id" });
    return;
  }
  const model: unknown = req.body?.coderModel;
  if (typeof model !== "string" || !ALLOWED_CODER_MODELS.has(model)) {
    res.status(400).json({ error: "Modelo no soportado." });
    return;
  }
  const userId = req.userId!;
  const result = await db
    .update(generatedApps)
    .set({ coderModel: model })
    .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
    .returning();
  if (result.length === 0) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  res.json(serializeApp(result[0]));
});

/**
 * Stream a ZIP of the generated app (frontend/, optional backend/, README.md).
 * Content-Disposition uses a sanitized title slug as the filename.
 */
router.get("/apps/:id/export", requireAuth, async (req: Request, res: Response) => {
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
  const safeName = row.title.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").slice(0, 60) || "app";
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);
  streamAppZip(res, {
    title: row.title,
    description: row.description,
    frontendBundle: row.frontendCode,
    backendBundle: row.backendCode,
    onError: (err) => {
      req.log.error({ err, appId: id }, "ZIP export failed");
      // If headers already went out we can't change the status — just end.
      try {
        if (!res.headersSent) {
          res.status(500).json({ error: "No pudimos generar el ZIP." });
        } else {
          res.end();
        }
      } catch {
        // ignore
      }
    },
  });
});

/**
 * Run the validate→patch→revalidate loop on the stored frontend bundle.
 * Persists any patched bundle so future previews use the fixed version.
 *
 * Response: { ok, fixed, before: {ok, issuesCount}, after: {ok, issuesCount} }
 */
router.post("/apps/:id/healthcheck", requireAuth, async (req: Request, res: Response) => {
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
  try {
    const before = await validateBundle(row.frontendCode);
    if (before.ok) {
      res.json({
        ok: true,
        fixed: false,
        before: { ok: true, issuesCount: 0 },
        after: { ok: true, issuesCount: 0 },
      });
      return;
    }
    // Try one auto-patch round. The patcher expects { file, problem, fix }
    // tuples, so we adapt our richer BuildIssue shape — message becomes
    // "problem" and we suggest a generic "fix the build error" instruction.
    const qaIssues = before.issues.map((i: BuildIssue) => ({
      file: i.file,
      problem: i.line ? `${i.message} (line ${i.line})` : i.message,
      fix: "Resuelve el error del build sin romper otras partes del archivo.",
    }));
    const patched = await patchBundle(
      row.frontendCode,
      qaIssues,
      (row.language === "javascript" ? "javascript" : "typescript") as GenLanguage,
    );
    if (!patched) {
      // Patcher refused or timed out — return the original before-state so the
      // user knows nothing was changed.
      res.json({
        ok: false,
        fixed: false,
        before: { ok: false, issuesCount: before.issues.length },
        after: { ok: false, issuesCount: before.issues.length },
      });
      return;
    }
    const after = await validateBundle(patched);
    if (after.ok || after.issues.length < before.issues.length) {
      // Save the improved bundle even if it's not fully clean — strictly better.
      await db
        .update(generatedApps)
        .set({ frontendCode: patched })
        .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)));
    }
    res.json({
      ok: after.ok,
      fixed: after.ok || after.issues.length < before.issues.length,
      before: { ok: false, issuesCount: before.issues.length },
      after: { ok: after.ok, issuesCount: after.issues.length },
    });
  } catch (err) {
    req.log.error({ err, appId: id }, "Health check failed");
    res.status(500).json({ error: "El chequeo falló: " + (err instanceof Error ? err.message : "error desconocido") });
  }
});

/**
 * Bundle the frontend into a self-contained HTML page and assign a public
 * slug. The actual HTML is built on demand by GET /p/:slug rather than stored
 * here — keeps the row small and lets the user re-deploy after edits without
 * any extra step. Returns the canonical public URL.
 */
router.post("/apps/:id/deploy", requireAuth, async (req: Request, res: Response) => {
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
  // Sanity-build once now to surface bundle errors immediately rather than at
  // first visit. We discard the output; /p/:slug will rebuild on demand.
  try {
    await buildDeployHtml({ bundle: row.frontendCode, title: row.title });
  } catch (err) {
    req.log.warn({ err, appId: id }, "Deploy pre-build failed");
    res.status(400).json({
      error: "No pudimos empaquetar la app: " + (err instanceof Error ? err.message : "error desconocido"),
    });
    return;
  }
  // Assign a slug if there isn't one yet. Slugs are stable so the URL the user
  // shared keeps working through later edits and re-deploys.
  let slug = row.publicSlug;
  if (!slug) {
    // Loop only protects against the (vanishingly rare) collision; the slug
    // generator already has ~50 bits of entropy.
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = makeSlug();
      try {
        await db
          .update(generatedApps)
          .set({ publicSlug: candidate })
          .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)));
        slug = candidate;
        break;
      } catch (err) {
        req.log.warn({ err, attempt }, "Slug collision, retrying");
      }
    }
    if (!slug) {
      res.status(500).json({ error: "No pudimos asignar una URL pública." });
      return;
    }
  }
  res.json({ url: publicUrlFor(slug), slug });
});

/**
 * Push the app to a brand-new GitHub repo using the Replit GitHub connector.
 * Stores the resulting repo URL on the app row so the UI can show "View repo"
 * on subsequent loads.
 */
router.post("/apps/:id/github", requireAuth, async (req: Request, res: Response) => {
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
  try {
    const result = await pushAppToGitHub({
      title: row.title,
      description: row.description,
      frontendBundle: row.frontendCode,
      backendBundle: row.backendCode,
    });
    await db
      .update(generatedApps)
      .set({ githubRepoUrl: result.url })
      .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)));
    res.json({ url: result.url, repoFullName: result.repoFullName });
  } catch (err) {
    req.log.error({ err, appId: id }, "GitHub push failed");
    res.status(500).json({
      error: "No pudimos subir a GitHub: " + (err instanceof Error ? err.message : "error desconocido"),
    });
  }
});

router.get("/apps/:id/messages", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid app id" });
    return;
  }
  const userId = req.userId!;
  const [owned] = await db
    .select({ id: generatedApps.id })
    .from(generatedApps)
    .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!owned) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const rows = await db
    .select()
    .from(appMessages)
    .where(eq(appMessages.appId, id))
    .orderBy(appMessages.id);
  res.json(rows.map(serializeMessage));
});

router.post("/apps/:id/messages", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid app id" });
    return;
  }
  const message: unknown = req.body?.message;
  if (typeof message !== "string" || message.trim().length < 2) {
    res.status(400).json({ error: "El mensaje debe tener al menos 2 caracteres." });
    return;
  }
  const userId = req.userId!;
  const [owned] = await db
    .select({ id: generatedApps.id })
    .from(generatedApps)
    .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!owned) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const cleanedMessage = message.trim();
  await enqueueGeneration(req, res, cleanedMessage, id, {
    chatMessage: { appId: id, content: cleanedMessage },
  });
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
