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
  method: "GET" | "POST" | "DELETE";
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

/* ----------------------- custom domain helpers ----------------------------- */

export type VercelDomainRecord = {
  /** "ALIAS" / "CNAME" / "A" — the DNS record type the user must create. */
  type: "A" | "CNAME";
  /** Host part to set in the DNS zone. "@" for the apex domain. */
  name: string;
  /** Target value for the record. */
  value: string;
};

export type VercelDomainStatus = {
  domain: string;
  /** True once Vercel has confirmed both DNS resolution and ownership. */
  verified: boolean;
  /**
   * Pending verification challenges. When `verified` is false and this is
   * non-empty, the user must add the listed TXT record(s) to their DNS
   * before the domain works. When `verified` is true this is empty.
   */
  verification: Array<{ type: string; domain: string; value: string; reason?: string }>;
  /**
   * DNS records the user must point at Vercel. Always returned so the UI
   * can show clear instructions even before verification finishes.
   */
  recommendedDns: VercelDomainRecord[];
};

/**
 * Decide which DNS records the registrar (Arsys, Hostinger, GoDaddy, IONOS,
 * Cloudflare, …) must serve so the domain points at the Vercel project.
 *
 * Convention used by Vercel's docs:
 *   - Apex domain (`mitienda.com`)  → A   record `@`     → 76.76.21.21
 *   - Sub domain (`www.mitienda.com`) → CNAME            → cname.vercel-dns.com
 *
 * Both are stable, documented Vercel endpoints. We always return both halves
 * (apex + www CNAME) for an apex domain so the user can wire the canonical
 * pair in one go.
 */
export function recommendedDnsFor(domain: string): VercelDomainRecord[] {
  const parts = domain.split(".");
  const isApex = parts.length === 2;
  if (isApex) {
    return [
      { type: "A", name: "@", value: "76.76.21.21" },
      { type: "CNAME", name: "www", value: "cname.vercel-dns.com" },
    ];
  }
  // Subdomain — single CNAME at the leaf.
  const host = parts.slice(0, -2).join(".");
  return [{ type: "CNAME", name: host || "@", value: "cname.vercel-dns.com" }];
}

/**
 * Attach a custom domain to the app's Vercel project. Caller is responsible
 * for ALL eligibility checks (project exists, user spend gate, etc.) — this
 * helper only talks to Vercel and persists the column. Returns the typed
 * failure verbatim so the route handler can surface Vercel's error message.
 */
export async function addVercelDomainForApp(opts: {
  appId: number;
  userId: string;
  projectId: string;
  domain: string;
  log: Logger;
}): Promise<
  | { ok: true; status: VercelDomainStatus }
  | { ok: false; failure: VercelDeployFailure }
> {
  const { appId, projectId, domain, log } = opts;
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { ok: false, failure: { kind: "missing_token" } };

  const added = await callVercel<{
    name: string;
    verified?: boolean;
    verification?: Array<{ type: string; domain: string; value: string; reason?: string }>;
  }>({
    token,
    method: "POST",
    path: `/v10/projects/${projectId}/domains`,
    body: { name: domain },
    log,
  });
  if (!added.ok) return { ok: false, failure: added.failure };

  await db
    .update(generatedApps)
    .set({ vercelCustomDomain: domain })
    .where(eq(generatedApps.id, appId));

  return {
    ok: true,
    status: {
      domain,
      verified: added.data.verified ?? false,
      verification: added.data.verification ?? [],
      recommendedDns: recommendedDnsFor(domain),
    },
  };
}

/**
 * Read the current verification status of an existing domain on the project.
 * Used by the UI to refresh "still waiting on DNS…" → "✓ verificado" without
 * re-creating the domain.
 */
export async function getVercelDomainStatus(opts: {
  projectId: string;
  domain: string;
  log: Logger;
}): Promise<
  | { ok: true; status: VercelDomainStatus }
  | { ok: false; failure: VercelDeployFailure }
> {
  const { projectId, domain, log } = opts;
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { ok: false, failure: { kind: "missing_token" } };

  const fetched = await callVercel<{
    name: string;
    verified?: boolean;
    verification?: Array<{ type: string; domain: string; value: string; reason?: string }>;
  }>({
    token,
    method: "GET",
    path: `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
    log,
  });
  if (!fetched.ok) return { ok: false, failure: fetched.failure };

  return {
    ok: true,
    status: {
      domain,
      verified: fetched.data.verified ?? false,
      verification: fetched.data.verification ?? [],
      recommendedDns: recommendedDnsFor(domain),
    },
  };
}

/**
 * Detach a custom domain from the project AND clear it from the app row.
 * Tolerates "domain not found in project" (404) so calling DELETE twice
 * doesn't error out — we still want the local column cleared in that case.
 */
export async function removeVercelDomainForApp(opts: {
  appId: number;
  projectId: string;
  domain: string;
  log: Logger;
}): Promise<{ ok: true } | { ok: false; failure: VercelDeployFailure }> {
  const { appId, projectId, domain, log } = opts;
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { ok: false, failure: { kind: "missing_token" } };

  const removed = await callVercel<unknown>({
    token,
    method: "DELETE",
    path: `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
    log,
  });
  if (!removed.ok && removed.failure.kind === "vercel_api_error" && removed.failure.status !== 404) {
    return { ok: false, failure: removed.failure };
  }

  await db
    .update(generatedApps)
    .set({ vercelCustomDomain: null })
    .where(eq(generatedApps.id, appId));

  return { ok: true };
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
