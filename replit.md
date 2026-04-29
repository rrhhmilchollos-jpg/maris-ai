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
- DB migration artifacts live in `lib/db/drizzle/` (generated via `pnpm --filter @workspace/db exec drizzle-kit generate`). The `0000_rich_unus.sql` migration captures the full current schema including the `generation_jobs` columns added for the queue (`editAppId`, `coderModel`, `language`, `attachmentIds`, `isAdmin`, `retryCount`, `workerId`). Day-to-day deploys still use `pnpm --filter @workspace/db run push`; the migrations folder is a snapshot trail for review and disaster recovery.

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