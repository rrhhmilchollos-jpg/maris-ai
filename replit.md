# AppForge

## Overview

AppForge is a full-stack SaaS platform that converts natural language prompts into functional web applications using AI. It aims to democratize web development by providing intuitive AI-powered tools for rapid prototyping and deployment, serving individual developers and small businesses. The platform operates on a credit-based system, offering free trials and paid credit packages for app generation.

## User Preferences

- I prefer a dark theme with violet/cyan accents for the UI.
- The UI should incorporate shadcn/ui components and Framer Motion animations for a modern and fluid user experience.
- The system should prioritize Spanish for all user-visible copy in generated applications, while keeping identifiers in English.
- I expect the AI to automatically include a backend when generating apps for marketplace, e-commerce, social, or SaaS platforms.
- I prefer that there are no strict size limits imposed on generated frontend bundles, acknowledging that larger apps may consume more credits.
- I prefer that generated bundles do not silently drop custom CSS files and that the preview accurately reflects all styles.

## System Architecture

AppForge features a React frontend, a Node.js/Express backend, and shared libraries, designed for asynchronous, multi-agent AI-driven application generation.

**Frontend**:
- Built with React, Vite, and TailwindCSS, utilizing `shadcn/ui` and `wouter` for routing.
- Employs Clerk for authentication and Framer Motion for animations.
- Features a dark theme with violet and cyan accents.
- The workspace includes a split panel for chat and a live preview powered by `@codesandbox/sandpack-react` for dynamic code display.
- Supports file attachments (images, PDFs, text, Markdown, CSV, JSON) in chat prompts for AI context.
- Implements a Visual Testing Agent for server-side UI testing and auto-correction across multiple viewports, with a feedback loop for code patching.
- Includes a Post-failure Diagnostic Agent to provide actionable insights for failed generation jobs.
- Provides various project type tabs on the dashboard (e.g., fullstack, mobile-first PWA, landing page, 2D/3D game, hybrid PWA), each influencing AI generation with specific intents and credit costs.
- Displays live, streaming agent logs during generation for real-time progress updates.

**Backend**:
- Developed with Node.js, Express, and TypeScript.
- Uses Drizzle ORM for PostgreSQL and Clerk Express middleware for user management.
- Integrates Anthropic and Stripe SDKs for AI generation and billing.
- Defined by an OpenAPI 3.1 specification for API contracts.
- Features an admin interface and supports user-owned backend code visibility.

**Multi-Agent AI Pipeline**:
- An asynchronous pipeline orchestrated by `lib/generate.ts`, utilizing various AI models (Anthropic Claude, Google Gemini, GPT-5 Codex) for roles like Researcher, Architect, Coder, and QA.
- Includes an autonomous self-healing loop with `esbuild` for validation and patching.
- Supports iterative editing and provides real-time progress updates.

**Persistent Job Queue**:
- Generation jobs are dispatched through `pg-boss` (Postgres-backed queue, no Redis required), wired up in `artifacts/api-server/src/lib/jobQueue.ts`. The queue boots in `index.ts` BEFORE orphan reclaim and the in-process worker is registered there.
- The HTTP enqueue path (`POST /generate`) inserts the row into `generation_jobs` and then sends `{jobId}` to pg-boss; the worker reloads everything else from the row, keeping the queue payload tiny.
- Worker concurrency is bounded via `JOB_CONCURRENCY` (default 3, hard cap 10). Retries: 2 with exponential backoff, 25-minute expiry per attempt.
- Boot reconciliation (`reclaimOrphanedJobs`) re-enqueues `queued` rows (singletonKey dedupes if pg-boss already has them) and only fails `running` rows older than 15 minutes — the rest are assumed live.
- Admin "Cola" tab (`/admin`, `GET /admin/jobs`) shows queued/running/failed-24h/succeeded-24h counters and the last 100 jobs with a manual `Reintentar` action (`POST /admin/jobs/:id/retry`) for failed or stale jobs.
- Schema additions on `generation_jobs`: `editAppId`, `coderModel`, `language`, `attachmentIds`, `isAdmin`, `retryCount`, `workerId`. The worker rehydrates the runJob signature from these columns.
- Manual retry (`POST /admin/jobs/:id/retry`) is concurrency-safe and rollback-safe: a single `UPDATE ... WHERE id=? AND status=?` guarded by the snapshotted status closes the TOCTOU window between the SELECT and UPDATE — two concurrent retries for the same row result in exactly one effective transition (the loser gets 0 rows and 409). After the guarded UPDATE, the queue send is attempted; if it throws, the prior state is restored. The `updatedAt` field is deliberately NOT part of the guard because Postgres microsecond precision vs node-pg millisecond Date objects could cause both updates to miss.
- Worker contract: pg-boss `work()` is registered with `includeMetadata: true` so each job exposes `retryCount` (camelCase in v12; we also accept legacy lowercase `retrycount`). The worker computes `attempt = retryCount + 1` and passes `{attempt, maxAttempts}` to `runJob`. On non-final attempts a thrown error is rethrown so pg-boss schedules the next attempt; on the final attempt the row is finalised (`failed`, refund, chat message) and the throw is absorbed — UNLESS the terminal DB write itself fails, in which case `runJob` rethrows so pg-boss records the job as failed instead of silently succeeding (the stale-running reclaim then catches the row).
- Restart + retry resilience is verified by `pnpm --filter @workspace/api-server run test:queue` (script: `artifacts/api-server/src/__tests__/queue-recovery.test.ts`). Run against a dedicated `appforge.generate-app.test` queue (set `GENERATE_QUEUE_NAME` env, required when the api-server workflow is also running). Last run: all 8 scenarios PASSED — (1) happy path, (2) restart resilience (enqueue→stop→start→pickup), (3) orphan reclaim of `queued` rows, (4) stale `running` rows >15min marked `failed`, (5) flaky handler succeeds on retry (attempts=[1,2], succeeds on 2), (6) retry exhaustion finalises row exactly once (attempts=[1,2,3], status=failed, retryCount=3), (7) handler throws on every attempt → never silently flips to succeeded (simulates final-attempt finalise failure), (8) concurrent admin retry → exactly one effective state transition (winners=1, losers=1).
- Queue-position observability: at enqueue time a `job_logs` line ("Tu solicitud está en cola en posición #N") is written so the streaming dashboard log shows where the user sits. `GET /generate/jobs/:id` also returns `queuePosition: number | null` (null once the job leaves `queued`). Position is derived as `1 + count(generation_jobs WHERE status='queued' AND id < :id)` — id-ordered FIFO matches pg-boss's default dispatch order.
- DB migration artifacts live in `lib/db/drizzle/` (generated via `pnpm --filter @workspace/db exec drizzle-kit generate`). The `0000_rich_unus.sql` migration captures the full current schema including the `generation_jobs` columns added for the queue (`editAppId`, `coderModel`, `language`, `attachmentIds`, `isAdmin`, `retryCount`, `workerId`). Day-to-day deploys still use `pnpm --filter @workspace/db run push`; the migrations folder is a snapshot trail for review and disaster recovery. **Operational note:** treat `0000_rich_unus.sql` as a **baseline-only** migration — it's a `CREATE TABLE IF NOT EXISTS` snapshot of the schema at the moment the queue work was merged. Do NOT run it against an existing populated database via a migration runner; it would either no-op (correct path) or, if the runner is strict-mode, conflict with already-existing tables. Future schema changes should be additive `0001_*`, `0002_*`, etc., generated incrementally.
- Queue health is exposed at `GET /api/healthz`: `{"status":"ok","queue":"ready"|"degraded"}`. `degraded` means pg-boss failed to start and the API is running with the in-process `setImmediate` fallback (no restart resilience for in-flight jobs). Singleton dedupe horizon for `enqueueGenerateJob` is 24h (was 1h in the initial draft) so a backlog older than 1h still dedupes correctly across restarts.

## Planner inteligente y memoria de errores (Task #10)

- `agent_memory` table (`lib/db/src/schema/agentMemory.ts`) stores successful patches indexed by a 1536-d pgvector embedding of the triggering error message. HNSW index on `vector_cosine_ops`. The pgvector extension is enabled in the Neon DB (one-shot `CREATE EXTENSION IF NOT EXISTS vector`).
- `artifacts/api-server/src/lib/agentMemory.ts` exposes `embedText`, `recallSimilar(error, {limit, threshold, language})`, `rememberPatch({errorMessage, patch, ...})`, and `buildRecallExamplesBlock(matches)` (Spanish FAILED-FIXES MEMORY block fed to the patcher). Embeddings try OpenAI `text-embedding-3-small` first; if the integrations proxy doesn't expose embeddings (current state — falls through with HTTP 401), it falls back to a deterministic FNV-1a-based lexical hash that produces a normalised 1536-d vector. Per-process LRU cache (500 entries) avoids re-hashing identical inputs.
- `artifacts/api-server/src/lib/planner.ts` runs a small Gemini-2.5-flash classifier (8s timeout) that decides one of three scopes: `fast-patch` (cosmetic / one-line edit on existing app), `feature` (new screen/component on existing app), or `full-build` (new app from scratch). A regex-based heuristic always provides a fallback. Output is the array of pipeline phases to execute.
- `generateApp` in `generate.ts` calls the planner FIRST for every request (new app or edit), before any branching. Emits `🧭 Plan: …` to the agent log. If scope is `fast-patch` (existing app only), it routes to `fastPatchEdit()` which bypasses singleEditPass and asks the patcher (claude-haiku-4-5) to apply the user's request directly to the bundle, then runs one validate pass. Saves ~60-90s on cosmetic edits. If the fast path returns nothing or fails validation it falls back to the full edit flow.
- For NEW-app generation, every optional phase is gated by `execPlan.phases.includes(...)`: research, design, integration, backend, qa, tests, validate, patch. Skipped phases get sensible defaults: a complete `FALLBACK_DESIGN` (theme/palette/typography/radius/tailwindExtend/globalCSS), empty `integrationSpec` (`{ services: [], envVars: [] }`), empty `QAReport` (`{ ok: true, issues: [] }`), `null` testCode, and `runValidatePatchLoop` accepts a `phaseGates: { validate, patch }` arg that short-circuits validation entirely (with a warn log) or skips parcheo while still surfacing build errors. Frontend is the one mandatory phase — the dispatcher throws with a Spanish error if a future scope drops it. This keeps `full-build` (today's only new-app scope) behaviorally identical while making `ExecutionPlan.phases` the full dispatcher contract.
- pgvector extension is now codified: `artifacts/api-server/src/index.ts` runs `ensurePgVector()` (a best-effort `CREATE EXTENSION IF NOT EXISTS vector`) on every server boot before the queue starts. Idempotent, runs in <50ms on Neon, logs `pgvector extension ensured` on success and a single error line on failure (without crashing the server).
- `/admin/memory` accepts `q` (case-insensitive ILIKE on `errorMessage` OR `patch`, parameterised via Drizzle `sql`) + `offset`/`limit` for pagination, returns `{ total, limit, offset, q, entries[] }`. Admin UI tab "Memoria" has a search form (Buscar/Limpiar) and prev/next paginator (25 entries/page) with "Mostrando X–Y de Z" counter.
- Memory is integrated into `runValidatePatchLoop`: before each patch attempt the loop calls `recallSimilar(primaryError)` and prepends a `FAILED-FIXES MEMORY` block to the patcher prompt. After the loop converges (validation OK), the last `(errorMessage, patchedBundle)` pair is persisted via `rememberPatch`. Near-duplicates (cosine sim > 0.92) bump `successCount` instead of inserting a new row. `fastPatchEdit` does the same with the user prompt as the semantic key.
- Admin UI: new "Memoria" tab in `/admin` (also reachable directly at `/admin/memory`) lists the stored patches with successCount, language, last-used timestamp, and a collapsible patch preview; a per-row delete button calls `DELETE /api/admin/memory/:id`. Endpoints live in `artifacts/api-server/src/routes/admin.ts`.
- Test: `tsx artifacts/api-server/src/__tests__/agent-memory.test.ts` — 24 checks across embedding shape/determinism, remember+recall round-trip, near-duplicate dedup via successCount, recall block formatting, planner heuristics for the three scopes, behavioral convergence on a repeated similar error (cold→empty block, save fix, warm→block contains saved fix with sim ≥ 0.85), and assertions that the planner's exported PLAN_FAST_PATCH/PLAN_FEATURE/PLAN_FULL constants expose the phases array shape consumed by the dispatcher in generate.ts. Self-cleans inserted rows. Latest run: 24/24 PASS (with expected `OpenAI embeddings unavailable; falling back to lexical hashing` warn confirming the fallback path).

**Database and Authentication**:
- PostgreSQL is used with a schema including `users`, `generated_apps`, `credit_transactions`, `app_messages`, and `job_logs`.
- Authentication is handled by Clerk, with middleware for user provisioning and credit management.
- Admin access is controlled via environment variables.

**Deployment and Actions**:
- Generated apps can be publicly deployed with unique slugs (isolated via iframes), exported as ZIP files, pushed to GitHub, and forked.
- Public deploy architecture (`/p/:slug`): a tiny outer wrapper page renders a `sandbox="allow-scripts"` iframe whose `src="/p/:slug/_inner"` serves the bundled user app. Sandbox without `allow-same-origin` keeps the iframe at an opaque origin, so untrusted user code cannot read AppForge cookies/sessions. The inner endpoint sends a defense-in-depth CSP. A routing shim injected before the user bundle runs `history.replaceState('/')` so SPA routers (wouter/react-router) match the home route — using `srcdoc` previously caused `location.pathname` to return `"srcdoc"`, leaving the page blank between header and footer.
- `backendCode` is explicitly included in the edit prompt context for AI to modify backend aspects.

## External Dependencies

- **Clerk**: User authentication and management.
- **Anthropic Claude**: AI models (`claude-sonnet-4-6`, `claude-haiku-4-5`).
- **Google Gemini**: AI models (`gemini-2.5-flash`, `gemini-3-pro-image-preview`).
- **GPT-5 Codex**: Advanced AI model.
- **Stripe**: Payment processing. Credentials are pulled from the Replit Stripe connector (no manual `STRIPE_SECRET_KEY`); the dev/prod connection is selected by `REPLIT_DEPLOYMENT`. Webhook secret remains as the env var `STRIPE_WEBHOOK_SECRET`. Credit packages (Starter/Pro/Studio) are priced in EUR with Spanish copy; Stripe Checkout is opened with `locale: "es"`. The dashboard's Annual upsell remains in USD per scope. Cancel URL `/billing?canceled=1` shows a Spanish "Pago cancelado" banner.
- **PostgreSQL**: Primary database.
- **@codesandbox/sandpack-react**: Frontend live preview.
- **Replit AI Integrations Proxy**: Access to AI models.
- **Replit GitHub Connector (@replit/connectors-sdk)**: GitHub repository integration.
- **esbuild**: Bundle validation and processing.
- **archiver**: ZIP file export.
- **OpenAPI 3.1**: API specification.

## Evaluador autónomo + Auto-publicar (Task #11)

- Nuevo agente "Visual Evaluator" en `artifacts/api-server/src/lib/evaluator.ts`. Funciona como segunda etapa después del Visual Tester: cuando el tester termina, `runAutoEvaluator` toma screenshots con Puppeteer (reutilizando `takeScreenshots` exportado desde `visualTester.ts`) y pide a Claude Sonnet 4.6 con visión un veredicto estricto `pass | fail` comparando lo renderizado contra el prompt original Y las pantallas declaradas por el Arquitecto.
- Bucle de retry máximo: 1 evaluación inicial + hasta 2 rondas con patcher = 3 visitas en total. Cada ronda reusa `patchBundle`, valida con `validateBundle` y persiste con concurrencia optimista (`UPDATE ... WHERE frontendCode = previousBundle`) — si el bundle cambió mientras tanto (por ejemplo un edit del usuario en chat) el evaluador se rinde.
- Si el evaluador aprueba y la app tiene `autoPublish=true`, se asegura un slug, se inserta un mensaje 🚀 en el chat con la URL pública y se llama a `sendAutoPublishEmail`. Si rechaza, marca `status="needs_review"`, escribe `evaluatorSummary` (resumen + top 5 issues) y manda `sendNeedsReviewEmail`.
- Schema: `generated_apps.autoPublish` (boolean default false) y `generated_apps.evaluatorSummary` (text nullable). `serializeApp` los incluye, OpenAPI los expone en `GeneratedApp`. Sincronizado vía `pnpm --filter @workspace/db run push --force`.
- Endpoints nuevos:
  - `PATCH /apps/:id/auto-publish` — `{ autoPublish: boolean }`. UI: botón "Auto-publicar: ON/OFF" junto a "Publicar" en el panel de la app.
  - `POST /apps/:id/retry-generation` — sólo válido cuando `status === "needs_review"`. Reusa `enqueueGeneration` con un prompt que combina la intención original + el `evaluatorSummary` para que el siguiente intento converja. Limpia `needs_review` y `evaluatorSummary` antes de encolar.
- UI: panel rojo encima del split chat/preview cuando `status === "needs_review"`, muestra `evaluatorSummary` y un botón "Reintentar generación" cableado al endpoint anterior.
- Notificaciones (pendiente de email provider): `artifacts/api-server/src/lib/notify.ts` exporta `sendAutoPublishEmail` y `sendNeedsReviewEmail`. **No hay proveedor de email configurado todavía** (ni Resend ni SendGrid ni SES). Por ahora ambas funciones loguean un payload estructurado con `msg: "📬 email_pending"` que un pipeline externo o Loki puede recoger fácilmente. Cuando se añada el proveedor real, basta con sustituir el cuerpo de `emit()` y todo lo demás (asunto, cuerpo en castellano, fallbacks de saludo) ya está listo.
- Robustez: si Chromium no está instalado el evaluador se salta limpiamente y devuelve `pass` (no penaliza al usuario por un problema de entorno). Excepciones del evaluador o del patcher se tratan como `fail` en esa ronda y nunca tumban la generación principal — el `setImmediate(...).catch(...)` en `apps.ts` garantiza que cualquier explosión queda en logs.
- Tests: `artifacts/api-server/src/__tests__/evaluator.test.ts` cubre `normalizeVerdict` (acepta `pass`/`PASS`/`{pass:true}`, fuerza `fail` cuando hay critical issue aunque el modelo diga `pass`, normaliza severities desconocidas) y `formatIssuesForPatcher` (descarta `minor`, cap a 6, sintetiza `fix` cuando viene vacío). Comando: `pnpm --filter @workspace/api-server run test:evaluator`.