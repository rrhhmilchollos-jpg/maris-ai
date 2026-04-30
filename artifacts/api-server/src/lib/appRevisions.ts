/**
 * App revision snapshots — every successful write to a generated app is also
 * captured here as an immutable copy so the user can roll back if a later
 * edit, visual-fix, or evaluator patch breaks something. The ledger is keyed
 * by appId (cascade-deleted) and grouped by `source`:
 *
 *  - "create"          : initial generation
 *  - "edit"            : user-driven edit from chat
 *  - "visual-fix"      : automatic Visual Tester or Evaluator patch
 *  - "health-fix"      : on-demand health check repair
 *  - "restore-backup"  : snapshot taken right BEFORE a rollback, so the user
 *                        can undo their undo if the rolled-back version is
 *                        worse than what they had.
 *
 * Restore writes the chosen revision back as the active row but FIRST takes
 * a "restore-backup" snapshot so nothing is ever lost.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  appMessages,
  appRevisions,
  generatedApps,
  generationJobs,
  type GeneratedAppRow,
} from "@workspace/db/schema";
import { db } from "./db";
import { logger } from "./logger";

export type RevisionSource =
  | "create"
  | "edit"
  | "visual-fix"
  | "health-fix"
  | "restore-backup";

type AnyExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Insert a snapshot from a row already in memory. Use this from inside the
 * runJob transaction — we have the just-saved row in scope so we don't pay
 * an extra round-trip and we keep the snapshot atomic with the save.
 */
export async function insertAppRevisionFromRow(
  executor: AnyExecutor,
  args: {
    row: GeneratedAppRow;
    source: RevisionSource;
    summary: string;
    jobId?: number | null;
  },
): Promise<void> {
  const { row, source, summary, jobId = null } = args;
  await executor.insert(appRevisions).values({
    appId: row.id,
    source,
    summary: summary.slice(0, 500),
    jobId,
    frontendCode: row.frontendCode,
    backendCode: row.backendCode,
    techStack: row.techStack,
    plannedPages: row.plannedPages ?? null,
    agentNotes: row.agentNotes,
  });
}

/**
 * Snapshot the CURRENT state of an app by re-reading it from the DB. Use
 * this from background tasks (visual tester, evaluator, health check) where
 * the bundle has just been overwritten and we want to preserve a copy.
 *
 * Important: call this AFTER the .update() that wrote the new code. We
 * intentionally snapshot the new state, not the old one — old state was
 * already snapshotted as the previous revision (or as the "create" one).
 *
 * Errors here are swallowed and logged — the user's app must not break
 * because the history table choked.
 */
export async function snapshotCurrentApp(args: {
  appId: number;
  source: RevisionSource;
  summary: string;
  jobId?: number | null;
}): Promise<void> {
  const { appId, source, summary, jobId = null } = args;
  try {
    const [row] = await db
      .select()
      .from(generatedApps)
      .where(eq(generatedApps.id, appId))
      .limit(1);
    if (!row) return;
    await insertAppRevisionFromRow(db, { row, source, summary, jobId });
  } catch (err) {
    logger.warn(
      { err, appId, source },
      "snapshotCurrentApp failed (non-fatal)",
    );
  }
}

/**
 * Restore an app to a previous revision. Takes a "restore-backup" snapshot
 * of the current state first so the user can always undo their undo.
 *
 * Returns { ok: true } on success or { ok: false, reason } on auth /
 * not-found errors. Throws only on unexpected DB errors.
 */
export async function restoreAppRevision(args: {
  appId: number;
  revisionId: number;
  userId: string;
}): Promise<
  | { ok: true }
  | { ok: false; reason: "not_found" | "forbidden" | "job_in_flight" }
> {
  const { appId, revisionId, userId } = args;
  return db.transaction(async (tx) => {
    // 1. Ownership check + actual row lock (FOR UPDATE). Without the lock
    //    a parallel runJob/healthcheck/visualTester could race with the
    //    restore and we'd lose either the rollback or their patch.
    const [appRow] = await tx
      .select()
      .from(generatedApps)
      .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)))
      .for("update")
      .limit(1);
    if (!appRow) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    // 1b. Refuse to restore while a generation job is still queued or
    //     running — its eventual write would clobber the restored bundle
    //     and leave the user confused. We don't take a job-row lock; the
    //     check is a best-effort guard plus the row lock above stops most
    //     real conflicts. The user can retry once the job lands.
    const [activeJob] = await tx
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.appId, appId),
          sql`${generationJobs.status} IN ('queued', 'running')`,
        ),
      )
      .limit(1);
    if (activeJob) {
      return { ok: false as const, reason: "job_in_flight" as const };
    }
    // 2. Fetch the target revision and confirm it belongs to this app.
    const [rev] = await tx
      .select()
      .from(appRevisions)
      .where(and(eq(appRevisions.id, revisionId), eq(appRevisions.appId, appId)))
      .limit(1);
    if (!rev) {
      return { ok: false as const, reason: "not_found" as const };
    }
    // 3. Snapshot CURRENT state as restore-backup BEFORE overwriting it.
    await insertAppRevisionFromRow(tx, {
      row: appRow,
      source: "restore-backup",
      summary: `Copia de seguridad antes de restaurar a la revisión #${revisionId}`,
    });
    // 4. Overwrite the app row with the chosen revision's content.
    await tx
      .update(generatedApps)
      .set({
        frontendCode: rev.frontendCode,
        backendCode: rev.backendCode,
        techStack: rev.techStack,
        plannedPages: rev.plannedPages,
        agentNotes: rev.agentNotes,
        // Restoring should put the app back into a clean "ready" status so
        // the autonomous evaluator's previous "needs_review" verdict on the
        // newer (worse) bundle no longer blocks the user.
        status: "ready",
        evaluatorSummary: null,
      })
      .where(eq(generatedApps.id, appId));
    // 5. Drop a chat message so the user sees a record of the rollback.
    await tx.insert(appMessages).values({
      appId,
      role: "assistant",
      content: `He restaurado la versión #${revisionId} de ${rev.createdAt.toLocaleString("es-ES")}. La versión que tenías quedó guardada como copia de seguridad por si quieres volver.`,
    });
    return { ok: true as const };
  });
}

/**
 * Friendly Spanish label for each revision source — used in UI lists.
 */
export function revisionSourceLabel(source: string): string {
  switch (source) {
    case "create":
      return "Creación inicial";
    case "edit":
      return "Edición desde chat";
    case "visual-fix":
      return "Reparación visual automática";
    case "health-fix":
      return "Reparación de build";
    case "restore-backup":
      return "Copia antes de restaurar";
    default:
      return source;
  }
}
