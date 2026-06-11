/**
 * Vercel deployment integration. Pushes a generated app to Vercel as a
 * REAL Vite project (the full source tree from the app's frontend bundle
 * uploaded as individual files), so Vercel runs `vite build` server-side
 * on every deploy. The result is the same `dist/` you'd get locally —
 * with code-splitting, tree-shaking and proper asset hashing — instead
 * of a single inlined HTML file.
 *
 * Why not the previous "single index.html" path? Because it was just a
 * snapshot of one in-browser bundle (Sandpack/esbuild) inlined into one
 * file. That worked for tiny demos but skipped the user-visible benefits
 * of a real Vercel project: per-route source maps, edge caching of
 * individual assets, real analytics. The Maris AI bundle already obeys
 * the Vite project layout (package.json, vite.config.*, src/*, public/*),
 * so we can ship it verbatim.
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
 * Files: each entry in the bundle uploaded as `{ file: "<path>", data: "<contents>" }`.
 * Binary files would need base64 + `encoding: "base64"` but the Maris AI
 * bundle is text-only (.tsx/.ts/.css/.json/.html/.md), so plain UTF-8 strings
 * are fine.
 */

import type { Logger } from "pino";
import { GeneratedApp } from "@workspace/db/schema";
import { bundleToFiles } from "./exportZip";

const VERCEL_API = "https://api.vercel.com";
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;

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

export type VercelEnvVar = {
  key: string;
  value: string;
  type: "plain" | "secret" | "encrypted";
  target: ("production" | "preview" | "development")[];
};

/**
 * Deploy the given app to Vercel. Returns the public URL or a typed failure
 * for the route handler to translate to an HTTP response. Never throws on
 * expected error paths — only on truly unexpected runtime errors.
 */
export async function deployAppToVercel(opts: {
  appId: string;
  userId: string;
  log: Logger;
}): Promise<{ ok: true; result: VercelDeployResult } | { ok: false; failure: VercelDeployFailure }> {
  const { appId, userId, log } = opts;

  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return { ok: false, failure: { kind: "missing_token" } };
  }

  const row = await GeneratedApp.findOne({ _id: appId, userId }).lean();
  if (!row) {
    return { ok: false, failure: { kind: "app_not_found" } };
  }

  const bundleFiles = bundleToFiles(row.frontendCode);
  if (Object.keys(bundleFiles).length === 0) {
    return {
      ok: false,
      failure: {
        kind: "build_failed",
        message:
          "El bundle del frontend está vacío — el generador no produjo archivos.",
      },
    };
  }

  const appKind = row.kind ?? "fullstack";
  const deployFiles =
    appKind === "python-api" || appKind === "django"
      ? preparePythonProjectForVercel(bundleFiles, appKind)
      : prepareViteProjectForVercel(bundleFiles);

  let projectId = row.vercelProjectId;
  const projectName = sanitiseProjectName(`maris-${appId.slice(0, 8)}-${row.title}`);
  const isPython = appKind === "python-api" || appKind === "django";

  // If we have a saved projectId, verify it still exists in Vercel.
  // If not (project was deleted), clear it so we recreate below.
  if (projectId) {
    const check = await callVercel<{ id: string }>({
      token,
      method: "GET",
      path: `/v9/projects/${projectId}`,
      log,
    });
    if (!check.ok && "status" in check.failure && check.failure.status === 404) {
      log.info({ projectId }, "Vercel project not found (deleted?), will recreate");
      projectId = undefined as any;
      await GeneratedApp.updateOne({ _id: appId }, { vercelProjectId: null });
    }
  }

  if (!projectId) {
    const created = await callVercel<{ id: string; name: string }>({
      token,
      method: "POST",
      path: "/v9/projects",
      body: isPython
        ? { name: projectName, ssoProtection: null }
        : { name: projectName, framework: "vite", ssoProtection: null },
      log,
    });
    if (!created.ok) return { ok: false, failure: created.failure };
    projectId = created.data.id;

    await GeneratedApp.updateOne({ _id: appId }, { vercelProjectId: projectId });
  }

  await ensureVercelProjectIsPublic({ token, projectId, log });

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
      files: Object.entries(deployFiles).map(([file, data]) => ({ file, data })),
      projectSettings: isPython
        ? { framework: null }
        : {
            framework: "vite",
            installCommand: "npm install",
            buildCommand: "npm run build",
            outputDirectory: "dist",
          },
    },
    log,
  });
  if (!deploy.ok) return { ok: false, failure: deploy.failure };

  const ready = await waitForVercelDeploymentReady({ token, deploymentId: deploy.data.id, log });
  if (!ready.ok) return { ok: false, failure: ready.failure };

  const alias = await assignStableVercelAlias({ token, deploymentId: deploy.data.id, alias: `${projectName}.vercel.app`, log });
  if (!alias.ok) return { ok: false, failure: alias.failure };

  const publicUrl = `https://${projectName}.vercel.app`;

  await GeneratedApp.updateOne({ _id: appId }, { vercelDeployUrl: publicUrl });

  return {
    ok: true,
    result: { url: publicUrl, projectId, deploymentId: deploy.data.id },
  };
}

/**
 * Tiny fetch wrapper around the Vercel REST API.
 */
async function callVercel<T>(opts: {
  token: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  log: Logger;
}): Promise<{ ok: true; data: T } | { ok: false; failure: VercelDeployFailure }> {
  const { token, method, path, body, log } = opts;
  let res: Response;
  try {
    const url = new URL(`${VERCEL_API}${path}`);
    if (VERCEL_TEAM_ID && !url.searchParams.has("teamId")) {
      url.searchParams.set("teamId", VERCEL_TEAM_ID);
    }
    res = await fetch(url, {
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

async function ensureVercelProjectIsPublic(opts: {
  token: string;
  projectId: string;
  log: Logger;
}): Promise<void> {
  const { token, projectId, log } = opts;
  const updated = await callVercel<{ id: string }>({
    token,
    method: "PATCH",
    path: `/v9/projects/${projectId}`,
    body: { ssoProtection: null },
    log,
  });

  if (!updated.ok) {
    log.warn(
      { projectId, failure: updated.failure },
      "No se pudo desactivar automáticamente Vercel Authentication para el proyecto",
    );
  }
}

async function assignStableVercelAlias(opts: {
  token: string;
  deploymentId: string;
  alias: string;
  log: Logger;
}): Promise<{ ok: true } | { ok: false; failure: VercelDeployFailure }> {
  const { token, deploymentId, alias, log } = opts;
  const assigned = await callVercel<{ alias: string; uid: string }>({
    token,
    method: "POST",
    path: `/v2/deployments/${deploymentId}/aliases`,
    body: { alias },
    log,
  });

  if (assigned.ok) return { ok: true };

  if (assigned.failure.kind === "vercel_api_error" && assigned.failure.status === 409) {
    log.info({ deploymentId, alias }, "El alias estable ya estaba asignado al deployment");
    return { ok: true };
  }

  return { ok: false, failure: assigned.failure };
}

async function waitForVercelDeploymentReady(opts: {
  token: string;
  deploymentId: string;
  log: Logger;
}): Promise<{ ok: true } | { ok: false; failure: VercelDeployFailure }> {
  const { token, deploymentId, log } = opts;
  const maxAttempts = 60;
  const delayMs = 2_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const status = await callVercel<{ readyState?: string; errorMessage?: string }>({
      token,
      method: "GET",
      path: `/v13/deployments/${deploymentId}`,
      log,
    });

    if (!status.ok) return { ok: false, failure: status.failure };

    if (status.data.readyState === "READY") return { ok: true };

    if (status.data.readyState === "ERROR" || status.data.readyState === "CANCELED") {
      return {
        ok: false,
        failure: {
          kind: "build_failed",
          message: status.data.errorMessage || `Vercel terminó el deployment con estado ${status.data.readyState}`,
        },
      };
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return {
    ok: false,
    failure: {
      kind: "vercel_api_error",
      status: 408,
      message: "Vercel no marcó el deployment como READY dentro del tiempo esperado",
    },
  };
}

/**
 * Sync environment variables to the Vercel project.
 */
export async function syncVercelEnvironmentVariables(opts: {
  projectId: string;
  envVars: Array<{ name: string; value: string }>;
  log: Logger;
}): Promise<{ ok: true } | { ok: false; failure: VercelDeployFailure }> {
  const { projectId, envVars, log } = opts;
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { ok: false, failure: { kind: "missing_token" } };

  log.info({ projectId, count: envVars.length }, "Syncing environment variables to Vercel");

  for (const env of envVars) {
    const existing = await callVercel<any>({
      token,
      method: "GET",
      path: `/v9/projects/${projectId}/env`,
      log,
    });

    if (existing.ok) {
      const alreadyExists = existing.data.envs?.find((e: any) => e.key === env.name);
      if (alreadyExists) {
        const updated = await callVercel<any>({
          token,
          method: "PATCH",
          path: `/v9/projects/${projectId}/env/${alreadyExists.id}`,
          body: {
            value: env.value,
            target: ["production", "preview", "development"],
          },
          log,
        });
        if (!updated.ok) log.warn({ key: env.name }, "Failed to update env var");
        continue;
      }
    }

    const created = await callVercel<any>({
      token,
      method: "POST",
      path: `/v10/projects/${projectId}/env`,
      body: {
        key: env.name,
        value: env.value,
        type: "plain",
        target: ["production", "preview", "development"],
      },
      log,
    });

    if (!created.ok) {
      log.warn({ key: env.name, failure: created.failure }, "Failed to create env var");
    }
  }

  return { ok: true };
}

/* ----------------------- custom domain helpers ----------------------------- */

export type VercelDomainRecord = {
  type: "A" | "CNAME";
  name: string;
  value: string;
};

export type VercelDomainStatus = {
  domain: string;
  verified: boolean;
  verification: Array<{ type: string; domain: string; value: string; reason?: string }>;
  recommendedDns: VercelDomainRecord[];
};

export function recommendedDnsFor(domain: string): VercelDomainRecord[] {
  const parts = domain.split(".");
  const isApex = parts.length === 2;
  if (isApex) {
    return [
      { type: "A", name: "@", value: "76.76.21.21" },
      { type: "CNAME", name: "www", value: "cname.vercel-dns.com" },
    ];
  }
  const host = parts.slice(0, -2).join(".");
  return [{ type: "CNAME", name: host || "@", value: "cname.vercel-dns.com" }];
}

export async function addVercelDomainForApp(opts: {
  appId: string;
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

  await GeneratedApp.updateOne({ _id: appId }, { vercelCustomDomain: domain });

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

export async function removeVercelDomainForApp(opts: {
  appId: string;
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

  await GeneratedApp.updateOne({ _id: appId }, { vercelCustomDomain: null });

  return { ok: true };
}

/**
 * Convert a free-form string into a Vercel-legal project name: lowercase
 * letters, digits, hyphens; max 52 chars; must start with a letter or digit.
 * FIX: usar solo 8 chars del appId para evitar nombres demasiado largos
 * con caracteres especiales que generan secuencias '---' inválidas.
 */
function sanitiseProjectName(raw: string): string {
  const stripped = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  const trimmed = stripped.slice(0, 52) || "maris-app";
  return trimmed.replace(/^-+/, "").replace(/-+$/, "");
}

export function stableVercelProductionUrlForApp(appId: string, title: string): string {
  const projectName = sanitiseProjectName(`maris-${appId.slice(0, 8)}-${title}`);
  return `https://${projectName}.vercel.app`;
}

function prepareViteProjectForVercel(
  files: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawPath, contents] of Object.entries(files)) {
    let p = rawPath;
    if (p.startsWith("./")) p = p.slice(2);
    if (p.startsWith("/")) p = p.slice(1);
    if (!p) continue;
    if (p.includes("..")) continue;
    if (
      p.startsWith("node_modules/") ||
      p.startsWith("dist/") ||
      p.startsWith("build/") ||
      p.startsWith(".vercel/") ||
      p.startsWith("tests/") ||
      p.startsWith("e2e/") ||
      p.startsWith("__tests__/") ||
      p === ".maris-ai" ||
      p === ".DS_Store"
    ) {
      continue;
    }
    out[p] = contents;
  }

  if (!out["package.json"]) {
    out["package.json"] = JSON.stringify(
      {
        name: "maris-app",
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
        },
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
        devDependencies: {
          "@vitejs/plugin-react": "^4.3.4",
          vite: "^6.0.0",
          typescript: "^5.6.0",
        },
      },
      null,
      2,
    ) + "\n";
  }
  if (!out["vite.config.ts"] && !out["vite.config.js"]) {
    out["vite.config.ts"] =
      `import { defineConfig } from "vite";\n` +
      `import react from "@vitejs/plugin-react";\n\n` +
      `export default defineConfig({\n` +
      `  plugins: [react()],\n` +
      `});\n`;
  }
  if (!out["index.html"]) {
    out["index.html"] =
      `<!doctype html>\n<html lang="es">\n  <head>\n` +
      `    <meta charset="UTF-8" />\n` +
      `    <meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
      `    <title>Maris AI</title>\n` +
      `  </head>\n  <body>\n    <div id="root"></div>\n` +
      `    <script type="module" src="/src/main.tsx"></script>\n` +
      `  </body>\n</html>\n`;
  }

  return out;
}

function preparePythonProjectForVercel(
  files: Record<string, string>,
  kind: "python-api" | "django",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawPath, contents] of Object.entries(files)) {
    let p = rawPath;
    if (p.startsWith("./")) p = p.slice(2);
    if (p.startsWith("/")) p = p.slice(1);
    if (!p) continue;
    if (p.includes("..")) continue;
    if (
      p.startsWith("__pycache__/") ||
      p.startsWith(".venv/") ||
      p.startsWith("venv/") ||
      p === ".maris-ai" ||
      p === ".DS_Store"
    ) {
      continue;
    }
    out[p] = contents;
  }

  out["vercel.json"] = JSON.stringify(
    {
      version: 2,
      builds: [
        { src: "api/index.py", use: "@vercel/python" },
      ],
      routes: [
        { src: "/(.*)", dest: "api/index.py" },
      ],
    },
    null,
    2,
  ) + "\n";

  if (!out["api/index.py"]) {
    if (kind === "python-api") {
      out["api/index.py"] =
        `# Auto-generated by Maris AI for Vercel deploys.\n` +
        `import sys, os\n` +
        `sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))\n` +
        `from main import app  # noqa: F401,E402\n`;
    } else {
      out["api/index.py"] =
        `# Auto-generated by Maris AI for Vercel deploys.\n` +
        `import os, sys\n` +
        `sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))\n` +
        `os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mysite.settings')\n` +
        `from django.core.wsgi import get_wsgi_application  # noqa: E402\n` +
        `application = get_wsgi_application()\n` +
        `app = application\n`;
    }
  }

  if (!out["requirements.txt"]) {
    out["requirements.txt"] =
      kind === "python-api"
        ? `fastapi==0.115.5\nuvicorn[standard]==0.32.1\nsqlalchemy==2.0.36\npydantic==2.10.3\n`
        : `django==5.1.4\n`;
  }

  return out;
}
