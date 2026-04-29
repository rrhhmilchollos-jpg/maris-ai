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
import { runVisualTester, VisualTesterError } from "../lib/visualTester";
import { chargeCredits, refundCredits } from "../lib/credits";

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
      await db
        .update(generatedApps)
        .set({ publicSlug: candidate })
        .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)));
      return candidate;
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
      recordLog,
    );
    recordLog("system", `Generación completada: ${Math.round(payload.frontendCode.length / 1000)} KB de frontend listos.`);

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
        }).catch((vtErr) => {
          logger.warn(
            { err: vtErr, appId: finalAppId, jobId },
            "Auto visual tester failed (non-fatal)",
          );
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
      // Use the actual reserved amount so kind-aware costs roll back correctly.
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
  await enqueueGeneration(
    req,
    res,
    finalPrompt,
    editAppId,
    undefined,
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
  const slug = await ensurePublicSlug(id, userId, req.log, row.publicSlug);
  if (!slug) {
    res.status(500).json({ error: "No pudimos asignar una URL pública." });
    return;
  }
  res.json({ url: publicUrlFor(slug), slug });
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

export default router;
