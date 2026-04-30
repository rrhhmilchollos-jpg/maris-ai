/**
 * Vercel deployment integration. Pushes a generated app to Vercel as a
 * single-file static deployment (one self-contained `index.html` produced
 * by `buildDeployHtml`) so the user gets a real public URL on Vercel's
 * edge network — independent from our own `/p/<slug>` proxy.
 *
 * Auth: VERCEL_TOKEN secret (personal access token, scope "Full Account").
 * Sent as `Authorization: Bearer <token>` on every request.
 *
 * Project lifecycle: the FIRST deploy creates a new Vercel project (POST
 * /v9/projects) named after a sanitised slug derived from the app id and
 * title. Subsequent deploys for the same app reuse the saved
 * `vercelProjectId` so updates land on the same project (and the same
 * production URL) instead of cluttering the user's dashboard with one
 * project per click.
 *
 * Files: a single `index.html` payload — Vercel's API expects each file
 * uploaded with `{ file: "index.html", data: "<...>" }`.
 */

import type { Logger } from "pino";
import { and, eq } from "drizzle-orm";
import { generatedApps } from "@workspace/db/schema";
import { db } from "./db";
import { buildDeployHtml } from "./deployBundle";

const VERCEL_API = "https://api.vercel.com";

export type VercelDeployResult = {
  url: string;
  projectId: string;
  /** Deployment id Vercel assigned (handy for the user to look up in their dashboard). */
  deploymentId: string;
};

export type VercelDeployFailure =
  | { kind: "missing_token" }
  | { kind: "app_not_found" }
  | { kind: "build_failed"; message: string }
  | { kind: "vercel_api_error"; status: number; message: string };

/**
 * Deploy the given app to Vercel. Returns the public URL or a typed failure
 * for the route handler to translate to an HTTP response. Never throws on
 * expected error paths — only on truly unexpected runtime errors.
 */
export async function deployAppToVercel(opts: {
  appId: number;
  userId: string;
  log: Logger;
}): Promise<{ ok: true; result: VercelDeployResult } | { ok: false; failure: VercelDeployFailure }> {
  const { appId, userId, log } = opts;

  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return { ok: false, failure: { kind: "missing_token" } };
  }

  // 1. Load and authorize the app row in one shot. Same ownership pattern
  //    used by every other /apps/:id endpoint.
  const [row] = await db
    .select()
    .from(generatedApps)
    .where(and(eq(generatedApps.id, appId), eq(generatedApps.userId, userId)))
    .limit(1);
  if (!row) {
    return { ok: false, failure: { kind: "app_not_found" } };
  }

  // 2. Build the same self-contained HTML our /p/<slug> route serves. If
  //    the bundle is broken we surface the real esbuild message so the
  //    user can fix it from the chat instead of a generic "build failed".
  let html: string;
  try {
    html = await buildDeployHtml({
      bundle: row.frontendCode,
      title: row.title,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    log.warn({ err, appId }, "Vercel deploy: buildDeployHtml failed");
    return { ok: false, failure: { kind: "build_failed", message } };
  }

  // 3. Resolve (or create) the Vercel project for this app. Project name
  //    must be lowercase, kebab-case, and stable across deploys so the
  //    same URL stays valid. Prefix with "maris-" + appId so two apps
  //    with the same title don't collide in the user's Vercel dashboard.
  let projectId = row.vercelProjectId;
  const projectName = sanitiseProjectName(`maris-${appId}-${row.title}`);

  if (!projectId) {
    const created = await callVercel<{ id: string; name: string }>({
      token,
      method: "POST",
      path: "/v9/projects",
      body: { name: projectName, framework: null },
      log,
    });
    if (!created.ok) return { ok: false, failure: created.failure };
    projectId = created.data.id;

    // Persist the new project id immediately so a crash between project
    // creation and deployment doesn't strand an orphan project.
    await db
      .update(generatedApps)
      .set({ vercelProjectId: projectId })
      .where(eq(generatedApps.id, appId));
  }

  // 4. Create a production deployment with the single index.html file.
  //    `target: "production"` makes Vercel point the project's main URL
  //    (e.g. <project>.vercel.app) at this build instead of giving us a
  //    one-off preview URL.
  const deploy = await callVercel<{
    id: string;
    url: string;
    readyState?: string;
  }>({
    token,
    method: "POST",
    path: `/v13/deployments?forceNew=1`,
    body: {
      name: projectName,
      project: projectId,
      target: "production",
      files: [{ file: "index.html", data: html }],
      projectSettings: { framework: null },
    },
    log,
  });
  if (!deploy.ok) return { ok: false, failure: deploy.failure };

  // Vercel returns "url" as a hostname WITHOUT scheme (e.g. "myapp.vercel.app").
  const publicUrl = deploy.data.url.startsWith("http")
    ? deploy.data.url
    : `https://${deploy.data.url}`;

  await db
    .update(generatedApps)
    .set({ vercelDeployUrl: publicUrl })
    .where(eq(generatedApps.id, appId));

  return {
    ok: true,
    result: { url: publicUrl, projectId, deploymentId: deploy.data.id },
  };
}

/**
 * Tiny fetch wrapper around the Vercel REST API. Centralises the bearer
 * header, JSON encoding, and error translation so the deploy function
 * above stays readable. Returns a typed failure on any non-2xx so callers
 * never throw on expected upstream errors.
 */
async function callVercel<T>(opts: {
  token: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  log: Logger;
}): Promise<{ ok: true; data: T } | { ok: false; failure: VercelDeployFailure }> {
  const { token, method, path, body, log } = opts;
  let res: Response;
  try {
    res = await fetch(`${VERCEL_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    log.warn({ err, path }, "Vercel API network error");
    return {
      ok: false,
      failure: {
        kind: "vercel_api_error",
        status: 0,
        message: err instanceof Error ? err.message : "network error",
      },
    };
  }

  if (!res.ok) {
    let detail = "";
    try {
      const json = (await res.json()) as { error?: { message?: string } };
      detail = json.error?.message ?? "";
    } catch {
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
    }
    log.warn({ path, status: res.status, detail }, "Vercel API error");
    return {
      ok: false,
      failure: {
        kind: "vercel_api_error",
        status: res.status,
        message: detail || `HTTP ${res.status}`,
      },
    };
  }

  return { ok: true, data: (await res.json()) as T };
}

/**
 * Convert a free-form string into a Vercel-legal project name: lowercase
 * letters, digits, hyphens; max 100 chars; must start with a letter or digit.
 * Strips diacritics first so Spanish titles like "Diseño" come out as
 * "diseno" instead of being lost entirely.
 */
function sanitiseProjectName(raw: string): string {
  const stripped = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  const trimmed = stripped.slice(0, 100) || "maris-app";
  // Vercel rejects names starting with a hyphen.
  return trimmed.replace(/^-+/, "");
}
