import { connectDB } from "./db";
import { GeneratedApp, type IGeneratedApp } from "@workspace/db/schema";
import { logger } from "./logger";

/**
 * Exclusive, optimistic guard for mutations that replace a customer's app bundle.
 * Mongo's conditional update is used instead of a process-local mutex so the
 * protection works across API replicas and queue workers.
 */
const DEFAULT_LOCK_MS = 45 * 60 * 1000;

type LeanApp = IGeneratedApp & { _id: unknown; contentVersion?: number };

export type MutationLease = {
  app: LeanApp;
  expectedContentVersion: number;
};

export async function acquireAppMutationLease(args: {
  appId: string;
  jobId: string;
  leaseMs?: number;
}): Promise<{ ok: true; lease: MutationLease } | { ok: false; reason: "not_found" | "busy" }> {
  await connectDB();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (args.leaseMs ?? DEFAULT_LOCK_MS));

  const app = await GeneratedApp.findOneAndUpdate(
    {
      _id: args.appId,
      $or: [
        { mutationLockJobId: { $exists: false } },
        { mutationLockJobId: null },
        { mutationLockJobId: args.jobId },
        { mutationLockExpiresAt: { $lt: now } },
      ],
    },
    {
      $set: {
        mutationLockJobId: args.jobId,
        mutationLockExpiresAt: expiresAt,
        mutationLockedAt: now,
      },
    },
    { new: true },
  ).lean<LeanApp>();

  if (!app) {
    const exists = await GeneratedApp.exists({ _id: args.appId });
    return { ok: false, reason: exists ? "busy" : "not_found" };
  }

  return {
    ok: true,
    lease: {
      app,
      expectedContentVersion: Number(app.contentVersion || 0),
    },
  };
}

export async function renewAppMutationLease(args: {
  appId: string;
  jobId: string;
  leaseMs?: number;
}): Promise<void> {
  await connectDB();
  const now = new Date();
  await GeneratedApp.updateOne(
    { _id: args.appId, mutationLockJobId: args.jobId },
    { $set: { mutationLockExpiresAt: new Date(now.getTime() + (args.leaseMs ?? DEFAULT_LOCK_MS)) } },
  );
}

/**
 * Commit only if the job still owns the lease and the version that it read has
 * not changed. A failed conditional update means that the existing app remains
 * untouched and the job must be surfaced as a conflict, never as a success.
 */
export async function commitAppMutation(args: {
  appId: string;
  jobId: string;
  expectedContentVersion: number;
  update: Record<string, unknown>;
}): Promise<{ ok: true; app: LeanApp } | { ok: false; reason: "conflict" }> {
  await connectDB();
  // Los proyectos creados antes de introducir contentVersion no contienen el
  // campo todavía. En su primera mutación protegida, «ausente» equivale a 0.
  const versionFilter = args.expectedContentVersion === 0
    ? { $or: [{ contentVersion: 0 }, { contentVersion: { $exists: false } }] }
    : { contentVersion: args.expectedContentVersion };
  const app = await GeneratedApp.findOneAndUpdate(
    {
      _id: args.appId,
      mutationLockJobId: args.jobId,
      ...versionFilter,
    },
    {
      $set: { ...args.update, updatedAt: new Date() },
      $inc: { contentVersion: 1 },
      $unset: { mutationLockJobId: 1, mutationLockExpiresAt: 1, mutationLockedAt: 1 },
    },
    { new: true },
  ).lean<LeanApp>();

  if (!app) return { ok: false, reason: "conflict" };
  return { ok: true, app };
}

export async function releaseAppMutationLease(args: { appId: string; jobId: string }): Promise<void> {
  try {
    await connectDB();
    await GeneratedApp.updateOne(
      { _id: args.appId, mutationLockJobId: args.jobId },
      { $unset: { mutationLockJobId: 1, mutationLockExpiresAt: 1, mutationLockedAt: 1 } },
    );
  } catch (err) {
    logger.warn({ err, appId: args.appId, jobId: args.jobId }, "Could not release app mutation lease");
  }
}
