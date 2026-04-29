# AppForge

A full-stack SaaS that turns plain-English prompts into ready-to-run web apps using Anthropic Claude. Users get 3 free credits on first sign-in; each generation costs 1 credit. Additional credits are purchased through Stripe-backed packages.

## Stack

- **Frontend (`artifacts/appforge`)**: React + Vite + TailwindCSS, shadcn/ui, wouter routing, Clerk auth, Framer Motion animations. Dark theme with violet/cyan accents.
- **Backend (`artifacts/api-server`)**: Node.js + Express + TypeScript, Drizzle ORM, PostgreSQL, Clerk Express middleware, Anthropic SDK, Stripe SDK.
- **Shared (`lib/`)**:
  - `lib/db` — Drizzle schema and pg pool
  - `lib/api-spec` — OpenAPI 3.1 spec (single source of truth for the contract)
  - `lib/api-zod`, `lib/api-client-react` — generated clients via `pnpm --filter @workspace/api-spec run codegen`
  - `lib/integrations-anthropic-ai` — Anthropic singleton via Replit's AI proxy
  - `lib/integrations-gemini-ai` — Google Gemini singleton via Replit's AI proxy

## Routes

| Method | Path | Notes |
|---|---|---|
| GET | `/api/healthz` | Liveness |
| GET | `/api/me` | Current user profile, provisions on first call |
| GET | `/api/me/stats` | Dashboard counters + recent apps |
| GET | `/api/apps` | List user's generated apps |
| GET | `/api/apps/:id` | Detail (404 if not owner) |
| DELETE | `/api/apps/:id` | Delete (204) |
| POST | `/api/generate` | Costs 1 credit; returns full generated app |
| GET | `/api/billing/packages` | Public list of credit packs |
| POST | `/api/billing/checkout` | Creates Stripe Checkout session (503 if Stripe not configured) |
| GET | `/api/billing/transactions` | User's recent ledger entries |
| POST | `/api/billing/confirm` | Verifies a session after redirect; idempotent |
| POST | `/api/billing/webhook` | Stripe webhook (raw body, mounted before json parser) |
| GET | `/api/admin/overview` | Admin: global counters and revenue |
| GET | `/api/admin/users` | Admin: list users with credits and app counts |
| POST | `/api/admin/users/:id/credits` | Admin: adjust credits (±delta) and write a ledger row |
| GET | `/api/admin/apps` | Admin: list all generated apps with owner email |
| GET | `/api/apps/:id/messages` | Chat history for an app (only the owner) |
| POST | `/api/apps/:id/messages` | Send a refinement message; persists user msg + enqueues edit job atomically |
| POST | `/api/apps/:id/generate-images` | Auth + ownership; replaces Unsplash/picsum placeholders in the bundle with real Nano Banana Pro (`gemini-3-pro-image-preview`) images, persisted in `app_images` |
| GET | `/api/apps/:appId/images/:imageId` | **Public** — serves binary image from `app_images` with `Cache-Control: immutable`; mounted before the auth-gated apps router so Sandpack and `/p/<slug>` deploys both work |

### Admin access

`ADMIN_EMAILS` (env var, comma-separated, case-insensitive) lists addresses recognized as administrators. The `/me` response exposes `isAdmin`, the layout shows an Admin link when true, and `requireAdmin` middleware (in `lib/auth.ts`) gates the `/admin/*` routes returning 403 for everyone else. Auth is fully delegated to Clerk — there is no password storage in this app.

**Admins have unlimited credits.** `POST /generate` skips the credit check, the deduction, and the ledger entry when `isAdminEmail(user.email)` is true. The dashboard, layout badge, and billing page all render `∞` instead of a numeric balance for admins.

### Generation pipeline

`POST /generate` is **asynchronous**. It enqueues a row in `generation_jobs`, kicks off `runJob` via `setImmediate`, and returns the job descriptor with `202 Accepted`. The dashboard then polls `GET /generate/jobs/:id` every 1.5 s to render a live progress bar and phase label until `status` becomes `succeeded` (with `appId`) or `failed` (with `errorMessage`).

**Source language.** Each app is locked at creation to either TypeScript (`.tsx`/`.ts`) or JavaScript (`.jsx`/`.js`) via `generated_apps.language` (default `"typescript"`). The dashboard exposes a dropdown next to the model picker; subsequent edits and healthchecks read the stored value, so the user can't accidentally mix languages mid-app. The coder + patcher + edit prompts in `generate.ts` are builder functions that take the language and emit the corresponding filename/syntax rules.

**Custom CSS.** The frontend system prompt explicitly invites the coder to add `src/styles/<name>.css` files for animations or component-scoped styles when Tailwind isn't enough. The bundle parser already passes `*.css` through to Sandpack (and esbuild treats it as an empty loader during validation), so no infra change was needed.

**Real images (Nano Banana Pro).** Generated apps include placeholder Unsplash URLs by default. The user can hit "Imágenes IA" on the app detail page to call `imageAgent.ts`, which:
1. Scans the frontend bundle for unique `images.unsplash.com` / `picsum.photos` URLs (capped at 4 per call, concurrency 2).
2. For each placeholder, builds a Spanish prompt from nearby `alt=""` text and calls `gemini-3-pro-image-preview` with `responseModalities: [TEXT, IMAGE]`.
3. Stores the b64 payload as a row in `app_images`, then rewrites the bundle so every occurrence of the original URL points at `/api/apps/<appId>/images/<imageId>`.
4. Persists the patched bundle on `generated_apps.frontendCode`.

The serving route is intentionally public (no auth) so embedded `<img>` tags work both inside Sandpack iframes and on the static `/p/<slug>` deploys. Cache headers are immutable since the URL is content-addressed by serial id.

`lib/generate.ts` runs up to two Anthropic calls per request and emits progress callbacks at each stage:
1. **Web research** (`researchTopic`) — only triggered when the prompt contains a clone keyword (e.g. "clon", "como wallapop", or any of the brand names listed in `CLONE_KEYWORDS`). Best-effort with a 30 s timeout, uses the `web_search_20250305` tool with `max_uses: 2`. If the proxy doesn't support tools or the call fails, the brief is empty and generation continues.
2. **Generation** — Claude Sonnet 4.5 with `max_tokens: 16000`, strict-JSON system prompt, and the research brief appended as ground truth. Errors bubble up with the underlying message in Spanish.

Phases reported back to the client: `queued → starting → researching (only for clones) → generating → parsing → ready` (or `failed` at any point).

### Admin credit bypass

Admin email checks happen at job-creation time (the credit gate) **and** after generation completes (the deduction). When `isAdminEmail(user.email)` is true, neither the user balance nor the credit ledger is touched.

## Database

Tables (`lib/db/src/schema/`):

- `users` — id is the Clerk user ID; tracks email, fullName, imageUrl, credits (default 3), stripeCustomerId.
- `generated_apps` — id, userId (FK), title, prompt, description, techStack (jsonb string[]), frontendCode, backendCode, status, createdAt.
- `credit_transactions` — id, userId (FK), kind (`usage` / `purchase` / `bonus`), amount (negative for usage), description, stripeSessionId (nullable, used for idempotency), createdAt.
- `app_messages` — id, appId (FK → generated_apps, cascade), role (`user` / `assistant`), content, createdAt. Backs the chat-driven iterative editor in the workspace.

Run `pnpm --filter @workspace/db run push` after schema changes.

## Auth

Clerk is Replit-managed. The frontend reads `VITE_CLERK_PUBLISHABLE_KEY`, which `vite.config.ts` falls back to from `CLERK_PUBLISHABLE_KEY`. The backend uses `clerkMiddleware` plus a `requireAuth` helper (`artifacts/api-server/src/lib/auth.ts`) that lazily provisions a `users` row from Clerk on first authenticated request and grants 3 starter credits.

## AI generation — multi-agent pipeline

`artifacts/api-server/src/lib/generate.ts` orchestrates a team of specialized AI agents. Models are routed by **role intent** — Anthropic Sonnet for reasoning-heavy planning, Anthropic Haiku for fast structured review/patch passes, and Google Gemini 2.5 Flash for bulk code generation (Gemini Flash benchmarks at ~3× the throughput of Sonnet on long code outputs). Both providers are reached through Replit's AI Integrations proxy — no API key needed.

| Agent | Model | Job |
|---|---|---|
| 🔎 Researcher | `claude-haiku-4-5` + `web_search` | Hard 7s cap. Optional, only fires for clone/reference prompts (`CLONE_KEYWORDS`). |
| 🧠 Architect (Planner) | `claude-sonnet-4-6` | Produces a JSON project plan: pages, components, hooks, utils, data models, file list, `backendNeeded` flag. Receives the research brief when available. **Note**: kept on Sonnet on purpose — Opus is ~2× slower for the same task and the plan is short enough that Sonnet's reasoning is sufficient. |
| 🔌 Integration Architect | `claude-haiku-4-5` | Decides which third-party services the app realistically needs (Clerk, Stripe, OpenAI, S3, Resend, etc.) — returns env vars + setup steps that get appended as `SETUP.md`. Runs **in parallel** with the Designer. |
| 🎨 Designer | `gemini-2.5-flash` | Produces a design system JSON (palette, typography, radius, `tailwindExtend`, `globalCSS`). Falls back to a built-in default if the call flakes. (Was Haiku → Gemini Flash for the fastest JSON emit available.) |
| ⚡ Frontend Engineer (Coder) | `gemini-2.5-flash` default, opt-in `claude-sonnet-4-6` (both streaming) | Generates the full frontend bundle, must implement every file from the plan. Sonnet path uses `anthropic.messages.stream` with `max_tokens: 64000` because non-streaming requests with that token budget time out (>10min). The FRONTEND prompt enforces a HARD BUDGET of ≤90KB total and ~6-8KB per page; the patcher prompt allows up to 110KB so fix passes don't truncate large valid bundles. The autonomous validate-then-patch loop is the safety net for any quality slips. |
| 🔧 Backend Engineer | `claude-sonnet-4-6` | Generates the backend bundle in **parallel** with frontend, only when `plan.backendNeeded === true`. Kept on Sonnet because backend code is short and demands stricter correctness (Express + auth glue). |
| ✅ QA Reviewer | `claude-haiku-4-5` | Returns structured JSON `{ok, issues[]}`. Each issue has `{file, problem, fix}` so the next agent can act on it. Runs **in parallel** with the Test Engineer. |
| 🧪 Test Engineer | `claude-haiku-4-5` | Generates real Vitest unit tests (per component & util), Playwright E2E for `/`, plus `vitest.config.ts` and `playwright.config.ts`. Files land in `tests/` and `e2e/` and are appended to the bundle. Skipped silently if it flakes. |
| 🛠️ Patcher (Debugger) | `claude-haiku-4-5` | Receives an issue list + the current bundle, returns a fully patched bundle. Sanity-rejects patches whose size collapses to <50% of the original. (Was Sonnet → Haiku because the patcher only applies small described diffs to a known bundle, and Haiku is ~3× faster.) |
| 🔍 Validator (in-process, not an LLM) | `esbuild` (`lib/validate.ts`) | Real in-memory build of the bundle, treating npm packages as external. Drives the autonomous loop with **actual** build errors (unresolved imports, syntax, missing files) instead of LLM commentary. |

**Autonomous self-healing loop** (`generate.ts`, Phase 5): after QA + Tests, the pipeline enters a bounded loop of up to **`MAX_ITERATIONS = 4`** cycles of *validate → patch → re-validate*. The Validator runs `esbuild` in-memory against the bundle parsed into a virtual filesystem; any build errors are forwarded to the Patcher as concrete `BuildIssue`s. The loop stops as soon as the build is clean, or when iterations run out (the best bundle so far is shipped with a visible note). On the very first iteration QA's suggestions are merged in alongside build errors so QA-detected problems don't get silently dropped.

Each agent has a hard timeout — tuned for **speed first** since user-perceived latency is the #1 churn driver. Current budget: research 7s, architect 30s, integrations 8s, designer 15s (Gemini Flash JSON), frontend streamed (no hard cap, Gemini Flash with maxOutputTokens 32k), backend 45s, QA 8s, tests 12s, patcher 35s (Haiku 16k tokens). MAX_ITERATIONS in the autonomous loop = 2 (one validate+patch+revalidate). With the Gemini swap on Coder + Designer the worst case dropped further — frontend pass typically completes in ~30-45s vs ~90s on Sonnet. The validator is local and typically runs in <1s per iteration.

Both `frontendCode` and `backendCode` are single strings using `// === FILE: <path> ===` delimiters so the workspace can split them for the live preview. The final `frontendCode` includes (in order): the engineer's bundle (possibly patched across multiple iterations) → the test files → `SETUP.md` if there are external services. The Sandpack preview parser (`artifacts/appforge/src/lib/parseBundle.ts`) explicitly skips `tests/`, `e2e/`, `*.test.*`, `*.spec.*`, `*.md`, and the test config files so tests are visible in the "Frontend" tab without breaking the live preview. The Validator's VFS parser uses the **same skip rules** so it doesn't trip over test/config files either.

Credits are reserved up front in the same transaction as the job row (and the chat message, if applicable), and refunded if generation fails.

### Edit mode

`generateApp` accepts an optional `previous: PreviousApp` parameter. When present, the multi-agent pipeline is bypassed and a single `gemini-2.5-flash` streaming pass receives the full previous bundles + the user's change request. The clone-research step is skipped — we already know what the app is.

## Workspace (chat + live preview)

The app detail page (`artifacts/appforge/src/pages/app-detail.tsx`) is a split workspace:

- **Left panel** — chat history loaded via `useListAppMessages`, plus a textarea wired to `useSendAppMessage`. While a job is in flight the input is disabled and a phase/progress indicator is shown.
- **Right panel** — tabs for `Preview en vivo`, `Frontend`, and `Backend`. The preview embeds `@codesandbox/sandpack-react` (`react-ts` template, light theme, 500 ms recompile delay). `lib/parseBundle.ts` splits the `// === FILE: ... ===` bundle, normalizes `src/*` → `/*`, drops build configs, promotes a generated `main.tsx` to `/index.tsx` (or installs a fallback wrapper), preserves the generated `index.css`, and always overrides `/public/index.html` to inject Tailwind via CDN (Sandpack cannot run a real postcss build).

`POST /apps/:id/messages` is concurrency-safe: it rejects with `409` if there is already a `queued`/`running` job for that app, and the chat message + credit reservation + job creation happen in a single DB transaction so a failure rolls everything back. The edit-finalization transaction throws `APP_NO_LONGER_AVAILABLE` (handled by the existing failure/refund path) if the app was deleted between enqueue and completion.

## Stripe

Stripe is **optional**. Without `STRIPE_SECRET_KEY`, `/billing/checkout` and `/billing/confirm` return `503` with a friendly message and `/billing/webhook` no-ops. The three packages (`starter`, `pro`, `studio`) are defined in `artifacts/api-server/src/lib/stripe.ts` and use their package id as the `priceId` field. To enable purchases, add `STRIPE_SECRET_KEY` (and optionally `STRIPE_WEBHOOK_SECRET`) — no code changes needed.

## Important commands

- `pnpm run typecheck` — full type safety check (libs first, then leaf packages)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks/zod after editing `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` — apply schema changes to PostgreSQL

## Recent decisions

- OpenAPI is the source of truth; frontend uses generated React Query hooks from `@workspace/api-client-react`. Backend returns plain JSON shaped to match the OpenAPI schemas (no zod parsing on the server side to avoid orval's operation-derived schema name confusion).
- The `priceId` field in `CreditPackage` is intentionally the internal package id, so the frontend can request checkout without knowing real Stripe price IDs.
- The live preview uses Sandpack instead of a real container/sandbox: it's instant, has no per-app cost, and runs entirely client-side. Tradeoff: only the frontend executes; backend code is shown read-only. A real execution sandbox is a future phase.

## Per-app actions (Apr 2026)

Each generated app exposes 5 actions from the detail page header:

1. **Modelo (selector)** — `PATCH /apps/:id/model` swaps the coder model used for subsequent edits. Allowed values: `auto` (= Gemini 2.5 Flash), `gemini-2.5-flash`, `claude-sonnet-4-6`. The dashboard generator has the same selector and persists the choice on the new app row (`generated_apps.coder_model`).
2. **ZIP** — `GET /apps/:id/export` streams a ZIP via `archiver` containing the parsed frontend files, backend file, and a README with the original prompt + tech stack.
3. **Chequeo** — `POST /apps/:id/healthcheck`: re-runs `validateBundle`; if it fails, runs one round of `patchBundle` (Claude Haiku, exported from `lib/generate.ts`) and persists the patched bundle if strictly better.
4. **Publicar / Pública** — `POST /apps/:id/deploy` assigns a CSPRNG slug (`makeSlug`, 10 chars `[a-z0-9]`) on `generated_apps.public_slug` (5 collision retries) and returns the public URL. Once published the button becomes a link to `/p/<slug>`.
5. **GitHub / Repo** — `POST /apps/:id/github` uses the Replit GitHub connector (`@replit/connectors-sdk`) to create a fresh repo (`appforge-<title>-<rand>`) and push the bundle via the blobs/trees/commits API. The repo URL is stored on `generated_apps.github_repo_url`.

### Public deploy isolation (`/p/:slug`)

- Mounted at the application root (NOT under `/api`) by `routes/publicDeploy.ts`. The path `/p` is registered in `artifact.toml` so the proxy routes it to the API server.
- **Security boundary**: the deployed app is untrusted, AI-generated JavaScript hosted on the same domain as our authenticated `/api` routes. To prevent session-token theft, the route serves a tiny wrapper HTML containing `<iframe sandbox="allow-scripts" srcdoc="...escaped inner HTML...">`. Without `allow-same-origin`, the iframe gets an opaque origin: no access to AppForge cookies/localStorage, and same-origin fetches are not credentialed. Wrapper response also sends `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy` headers as defense-in-depth.
- The HTML is rebuilt on every request (no DB cache) by `lib/deployBundle.ts` — it parses the bundle, picks an entry (`src/main.tsx` / `index.tsx` / `App.tsx`), runs an in-memory esbuild with a virtual filesystem plugin (entry-point kind handled explicitly to avoid silent externalization), externalizes bare imports into an esm.sh import map, and wraps with Tailwind CDN. ~50–200 ms per visit.
- Slug input is strictly validated against `SLUG_PATTERN = /^[a-z0-9]{10}$/` before any DB lookup.
- `esbuild` is marked external in `artifacts/api-server/build.mjs` so its native binary lookup works at runtime.

### Notes on what was rejected

The user explicitly rejected: MongoDB, Socket.io, per-agent credit pricing, Opus for the Architect role, server-side `npm install`/`npm start` of the generated apps. CSRF middleware on `/api` was deferred — Clerk's default `SameSite=Lax` cookies prevent the sandboxed iframe from sending credentials cross-origin, and adding CSRF tokens is outside the accepted feature scope.

## Generated-app quality fixes (Apr 2026)

Three real bugs reported by users were addressed:

1. **Generated UI was sometimes English** — coder prompts now have an explicit `LANGUAGE` block requiring all user-visible copy in Spanish (es-ES). Identifiers stay English. Applied to `FRONTEND_SYSTEM_PROMPT`, `EDIT_SYSTEM_PROMPT`, and `PATCHER_SYSTEM_PROMPT`.

2. **Bundles shipped with syntax errors** (`,,` double-commas, garbage tokens like `née`, unterminated strings) — root cause: edit mode bypassed the validate→patch loop entirely. Fix: extracted the loop into `runValidatePatchLoop(initialBundle, qaReport, onProgress, baseProgressStart)` in `lib/generate.ts` and call it from both initial generation AND edit mode. Loop is bounded (`MAX_ITERATIONS=2`) with stagnation guard. Also added explicit `SYNTAX` rules to the three coder prompts forbidding the observed failure patterns.

3. **`wouter` and other common packages failed to resolve in the Sandpack preview** — Sandpack starts from the `react-ts` template which only ships react/react-dom. Fix: `parseBundle.ts` now exports a `SANDPACK_DEPENDENCIES` map (wouter, lucide-react, clsx, tailwind-merge, date-fns, zod) which `app-detail.tsx` passes to `SandpackProvider.customSetup.dependencies`. The list mirrors the packages the coder prompt allows.
4. **Generated bundles silently rendered only the navbar** — root cause: the LLM emitted wouter v2 syntax `<Link href="…"><a className="…">…</a></Link>`. With wouter v3 (which is what the preview ships), `<Link>` itself is the anchor, so the markup becomes `<a><a>…</a></a>`. React 18 throws `Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.` during reconciliation and the whole `<main>` subtree disappears. esbuild's static check passes (the JSX is valid), so the auto-patcher loop never noticed. Two-part fix:
    - The frontend coder prompt, the patcher prompt, and the edit prompt now carry a dedicated `WOUTER v3` rule with WRONG/RIGHT examples telling the model to flatten `className`/`onClick`/`aria-*` directly onto `<Link>`.
    - `validate.ts` now runs `detectWouterAnchorNesting(vfs)` after esbuild and emits a `BuildIssue` (file + line) for every `<Link …>… <a` it finds, gated by a negative lookahead for `</Link>` so siblings don't false-positive. The issues feed straight into the existing `patchBundle` loop, so any new generation that slips through gets auto-flattened before the user sees it.
