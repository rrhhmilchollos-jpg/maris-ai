# AppForge

## Overview

AppForge is a full-stack SaaS platform designed to transform natural language prompts into functional web applications. Leveraging advanced AI models, it offers users the ability to generate ready-to-run web apps, significantly accelerating the development process. The platform supports a credit-based system for app generation, with options for free trials and paid credit packages. Its core vision is to democratize web development by making it accessible through intuitive AI-powered tools, targeting both individual developers and small businesses seeking rapid prototyping and deployment solutions.

## User Preferences

- I prefer a dark theme with violet/cyan accents for the UI.
- The UI should incorporate shadcn/ui components and Framer Motion animations for a modern and fluid user experience.
- The system should prioritize Spanish for all user-visible copy in generated applications, while keeping identifiers in English.
- I expect the AI to automatically include a backend when generating apps for marketplace, e-commerce, social, or SaaS platforms.
- I prefer that there are no strict size limits imposed on generated frontend bundles, acknowledging that larger apps may consume more credits.
- I prefer that generated bundles do not silently drop custom CSS files and that the preview accurately reflects all styles.

## System Architecture

The AppForge system is composed of a React-based frontend, a Node.js/Express backend, and shared libraries.

**Frontend (`artifacts/appforge`)**:
- Built with React, Vite, and TailwindCSS.
- Utilizes `shadcn/ui` for UI components and `wouter` for routing.
- Implements Clerk for user authentication and Framer Motion for animations.
- Features a dark theme with violet and cyan accents.
- The workspace includes a split panel for chat interaction and a live preview powered by `@codesandbox/sandpack-react`, which dynamically parses and displays generated frontend code. `wouter` is shipped as a real Sandpack dependency pinned to `^2.12.1` (CommonJS) — wouter v3 is pure ESM and Sandpack v2's bundler hangs on it indefinitely.
- Generated applications include placeholder images, which can be replaced with AI-generated images via the Nano Banana Pro feature.
- A Visual Testing Agent ("Análisis Visual" button on the app detail page) takes server-side screenshots of the deployed `/p/<slug>` URL at three viewports (desktop / tablet / mobile) using headless Chromium (Nix `chromium` package, resolved via `which chromium`), sends them to Claude Sonnet 4.6 vision for scoring, and runs an auto-fix loop (up to 3 cycles) that rewrites the bundle and persists the patched code. It also runs automatically in the background after every successful generation. Costs 30 credits per run (admins exempt). On failure the agent **refunds the silent charge** in both modes. Patched bundles are validated through esbuild (`validateBundle`) before being persisted, and the UPDATE uses an optimistic-concurrency check on the previous `frontendCode` so concurrent chat edits are never clobbered.
- Post-failure Diagnostic Agent: when any generation/edit job throws, after refunding the credit the server kicks off a free `diagnoseFailedAgent` background task. If the app already has a `publicSlug`, it runs the Visual Testing Agent in read-only mode (no auto-fix) against the live deploy; otherwise it runs the static esbuild health check on the last good bundle. Findings are posted as a single assistant chat message so the user gets actionable diagnostics instead of a blank failure.

**Backend (`artifacts/api-server`)**:
- Developed with Node.js, Express, and TypeScript.
- Uses Drizzle ORM for PostgreSQL database interactions.
- Integrates Clerk Express middleware for authentication and user management.
- Incorporates Anthropic and Stripe SDKs for AI generation and billing.
- Designed with an OpenAPI 3.1 specification as the single source of truth for API contracts.
- Features an admin interface for managing users, credits, and generated applications.

**Shared Libraries (`lib/`)**:
- `lib/db`: Drizzle schema and PostgreSQL connection pool.
- `lib/api-spec`: OpenAPI 3.1 specification.
- `lib/api-zod`, `lib/api-client-react`: Generated clients for API interaction.
- `lib/integrations-anthropic-ai`, `lib/integrations-gemini-ai`: Singletons for AI model access via Replit's AI proxy.

**Multi-Agent AI Pipeline**:
- The core of the application generation is an asynchronous, multi-agent AI pipeline orchestrated by `lib/generate.ts`.
- Different AI models (Anthropic Claude Sonnet/Haiku, Google Gemini Flash, GPT-5 Codex) are assigned specific roles based on their strengths (e.g., Researcher, Architect, Coder, QA Reviewer, Patcher).
- The pipeline includes an autonomous self-healing loop with a validator (`esbuild`) and a patcher to automatically correct build errors and improve code quality.
- Generation is asynchronous, providing real-time progress updates to the user.
- Supports iterative editing with a dedicated edit mode that utilizes a single AI pass.
- Generated applications are locked to either TypeScript or JavaScript.

**Database Schema**:
- `users`: Stores user information, Clerk ID, email, and credit balance.
- `generated_apps`: Stores details of generated applications, including code, prompt, and status.
- `credit_transactions`: Logs credit usage and purchases.
- `app_messages`: Stores chat history for iterative app refinement.

**Authentication**:
- Fully delegated to Clerk, with backend middleware provisioning user profiles and initial credits on the first authenticated request.
- Admin access is controlled via an `ADMIN_EMAILS` environment variable, granting unlimited credits and access to administrative routes.

**Deployment and Actions**:
- Each app provides actions like model selection for edits, ZIP export, health checks, public deployment with a unique slug, GitHub repository creation, and **forking** (free clone of an app to a new copy owned by the same user, blocked while a generation/edit job is in flight or when the source is not in `ready` status — `POST /apps/:id/fork`).
- Public deployments (`/p/:slug`) are isolated within an iframe with strict security policies to prevent cross-origin attacks.
- The Backend code tab is visible to **owners** of an app (not just admins) — `GET /apps/:id` already gates by ownership, so any user reaching the page is allowed to see their own server code.
- The chat input on the app detail page shows an inline **out-of-credits banner** with a CTA to /billing when `stats.credits <= 0`, so users discover the need to top up before pressing send.
- The dashboard "Apps recientes" list has a **Todas / Desplegadas** chip filter (pure client-side, filters on `publicSlug`).

**Visual Testing Agent — Full Loop**:
- Auto-runs after BOTH initial generation and edits via `autoRunVisualTester` (background `setImmediate` after the finalisation transaction commits in `runJob`).
- Costs 30 credits per run, charged silently (refunded if the run errors out). Skipped when the user has 0 credits available.
- Up to `MAX_FIX_CYCLES=3` patch cycles per run; each patched bundle is validated via in-memory esbuild before persisting (optimistic concurrency to avoid clobbering chat edits).
- After completion, posts an assistant message to the app's chat history summarising the outcome (score, cycles, fixes applied, top issues, summary). This makes the agent's work visible to the user — without it, the 30-credit charge looks invisible.
- The architect prompt (`PLAN_SYSTEM_PROMPT`) understands `[INTENT: …]` hints prefixed by the dashboard's project-type tabs (mobile-first PWA / landing page / fullstack) and biases the plan accordingly.

**Project Type Tabs (Dashboard)**:
- 6 chips above the prompt textarea on `/dashboard`, each with a credit-cost badge:
  - **App completa** (`fullstack`, 1cr) — default. Standard fullstack/SaaS-style web app.
  - **App móvil** (`mobile`, 2cr) — mobile-first PWA, single-column, 44px tap targets, bottom nav.
  - **Landing page** (`landing`, 1cr) — single-page marketing site, `backendNeeded=false`.
  - **Juego 2D** (`game-2d`, 3cr) — single-page HTML5 Canvas game with game loop, controls, score, state machine.
  - **Juego 3D** (`game-3d`, 5cr) — single-page Three.js + react-three-fiber game, scene/camera/lights, useFrame loop.
  - **App híbrida (PWA)** (`hybrid-pwa`, 3cr) — installable PWA with `manifest.webmanifest`, service worker (offline-first), `beforeinstallprompt` UI.
- Each chip changes the textarea placeholder. On submit the dashboard sends a `kind` field (validated against the `ALLOWED_KINDS` whitelist on the server); the **server** is authoritative for both:
  - **Cost** — `KIND_COSTS` in `apps.ts`. Reservation, deduction, ledger insert, and refund all use the same `cost` value (transactional UPDATE includes `WHERE credits >= cost` for race-safety; failed-job and orphan-reclaim refunds look up the actual reservation amount, never falling back to a hardcoded 1).
  - **`[INTENT: …]` directive** — `KIND_INTENTS` in `apps.ts`. Prepended to the user prompt before the architect sees it (clients can't bypass by sending raw text). The architect's `PLAN_SYSTEM_PROMPT` has a matching `INTENT HINTS` section that tells it: backend-needed override, required components, hooks, techStack entries (HTML5 Canvas / pixi.js / three / @react-three/fiber / drei / Service Worker / PWA), and single-page game enforcement.
- Edits (chat messages on `/app/:id`) ignore `kind` entirely — they always cost 1 credit and inherit the existing app's characteristics from its stored `frontendCode`.
- Implemented as `role="group"` with `aria-pressed` toggle buttons + `flex-wrap` for narrow viewports (matching the existing Todas/Desplegadas filter pattern); not WAI-ARIA tabs to avoid needing roving-tabindex/arrow-key navigation.

**Annual Upgrade Modal**:
- A 4th credit package "Annual" (id: `annual`, 600 credits / $399 — ~58% off Pro per credit) is exposed via `CREDIT_PACKAGES`. Reuses the existing checkout/webhook flow (no separate Stripe subscription product yet).
- The dashboard auto-pops a modal 1.2s after the user object loads, *only* for non-admins. Dismissed (X / overlay click / "Tal vez después") snoozes 7 days via `localStorage` (`appforge_annual_modal_until`). Buying calls the existing `/api/billing/checkout` with `priceId="annual"`; a Stripe-not-configured error redirects to `/billing` so the user sees the explanatory copy.

**Social Login (Clerk)**:
- AppForge uses Clerk's pre-built `<SignIn>` and `<SignUp>` components. Social providers (Google, GitHub, Apple, Facebook, etc.) are rendered automatically by Clerk **as soon as you enable them in the Clerk Dashboard** — there is no code change required in this repo. To enable: Clerk Dashboard → User & Authentication → Social Connections → toggle the providers and add their client credentials.

**Live Agent Logs (terminal-style streaming)**:
- New `job_logs` table (`lib/db/src/schema/jobLogs.ts`) — stores per-step log lines emitted by each agent during a generation. FK on `generation_jobs` with `ON DELETE CASCADE`; indexed on `(job_id, id)` so the cursor query is O(log n).
- `generate.ts` exports an `AgentLog` callback type. `generateApp` accepts an optional `onAgentLog`; internally a `log()` helper wraps it in a try/catch so a logging failure can NEVER take down a paid generation. Emissions added at every agent boundary: researcher (start + outcome), architect (plan summary + page list), integration (services), designer (theme/palette), coder (frontend KB / backend KB), qa (issue count), validator (build OK / errors), patcher (per-fix attempt + result), system (init / completion). `runValidatePatchLoop` accepts the logger too — used by BOTH initial generation AND edit mode for parity.
- `apps.ts runJob` builds a `recordLog(agent, message, level)` helper that does fire-and-forget `INSERT INTO job_logs` (trims messages > 280 chars, swallows errors). Wired into `generateApp`'s `onAgentLog` param.
- Endpoint `GET /api/generate/jobs/:id/logs?afterId=N` — owner-checked (verifies job belongs to caller before returning anything), clamps `afterId` to non-negative int, returns up to 500 new lines ordered by id. Cursor pagination via `sql\`>\``.
- Frontend `<AgentLogStream>` component (`artifacts/appforge/src/components/agent-log-stream.tsx`) — terminal-style scrollable panel below the progress bar on dashboard AND inside the chat thread on app-detail. Polls every 1.2s while job active, accumulates lines locally (history persists after job ends), dedupes by id (out-of-order safe), auto-scrolls on new lines, resets buffer when `jobId` changes. Color-coded per agent (researcher=sky, architect=violet, designer=pink, integration=amber, coder=emerald, qa=cyan, validator=orange, patcher=yellow, system=muted).
- Tail-loss mitigation: when the job transitions active→terminal, the component triggers two extra invalidations (~1.5s and ~3s after) to capture any log lines that landed in the DB after the job row flipped to "succeeded" (the fire-and-forget INSERT may commit slightly after job finalisation).
- OpenAPI: `JobLogEntry` + `JobLogList` schemas. `lib/api-zod/src/index.ts` no longer re-exports from `./generated/types` — that re-export caused a duplicate-identifier error when an endpoint introduces query params (orval emits both a zod schema and a TS interface for `XParams`); the only consumer (`HealthCheckResponse`) is in `api.ts` already, picked up via `typeof Schema._output`.

**Edit Prompt — Backend Awareness**:
- `buildEditSystemPrompt` (in `lib/generate.ts`) explicitly instructs the model that `backendCode` is in scope: any user request mentioning backend, API, endpoint, auth, payments, db, etc. must rewrite `backendCode`. The "1-4 files surgical edit" guidance is scoped to tweaks; full-feature/full-backend requests may touch many files.
- **Known debt — secret leakage in edit prompt**: every edit pass sends the *current* `frontendCode` AND `backendCode` to the LLM. AppForge bundles read secrets from environment variables (not hard-coded), but if a user pastes a literal secret into their generated backend code via chat, it would be transmitted on the next edit. Mitigation (not yet implemented): redact common secret-shaped literals before sending, or only inject `backendCode` for explicit backend-edit intents.

## External Dependencies

- **Clerk**: User authentication and management.
- **Anthropic Claude**: AI models for reasoning, planning, and code generation (`claude-sonnet-4-6`, `claude-haiku-4-5`).
- **Google Gemini**: AI models for bulk code generation and image generation (`gemini-2.5-flash`, `gemini-3-pro-image-preview`).
- **GPT-5 Codex**: Premium AI model for advanced code generation.
- **Stripe**: Payment processing for credit packages (optional, configurable via environment variables).
- **PostgreSQL**: Primary database for storing application data.
- **@codesandbox/sandpack-react**: Frontend live preview in the workspace.
- **Replit AI Integrations Proxy**: Access to Anthropic, Gemini, and OpenAI models without direct API key management.
- **Replit GitHub Connector (@replit/connectors-sdk)**: Integration for pushing generated code to GitHub repositories.
- **esbuild**: In-memory bundle validation and processing.
- **archiver**: For streaming ZIP file exports.
- **OpenAPI 3.1**: API specification.