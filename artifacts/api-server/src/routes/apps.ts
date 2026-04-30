import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { requireAuth, isAdminEmail, ensureUser } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  generatedApps,
  users,
  creditTransactions,
  generationJobs,
  appMessages,
  jobLogs,
  chatAttachments,
  appRuntimeErrors,
} from "@workspace/db/schema";

type GeneratedAppRow = typeof generatedApps.$inferSelect;
type GenerationJobRow = typeof generationJobs.$inferSelect;
type AppMessageRow = typeof appMessages.$inferSelect;
import {
  generateApp,
  patchBundle,
  researchTopic,
  type GenLanguage,
  type AttachmentContext,
} from "../lib/generate";
import { classifyChatIntent } from "../lib/intentClassifier";
import { tryConsumeFreeAnswer } from "../lib/freeAnswerLimiter";
import { generateAppImages } from "../lib/imageAgent";
import { streamAppZip } from "../lib/exportZip";
import { buildDeployHtml, makeSlug } from "../lib/deployBundle";
import { pushAppToGitHub } from "../lib/githubPush";
import { validateBundle, type BuildIssue } from "../lib/validate";
import { runVisualTester, VisualTesterError } from "../lib/visualTester";
import { runAutoEvaluator } from "../lib/evaluator";
import { chargeCredits, refundCredits } from "../lib/credits";
import { enqueueGenerateJob, reenqueueGenerateJob } from "../lib/jobQueue";
import { captureAgentError, addBreadcrumb } from "../lib/sentry";
import { loadAgentMemory } from "../lib/agentMemoryContext";
import { runMemoryExtractor } from "../lib/agentMemoryExtractor";
import {
  insertAppRevisionFromRow,
  restoreAppRevision,
  revisionSourceLabel,
} from "../lib/appRevisions";
import { TEMPLATES } from "../lib/templates";
import {
  deployAppToVercel,
  addVercelDomainForApp,
  getVercelDomainStatus,
  removeVercelDomainForApp,
} from "../lib/vercelDeploy";
import { getUserSpentCents, CUSTOM_DOMAIN_MIN_SPEND_CENTS } from "../lib/credits";
import { appRevisions } from "@workspace/db/schema";

/** Credits charged for one Visual Testing Agent run (silent). */
const VISUAL_TEST_COST = 30;
/** Internal base URL puppeteer uses to reach our public deploy route. */
const VISUAL_TEST_BASE_URL = process.env.VISUAL_TEST_BASE_URL ?? "http://localhost:80";

/**
 * Background helper used by the generation pipeline to run the Visual Testing
 * Agent right after a successful generation. Charges credits silently and
 * skips cleanly if the user can't afford it. All errors are non-fatal.
 */
async function autoRunVisualTester(opts: {
  appId: number;
  userId: string;
  isAdmin: boolean;
  prompt: string;
  jobId: number;
}): Promise<void> {
  const { appId, userId, isAdmin, prompt, jobId } = opts;
  // Re-read the row inside the background task so we get the latest bundle
  // (image agent may have already swapped some <img> srcs).
  const [row] = await db
    .select()
    .from(generatedApps)
    .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!row) {
    logger.warn({ appId, jobId }, "Auto visual tester: app row missing");
    return;
  }
  const slug = await ensurePublicSlug(appId, userId, logger, row.publicSlug);
  if (!slug) {
    logger.warn({ appId, jobId }, "Auto visual tester: could not assign slug");
    return;
  }
  const charge = await chargeCredits({
    userId,
    isAdmin,
    amount: VISUAL_TEST_COST,
    description: `Auto Visual Testing — app #${appId} (job #${jobId})`,
  });
  if (!charge.ok) {
    logger.info(
      { appId, jobId },
      "Auto visual tester skipped — insufficient credits",
    );
    return;
  }
  try {
    const report = await runVisualTester({
      app: {
        id: row.id,
        title: row.title,
        description: row.description,
        frontendCode: row.frontendCode,
        publicSlug: slug,
      },
      baseUrl: VISUAL_TEST_BASE_URL,
      prompt,
      autoFix: true,
      log: logger,
    });
    logger.info(
      {
        appId,
        jobId,
        cycles: report.cycles,
        fixesApplied: report.fixesApplied,
        score: report.finalAnalysis.overallScore,
      },
      "Auto visual tester completed",
    );
    // Surface the visual test result into the app's chat history so the user
    // actually sees that the testing agent worked. Without this the 30-credit
    // charge is invisible work — the user only notices when something goes
    // wrong. Format: short Spanish summary + score + fix count + top issues.
    try {
      const a = report.finalAnalysis;
      const lines: string[] = [];
      const headline = a.visuallyCorrect
        ? `🧪 Testing visual: aprobado (${a.overallScore}/100)`
        : `🧪 Testing visual: ${a.overallScore}/100`;
      lines.push(headline);
      if (report.fixesApplied > 0) {
        lines.push(
          `Apliqué ${report.fixesApplied} corrección${report.fixesApplied === 1 ? "" : "es"} automática${report.fixesApplied === 1 ? "" : "s"} en ${report.cycles} ciclo${report.cycles === 1 ? "" : "s"}.`,
        );
      } else {
        lines.push(`Revisé el render en ${report.cycles} ciclo${report.cycles === 1 ? "" : "s"} sin necesidad de cambios.`);
      }
      const topIssues = a.issues.slice(0, 3);
      if (topIssues.length > 0) {
        lines.push("");
        lines.push("Hallazgos principales:");
        for (const issue of topIssues) {
          const sev =
            issue.severity === "critical"
              ? "🔴"
              : issue.severity === "major"
                ? "🟠"
                : "🟡";
          lines.push(`- ${sev} ${issue.description}`);
        }
      }
      if (a.summary) {
        lines.push("");
        lines.push(`_${a.summary}_`);
      }
      await db.insert(appMessages).values({
        appId,
        role: "assistant",
        content: lines.join("\n"),
      });
    } catch (msgErr) {
      logger.warn(
        { err: msgErr, appId, jobId },
        "Failed to insert visual tester chat message (non-fatal)",
      );
    }
  } catch (err) {
    logger.warn(
      { err, appId, jobId },
      "Auto visual tester failed during run — refunding silent charge",
    );
    await refundCredits({
      userId,
      isAdmin,
      amount: VISUAL_TEST_COST,
      description: `Reembolso Auto Visual Testing — app #${appId} (job #${jobId})`,
    }).catch((refundErr) => {
      logger.error(
        { refundErr, appId, jobId },
        "Auto visual tester refund failed",
      );
    });
  }
}

/**
 * Ensure a generated app has a public slug, assigning a fresh one if missing.
 * Returns the slug or null if every collision-protected attempt failed.
 */
async function ensurePublicSlug(
  appId: number,
  userId: string,
  log: { warn: (...args: unknown[]) => void },
  existingSlug: string | null,
): Promise<string | null> {
  if (existingSlug) return existingSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = makeSlug();
    try {
      // Only assign if no slug exists yet — protects against two concurrent
      // callers (e.g. evaluator + manual publish) racing to overwrite each
      // other's slug. RETURNING tells us whether we won the race.
      const updated = await db
        .update(generatedApps)
        .set({ publicSlug: candidate })
        .where(
          and(
            eq(generatedApps.id, appId),
            eq(generatedApps.userId, userId),
            sql`${generatedApps.publicSlug} IS NULL`,
          ),
        )
        .returning({ publicSlug: generatedApps.publicSlug });
      if (updated.length > 0) return updated[0].publicSlug;
      // We didn't win the race — re-read to find the slug the other caller
      // assigned, and return it so both callers agree on the same URL.
      const [row] = await db
        .select({ publicSlug: generatedApps.publicSlug })
        .from(generatedApps)
        .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)))
        .limit(1);
      return row?.publicSlug ?? null;
    } catch (err) {
      log.warn({ err, attempt }, "Slug collision, retrying");
    }
  }
  return null;
}

const router: IRouter = Router();

/** Coder models the user is allowed to choose from in the dashboard. */
const ALLOWED_CODER_MODELS = new Set([
  "auto",
  "gemini-2.5-flash",
  "claude-sonnet-4-6",
  "gpt-5",
]);
/** Premium-tier models — only users with isPremium === true may use them. */
const PREMIUM_CODER_MODELS = new Set(["claude-sonnet-4-6", "gpt-5"]);
/** Source-language choices the user can pick at generation time. */
const ALLOWED_LANGUAGES = new Set<GenLanguage>(["typescript", "javascript"]);

/**
 * Project kinds the user can pick from the dashboard tabs. Each maps to a
 * credit cost (bigger projects burn credits faster) and a `[INTENT: …]`
 * directive that's prepended to the user prompt before the architect sees it,
 * so all downstream agents (architect, designer, coder, visual tester) know
 * what they're building. Edits ignore the kind entirely — they cost 1 credit
 * and inherit the original app's characteristics.
 */
type ProjectKind =
  | "fullstack"
  | "mobile"
  | "landing"
  | "game-2d"
  | "game-3d"
  | "hybrid-pwa";
const KIND_COSTS: Record<ProjectKind, number> = {
  fullstack: 1,
  mobile: 2,
  landing: 1,
  "game-2d": 3,
  "game-3d": 5,
  "hybrid-pwa": 3,
};
const KIND_INTENTS: Record<ProjectKind, string | null> = {
  fullstack: null,
  mobile:
    "[INTENT: mobile-first PWA — diseño en columna única optimizado para pantallas de teléfono, tipografía grande, áreas de toque generosas (mínimo 44px), barra de navegación inferior fija, todas las páginas deben verse perfectas a 390px de ancho]",
  landing:
    "[INTENT: landing page — sitio de marketing de una sola página con hero impactante, sección de features, prueba social/testimonios, pricing y CTA final + footer. No requiere backend ni dashboard, backendNeeded debe ser false]",
  "game-2d":
    "[INTENT: 2D game — juego web 2D de una sola página usando HTML5 Canvas (o pixi.js si la mecánica lo justifica). Incluye loop de juego con requestAnimationFrame, controles por teclado/táctil, sistema de puntuación, estados (menu/playing/gameover), reinicio. backendNeeded=false. La página principal ES el juego, no un dashboard. Tabla de records con localStorage]",
  "game-3d":
    "[INTENT: 3D game — juego web 3D de una sola página usando three + @react-three/fiber + @react-three/drei. Incluye escena con cámara y luces, loop con useFrame, controles (OrbitControls o teclado WASD), físicas básicas, sistema de puntuación, estados (menu/playing/gameover). backendNeeded=false. La página principal ES el juego. Records en localStorage]",
  "hybrid-pwa":
    "[INTENT: hybrid PWA — aplicación instalable estilo app nativa: manifest.json con name/icons/theme_color/display=standalone, service worker registrado para offline-first (cachea shell + assets), prompt de instalación 'Add to Home Screen', diseño mobile-first con bottom navigation, áreas táctiles ≥44px. Debe verse perfecta a 390px y funcionar offline tras la primera carga]",
};
const ALLOWED_KINDS = new Set<ProjectKind>(Object.keys(KIND_COSTS) as ProjectKind[]);

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
    vercelDeployUrl: row.vercelDeployUrl,
    vercelProjectId: row.vercelProjectId,
    vercelCustomDomain: row.vercelCustomDomain,
    autoPublish: row.autoPublish,
    evaluatorSummary: row.evaluatorSummary,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Build the full public deploy URL from a slug, using the first
 * REPLIT_DOMAINS entry. Falls back to a relative `/p/<slug>` if the env var
 * isn't set so callers always get a usable string in dev.
 */
/**
 * Internal deploy helper shared between `POST /apps/:id/deploy` (manual button)
 * and the autonomous evaluator's auto-publish path. Runs the same sanity build
 * the manual deploy does, assigns a slug if missing, and returns the canonical
 * URL. Throws on failure (caller decides how to surface the error: HTTP 400
 * for the route, log + email_pending for the evaluator).
 */
export async function runDeployForApp(opts: {
  appId: number;
  userId: string;
  log: { warn: (...args: unknown[]) => void };
}): Promise<{ url: string; slug: string }> {
  const { appId, userId, log } = opts;
  const [row] = await db
    .select()
    .from(generatedApps)
    .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!row) {
    throw new Error("App not found");
  }
  // Sanity-build once now to surface bundle errors immediately rather than at
  // first visit. We discard the output; /p/:slug will rebuild on demand.
  await buildDeployHtml({ bundle: row.frontendCode, title: row.title });
  const slug = await ensurePublicSlug(appId, userId, log, row.publicSlug);
  if (!slug) {
    throw new Error("Could not assign public slug");
  }
  return { url: publicUrlFor(slug), slug };
}

function publicUrlFor(slug: string): string {
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const host = domains[0];
  return host ? `https://${host}/p/${slug}` : `/p/${slug}`;
}

function serializeMessage(row: AppMessageRow) {
  // attachment_ids is a JSON-encoded array of integers — defensively parse so a
  // bad row never takes down the whole /messages response.
  let attachmentIds: number[] = [];
  try {
    const parsed = JSON.parse(row.attachmentIds || "[]");
    if (Array.isArray(parsed)) {
      attachmentIds = parsed.filter((n) => Number.isInteger(n)) as number[];
    }
  } catch {
    /* ignore — leave empty */
  }
  return {
    id: row.id,
    appId: row.appId,
    role: row.role,
    content: row.content,
    attachmentIds,
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

async function refundCredit(userId: string, jobId: number, amount = 1) {
  if (amount <= 0) return;
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          credits: sql`${users.credits} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await tx.insert(creditTransactions).values({
        userId,
        kind: "refund",
        amount,
        description: `Reembolso por generación fallida (job #${jobId})`,
      });
    });
  } catch (err) {
    logger.error({ err, userId, jobId, amount }, "Failed to refund credit");
  }
}

interface RunAttemptContext {
  attempt: number;
  maxAttempts: number;
}

async function runJob(
  jobId: number,
  userId: string,
  prompt: string,
  isAdmin: boolean,
  editAppId: number | undefined,
  coderModel: string,
  language: GenLanguage,
  attachmentIds: number[] = [],
  attemptCtx: RunAttemptContext = { attempt: 1, maxAttempts: 1 },
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

    // Live agent log: fire-and-forget insert into job_logs so the dashboard
    // can stream what each agent is doing in real time. We DELIBERATELY do
    // not await this — the generation pipeline must never block on logging,
    // and a logging failure must never fail a paid generation.
    const recordLog = (agent: string, message: string, level: "info" | "warn" | "error" = "info") => {
      // Trim to keep DB rows small. Anything longer than ~280 chars is a sign
      // the agent dumped a transcript instead of a status line.
      const trimmed = message.length > 280 ? message.slice(0, 277) + "…" : message;
      db.insert(jobLogs)
        .values({ jobId, agent, level, message: trimmed })
        .catch((err) => {
          logger.warn({ err, jobId }, "Failed to write job log line");
        });
    };
    recordLog("system", "Iniciando pipeline multiagente…");

    // Resolve any user-uploaded attachments into a typed context for the AI.
    // We always re-check ownership here even though the upload route enforced
    // it — defense in depth, and clients could in theory POST a foreign id.
    let resolvedAttachments: AttachmentContext[] | undefined;
    if (attachmentIds.length > 0) {
      try {
        const ids = attachmentIds.filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length > 0) {
          const rows = await db
            .select()
            .from(chatAttachments)
            .where(
              and(
                eq(chatAttachments.userId, userId),
                sql`${chatAttachments.id} = ANY(${ids})`,
              ),
            );
          resolvedAttachments = rows.map((r) => {
            const isText =
              r.mimeType.startsWith("text/") ||
              r.mimeType === "application/json" ||
              r.mimeType === "application/xml";
            let textContent: string | undefined;
            if (isText) {
              try {
                // Cap at 10 KB per file before the prompt builder applies its
                // own 25 KB total cap. Anything bigger is almost certainly
                // noise the user didn't read either.
                const buf = Buffer.from(r.dataBase64, "base64");
                textContent = buf.toString("utf8").slice(0, 10_000);
              } catch {
                textContent = undefined;
              }
            }
            return {
              id: r.id,
              filename: r.filename,
              mimeType: r.mimeType,
              sizeBytes: r.sizeBytes,
              textContent,
            } satisfies AttachmentContext;
          });
          recordLog(
            "system",
            `Adjuntos cargados: ${resolvedAttachments.length} archivo(s) (${resolvedAttachments
              .map((a) => a.filename)
              .slice(0, 3)
              .join(", ")}${resolvedAttachments.length > 3 ? "…" : ""}).`,
          );
        }
      } catch (attErr) {
        logger.warn({ attErr, jobId }, "Failed to resolve attachments — continuing without them");
        recordLog("system", "No pude cargar los adjuntos; sigo sin ellos.", "warn");
      }
    }

    // Load persistent agent memory: cross-app preferences + (when editing)
    // per-app notes + recent chat turns. Failures here just degrade to "no
    // memory" — never block the generation.
    const agentMemory = await loadAgentMemory(userId, editAppId);
    if (
      agentMemory.conversationHistory.length > 0 ||
      agentMemory.appNotes.length > 0 ||
      agentMemory.userPreferences.length > 0
    ) {
      recordLog(
        "system",
        `Memoria cargada: ${agentMemory.conversationHistory.length} turnos previos, ${agentMemory.appNotes.length} chars de notas de app, ${agentMemory.userPreferences.length} chars de preferencias.`,
      );
    }

    addBreadcrumb("job:start", {
      jobId,
      userId,
      editAppId: editAppId ?? null,
      coderModel,
      language,
      promptChars: prompt.length,
      attachments: attachmentIds.length,
      attempt: attemptCtx.attempt,
      memoryTurns: agentMemory.conversationHistory.length,
      memoryNotesChars: agentMemory.appNotes.length,
      memoryPrefsChars: agentMemory.userPreferences.length,
    });
    const payload = await generateApp(
      prompt,
      async (p) => {
        // Each phase progress event becomes a Sentry breadcrumb, so when we
        // capture an error later we have a timeline of which phases ran and
        // how far they got. Cheap and bounded — phases are coarse-grained.
        addBreadcrumb(`phase:${p.phase}`, {
          jobId,
          progress: p.progress,
          note: p.note,
        });
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
      recordLog,
      resolvedAttachments,
      // Per-phase error reporter: every pipeline phase (planner, researcher,
      // architect, integrations, design, frontend, backend, qa, tests,
      // validate-patch-loop) is wrapped by generate.ts so a failure inside
      // one of them lands in Sentry tagged with the EXACT phase name plus
      // jobId/userId/appId, instead of the coarse "runJob" attribution from
      // the outer try/catch below.
      (phase, err, extras) => {
        captureAgentError(err, {
          phase,
          jobId,
          userId,
          appId: editAppId,
          extra: { ...extras, attempt: attemptCtx.attempt, coderModel, language },
        });
      },
      agentMemory,
    );
    recordLog("system", `Generación completada: ${Math.round(payload.frontendCode.length / 1000)} KB de frontend listos.`);

    // Atomic finalisation: insert/update app + mark job succeeded in one tx.
    // We capture the resulting appId in this outer var so we can schedule
    // post-commit work (memory extractor, image gen, visual tester) AFTER
    // the transaction is durably committed — scheduling from inside the
    // transaction callback risks firing before the COMMIT lands, which can
    // race against UPDATE/INSERT statements that depend on the new row.
    let finalAppIdAfterTx: number | null = null;
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
            // Refresh the persisted plan so the evaluator and any future
            // re-runs ground themselves against the most recent architect
            // plan, not the original one from app creation.
            plannedPages: payload.plannedPages,
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
        // Snapshot the new state into the revision history so the user can
        // roll back to this exact bundle later if a future edit breaks it.
        await insertAppRevisionFromRow(tx, {
          row: updated,
          source: "edit",
          summary: payload.description,
          jobId,
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
            // Architect's planned page list — fed to the autonomous evaluator
            // so vision can verify "the app actually has these screens".
            plannedPages: payload.plannedPages,
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
        // First revision in the history — the genesis snapshot. The user can
        // always come back to "the original generation" with one click, no
        // matter how many edits happen later.
        await insertAppRevisionFromRow(tx, {
          row: inserted,
          source: "create",
          summary: payload.description || "Creación inicial",
          jobId,
        });
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

      // Hand the resulting appId back to the outer scope so the post-commit
      // hooks below can schedule the memory extractor *after* this tx has
      // really landed in the database.
      finalAppIdAfterTx = resultAppId;

      // Schedule automatic AI image generation in the background after the
      // transaction commits. The Unsplash placeholder URLs the coder emits
      // often 404 (rate-limited / removed photos) so the bundle ships with
      // broken <img> tags showing alt text overlays. Nano Banana replaces
      // them with real generated images stored in app_images. We do this
      // *after* the job is marked succeeded so the user sees their app
      // immediately, then the images swap in on the next refetch.
      const finalAppId = resultAppId;
      const finalUserId = userId;
      const finalIsAdmin = isAdmin;
      const finalPrompt = prompt;
      setImmediate(() => {
        generateAppImages(finalAppId).catch((imgErr) => {
          logger.warn(
            { err: imgErr, appId: finalAppId, jobId },
            "Auto image generation failed (non-fatal)",
          );
        });
      });
      // Also schedule the Visual Testing Agent in the background. This costs
      // 30 credits (silent — disclosed in the product description) and runs
      // up to 3 fix cycles against /p/<slug>. We auto-create a slug here so
      // puppeteer has a URL to screenshot. If the user is broke or anything
      // explodes, we just log and move on — the user already has their app.
      setImmediate(() => {
        autoRunVisualTester({
          appId: finalAppId,
          userId: finalUserId,
          isAdmin: finalIsAdmin,
          prompt: finalPrompt,
          jobId,
        })
          .catch((vtErr) => {
            logger.warn(
              { err: vtErr, appId: finalAppId, jobId },
              "Auto visual tester failed (non-fatal)",
            );
          })
          .finally(() => {
            // Chain the autonomous Visual Evaluator AFTER the visual tester
            // so they run in series. The tester is generic auto-fix; the
            // evaluator is a strict pass/fail judgment that can auto-publish
            // the app if the user opted in. Errors here MUST NOT take down
            // the generation — the user already has their app.
            runAutoEvaluator({
              appId: finalAppId,
              userId: finalUserId,
              userIntent: finalPrompt,
              // The architect's planned page list (persisted on the row by
              // the transaction above) is fed to the vision model as ground
              // truth so it can complain when planned screens are missing.
              plannedPages: payload.plannedPages,
              jobId,
              baseUrl: VISUAL_TEST_BASE_URL,
              log: logger,
            }).catch((evErr) => {
              logger.warn(
                { err: evErr, appId: finalAppId, jobId },
                "Auto evaluator failed (non-fatal)",
              );
            });
          });
      });

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

    // Post-commit hook: launch the memory extractor only AFTER the txn has
    // durably committed. Doing this from inside the transaction callback
    // would risk a race where the extractor's UPDATE on agent_notes runs
    // before the row exists, or where a rolled-back transaction still writes
    // memory for an app that never came into being. Fire-and-forget — any
    // failure is logged and swallowed because the user already has their app.
    if (finalAppIdAfterTx !== null) {
      const memoryAppId: number = finalAppIdAfterTx;
      setImmediate(() => {
        runMemoryExtractor({
          userId,
          appId: memoryAppId,
          userPrompt: prompt,
          appDescription: payload.description,
        }).catch((memErr) => {
          logger.warn(
            { err: memErr, appId: memoryAppId, jobId },
            "Memory extractor failed (non-fatal)",
          );
        });
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Error desconocido";
    const hasMoreAttempts = attemptCtx.attempt < attemptCtx.maxAttempts;
    captureAgentError(err, {
      jobId,
      userId,
      appId: editAppId,
      phase: "runJob",
      extra: {
        attempt: attemptCtx.attempt,
        maxAttempts: attemptCtx.maxAttempts,
        editAppId,
        coderModel,
        language,
        willRetry: hasMoreAttempts,
      },
    });
    if (hasMoreAttempts) {
      // Transient failure: bump retryCount, rethrow so pg-boss schedules backoff.
      logger.warn(
        { err, jobId, attempt: attemptCtx.attempt, maxAttempts: attemptCtx.maxAttempts },
        "Generation job attempt failed — pg-boss will retry",
      );
      try {
        await db
          .update(generationJobs)
          .set({
            phase: "retrying",
            errorMessage: `Reintento ${attemptCtx.attempt}/${attemptCtx.maxAttempts}: ${detail}`,
            retryCount: attemptCtx.attempt,
            updatedAt: new Date(),
          })
          .where(eq(generationJobs.id, jobId));
      } catch (updateErr) {
        logger.error({ updateErr, jobId }, "Failed to mark job as retrying");
      }
      throw err;
    }

    // Final attempt: finalise (failed + refund + chat message).
    logger.error(
      { err, jobId, attempt: attemptCtx.attempt, maxAttempts: attemptCtx.maxAttempts },
      "Generation job failed after all retries",
    );
    try {
      await db
        .update(generationJobs)
        .set({
          status: "failed",
          phase: "failed",
          errorMessage: `Falló la generación: ${detail}`,
          retryCount: attemptCtx.attempt,
          updatedAt: new Date(),
        })
        .where(eq(generationJobs.id, jobId));
    } catch (updateErr) {
      // Rethrow if terminal write fails so pg-boss doesn't record success.
      logger.error({ err: updateErr, jobId }, "Failed to mark job as failed — rethrowing");
      throw updateErr;
    }
    // CRITICAL UX: when an *edit* fails, the user has just sent a message and
    // is sitting waiting in the chat. Without an assistant reply they see
    // nothing happen and assume the agent is broken. Drop a clear assistant
    // message into the conversation so the chat history reflects the
    // failure.
    if (editAppId) {
      try {
        await db.insert(appMessages).values({
          appId: editAppId,
          role: "assistant",
          content:
            `❌ No pude aplicar el cambio: ${detail}\n\n` +
            `He devuelto el crédito. Vuelve a intentarlo o reformula la petición. ` +
            `Si el problema persiste, prueba con otro modelo desde el botón "Modelo".`,
        });
      } catch (msgErr) {
        logger.error({ msgErr, jobId, editAppId }, "Failed to insert error chat message");
      }
    }
    if (!isAdmin) {
      // Look up the original reservation amount so we refund exactly what we
      // charged (kind-aware — a failed game-3d job refunds 5, not 1). If no
      // reservation row exists, do NOT fall back to 1 — that would mint
      // credits out of thin air. Log loudly for manual reconciliation
      // instead. Reservations are written in the same transaction as the
      // job, so a missing row signals real ledger corruption.
      const [reservation] = await db
        .select({ amount: creditTransactions.amount })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.userId, userId),
            eq(
              creditTransactions.description,
              `Reserva de crédito para job #${jobId}`,
            ),
          ),
        )
        .limit(1);
      if (reservation) {
        await refundCredit(userId, jobId, Math.abs(reservation.amount));
      } else {
        logger.error(
          { userId, jobId },
          "Failed-job refund SKIPPED — no reservation row found for this job. Manual reconciliation required.",
        );
      }
    }
    // Diagnostic agent: when any agent errors out, kick off a free diagnosis
    // so the user gets actionable info in the chat instead of just a generic
    // failure. If there's a deployed app, we run the Visual Testing Agent on
    // the live URL; otherwise we run the static health-check (esbuild) on the
    // last good bundle.
    if (editAppId) {
      diagnoseFailedAgent({
        appId: editAppId,
        userId,
        jobId,
        failureDetail: detail,
      }).catch((diagErr) => {
        logger.warn(
          { diagErr, jobId, editAppId },
          "Post-failure diagnostic agent crashed",
        );
      });
    }
  }
}

/**
 * Free post-failure diagnostic. Tries the Visual Testing Agent against the
 * live deploy if the app already has a public slug (auto-fix disabled — we
 * only want to surface what's wrong, not patch it without consent), otherwise
 * falls back to the static esbuild health check. Posts a single assistant
 * message into the chat with the findings so the user has actionable info.
 *
 * Never charges credits — this is a courtesy diagnostic that fires after we've
 * already refunded the failed job.
 */
async function diagnoseFailedAgent(opts: {
  appId: number;
  userId: string;
  jobId: number;
  failureDetail: string;
}): Promise<void> {
  const { appId, userId, jobId } = opts;
  const [row] = await db
    .select()
    .from(generatedApps)
    .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!row) return;

  // Path 1: deployed app → Visual Testing Agent (read-only, no auto-fix).
  if (row.publicSlug && row.frontendCode) {
    try {
      const report = await runVisualTester({
        app: {
          id: row.id,
          title: row.title,
          description: row.description,
          frontendCode: row.frontendCode,
          publicSlug: row.publicSlug,
        },
        baseUrl: VISUAL_TEST_BASE_URL,
        prompt: row.title + (row.description ? `: ${row.description}` : ""),
        autoFix: false,
        log: logger,
      });
      const top = report.finalAnalysis.issues
        .slice(0, 3)
        .map(
          (i, idx) =>
            `${idx + 1}. [${i.severity}/${i.viewport}] ${i.description}`,
        )
        .join("\n");
      await db.insert(appMessages).values({
        appId,
        role: "assistant",
        content:
          `🔎 **Diagnóstico automático tras el error**\n` +
          `Mi compañero de pruebas visuales analizó la versión actual desplegada (sin tocarla).\n\n` +
          `Puntuación visual: **${Math.round(report.finalAnalysis.overallScore)}/100**\n` +
          (top
            ? `Problemas detectados:\n${top}\n\n`
            : `No detectó problemas visuales serios — el error parece ser de lógica/agente, no del UI.\n\n`) +
          `Si quieres, vuelve a intentar la edición, prueba con otro modelo, o pulsa "Análisis Visual" para un reporte completo (gratis esta vez no, normalmente cuesta 30 créditos).`,
      });
      logger.info(
        { appId, jobId, score: report.finalAnalysis.overallScore },
        "Post-failure diagnostic completed via Visual Testing Agent",
      );
      return;
    } catch (err) {
      logger.warn(
        { err, appId, jobId },
        "Post-failure Visual Testing Agent failed, falling back to esbuild",
      );
      // Fall through to static check.
    }
  }

  // Path 2: no deploy (or visual tester crashed) → static esbuild health check.
  if (row.frontendCode) {
    try {
      const report = await validateBundle(row.frontendCode);
      const lines: string[] = [];
      if (report.ok) {
        lines.push(
          "El bundle actual compila sin errores — el fallo parece ser específico de la nueva edición que pediste.",
        );
      } else {
        const top: string = report.issues
          .slice(0, 3)
          .map((i: BuildIssue, idx: number) => `${idx + 1}. ${i.message}`)
          .join("\n");
        lines.push(
          `El bundle actual tiene ${report.issues.length} error(es) de compilación:\n${top}`,
        );
      }
      await db.insert(appMessages).values({
        appId,
        role: "assistant",
        content:
          `🔎 **Diagnóstico automático tras el error**\n` +
          `Hice un chequeo de salud del código actual:\n\n${lines.join("\n")}\n\n` +
          `Vuelve a intentar la edición o reformula la petición.`,
      });
      logger.info(
        { appId, jobId, ok: report.ok },
        "Post-failure diagnostic completed via static health check",
      );
    } catch (err) {
      logger.warn(
        { err, appId, jobId },
        "Post-failure static health check also failed",
      );
    }
  }
}

/** A job stuck in `running` for longer than this on boot reclaim is presumed dead. */
const STALE_RUNNING_MS = 15 * 60 * 1000; // 15 minutes — longer than any realistic single phase

/**
 * Threshold for the *inline* stale-job recovery inside the 409 check on the
 * /generate endpoint. Healthy runs update generation_jobs.updated_at on every
 * phase transition (planner, architect, integrations, frontend, qa, parsing,
 * etc.) which fires multiple times per minute. 5 minutes without an update
 * means the worker silently died — it's safe to reclaim and unblock the user.
 *
 * Deliberately stricter than STALE_RUNNING_MS so the user isn't blocked for
 * 15 min when an edit hangs; the boot threshold stays conservative because at
 * boot we may race with another live worker that's still mid-phase.
 */
const STALE_INFLIGHT_INLINE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Mark a single 'running' job as failed and refund its reservation.
 * Idempotent at the DB level — if the row was already terminal, the WHERE
 * clause matches 0 rows and the refund is skipped.
 *
 * Used by both the boot-time reclaim sweep and the inline 409 recovery so
 * the failure UX (status, phase, error message, credit ledger) stays
 * consistent regardless of which path detected the stale job.
 */
async function reclaimSingleStaleJob(
  job: { id: number; userId: string },
  reason: string,
): Promise<void> {
  await db
    .update(generationJobs)
    .set({
      status: "failed",
      phase: "failed",
      errorMessage: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(generationJobs.id, job.id),
        sql`${generationJobs.status} IN ('queued', 'running')`,
      ),
    );
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
    await refundCredit(job.userId, job.id, Math.abs(reservation.amount));
  }
}

/**
 * Reconcile generation_jobs against the queue. Called at boot AND on a
 * periodic interval (every couple of minutes) so apps don't get stuck behind
 * a dead worker between server restarts.
 *
 *   - `queued` jobs: re-enqueue them. They were created in a previous run and
 *     either never made it to the queue (crash between DB insert and
 *     boss.send) or pg-boss already has them — singletonKey dedupes the
 *     re-enqueue.
 *   - `running` jobs older than STALE_RUNNING_MS: mark failed + refund. The
 *     worker that picked them up must be dead.
 *   - `running` jobs younger than that: leave alone — a live worker may
 *     still own them.
 */
export async function reclaimOrphanedJobs(opts: { userId?: string } = {}) {
  try {
    const where = opts.userId
      ? sql`${generationJobs.status} IN ('queued', 'running') AND ${generationJobs.userId} = ${opts.userId}`
      : sql`${generationJobs.status} IN ('queued', 'running')`;
    const all = await db.select().from(generationJobs).where(where);
    if (all.length === 0) return;

    const now = Date.now();
    let requeued = 0;
    let failed = 0;

    for (const job of all) {
      if (job.status === "queued") {
        // Re-enqueue. enqueueGenerateJob uses a singletonKey so duplicates
        // (already in pg-boss) are silently rejected.
        try {
          await enqueueGenerateJob(job.id);
          requeued++;
        } catch (err) {
          logger.warn({ err, jobId: job.id }, "Failed to re-enqueue queued job at boot");
        }
        continue;
      }
      // running:
      const ageMs = now - new Date(job.updatedAt).getTime();
      if (ageMs < STALE_RUNNING_MS) continue;
      try {
        await reclaimSingleStaleJob(job, "Interrumpido — proceso del servidor caído.");
        failed++;
      } catch (err) {
        logger.warn({ err, jobId: job.id }, "Failed to reclaim stale running job");
      }
    }

    if (requeued || failed) {
      logger.warn({ requeued, failed, total: all.length }, "Reclaimed orphaned generation jobs");
    }
  } catch (err) {
    logger.error({ err }, "Failed to reclaim orphaned jobs");
  }
}

/**
 * Worker entry point: load all params from the DB row and run the job.
 *
 * The pg-boss worker calls this with just the jobId — the row in
 * generation_jobs is the source of truth for everything else (prompt, edit
 * target, attachments, model, language, isAdmin). This contract is what
 * lets the worker run in a separate process or survive a restart.
 *
 * Idempotency: if the job is already in a terminal state (succeeded/failed),
 * we no-op. If it's running, we still re-process — we trust the queue to not
 * dispatch the same job twice in normal operation; the only way we'd see this
 * is a crash mid-run or a manual retry.
 */
export async function runJobById(
  jobId: number,
  attemptCtx: { attempt: number; maxAttempts: number } = { attempt: 1, maxAttempts: 1 },
): Promise<void> {
  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  if (!job) {
    logger.warn({ jobId }, "Worker received jobId for non-existent generation job");
    return;
  }
  if (job.status === "succeeded" || job.status === "failed") {
    // Already done — nothing to do. Happens when an old retry fires after
    // a manual finalisation.
    return;
  }
  await runJob(
    job.id,
    job.userId,
    job.prompt,
    job.isAdmin,
    job.editAppId ?? undefined,
    job.coderModel,
    job.language as GenLanguage,
    Array.isArray(job.attachmentIds) ? job.attachmentIds : [],
    attemptCtx,
  );
}

interface EnqueueExtras {
  // Optional: a chat user message to persist atomically with the job. If the
  // enqueue (credit reservation, etc.) fails, the message is rolled back too.
  chatMessage?: { appId: number; content: string };
  // Optional: ids of chat_attachments rows that the user attached to this
  // prompt. They get (a) persisted on the message row so the chat bubble can
  // render thumbnails, and (b) loaded by runJob and fed to the AI.
  attachmentIds?: number[];
}

async function enqueueGeneration(
  req: Request,
  res: Response,
  cleanedPrompt: string,
  editAppId: number | undefined,
  extras?: EnqueueExtras,
  coderModelOverride?: string,
  languageOverride?: GenLanguage,
  kind: ProjectKind = "fullstack",
) {
  // Edits always cost 1 credit (the original kind already informed the
  // architecture, and re-runs aren't substantially more expensive than a
  // small fullstack call). New generations scale with the kind.
  const cost = editAppId ? 1 : KIND_COSTS[kind] ?? 1;
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

  if (!isAdmin && user.credits < cost) {
    res.status(402).json({
      error:
        cost > 1
          ? `Este tipo de proyecto cuesta ${cost} créditos y solo tienes ${user.credits}. Compra más para seguir generando.`
          : "Te has quedado sin créditos. Compra más para seguir generando.",
    });
    return;
  }

  // For edits, refuse if there's already a *live* in-flight job on this app
  // to avoid last-writer-wins races. The UI also blocks the chat input but a
  // second tab / API client could try otherwise.
  //
  // IMPORTANT: a row in 'queued' or 'running' is NOT enough on its own to
  // block — if a previous worker died (process crash, network split, OpenAI
  // call hung past pg-boss expiry) the row stays at 'running' forever and
  // the user gets a permanent 409 with no way out except an admin restart.
  // We therefore reclaim any in-flight row whose updated_at hasn't moved in
  // STALE_INFLIGHT_INLINE_MS (healthy generations bump updated_at on every
  // phase transition, multiple times per minute) and let the request proceed.
  if (editAppId) {
    const inFlight = await db
      .select({
        id: generationJobs.id,
        userId: generationJobs.userId,
        status: generationJobs.status,
        updatedAt: generationJobs.updatedAt,
      })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.appId, editAppId),
          sql`${generationJobs.status} IN ('queued', 'running')`,
        ),
      )
      .orderBy(sql`${generationJobs.updatedAt} DESC`)
      .limit(1);
    if (inFlight.length > 0) {
      const stuck = inFlight[0];
      const ageMs = Date.now() - new Date(stuck.updatedAt).getTime();
      if (ageMs >= STALE_INFLIGHT_INLINE_MS) {
        // Looks dead. Reclaim and continue — the user gets to retry instead
        // of being told to "wait" for something that will never finish.
        req.log.warn(
          { appId: editAppId, jobId: stuck.id, ageMinutes: Math.round(ageMs / 60_000) },
          "Auto-reclaiming stale in-flight job before accepting new edit",
        );
        try {
          await reclaimSingleStaleJob(
            { id: stuck.id, userId: stuck.userId },
            "Liberado automáticamente: el job anterior se quedó colgado más de 5 min sin avanzar.",
          );
        } catch (err) {
          req.log.error({ err, jobId: stuck.id }, "Inline reclaim failed; surfacing 409");
          res.status(409).json({
            error: "Ya hay un cambio en curso para esta app. Espera a que termine.",
          });
          return;
        }
      } else {
        const remainingSec = Math.max(
          1,
          Math.ceil((STALE_INFLIGHT_INLINE_MS - ageMs) / 1000),
        );
        res.status(409).json({
          error:
            `Ya hay un cambio en curso para esta app. ` +
            `Espera a que termine (se desbloqueará automáticamente en ~${remainingSec}s si no progresa).`,
        });
        return;
      }
    }
  }

  let job;
  try {
    job = await db.transaction(async (tx) => {
      if (!isAdmin) {
        const updated = await tx
          .update(users)
          .set({
            credits: sql`${users.credits} - ${cost}`,
            updatedAt: new Date(),
          })
          .where(and(eq(users.id, userId), sql`${users.credits} >= ${cost}`))
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
          // Persist all run params so the worker can rehydrate from this row
          // alone given just the jobId. This is what makes the queue work
          // across process boundaries / restarts.
          editAppId: editAppId ?? null,
          coderModel,
          language,
          attachmentIds: extras?.attachmentIds ?? [],
          isAdmin,
        })
        .returning();
      if (!isAdmin) {
        await tx.insert(creditTransactions).values({
          userId,
          kind: "usage",
          amount: -cost,
          description: `Reserva de crédito para job #${created.id}`,
        });
      }
      // Persist the chat message in the same tx so it never lingers without a job.
      if (extras?.chatMessage) {
        await tx.insert(appMessages).values({
          appId: extras.chatMessage.appId,
          role: "user",
          content: extras.chatMessage.content,
          attachmentIds: JSON.stringify(extras?.attachmentIds ?? []),
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

  // Hand off to the persistent queue; fall back to setImmediate if the queue is down.
  try {
    await enqueueGenerateJob(job.id);
    // Visible queue position in the job log stream so users see "tu app está #3 en la cola".
    try {
      const [{ ahead }] = await db
        .select({ ahead: sql<number>`count(*)::int` })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.status, "queued"),
            sql`${generationJobs.id} < ${job.id}`,
          ),
        );
      const position = Number(ahead) + 1;
      await db.insert(jobLogs).values({
        jobId: job.id,
        agent: "queue",
        level: "info",
        message:
          position === 1
            ? "Tu solicitud está en cola y empezará a procesarse en breve."
            : `Tu solicitud está en cola en posición #${position}.`,
      });
    } catch (logErr) {
      logger.warn({ err: logErr, jobId: job.id }, "Failed to write queue-position log line");
    }
  } catch (err) {
    logger.error({ err, jobId: job.id }, "Failed to enqueue job in queue — falling back to in-process run");
    const attachmentIdsForJob = extras?.attachmentIds ?? [];
    setImmediate(() => {
      runJob(
        job.id,
        userId,
        cleanedPrompt,
        isAdmin,
        editAppId,
        coderModel,
        language,
        attachmentIdsForJob,
      ).catch((runErr) => {
        logger.error({ err: runErr, jobId: job.id }, "runJob threw unexpectedly");
      });
    });
  }

  res.status(202).json(serializeJob(job));
}

router.post(
  "/generate",
  async (req: Request, res: Response, next) => {
    // Admin bypass — same shape as /apps/:id/generate-images. Allows the
    // server itself (or an operator with SESSION_SECRET) to enqueue a job
    // on behalf of a known user via x-admin-user-id, without going through
    // a Clerk session. Used for one-shot scripted generations.
    const adminKey = req.header("x-admin-key");
    const adminUserId = req.header("x-admin-user-id");
    if (adminKey && adminKey === process.env.SESSION_SECRET && adminUserId) {
      try {
        const user = await ensureUser(adminUserId);
        req.userId = adminUserId;
        req.dbUser = user;
        return next();
      } catch (err) {
        req.log.error({ err, adminUserId }, "admin bypass ensureUser failed");
        res.status(500).json({ error: "admin bypass failed" });
        return;
      }
    }
    return requireAuth(req, res, next);
  },
  async (req: Request, res: Response) => {
  const prompt: unknown = req.body?.prompt;
  const appIdRaw: unknown = req.body?.appId;
  const coderModelRaw: unknown = req.body?.coderModel;
  const languageRaw: unknown = req.body?.language;
  const kindRaw: unknown = req.body?.kind;
  const attachmentIdsRaw: unknown = req.body?.attachmentIds;
  // Sanitise: only keep positive integers, hard-cap at 10 attachments per
  // request so a malicious client can't DoS us by sending 10 000 ids.
  const attachmentIds: number[] = Array.isArray(attachmentIdsRaw)
    ? attachmentIdsRaw
        .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)
        .slice(0, 10)
    : [];
  if (typeof prompt !== "string" || prompt.trim().length < 5) {
    res.status(400).json({ error: "El prompt debe tener al menos 5 caracteres." });
    return;
  }
  const userId = req.userId!;
  // Validate kind against the whitelist; anything unknown silently falls back
  // to the default fullstack preset (1 credit, no INTENT prefix). Edits ignore
  // the kind entirely (set further down).
  const kind: ProjectKind =
    typeof kindRaw === "string" && ALLOWED_KINDS.has(kindRaw as ProjectKind)
      ? (kindRaw as ProjectKind)
      : "fullstack";
  // The dashboard sends raw user prompt; the server prepends the kind's
  // [INTENT: …] directive so the architect can't be talked into ignoring it
  // by a malicious client. Edits skip this — they inherit the original app's
  // intent from the existing files.
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
  // Premium models (GPT-5, Claude Sonnet) are gated by lifetime spend — admins
  // and paying users only. Sneaky callers that send the value over the API
  // get downgraded to "auto" silently rather than a 403.
  const user = req.dbUser!;
  const isAdmin = isAdminEmail(user.email);
  const txns = await db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));
  const lifetimePurchased = txns.reduce(
    (sum, t) => sum + (t.kind === "purchase" ? Math.abs(t.amount) : 0),
    0,
  );
  const isPremium = isAdmin || lifetimePurchased >= 200;
  const requestedModel =
    typeof coderModelRaw === "string" && ALLOWED_CODER_MODELS.has(coderModelRaw)
      ? coderModelRaw
      : undefined;
  const coderModelOverride =
    requestedModel && PREMIUM_CODER_MODELS.has(requestedModel) && !isPremium
      ? "auto"
      : requestedModel;
  const languageOverride =
    typeof languageRaw === "string" && ALLOWED_LANGUAGES.has(languageRaw as GenLanguage)
      ? (languageRaw as GenLanguage)
      : undefined;
  // Build the final prompt: prepend the kind's intent directive only for new
  // generations. Edits skip it because they reuse the existing app context.
  const intent = !editAppId ? KIND_INTENTS[kind] : null;
  const finalPrompt = intent ? `${intent}\n\n${cleanedPrompt}` : cleanedPrompt;
  // For initial generations, we don't persist a chat message here (apps.ts
  // seeds the conversation transactionally inside runJob's success path), but
  // attachments still need to flow through so the AI sees them. Pass them via
  // the same `extras` channel.
  await enqueueGeneration(
    req,
    res,
    finalPrompt,
    editAppId,
    editAppId
      ? { chatMessage: { appId: editAppId, content: cleanedPrompt }, attachmentIds }
      : { attachmentIds },
    coderModelOverride,
    languageOverride,
    kind,
  );
});

/**
 * Replace placeholder image URLs (Unsplash/picsum) in the app's frontend bundle
 * with real images generated by the Nano Banana Pro image agent. Synchronous —
 * the front end shows a spinner while we wait. Capped at 4 images per call.
 */
router.post(
  "/apps/:id/generate-images",
  async (req: Request, res: Response, next) => {
    // Allow an internal-admin bypass via the SESSION_SECRET so the running
    // server can be triggered from the shell to repair an app without going
    // through Clerk auth. Used only for one-shot fixes.
    const adminKey = req.header("x-admin-key");
    if (adminKey && adminKey === process.env.SESSION_SECRET) {
      return next();
    }
    return requireAuth(req, res, next);
  },
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid app id" });
      return;
    }
    const adminKey = req.header("x-admin-key");
    const isAdmin = adminKey != null && adminKey === process.env.SESSION_SECRET;
    if (!isAdmin) {
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
 * Toggle the per-app auto-publish flag. When ON, the autonomous evaluator
 * will deploy the app to /p/<slug> automatically as soon as it gives it the
 * visto bueno (and email the owner). When OFF, the evaluator still runs but
 * leaves publishing to the user.
 */
router.patch(
  "/apps/:id/auto-publish",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid app id" });
      return;
    }
    const value: unknown = req.body?.autoPublish;
    if (typeof value !== "boolean") {
      res.status(400).json({ error: "autoPublish debe ser boolean." });
      return;
    }
    const userId = req.userId!;
    const result = await db
      .update(generatedApps)
      .set({ autoPublish: value })
      .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
      .returning();
    if (result.length === 0) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    res.json(serializeApp(result[0]));
  },
);

/**
 * Re-trigger the generation pipeline for an app stuck in `needs_review`.
 * Resets the status to `ready`, clears the evaluator summary, and enqueues a
 * fresh edit-mode job using the original prompt. The dashboard wires this
 * to the red "Reintentar generación" button.
 */
router.post(
  "/apps/:id/retry-generation",
  requireAuth,
  async (req: Request, res: Response) => {
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
    if (row.status !== "needs_review") {
      res.status(409).json({
        error: "Esta app no está marcada para revisión; usa el chat normal para editarla.",
      });
      return;
    }
    // Build a self-explanatory retry prompt using the evaluator summary as
    // context. The patcher will see the original intent + what the evaluator
    // didn't like, so the next pass has a real shot at converging.
    const retryPrompt =
      `Reintenta esta app. La evaluación visual rechazó la versión anterior.\n\n` +
      `INTENCIÓN ORIGINAL:\n${row.prompt}\n\n` +
      `RAZONES DEL RECHAZO:\n${row.evaluatorSummary ?? "(sin detalle)"}\n\n` +
      `Aplica los cambios necesarios para que pase la evaluación.`;
    // Snapshot the prior needs_review state so we can restore it if the
    // enqueue fails — otherwise a 402/409/etc would leave the app stuck in
    // "ready" with `evaluatorSummary` wiped, and the next call to this
    // endpoint would 409 (status !== "needs_review").
    const previousStatus = row.status;
    const previousSummary = row.evaluatorSummary;
    // Clear the needs_review state up front so the dashboard reflects the
    // retry immediately (the worker will set status back to ready on success).
    await db
      .update(generatedApps)
      .set({ status: "ready", evaluatorSummary: null })
      .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)));
    // Reuse the same enqueue path the chat /messages endpoint takes — that
    // way credit accounting, in-flight protection, and chat-message
    // persistence behave identically to a normal user-initiated edit.
    try {
      await enqueueGeneration(req, res, retryPrompt, id, {
        chatMessage: { appId: id, content: retryPrompt },
        attachmentIds: [],
      });
    } catch (err) {
      // enqueueGeneration normally responds via res; an unexpected throw is
      // truly exceptional. Restore state and rethrow so the user can retry.
      await db
        .update(generatedApps)
        .set({ status: previousStatus, evaluatorSummary: previousSummary })
        .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
        .catch(() => undefined);
      throw err;
    }
    // enqueueGeneration writes its own response. If it short-circuited with
    // a 4xx/5xx (out of credits, in-flight job, etc.), restore the prior
    // needs_review state so the user can retry from the same UI.
    if (res.statusCode >= 400) {
      await db
        .update(generatedApps)
        .set({ status: previousStatus, evaluatorSummary: previousSummary })
        .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
        .catch((err) => {
          req.log.warn({ err, appId: id }, "Failed to restore needs_review after retry rejection");
        });
    }
  },
);

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
      // Capture the post-fix bundle in revision history. We use snapshotCurrentApp
      // (re-reads the row) to keep this lightweight and to never block the
      // user-facing response on a snapshot failure.
      const { snapshotCurrentApp } = await import("../lib/appRevisions");
      void snapshotCurrentApp({
        appId: id,
        source: "health-fix",
        summary: `Reparación automática del build (${before.issues.length} → ${after.issues.length} errores)`,
      });
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
  try {
    const result = await runDeployForApp({ appId: id, userId, log: req.log });
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "App not found") {
      res.status(404).json({ error: "App not found" });
      return;
    }
    if (err instanceof Error && err.message === "Could not assign public slug") {
      res.status(500).json({ error: "No pudimos asignar una URL pública." });
      return;
    }
    req.log.warn({ err, appId: id }, "Deploy pre-build failed");
    res.status(400).json({
      error:
        "No pudimos empaquetar la app: " +
        (err instanceof Error ? err.message : "error desconocido"),
    });
  }
});

/**
 * POST /apps/:id/fork — clone an existing app into a new one owned by the
 * current user. The fork copies the working bundle (frontend + backend), the
 * coder model preference, and the language choice, but resets the public slug
 * and any GitHub repo link — those are deploy-target specific. Title gets a
 * "(copia)" suffix so the user can tell the two apart in the dashboard.
 *
 * Free of charge: forking is a UX convenience, not a generation. The new app
 * starts with a single seed assistant message explaining where it came from.
 */
router.post("/apps/:id/fork", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid app id" });
    return;
  }
  const userId = req.userId!;
  const [source] = await db
    .select()
    .from(generatedApps)
    .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!source) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  // Refuse to fork an app that's mid-generation/edit — we'd snapshot a stale
  // pre-edit bundle and the user would think the fork "lost" their changes.
  // Also refuse failed apps (the bundle may not even compile).
  if (source.status !== "ready") {
    res.status(409).json({
      error:
        source.status === "failed"
          ? "No se puede clonar una app que falló al generarse."
          : "Espera a que termine el cambio actual antes de clonar.",
    });
    return;
  }
  const forkedTitle = source.title.endsWith("(copia)")
    ? source.title
    : `${source.title} (copia)`;
  const [inserted] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(generatedApps)
      .values({
        userId,
        title: forkedTitle,
        prompt: source.prompt,
        description: source.description,
        techStack: source.techStack,
        frontendCode: source.frontendCode,
        backendCode: source.backendCode,
        status: "ready",
        coderModel: source.coderModel,
        language: source.language,
      })
      .returning();
    await tx.insert(appMessages).values({
      appId: row.id,
      role: "assistant",
      content: `Esta app es una copia de "${source.title}". Pídeme cambios sin miedo a romper la versión original.`,
    });
    return [row];
  });
  req.log.info({ srcAppId: id, newAppId: inserted.id, userId }, "App forked");
  res.json(inserted);
});

/**
 * POST /apps/:id/visual-test — Visual Testing Agent.
 *
 * Captures screenshots of the app's public deploy URL at three viewports,
 * scores them with Claude Sonnet vision, and (when issues are found) auto-
 * patches the bundle up to MAX_FIX_CYCLES=3 times. Charges 30 credits per run
 * silently — admins are exempt.
 *
 * If the app has no `publicSlug`, one is created on the fly so the agent has
 * a URL to screenshot. The deploy route renders the latest bundle on every
 * request, so no separate "publish" step is required.
 */
router.post(
  "/apps/:id/visual-test",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid app id" });
      return;
    }
    const userId = req.userId!;
    const isAdmin = req.dbUser?.email ? isAdminEmail(req.dbUser.email) : false;

    const [row] = await db
      .select()
      .from(generatedApps)
      .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    // Ensure deploy URL exists.
    const slug = await ensurePublicSlug(id, userId, req.log, row.publicSlug);
    if (!slug) {
      res
        .status(500)
        .json({ error: "No pudimos preparar la URL pública para los screenshots." });
      return;
    }

    // Sanity-build so puppeteer doesn't screenshot a server-error page.
    try {
      await buildDeployHtml({ bundle: row.frontendCode, title: row.title });
    } catch (err) {
      req.log.warn({ err, appId: id }, "Visual test pre-build failed");
      res.status(400).json({
        error:
          "El bundle actual no compila, así que no podemos analizarlo visualmente: " +
          (err instanceof Error ? err.message : "error desconocido"),
      });
      return;
    }

    // Charge silently. The cost is intentionally not surfaced in the response —
    // the user is told about it once in the product description, not per-run.
    const charge = await chargeCredits({
      userId,
      isAdmin,
      amount: VISUAL_TEST_COST,
      description: `Visual Testing Agent — app #${id}`,
    });
    if (!charge.ok) {
      res
        .status(402)
        .json({ error: "Créditos insuficientes para el análisis visual." });
      return;
    }

    try {
      const report = await runVisualTester({
        app: {
          id: row.id,
          title: row.title,
          description: row.description,
          frontendCode: row.frontendCode,
          publicSlug: slug,
        },
        baseUrl: VISUAL_TEST_BASE_URL,
        prompt: row.title + (row.description ? `: ${row.description}` : ""),
        autoFix: true,
        log: req.log,
      });
      res.json({
        cycles: report.cycles,
        fixesApplied: report.fixesApplied,
        analysis: {
          ...report.finalAnalysis,
          // Map internal `cssfix` to the public `suggestion` field.
          issues: report.finalAnalysis.issues.map((i) => ({
            severity: i.severity,
            type: i.type,
            viewport: i.viewport,
            description: i.description,
            suggestion: i.cssfix,
          })),
        },
        screenshots: report.screenshots.map((s) => ({
          viewport: s.viewport,
          mimeType: s.mimeType,
          width: s.width,
          height: s.height,
          imageBase64: s.data,
          consoleErrors: s.consoleErrors,
        })),
      });
    } catch (err) {
      req.log.error({ err, appId: id }, "Visual tester crashed");
      // Refund the silent charge if the run failed — the user shouldn't pay
      // for an analysis that never produced a report.
      await refundCredits({
        userId,
        isAdmin,
        amount: VISUAL_TEST_COST,
        description: `Reembolso Visual Testing — app #${id} (falló)`,
      }).catch((refundErr) => {
        req.log.error({ refundErr, appId: id }, "Visual tester refund failed");
      });
      const code = err instanceof VisualTesterError ? err.code : "internal";
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Error inesperado en el análisis visual.",
        code,
      });
    }
  },
);

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
  // Load the full row so the intent classifier can reason with title +
  // description + persistent agent notes — without that context the
  // "question" branch can't answer "¿de qué va esta app?" sensibly.
  const [owned] = await db
    .select({
      id: generatedApps.id,
      title: generatedApps.title,
      description: generatedApps.description,
      agentNotes: generatedApps.agentNotes,
    })
    .from(generatedApps)
    .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!owned) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const cleanedMessage = message.trim();
  const attachmentIdsRaw: unknown = req.body?.attachmentIds;
  const attachmentIds: number[] = Array.isArray(attachmentIdsRaw)
    ? attachmentIdsRaw
        .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)
        .slice(0, 10)
    : [];

  // Intent classifier — runs BEFORE we enqueue so questions and pure
  // research requests don't waste a credit on a full regeneration. If the
  // user attached images we always treat the message as an edit (no point
  // running text-only classification when the user clearly wants the
  // image baked into the app).
  if (attachmentIds.length === 0) {
    // Pull the last 10 chat turns so the classifier can disambiguate
    // follow-ups like "y ahora más grande" (clearly an edit referring to
    // the previous answer) vs "¿y por qué hiciste eso?" (a question).
    const history = await db
      .select({ role: appMessages.role, content: appMessages.content })
      .from(appMessages)
      .where(eq(appMessages.appId, id))
      .orderBy(desc(appMessages.id))
      .limit(10);
    const recentMessages = history.reverse();

    // Rate-limit gate BEFORE we call the classifier so an abusive user
    // can't even spend a Haiku classification call on us once they're
    // capped. Admins bypass. If the user is over the free quota we fall
    // straight through to enqueueGeneration — they pay 1 credit like a
    // normal edit, no bespoke 429 (which the chat UI doesn't know how to
    // render anyway).
    const isAdmin = isAdminEmail(req.dbUser!.email);
    const limit = await tryConsumeFreeAnswer(userId, isAdmin);
    const classified = limit.allowed
      ? await classifyChatIntent({
          appTitle: owned.title,
          appDescription: owned.description ?? "",
          agentNotes: owned.agentNotes ?? "",
          recentMessages,
          message: cleanedMessage,
          log: req.log,
        })
      : { intent: "edit" as const, reply: "" };
    if (!limit.allowed) {
      req.log.info(
        { userId, resetMs: limit.resetMs },
        "Free-answer cap hit — routing message through paid edit path",
      );
    }

    if (classified.intent === "question" || classified.intent === "research") {
      // Build the assistant reply. Question → use the model's reply
      // verbatim. Research → call the existing researchTopic helper which
      // returns a Spanish brief; if it fails (timeout, no key) fall back
      // to a clear apology so the chat never goes silent.
      let assistantReply = classified.reply;
      if (classified.intent === "research") {
        try {
          const brief = await researchTopic(cleanedMessage);
          assistantReply = brief && brief.length > 0
            ? brief
            : "No pude completar la búsqueda en este momento. Inténtalo otra vez en unos segundos o reformula la petición.";
        } catch (err) {
          req.log.warn({ err, appId: id }, "researchTopic failed inside chat");
          assistantReply =
            "No pude completar la búsqueda en este momento. Inténtalo otra vez en unos segundos.";
        }
      }
      // Empty reply guard — should be rare but means the model returned
      // intent=question with no body. Fall through to a generic line so
      // we still close the loop with the user.
      if (!assistantReply || assistantReply.trim().length === 0) {
        assistantReply =
          "No tengo suficiente información para responder. ¿Puedes reformular la pregunta?";
      }
      // Persist user + assistant turns in a single transaction so partial
      // writes can never strand the chat with an unanswered user line.
      await db.transaction(async (tx) => {
        await tx.insert(appMessages).values({
          appId: id,
          role: "user",
          content: cleanedMessage,
          attachmentIds: "[]",
        });
        await tx.insert(appMessages).values({
          appId: id,
          role: "assistant",
          content: assistantReply,
          attachmentIds: "[]",
        });
      });
      res.status(200).json({
        kind: "answered",
        intent: classified.intent,
        reply: assistantReply,
      });
      return;
    }
  }

  // Default path: real edit → existing generation pipeline.
  await enqueueGeneration(req, res, cleanedMessage, id, {
    chatMessage: { appId: id, content: cleanedMessage },
    attachmentIds,
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
    // Queue position: how many queued jobs are ahead of this one (older id,
    // status=queued). Returns 0 if this job is no longer queued.
    let queuePosition: number | null = null;
    if (row.status === "queued") {
      const [{ ahead }] = await db
        .select({ ahead: sql<number>`count(*)::int` })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.status, "queued"),
            sql`${generationJobs.id} < ${id}`,
          ),
        );
      queuePosition = Number(ahead) + 1;
    }
    res.json({ ...serializeJob(row), queuePosition });
  },
);

/**
 * Stream live agent log lines for a job. The dashboard polls this endpoint
 * with `?afterId=N` to fetch only new lines since the last seen id, which
 * keeps the payload tiny and avoids re-rendering existing rows. Owner-only:
 * we verify the job belongs to the requester before returning anything.
 *
 * Uses sql`>` instead of gt() to keep the import surface minimal — afterId
 * is server-clamped to a non-negative int, so no injection surface.
 */
router.get(
  "/generate/jobs/:id/logs",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const userId = req.userId!;
    // Ownership check: we never return logs for someone else's job.
    const [job] = await db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(and(eq(generationJobs.id, id), eq(generationJobs.userId, userId)))
      .limit(1);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const afterRaw = Number(req.query.afterId ?? 0);
    const afterId = Number.isFinite(afterRaw) && afterRaw > 0 ? Math.floor(afterRaw) : 0;
    const rows = await db
      .select()
      .from(jobLogs)
      .where(and(eq(jobLogs.jobId, id), sql`${jobLogs.id} > ${afterId}`))
      .orderBy(jobLogs.id)
      .limit(500);
    res.json({
      logs: rows.map((r) => ({
        id: r.id,
        agent: r.agent,
        level: r.level,
        message: r.message,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  },
);

/**
 * List the most recent runtime errors reported from the published app's
 * iframe sandbox. Owner-only — we never return another user's error
 * payloads, even though the writer endpoint (`POST /p/:slug/_error`) is
 * unauthenticated by design (the iframe runs in an opaque origin).
 */
router.get(
  "/apps/:id/runtime-errors",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid app id" });
      return;
    }
    const userId = req.userId!;
    const [app] = await db
      .select({ id: generatedApps.id })
      .from(generatedApps)
      .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
      .limit(1);
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    const rows = await db
      .select()
      .from(appRuntimeErrors)
      .where(eq(appRuntimeErrors.appId, id))
      .orderBy(desc(appRuntimeErrors.id))
      .limit(50);
    res.json({
      errors: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        message: r.message,
        source: r.source,
        lineno: r.lineno,
        colno: r.colno,
        stack: r.stack,
        userAgent: r.userAgent,
        pathname: r.pathname,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  },
);

/**
 * Discard all stored runtime errors for an app. Used by the panel after
 * the user regenerates or fixes the app and wants the error notice gone.
 */
router.delete(
  "/apps/:id/runtime-errors",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid app id" });
      return;
    }
    const userId = req.userId!;
    const [app] = await db
      .select({ id: generatedApps.id })
      .from(generatedApps)
      .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
      .limit(1);
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    await db.delete(appRuntimeErrors).where(eq(appRuntimeErrors.appId, id));
    res.status(204).end();
  },
);

// =============================================================================
// Per-app agent notes (memory layer #2). Read by every edit, written by the
// post-edit memory extractor, also editable by the user.
// =============================================================================

router.get("/apps/:id/notes", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid app id" });
    return;
  }
  const userId = req.userId!;
  const [row] = await db
    .select({ agentNotes: generatedApps.agentNotes })
    .from(generatedApps)
    .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  res.json({ notes: row.agentNotes ?? "" });
});

/**
 * List the revision history of an app — most recent first. Returns light
 * metadata only (id, source, summary, createdAt) so the dashboard can render
 * a timeline without paying the cost of shipping every bundle.
 */
router.get(
  "/apps/:id/revisions",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid app id" });
      return;
    }
    const userId = req.userId!;
    // Ownership gate first — never leak revision metadata across users.
    const [appRow] = await db
      .select({ id: generatedApps.id })
      .from(generatedApps)
      .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
      .limit(1);
    if (!appRow) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    const rows = await db
      .select({
        id: appRevisions.id,
        source: appRevisions.source,
        summary: appRevisions.summary,
        createdAt: appRevisions.createdAt,
      })
      .from(appRevisions)
      .where(eq(appRevisions.appId, id))
      .orderBy(desc(appRevisions.createdAt))
      .limit(100);
    res.json({
      revisions: rows.map((r) => ({
        id: r.id,
        source: r.source,
        sourceLabel: revisionSourceLabel(r.source),
        summary: r.summary,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  },
);

/**
 * Restore the app to a previous revision. Snapshots the current state as
 * "restore-backup" first so the user can always undo their undo.
 */
router.post(
  "/apps/:id/revisions/:revisionId/restore",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const revisionId = Number(req.params.revisionId);
    if (!Number.isInteger(id) || !Number.isInteger(revisionId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const userId = req.userId!;
    try {
      const result = await restoreAppRevision({ appId: id, revisionId, userId });
      if (!result.ok) {
        if (result.reason === "job_in_flight") {
          // 409 Conflict — there's a generation/edit job still running for
          // this app. Restoring now would race with its eventual write.
          res.status(409).json({
            error:
              "No puedo restaurar mientras hay una generación o edición en curso. Espera a que termine e inténtalo de nuevo.",
          });
          return;
        }
        // Forbidden vs not_found are intentionally collapsed into 404 to
        // avoid leaking which app IDs exist for other users.
        res
          .status(404)
          .json({ error: result.reason === "forbidden" ? "App not found" : "Revision not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err, appId: id, revisionId }, "restoreAppRevision failed");
      res.status(500).json({ error: "No pude restaurar esa versión." });
    }
  },
);

/**
 * Public catalog of curated starter templates the dashboard renders as
 * clickable cards. No auth required — they're just labels + seed prompts;
 * clicking one only pre-fills the prompt textarea on the client. Actual
 * generation still goes through /generate with the user's session.
 */
router.get("/templates", (_req: Request, res: Response) => {
  res.json({ templates: TEMPLATES });
});

/**
 * POST /apps/:id/deploy/vercel — push the current bundle to the user's
 * Vercel account as a static deployment. Reuses the same Vercel project
 * across deploys so the production URL stays stable. Returns the URL
 * immediately once Vercel acknowledges the deployment (Vercel's edge will
 * finish building the static page within a few seconds).
 *
 * Failures map to:
 *  - 503 if VERCEL_TOKEN isn't configured (operator action required).
 *  - 404 if the app doesn't belong to the requester (info-hiding: same
 *    code as not-found).
 *  - 400 if the bundle won't compile (the user can fix it from chat).
 *  - 502 if Vercel's API rejects the request — message is forwarded so
 *    the user can see whether it was, e.g., a duplicate project name.
 */
router.post(
  "/apps/:id/deploy/vercel",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid app id" });
      return;
    }
    const userId = req.userId!;
    try {
      const r = await deployAppToVercel({ appId: id, userId, log: req.log });
      if (r.ok) {
        res.json(r.result);
        return;
      }
      switch (r.failure.kind) {
        case "missing_token":
          res.status(503).json({
            error:
              "El despliegue a Vercel no está configurado en este servidor. Pide al administrador que añada VERCEL_TOKEN.",
          });
          return;
        case "app_not_found":
          res.status(404).json({ error: "App not found" });
          return;
        case "build_failed":
          res.status(400).json({
            error: `No pude empaquetar la app: ${r.failure.message}`,
          });
          return;
        case "vercel_api_error":
          res.status(502).json({
            error: `Vercel rechazó el despliegue (${r.failure.status}): ${r.failure.message}`,
          });
          return;
      }
    } catch (err) {
      req.log.error({ err, appId: id }, "Vercel deploy unexpected failure");
      res.status(500).json({ error: "No pude desplegar a Vercel." });
    }
  },
);

/**
 * Custom Vercel domain endpoints — POST/GET/DELETE /apps/:id/domain.
 *
 * Gated server-side by `getUserSpentCents(userId) >= CUSTOM_DOMAIN_MIN_SPEND_CENTS`
 * (= 50 EUR). The UI also enforces this for UX, but we re-check it here so a
 * crafted curl request can't bypass the rule.
 *
 * Pre-conditions:
 *  - The app must already have a Vercel deploy (vercelProjectId not null).
 *    Otherwise we'd be attaching a domain to a project that doesn't exist.
 *
 * Spend gate is checked AFTER ownership so we don't leak whether an app id
 * exists to a non-paying user.
 */

function isPlausibleDomain(input: string): boolean {
  // Conservative validator — the real check happens at Vercel. We just
  // reject obviously broken inputs to keep noise out of the upstream call.
  // Allows xn-- (IDN) prefix so "miweb.es" with accents post-punycoded works.
  return /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
    input.trim(),
  );
}

async function loadAppForDomain(
  id: number,
  userId: string,
): Promise<
  | { ok: true; row: { id: number; vercelProjectId: string | null; vercelCustomDomain: string | null } }
  | { ok: false; status: 404 }
> {
  const [row] = await db
    .select({
      id: generatedApps.id,
      vercelProjectId: generatedApps.vercelProjectId,
      vercelCustomDomain: generatedApps.vercelCustomDomain,
    })
    .from(generatedApps)
    .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!row) return { ok: false, status: 404 };
  return { ok: true, row };
}

router.post(
  "/apps/:id/domain",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid app id" });
      return;
    }
    const userId = req.userId!;
    const domainRaw = String(req.body?.domain ?? "").trim().toLowerCase();
    if (!isPlausibleDomain(domainRaw)) {
      res.status(400).json({
        error:
          "Dominio no válido. Escribe sólo el nombre, p. ej. mitienda.com (sin https://, sin / al final).",
      });
      return;
    }

    const app = await loadAppForDomain(id, userId);
    if (!app.ok) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    if (!app.row.vercelProjectId) {
      res.status(400).json({
        error:
          "Antes de conectar un dominio personalizado tienes que desplegar la app a Vercel al menos una vez.",
      });
      return;
    }

    // Spend gate. Computed after ownership check (info-hiding) so non-paying
    // users can't probe for app existence.
    const spentCents = await getUserSpentCents(userId);
    if (spentCents < CUSTOM_DOMAIN_MIN_SPEND_CENTS) {
      const remainingCents = CUSTOM_DOMAIN_MIN_SPEND_CENTS - spentCents;
      res.status(402).json({
        error: `Conectar tu propio dominio se desbloquea cuando acumulas ${(CUSTOM_DOMAIN_MIN_SPEND_CENTS / 100).toFixed(0)} € en compras. Te faltan ${(remainingCents / 100).toFixed(2)} €.`,
        spentCents,
        requiredCents: CUSTOM_DOMAIN_MIN_SPEND_CENTS,
      });
      return;
    }

    try {
      const r = await addVercelDomainForApp({
        appId: id,
        userId,
        projectId: app.row.vercelProjectId,
        domain: domainRaw,
        log: req.log,
      });
      if (r.ok) {
        res.json(r.status);
        return;
      }
      switch (r.failure.kind) {
        case "missing_token":
          res.status(503).json({
            error:
              "El despliegue a Vercel no está configurado en este servidor. Pide al administrador que añada VERCEL_TOKEN.",
          });
          return;
        case "vercel_api_error":
          res.status(502).json({
            error: `Vercel rechazó el dominio (${r.failure.status}): ${r.failure.message}`,
          });
          return;
        default:
          res.status(500).json({ error: "No pude conectar el dominio." });
          return;
      }
    } catch (err) {
      req.log.error({ err, appId: id }, "Vercel domain attach unexpected failure");
      res.status(500).json({ error: "No pude conectar el dominio." });
    }
  },
);

router.get(
  "/apps/:id/domain",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid app id" });
      return;
    }
    const userId = req.userId!;
    const app = await loadAppForDomain(id, userId);
    if (!app.ok) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    const spentCents = await getUserSpentCents(userId);

    if (!app.row.vercelCustomDomain || !app.row.vercelProjectId) {
      res.json({
        domain: null,
        spentCents,
        requiredCents: CUSTOM_DOMAIN_MIN_SPEND_CENTS,
      });
      return;
    }

    const r = await getVercelDomainStatus({
      projectId: app.row.vercelProjectId,
      domain: app.row.vercelCustomDomain,
      log: req.log,
    });
    if (r.ok) {
      res.json({ ...r.status, spentCents, requiredCents: CUSTOM_DOMAIN_MIN_SPEND_CENTS });
      return;
    }
    // Vercel call failed — don't 500 the whole thing; return cached domain
    // so the UI still shows what's saved with a soft warning.
    res.json({
      domain: app.row.vercelCustomDomain,
      verified: false,
      verification: [],
      recommendedDns: [],
      spentCents,
      requiredCents: CUSTOM_DOMAIN_MIN_SPEND_CENTS,
      warning: r.failure.kind === "vercel_api_error" ? r.failure.message : "Vercel no está disponible.",
    });
  },
);

router.delete(
  "/apps/:id/domain",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid app id" });
      return;
    }
    const userId = req.userId!;
    const app = await loadAppForDomain(id, userId);
    if (!app.ok) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    if (!app.row.vercelCustomDomain || !app.row.vercelProjectId) {
      res.json({ ok: true });
      return;
    }
    const r = await removeVercelDomainForApp({
      appId: id,
      projectId: app.row.vercelProjectId,
      domain: app.row.vercelCustomDomain,
      log: req.log,
    });
    if (r.ok) {
      res.json({ ok: true });
      return;
    }
    if (r.failure.kind === "missing_token") {
      res.status(503).json({ error: "VERCEL_TOKEN no configurado." });
      return;
    }
    res.status(502).json({
      error: `No pude quitar el dominio en Vercel: ${r.failure.kind === "vercel_api_error" ? r.failure.message : "error desconocido"}`,
    });
  },
);

router.put("/apps/:id/notes", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid app id" });
    return;
  }
  const notes: unknown = req.body?.notes;
  if (typeof notes !== "string") {
    res.status(400).json({ error: "notes debe ser una cadena" });
    return;
  }
  // Hard cap at 3 KB — same limit the writer enforces on auto-extracted
  // notes. Beyond this we silently truncate; the agent can always re-add
  // the most relevant bits next time.
  const trimmed = notes.slice(0, 3000);
  const userId = req.userId!;
  const updated = await db
    .update(generatedApps)
    .set({ agentNotes: trimmed })
    .where(and(eq(generatedApps.id, id), eq(generatedApps.userId, userId)))
    .returning({ id: generatedApps.id });
  if (updated.length === 0) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  res.json({ notes: trimmed });
});

export default router;
