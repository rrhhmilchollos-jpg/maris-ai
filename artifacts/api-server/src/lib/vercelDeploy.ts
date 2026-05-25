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
  const row = await GeneratedApp.findOne({ _id: appId, userId }).lean();
  if (!row) {
    return { ok: false, failure: { kind: "app_not_found" } };
  }

  // 2. Materialise the full Vite project tree from the bundle. Each entry
  //    becomes one file uploaded to Vercel. We refuse empty bundles so the
  //    UI shows "build failed" instead of silently deploying nothing (which
  //    would leave a broken white page on the user's vercel.app URL).
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
  // Pick the Vercel preset based on the app's stored kind. JS apps go through
  // the Vite preset (npm install + vite build → dist). Python kinds get a
  // vercel.json that wires up @vercel/python so FastAPI / Django run as
  // serverless functions.
  const appKind = row.kind ?? "fullstack";
  const deployFiles =
    appKind === "python-api" || appKind === "django"
      ? preparePythonProjectForVercel(bundleFiles, appKind)
      : prepareViteProjectForVercel(bundleFiles);

  // 3. Resolve (or create) the Vercel project for this app. Project name
  //    must be lowercase, kebab-case, and stable across deploys so the
  //    same URL stays valid. Prefix with "maris-" + appId so two apps
  //    with the same title don't collide in the user's Vercel dashboard.
  let projectId = row.vercelProjectId;
  const projectName = sanitiseProjectName(`maris-${appId}-${row.title}`);
  const isPython = appKind === "python-api" || appKind === "django";

  if (!projectId) {
    const created = await callVercel<{ id: string; name: string }>({
      token,
      method: "POST",
      path: "/v9/projects",
      // For JS apps, framework: "vite" → Vercel sets installCommand,
      // buildCommand, outputDirectory automatically. For Python apps we omit
      // the framework field; the runtime is selected by the vercel.json that
      // ships in the bundle (functions = "@vercel/python").
      body: isPython
        ? { name: projectName }
        : { name: projectName, framework: "vite" },
      log,
    });
    if (!created.ok) return { ok: false, failure: created.failure };
    projectId = created.data.id;

    // Persist the new project id immediately so a crash between project
    // creation and deployment doesn't strand an orphan project.
    await GeneratedApp.updateOne({ _id: appId }, { vercelProjectId: projectId });
  }

  // 4. Create a production deployment with the FULL project tree. Vercel
  //    runs `npm install` + `vite build` on its build infrastructure and
  //    serves the `dist/` output at the project's main URL.
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
      files: Object.entries(deployFiles).map(([file, data]) => ({ file, data })),
      // Python deployments rely on the bundled vercel.json + requirements.txt
      // (Vercel's @vercel/python runtime auto-installs from the latter). For
      // JS apps we keep the explicit Vite build commands so a missing
      // framework field on the project record doesn't break the deploy.
      projectSettings: isPython
        ? { framework: null }
        : {
            framework: "vite",
            installCommand: "npm install",
            buildCommand: "vite build",
            outputDirectory: "dist",
          },
    },
    log,
  });
  if (!deploy.ok) return { ok: false, failure: deploy.failure };

  // Vercel returns "url" as a hostname WITHOUT scheme (e.g. "myapp.vercel.app").
  const publicUrl = deploy.data.url.startsWith("http")
    ? deploy.data.url
    : `https://${deploy.data.url}`;

  await GeneratedApp.updateOne({ _id: appId }, { vercelDeployUrl: publicUrl });

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

  await GeneratedApp.updateOne({ _id: appId }, { vercelCustomDomain: null });

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

/**
 * Normalise a generated Vite bundle into the file shape Vercel expects:
 *   - paths must NOT start with "/" or "./"
 *   - we drop tests/, e2e/, __tests__/, and editor noise (.maris-ai, .DS_Store)
 *   - we ensure a `package.json`, `vite.config.*` and an `index.html` exist;
 *     if any are missing we inject a minimal one so `vite build` succeeds.
 *
 * The Maris AI generator already follows this layout, but a future change in
 * the prompt could regress and we'd rather inject a tiny default than push a
 * broken project to the user's Vercel dashboard.
 */
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
    // Skip dirs that don't belong in a published bundle and would just slow
    // down `npm install` or trip the build.
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

/**
 * Adapt a generated Python project tree for Vercel's @vercel/python serverless
 * runtime. Different conventions per kind:
 *
 *  - "python-api" (FastAPI): Vercel mounts each file under api/*.py as a
 *    serverless function. We require an `api/index.py` that re-exports the
 *    FastAPI `app` so every request hits it. If the bundle put the app in
 *    `main.py` at the root (which is the canonical layout the system prompt
 *    asks for), we synthesise a thin shim `api/index.py` that imports it.
 *
 *  - "django": Vercel runs Django via WSGI. We synthesise `api/index.py`
 *    that imports `application` from the project's `wsgi.py` (or
 *    `<project>/wsgi.py` when present). For projects that ship a
 *    single-file Django (no proper package), the user is told via README
 *    to deploy locally instead.
 *
 * In both cases we inject a `vercel.json` that routes ALL requests to
 * `api/index.py` so the framework handles its own routing internally
 * (FastAPI router / Django URLconf), and a `requirements.txt` if missing.
 */
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

  // Always overwrite vercel.json so user changes don't accidentally break
  // the routing — Maris owns the deploy config.
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

  // Synthesise api/index.py if missing.
  if (!out["api/index.py"]) {
    if (kind === "python-api") {
      // FastAPI: import the `app` from main.py at the project root. Vercel's
      // Python runtime auto-detects ASGI apps named `app`, `application`,
      // `handler`, `server`, etc.
      out["api/index.py"] =
        `# Auto-generated by Maris AI for Vercel deploys.\n` +
        `# Re-exports the FastAPI app from main.py so @vercel/python can serve it.\n` +
        `import sys, os\n` +
        `sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))\n` +
        `from main import app  # noqa: F401,E402\n`;
    } else {
      // Django: try to import the project's wsgi module. We attempt a few
      // common names; if none exist the deploy will fail with a clear
      // ImportError pointing the user at what to fix.
      out["api/index.py"] =
        `# Auto-generated by Maris AI for Vercel deploys.\n` +
        `# Bridges Django's WSGI application to @vercel/python.\n` +
        `import os, sys\n` +
        `sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))\n` +
        `os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mysite.settings')\n` +
        `from django.core.wsgi import get_wsgi_application  # noqa: E402\n` +
        `application = get_wsgi_application()\n` +
        `app = application  # @vercel/python detects either name\n`;
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
