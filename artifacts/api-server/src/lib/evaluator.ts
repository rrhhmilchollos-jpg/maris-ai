/**
 * Autonomous Visual Evaluator (Task #11).
 *
 * Pipeline-internal cousin of `runVisualTester`. The visual tester is a
 * generic "score the screenshots and auto-fix obvious issues" loop with no
 * understanding of WHAT the user actually asked for. The evaluator goes one
 * step further: it compares the rendered app against the user's original
 * intent and the architect's planned pages, returning a strict pass/fail
 * verdict suitable for gating an *automatic* publish.
 *
 * Two public entry points:
 *
 *   - `evaluateApp(...)` — single read-only judgment. Takes screenshots,
 *     calls Claude vision with intent + planned-pages context, returns a
 *     structured verdict + issues. No DB writes, no patches.
 *
 *   - `runAutoEvaluator(...)` — the orchestrator used after a successful
 *     generation. Runs evaluateApp; if it fails, asks the patcher to fix
 *     the called-out issues, persists, and re-evaluates. MAX_VISION_ROUNDS
 *     extra rounds. On final pass + autoPublish, deploys (assigns slug) and
 *     emails the owner. On final fail, marks the app `needs_review` with a
 *     Spanish summary the dashboard renders in a red panel.
 *
 * Reuses `takeScreenshots`, `chromiumExecutablePath`, and the visual tester's
 * Puppeteer infrastructure to avoid double-launching Chromium.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { db } from "./db";
import { generatedApps, users, appMessages, jobLogs } from "@workspace/db/schema";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { patchBundle, type GenLanguage } from "./generate";
import { validateBundle } from "./validate";
import {
  takeScreenshots,
  chromiumExecutablePath,
  type ViewportShot,
} from "./visualTester";
import { makeSlug } from "./deployBundle";
import { sendAutoPublishEmail, sendNeedsReviewEmail } from "./notify";

/** Hard cap on the number of vision-driven patch rounds the evaluator runs.
 *  The first round is the initial "is this any good?" judgment; rounds
 *  2..MAX_VISION_ROUNDS are patcher iterations. The spec says "máximo 2
 *  rondas extras" — so total visions = 1 (initial) + 2 (post-patch). */
const MAX_VISION_ROUNDS = 3;

type Severity = "critical" | "major" | "minor";

export type EvaluatorIssue = {
  severity: Severity;
  description: string;
  fix: string;
};

export type EvaluatorVerdict = "pass" | "fail";

export type EvaluatorReport = {
  verdict: EvaluatorVerdict;
  issues: EvaluatorIssue[];
  summary: string;
  screenshots: ViewportShot[];
};

/* ------------------------------------------------------------------ */
/*  Vision call                                                       */
/* ------------------------------------------------------------------ */

/** Strip ```json fences and try to parse JSON from a model response. */
function safeJsonParse<T>(raw: string): T | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

type RawVerdictPayload = {
  verdict?: string;
  pass?: boolean;
  issues?: Array<Partial<EvaluatorIssue>>;
  summary?: string;
};

/** Normalise a raw model response into a strict EvaluatorReport-shaped slice. */
export function normalizeVerdict(
  raw: RawVerdictPayload | null,
  fallbackSummary: string,
): { verdict: EvaluatorVerdict; issues: EvaluatorIssue[]; summary: string } {
  if (!raw) {
    return {
      verdict: "fail",
      issues: [],
      summary: fallbackSummary,
    };
  }
  // The model occasionally returns `pass: true` instead of `verdict: "pass"`.
  // Accept either — we're strict about what we ask for, lax about what we
  // accept, otherwise a one-off model hiccup blocks an otherwise good app.
  const verdictRaw = String(raw.verdict ?? "").toLowerCase();
  const passBool = raw.pass === true;
  const verdict: EvaluatorVerdict =
    verdictRaw === "pass" || passBool ? "pass" : "fail";
  const issues: EvaluatorIssue[] = Array.isArray(raw.issues)
    ? raw.issues
        .filter((i): i is EvaluatorIssue => !!i && typeof i === "object")
        .map((i) => ({
          severity:
            i.severity === "critical" || i.severity === "major" || i.severity === "minor"
              ? i.severity
              : "major",
          description: typeof i.description === "string" ? i.description.slice(0, 600) : "",
          fix: typeof i.fix === "string" ? i.fix.slice(0, 600) : "",
        }))
        .filter((i) => i.description.length > 0)
    : [];
  const summary =
    typeof raw.summary === "string" && raw.summary.trim().length > 0
      ? raw.summary.slice(0, 800)
      : fallbackSummary;
  // Critical-issue safety net: if the model returns "pass" but also lists
  // critical issues, treat it as fail. Auto-publish is a one-way action — we
  // err on the side of NOT shipping a known-broken app.
  const hasCritical = issues.some((i) => i.severity === "critical");
  return {
    verdict: hasCritical ? "fail" : verdict,
    issues,
    summary,
  };
}

async function judgeWithVision(
  shots: ViewportShot[],
  app: { title: string; description: string | null },
  userIntent: string,
  plannedPages: Array<{ name: string; route?: string; purpose?: string }> = [],
): Promise<{ verdict: EvaluatorVerdict; issues: EvaluatorIssue[]; summary: string }> {
  type ContentBlock =
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: "image/png"; data: string };
      };
  const content: ContentBlock[] = [];
  for (const shot of shots) {
    if (!shot.data) continue;
    content.push({
      type: "text",
      text: `=== ${shot.viewport.toUpperCase()} (${shot.width}x${shot.height}) ===`,
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: shot.data },
    });
    if (shot.consoleErrors.length > 0) {
      content.push({
        type: "text",
        text: `Errores de consola en ${shot.viewport}:\n${shot.consoleErrors
          .slice(0, 5)
          .join("\n")}`,
      });
    }
  }

  if (content.length === 0) {
    return {
      verdict: "fail",
      issues: [
        {
          severity: "critical",
          description: "No se pudieron capturar screenshots de la app.",
          fix: "Comprueba que el bundle compila y se sirve en /p/<slug>.",
        },
      ],
      summary: "Sin screenshots para evaluar.",
    };
  }

  const planBlock = plannedPages.length
    ? plannedPages
        .map((p, idx) => `${idx + 1}. ${p.name}${p.route ? ` (${p.route})` : ""}${p.purpose ? ` — ${p.purpose}` : ""}`)
        .join("\n")
    : "(sin plan de pantallas explícito; usa el prompt como referencia)";

  content.push({
    type: "text",
    text: `Eres el EVALUADOR AUTÓNOMO de Maris AI. Tu trabajo es decidir si esta
app generada cumple lo que la usuaria pidió, comparando los screenshots con
la intención original y el plan declarado por el Arquitecto.

PROMPT ORIGINAL DE LA USUARIA:
${userIntent.slice(0, 2000)}

PLAN DEL ARQUITECTO (pantallas declaradas):
${planBlock}

INFO DE LA APP:
- Título: ${app.title}
- Descripción: ${app.description ?? "(no disponible)"}

CRITERIOS PARA "pass":
- La pantalla principal renderiza algo razonable (no está en blanco, no hay
  errores de consola visibles, no hay layouts rotos).
- Lo que se ve coincide en lo esencial con lo que pidió la usuaria (si pidió
  un Wallapop, debe verse un marketplace, no un blog).
- En móvil (390px) se ve usable, no hay overflow horizontal evidente.

CRITERIOS PARA "fail":
- Pantalla en blanco o cargando indefinidamente.
- Layout roto, contenido superpuesto, texto ilegible.
- El contenido NO coincide con lo pedido (ej: pidió "tienda de zapatos" y se
  ve un dashboard de admin genérico).
- Errores críticos de consola que impiden interactuar.

Devuelve EXCLUSIVAMENTE un JSON válido (sin markdown, sin backticks):

{
  "verdict": "pass" | "fail",
  "summary": "una frase en castellano explicando el veredicto",
  "issues": [
    {
      "severity": "critical" | "major" | "minor",
      "description": "qué está mal, en castellano",
      "fix": "instrucción concreta para el patcher (qué archivo o componente tocar y cómo)"
    }
  ]
}

Sé estricto pero JUSTO: el objetivo es decidir si esta app está lista para
publicarse automáticamente. Si dudas, "fail" con una sugerencia clara.`,
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content }],
  });

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");

  return normalizeVerdict(safeJsonParse<RawVerdictPayload>(text), "Análisis no parseable; tratado como fallo.");
}

/* ------------------------------------------------------------------ */
/*  Patcher feedback formatting                                       */
/* ------------------------------------------------------------------ */

/** Build a QAIssue list the patcher understands from evaluator findings. */
export function formatIssuesForPatcher(
  issues: EvaluatorIssue[],
): Array<{ file: string; problem: string; fix: string }> {
  return issues
    .filter((i) => i.severity !== "minor")
    .slice(0, 6)
    .map((i, idx) => ({
      file: `evaluator-finding-${idx + 1}`,
      problem: `[${i.severity}] ${i.description}`,
      fix: i.fix || "Aplica el cambio mínimo para solucionar este problema visual.",
    }));
}

/* ------------------------------------------------------------------ */
/*  Public read-only API                                              */
/* ------------------------------------------------------------------ */

export async function evaluateApp(opts: {
  app: {
    id: number;
    title: string;
    description: string | null;
    publicSlug: string;
  };
  baseUrl: string;
  userIntent: string;
  plannedPages?: Array<{ name: string; route?: string; purpose?: string }>;
  log?: Logger;
}): Promise<EvaluatorReport> {
  const { app, baseUrl, userIntent, plannedPages, log } = opts;
  const url = `${baseUrl.replace(/\/$/, "")}/p/${app.publicSlug}`;
  log?.info({ appId: app.id, url }, "👁 Evaluator capturing screenshots");
  const shots = await takeScreenshots(url);
  const verdict = await judgeWithVision(
    shots,
    { title: app.title, description: app.description },
    userIntent,
    plannedPages,
  );
  log?.info(
    { appId: app.id, verdict: verdict.verdict, issues: verdict.issues.length },
    "👁 Evaluator verdict",
  );
  return {
    verdict: verdict.verdict,
    issues: verdict.issues,
    summary: verdict.summary,
    screenshots: shots,
  };
}

/* ------------------------------------------------------------------ */
/*  Orchestrator (post-generation hook)                               */
/* ------------------------------------------------------------------ */

/** Persistence-light helper: assign a slug if missing, returns slug or null. */
async function ensurePublicSlug(
  appId: number,
  userId: string,
  log: Logger,
  existingSlug: string | null,
): Promise<string | null> {
  if (existingSlug) return existingSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = makeSlug();
    try {
      // Idempotent + race-safe: only assign when no slug exists yet. If the
      // route's manual publish already set one between our SELECT and this
      // UPDATE, we lose the race and re-read the winner instead of clobbering.
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
      const [row] = await db
        .select({ publicSlug: generatedApps.publicSlug })
        .from(generatedApps)
        .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)))
        .limit(1);
      return row?.publicSlug ?? null;
    } catch (err) {
      log.warn({ err, attempt }, "Slug collision while assigning auto-publish slug, retrying");
    }
  }
  return null;
}

/** Build the public deploy URL the email/chat link should use. */
function publicUrlFor(slug: string): string {
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const host = domains[0];
  return host ? `https://${host}/p/${slug}` : `/p/${slug}`;
}

export type AutoEvaluatorResult = {
  ranEvaluator: boolean;
  finalVerdict: EvaluatorVerdict;
  rounds: number;
  fixesApplied: number;
  autoPublished: boolean;
  publicUrl: string | null;
  summary: string;
};

export async function runAutoEvaluator(opts: {
  appId: number;
  userId: string;
  userIntent: string;
  /**
   * Architect-declared screens. Optional at the call-site: when omitted, the
   * evaluator falls back to whatever is persisted on `generated_apps.plannedPages`
   * (set by the worker after a successful generation).
   */
  plannedPages?: Array<{ name: string; route?: string; purpose?: string }>;
  jobId: number;
  baseUrl: string;
  log: Logger;
  /** Test-only override: inject a fake evaluator instead of running puppeteer. */
  __evaluator?: typeof evaluateApp;
  /** Test-only override: inject a fake patcher instead of calling Claude. */
  __patcher?: typeof patchBundle;
  /** Test-only override: skip the email side-effect entirely. */
  __notifier?: typeof sendAutoPublishEmail;
  /**
   * Test-only override: inject a fake deploy helper. Production wires this to
   * `runDeployForApp` from routes/apps.ts (lazy require to avoid a cycle).
   */
  __deploy?: (args: {
    appId: number;
    userId: string;
    log: Logger;
  }) => Promise<{ url: string; slug: string }>;
}): Promise<AutoEvaluatorResult> {
  const { appId, userId, userIntent, jobId, baseUrl, log } = opts;
  const evalFn = opts.__evaluator ?? evaluateApp;
  const patchFn = opts.__patcher ?? patchBundle;
  const notifyFn = opts.__notifier ?? sendAutoPublishEmail;
  // Lazy require so the route module doesn't pull the evaluator at import
  // time (would create an import cycle: routes -> evaluator -> routes).
  const deployFn =
    opts.__deploy ??
    (async (args) => {
      const mod = await import("../routes/apps");
      return mod.runDeployForApp(args);
    });

  // Helper to mirror the visual evaluator's milestones into the per-job log
  // stream consumed by the dashboard timeline. Fire-and-forget so logging
  // failures never bubble into the orchestrator. Same pattern as `recordLog`
  // in routes/apps.ts (the generation pipeline).
  const recordEvalLog = (
    message: string,
    level: "info" | "warn" | "error" = "info",
  ): void => {
    const trimmed = message.length > 280 ? message.slice(0, 277) + "…" : message;
    db.insert(jobLogs)
      .values({ jobId, agent: "evaluator", level, message: trimmed })
      .catch((err) => {
        log.warn({ err, jobId, appId }, "Failed to write evaluator job log line");
      });
  };

  // Bail early if Chromium isn't installed — the evaluator is best-effort.
  // We DO NOT mark the app as needs_review in that case; the user shouldn't
  // be punished for an environment problem.
  if (!opts.__evaluator && !chromiumExecutablePath()) {
    log.warn({ appId, jobId }, "👁 Evaluator skipped — Chromium not installed");
    return {
      ranEvaluator: false,
      finalVerdict: "pass",
      rounds: 0,
      fixesApplied: 0,
      autoPublished: false,
      publicUrl: null,
      summary: "Evaluador omitido (Chromium no disponible).",
    };
  }

  // Re-read the app row so we have the latest bundle (the visual tester or
  // image agent may have run in between).
  const [row] = await db
    .select()
    .from(generatedApps)
    .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!row) {
    log.warn({ appId, jobId }, "Evaluator: app row missing");
    return {
      ranEvaluator: false,
      finalVerdict: "fail",
      rounds: 0,
      fixesApplied: 0,
      autoPublished: false,
      publicUrl: null,
      summary: "App no encontrada en la base de datos.",
    };
  }

  // Need a slug to render /p/<slug> in puppeteer. Assign one if missing,
  // even if autoPublish is off — it's how the evaluator reaches the app.
  const slug = await ensurePublicSlug(appId, userId, log, row.publicSlug);
  if (!slug) {
    log.warn({ appId, jobId }, "Evaluator: could not assign slug for screenshot");
    return {
      ranEvaluator: false,
      finalVerdict: "fail",
      rounds: 0,
      fixesApplied: 0,
      autoPublished: false,
      publicUrl: null,
      summary: "No se pudo asignar slug para el evaluador.",
    };
  }

  // Resolve planned pages: caller override wins, otherwise fall back to the
  // value persisted on the row by the worker. This ensures the evaluator
  // ALWAYS feeds the architect's screen list to the vision model when one is
  // available — even when called from contexts that don't have it in scope
  // (e.g., a future "re-evaluate" admin button).
  const effectivePlannedPages = opts.plannedPages ?? row.plannedPages ?? undefined;

  log.info(
    {
      appId,
      jobId,
      slug,
      planScreens: effectivePlannedPages?.length ?? 0,
    },
    "👁 Evaluating visually…",
  );
  recordEvalLog(
    `👁 Evaluando visualmente la app${
      effectivePlannedPages?.length
        ? ` (${effectivePlannedPages.length} pantalla(s) planificada(s))`
        : ""
    }…`,
  );

  let currentBundle = row.frontendCode;
  let lastReport: EvaluatorReport | null = null;
  let fixesApplied = 0;
  let round = 0;

  // Round budget: 1 initial vision + up to 2 post-patch visions = 3 total.
  while (round < MAX_VISION_ROUNDS) {
    round++;
    let report: EvaluatorReport;
    try {
      report = await evalFn({
        app: {
          id: row.id,
          title: row.title,
          description: row.description,
          publicSlug: slug,
        },
        baseUrl,
        userIntent,
        plannedPages: effectivePlannedPages,
        log,
      });
    } catch (err) {
      log.warn({ err, appId, jobId, round }, "👁 Evaluator threw — treating as fail");
      report = {
        verdict: "fail",
        issues: [],
        summary:
          err instanceof Error
            ? `El evaluador falló: ${err.message}`
            : "El evaluador falló por un error inesperado.",
        screenshots: [],
      };
    }
    lastReport = report;

    if (report.verdict === "pass") {
      log.info({ appId, jobId, round }, "👁 Evaluator passed");
      recordEvalLog(`✅ Evaluación visual aprobada en la ronda ${round}.`);
      break;
    }
    recordEvalLog(
      `👁 Ronda ${round}: el evaluador encontró ${report.issues.length} problema(s). ${report.summary}`,
      "warn",
    );

    // Fail path. If we've used our budget, stop.
    if (round >= MAX_VISION_ROUNDS) {
      log.info(
        { appId, jobId, round, issues: report.issues.length },
        "👁 Evaluator exhausted retries — leaving for manual review",
      );
      recordEvalLog(
        `⚠️ Se agotaron los intentos automáticos (${MAX_VISION_ROUNDS} ronda(s)). Marcando como "necesita revisión".`,
        "warn",
      );
      break;
    }

    const patcherIssues = formatIssuesForPatcher(report.issues);
    if (patcherIssues.length === 0) {
      log.info(
        { appId, jobId, round },
        "🔁 Evaluator failed but no actionable issues — stopping",
      );
      break;
    }

    log.info(
      { appId, jobId, round, fixCount: patcherIssues.length },
      `🔁 Evaluator pidió arreglar ${patcherIssues.length} cosa(s); llamo al patcher`,
    );
    recordEvalLog(
      `🔁 Aplicando arreglos automáticos para ${patcherIssues.length} problema(s)…`,
    );

    let patched: string | null = null;
    try {
      const language = (row.language === "javascript" ? "javascript" : "typescript") as GenLanguage;
      patched = await patchFn(currentBundle, patcherIssues, language, "");
    } catch (err) {
      log.warn({ err, appId, jobId, round }, "🔁 Patcher threw — stopping evaluator loop");
      break;
    }
    if (!patched || patched.length < 100 || !patched.includes("// === FILE:")) {
      log.warn({ appId, jobId, round }, "🔁 Patcher returned an unusable bundle — stopping");
      break;
    }

    // Validate before persisting so we never overwrite a working bundle with
    // a corrupted patcher response.
    const validation = await validateBundle(patched);
    if (!validation.ok && validation.issues.length > 0) {
      log.warn(
        { appId, jobId, round, errors: validation.issues.length },
        "🔁 Patched bundle failed validation — discarding and stopping",
      );
      break;
    }

    // Optimistic concurrency: only overwrite if the bundle still matches
    // what we patched against. A racing chat edit must always win.
    const previousBundle = currentBundle;
    const updated = await db
      .update(generatedApps)
      .set({ frontendCode: patched })
      .where(
        and(
          eq(generatedApps.id, appId),
          eq(generatedApps.frontendCode, previousBundle),
        ),
      )
      .returning({ id: generatedApps.id });
    if (updated.length === 0) {
      log.warn(
        { appId, jobId, round },
        "🔁 Bundle changed concurrently — stopping evaluator loop",
      );
      break;
    }
    currentBundle = patched;
    fixesApplied++;
    // Snapshot the patched bundle so the user can roll back if the evaluator's
    // strict critique made things worse than the previous, looser version.
    void import("./appRevisions").then(({ snapshotCurrentApp }) =>
      snapshotCurrentApp({
        appId,
        source: "visual-fix",
        summary: `Reparación del evaluador autónomo (ronda ${round})`,
        jobId: jobId ?? null,
      }),
    );
    // Tiny pause so the public deploy route reflects the new bundle for the
    // next puppeteer cycle.
    await new Promise((r) => setTimeout(r, 1200));
  }

  const finalVerdict: EvaluatorVerdict = lastReport?.verdict ?? "fail";
  const finalSummary = lastReport?.summary ?? "Sin veredicto.";
  const publicUrl = publicUrlFor(slug);

  // Decide outcomes.
  if (finalVerdict === "pass") {
    // Always clear any prior needs_review state on a successful pass.
    await db
      .update(generatedApps)
      .set({ status: "ready", evaluatorSummary: null })
      .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)))
      .catch((err) => {
        log.warn({ err, appId }, "Failed to clear evaluatorSummary after pass");
      });

    // Re-read autoPublish right before deciding — the user may have toggled
    // it off via the UI while the (slow) evaluator was running. Snapshot
    // captured at the start of runAutoEvaluator can be minutes old.
    const [fresh] = await db
      .select({ autoPublish: generatedApps.autoPublish })
      .from(generatedApps)
      .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)))
      .limit(1);
    const shouldAutoPublish = fresh?.autoPublish === true;
    if (shouldAutoPublish) {
      // Run the SAME deploy path the manual "Publicar" button uses. This
      // guarantees the auto-publish flow gets the bundle sanity-build, slug
      // assignment, and any future deploy-time hooks (CDN purge, etc.) for
      // free instead of diverging from the manual path.
      let deployResult: { url: string; slug: string };
      try {
        deployResult = await deployFn({ appId, userId, log });
      } catch (err) {
        log.warn(
          { err, appId, jobId },
          "🚀 Auto-deploy failed — leaving app un-published despite passing evaluation",
        );
        // Persist a chat note so the user knows the evaluator passed but the
        // deploy itself blew up (e.g., bundle stopped compiling between
        // evaluation and deploy). They can hit "Publicar" manually to retry.
        try {
          await db.insert(appMessages).values({
            appId,
            role: "assistant",
            content:
              `👁 Evaluación visual: aprobada. Pero no pude publicar la app automáticamente: ${
                err instanceof Error ? err.message : "error desconocido"
              }. Pulsa "Publicar" para reintentar.`,
          });
        } catch {
          // Best-effort.
        }
        return {
          ranEvaluator: true,
          finalVerdict: "pass",
          rounds: round,
          fixesApplied,
          autoPublished: false,
          publicUrl: null,
          summary: finalSummary,
        };
      }
      const finalUrl = deployResult.url;
      log.info(
        { appId, jobId, publicUrl: finalUrl },
        `🚀 Publicado automáticamente en ${finalUrl}`,
      );
      recordEvalLog(`🚀 He publicado tu app automáticamente: ${finalUrl}`);
      // Email + chat hint.
      try {
        const [user] = await db
          .select({ email: users.email, fullName: users.fullName })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        await notifyFn({
          to: user?.email ?? null,
          recipientName: user?.fullName ?? null,
          appTitle: row.title,
          url: finalUrl,
          log,
        });
      } catch (err) {
        log.warn({ err, appId, jobId }, "Auto-publish email failed (non-fatal)");
      }
      try {
        await db.insert(appMessages).values({
          appId,
          role: "assistant",
          content: `🚀 He publicado tu app automáticamente: ${finalUrl}\n\nLa evaluación visual dio el visto bueno.`,
        });
      } catch (err) {
        log.warn({ err, appId, jobId }, "Failed to insert auto-publish chat message");
      }
      return {
        ranEvaluator: true,
        finalVerdict: "pass",
        rounds: round,
        fixesApplied,
        autoPublished: true,
        publicUrl: finalUrl,
        summary: finalSummary,
      };
    }
    // Pass without auto-publish: just leave a chat note so the user knows.
    try {
      await db.insert(appMessages).values({
        appId,
        role: "assistant",
        content: `👁 Evaluación visual: aprobada. ${finalSummary}\n\nActiva "Auto-publicar" en el panel si quieres que la próxima vez se despliegue sola.`,
      });
    } catch (err) {
      log.warn({ err, appId, jobId }, "Failed to insert evaluator pass chat message");
    }
    return {
      ranEvaluator: true,
      finalVerdict: "pass",
      rounds: round,
      fixesApplied,
      autoPublished: false,
      publicUrl: null,
      summary: finalSummary,
    };
  }

  // Fail path — mark needs_review and tell the user via chat.
  const issuesBlock = (lastReport?.issues ?? [])
    .slice(0, 5)
    .map((i, idx) => `${idx + 1}. [${i.severity}] ${i.description}`)
    .join("\n");
  const evaluatorSummary = `${finalSummary}${issuesBlock ? `\n\n${issuesBlock}` : ""}`.slice(0, 1500);

  await db
    .update(generatedApps)
    .set({ status: "needs_review", evaluatorSummary })
    .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)))
    .catch((err) => {
      log.warn({ err, appId }, "Failed to mark app as needs_review");
    });

  try {
    await db.insert(appMessages).values({
      appId,
      role: "assistant",
      content:
        `⚠️ La evaluación visual rechazó la app después de ${round} ronda${round === 1 ? "" : "s"}.\n\n` +
        `${finalSummary}\n\n` +
        `Pulsa "Reintentar generación" en el panel rojo para volver a intentarlo.`,
    });
  } catch (err) {
    log.warn({ err, appId, jobId }, "Failed to insert needs_review chat message");
  }

  // Best-effort heads-up email so the user knows their app is waiting for them.
  try {
    const [user] = await db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    await sendNeedsReviewEmail({
      to: user?.email ?? null,
      recipientName: user?.fullName ?? null,
      appTitle: row.title,
      summary: finalSummary,
      log,
    });
  } catch (err) {
    log.warn({ err, appId, jobId }, "Needs-review email failed (non-fatal)");
  }

  return {
    ranEvaluator: true,
    finalVerdict: "fail",
    rounds: round,
    fixesApplied,
    autoPublished: false,
    publicUrl: null,
    summary: evaluatorSummary,
  };
}
