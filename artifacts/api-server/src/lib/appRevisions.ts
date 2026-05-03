/**
 * App revision snapshots — every successful write to a generated app is also
 * captured here as an immutable copy so the user can roll back if a later
 * edit, visual-fix, or evaluator patch breaks something.
 */
import { connectDB } from "./db";
import {
  AppRevision,
  AppMessage,
  GeneratedApp,
  GenerationJob,
  type IGeneratedApp,
} from "@workspace/db/schema";
import { logger } from "./logger";
 
export type RevisionSource =
  | "create"
  | "edit"
  | "visual-fix"
  | "health-fix"
  | "restore-backup";
 
/**
 * Insert a snapshot from a row already in memory. Use this right after
 * saving the app so we keep the snapshot close to the write.
 */
export async function insertAppRevisionFromRow(args: {
  row: IGeneratedApp;
  source: RevisionSource;
  summary: string;
  jobId?: string | null;
}): Promise<void> {
  await connectDB();
  const { row, source, summary, jobId = null } = args;
  await AppRevision.create({
    appId: String(row._id),
    source,
    summary: summary.slice(0, 500),
    jobId: jobId ?? undefined,
    frontendCode: row.frontendCode,
    backendCode: row.backendCode,
  });
}
 
/**
 * Snapshot the CURRENT state of an app by re-reading it from the DB.
 * Errors are swallowed and logged — the user's app must not break
 * because the history table choked.
 */
export async function snapshotCurrentApp(args: {
  appId: string;
  source: RevisionSource;
  summary: string;
  jobId?: string | null;
}): Promise<void> {
  await connectDB();
  const { appId, source, summary, jobId = null } = args;
  try {
    const row = await GeneratedApp.findById(appId).lean<IGeneratedApp>();
    if (!row) return;
    await insertAppRevisionFromRow({ row, source, summary, jobId });
  } catch (err) {
    logger.warn({ err, appId, source }, "snapshotCurrentApp failed (non-fatal)");
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
  appId: string;
  revisionId: string;
  userId: string;
}): Promise<
  | { ok: true }
  | { ok: false; reason: "not_found" | "forbidden" | "job_in_flight" }
> {
  await connectDB();
  const { appId, revisionId, userId } = args;
 
  // 1. Ownership check
  const appRow = await GeneratedApp.findOne(
    { _id: appId, userId },
  ).lean<IGeneratedApp>();
  if (!appRow) {
    return { ok: false as const, reason: "forbidden" as const };
  }
 
  // 2. Check for in-flight jobs
  const activeJob = await GenerationJob.findOne(
    { appId, status: { $in: ["queued", "running"] } },
    { _id: 1 },
  ).lean();
  if (activeJob) {
    return { ok: false as const, reason: "job_in_flight" as const };
  }
 
  // 3. Fetch the target revision
  const rev = await AppRevision.findOne(
    { _id: revisionId, appId },
  ).lean();
  if (!rev) {
    return { ok: false as const, reason: "not_found" as const };
  }
 
  // 4. Snapshot CURRENT state as restore-backup BEFORE overwriting.
  await insertAppRevisionFromRow({
    row: appRow,
    source: "restore-backup",
    summary: `Copia de seguridad antes de restaurar a la revisión #${revisionId}`,
  });
 
  // 5. Overwrite the app row with the chosen revision's content.
  await GeneratedApp.findByIdAndUpdate(appId, {
    $set: {
      frontendCode: rev.frontendCode,
      backendCode: rev.backendCode,
      status: "ready",
      evaluatorSummary: null,
    },
  });
 
  // 6. Drop a chat message so the user sees a record of the rollback.
  await AppMessage.create({
    appId,
    role: "assistant",
    content: `He restaurado la versión #${revisionId} de ${rev.createdAt.toLocaleString("es-ES")}. La versión que tenías quedó guardada como copia de seguridad por si quieres volver.`,
  });
 
  return { ok: true as const };
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
 
