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

### Admin access

`ADMIN_EMAILS` (env var, comma-separated, case-insensitive) lists addresses recognized as administrators. The `/me` response exposes `isAdmin`, the layout shows an Admin link when true, and `requireAdmin` middleware (in `lib/auth.ts`) gates the `/admin/*` routes returning 403 for everyone else. Auth is fully delegated to Clerk — there is no password storage in this app.

**Admins have unlimited credits.** `POST /generate` skips the credit check, the deduction, and the ledger entry when `isAdminEmail(user.email)` is true. The dashboard, layout badge, and billing page all render `∞` instead of a numeric balance for admins.

### Generation pipeline

`POST /generate` is **asynchronous**. It enqueues a row in `generation_jobs`, kicks off `runJob` via `setImmediate`, and returns the job descriptor with `202 Accepted`. The dashboard then polls `GET /generate/jobs/:id` every 1.5 s to render a live progress bar and phase label until `status` becomes `succeeded` (with `appId`) or `failed` (with `errorMessage`).

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

## AI generation

`artifacts/api-server/src/lib/generate.ts` calls `claude-sonnet-4-6` (with `claude-haiku-4-5` for the optional clone-research step) using a strict JSON-only system prompt that returns `{ title, description, techStack[], frontendCode, backendCode }`. Both code fields are single strings using `// === FILE: <path> ===` delimiters so the frontend can render and split as needed. Credits are reserved up front in the same transaction as the job row (and the chat message, if applicable), and refunded if generation fails.

`generateApp` accepts an optional `previous: PreviousApp` parameter. When present, the system prompt switches to **edit mode**: the model receives the previous title/description/techStack and full frontend+backend bundles and is asked to produce a complete, updated bundle that applies the requested change. The clone-research step is skipped in edit mode.

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
