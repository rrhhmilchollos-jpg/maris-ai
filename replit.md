# AppForge

## Overview

AppForge is a full-stack SaaS platform that converts natural language prompts into functional web applications using AI. It aims to democratize web development by providing intuitive AI-powered tools for rapid prototyping and deployment, serving individual developers and small businesses. The platform operates on a credit-based system, offering free trials and paid credit packages for app generation. Its business vision is to make web development accessible to a broader audience, reducing the need for specialized coding skills and accelerating the development lifecycle.

## User Preferences

- I prefer a dark theme with violet/cyan accents for the UI.
- The UI should incorporate shadcn/ui components and Framer Motion animations for a modern and fluid user experience.
- The system should prioritize Spanish for all user-visible copy in generated applications, while keeping identifiers in English.
- I expect the AI to automatically include a backend when generating apps for marketplace, e-commerce, social, or SaaS platforms.
- I prefer that there are no strict size limits imposed on generated frontend bundles, acknowledging that larger apps may consume more credits.
- I prefer that generated bundles do not silently drop custom CSS files and that the preview accurately reflects all styles.

## System Architecture

AppForge features a React frontend, a Node.js/Express backend, and shared libraries, designed for asynchronous, multi-agent AI-driven application generation. The system emphasizes a modular, scalable architecture with a focus on real-time feedback and autonomous error correction.

**Frontend**:
- Built with React, Vite, and TailwindCSS, utilizing `shadcn/ui` and `wouter` for routing.
- Employs Clerk for authentication and Framer Motion for animations.
- The workspace includes a split panel for chat and a live preview powered by `@codesandbox/sandpack-react`.
- Supports various project type tabs on the dashboard, influencing AI generation with specific intents and credit costs.
- Displays live, streaming agent logs during generation.
- Features a Visual Testing Agent for server-side UI testing and auto-correction, with a feedback loop for code patching.
- Includes a Post-failure Diagnostic Agent to provide actionable insights for failed generation jobs.

**Backend**:
- Developed with Node.js, Express, and TypeScript, using Drizzle ORM for PostgreSQL.
- Integrates Clerk Express middleware for user management and Anthropic/Stripe SDKs for AI and billing.
- Defined by an OpenAPI 3.1 specification.
- Features an admin interface and supports user-owned backend code visibility for AI modification.

**Multi-Agent AI Pipeline**:
- An asynchronous pipeline orchestrated by `lib/generate.ts`, utilizing various AI models (Anthropic Claude, Google Gemini, GPT-5 Codex) for roles like Researcher, Architect, Coder, and QA.
- Includes an autonomous self-healing loop with `esbuild` for validation and patching.
- Supports iterative editing and provides real-time progress updates.
- A small Gemini-2.5-flash classifier (planner) determines the scope (`fast-patch`, `feature`, `full-build`) for each request, directing the AI pipeline accordingly.
- An `agent_memory` table stores successful patches, indexed by pgvector embeddings of error messages, to improve subsequent patch attempts.

**Persistent Job Queue**:
- Generation jobs are managed by `pg-boss` (Postgres-backed queue) for robust, asynchronous processing.
- Supports job concurrency control, retries with exponential backoff, and orphan job reclamation.
- Provides real-time queue position observability for users.

**Deployment Architecture**:
- Generated apps can be publicly deployed with unique slugs using sandboxed iframes for security, exported as ZIP files, pushed to GitHub, and forked.
- `backendCode` is explicitly included in the edit prompt context for AI to modify backend aspects.

**Autonomous Evaluator**:
- A "Visual Evaluator" agent runs after the Visual Tester, taking screenshots with Puppeteer and using Claude Sonnet 4.6 with vision to determine `pass | fail` against the original prompt and architect-declared screens.
- Supports retry loops with the patcher for self-correction.
- Automates publishing if approved (`autoPublish=true`) or marks for review (`needs_review`) if rejected, providing a summary of issues.

## External Dependencies

- **Clerk**: User authentication and management.
- **Anthropic Claude**: AI models (`claude-sonnet-4-6`, `claude-haiku-4-5`).
- **Google Gemini**: AI models (`gemini-2.5-flash`, `gemini-3-pro-image-preview`).
- **GPT-5 Codex**: Advanced AI model.
- **Stripe**: Payment processing.
- **PostgreSQL**: Primary database.
- **@codesandbox/sandpack-react**: Frontend live preview.
- **Replit AI Integrations Proxy**: Access to AI models.
- **Replit GitHub Connector (@replit/connectors-sdk)**: GitHub repository integration.
- **esbuild**: Bundle validation and processing.
- **archiver**: ZIP file export.
- **OpenAPI 3.1**: API specification.
- **Sentry**: Error tracking and monitoring (`@sentry/node` en api-server, `@sentry/react` en appforge). Activado solo si están definidas las variables `SENTRY_DSN_API` (servidor) y `VITE_SENTRY_DSN_WEB` (cliente). En el servidor se captura automáticamente el contexto del usuario Clerk y errores del worker de generación (`apps.ts runJob`). En el frontend se enriquece el evento con `userId` y `email` del usuario autenticado.
- **OpenTelemetry (`@opentelemetry/*`)**: Dependencia transitiva de `@sentry/node`. Estos paquetes ahora se empaquetan dentro del bundle del API server (eliminados del `external` de `build.mjs`) para evitar errores de resolución en runtime. `@opentelemetry/api` también se añadió como dependencia explícita en `lib/db` para deduplicar `drizzle-orm`.

## Monitoreo y métricas (Task #12)

- **Endpoint**: `GET /api/admin/metrics` (protegido por `requireAuth + requireAdmin`). Devuelve, en una sola llamada:
  - `jobs24h`: total / éxitos / fallos / tasa de éxito / duración media (ms) en las últimas 24h.
  - `topFailingPhases`: top 3 fases con más errores en 24h.
  - `credits`: usados hoy / usados este mes (transacciones `kind = "usage"`).
  - `topUsers`: top 5 usuarios por consumo de créditos en 30 días.
  - `apps`: publicadas hoy / total (con `publicSlug` no nulo).
- **Frontend**: ruta `/admin/dashboard` (`pages/admin-dashboard.tsx`) con `useQuery` y `refetchInterval: 30_000`. Acceso desde `/admin` mediante el botón "Panel de métricas" sobre las pestañas.
- **Sentry**: `initSentry()` se llama al inicio de `app.ts` (servidor) y `main.tsx` (cliente); ambos hacen no-op si falta el DSN. El middleware de captura de errores está montado después de las rutas en `app.ts`.
- **Captura por fase del pipeline**: `lib/generate.ts` expone `generateApp(... , onPhaseError?)`. Internamente envuelve cada fase (`planner`, `researcher`, `architect`, `integrations`, `design`, `frontend`, `backend`, `qa`, `tests`, `validate-patch-loop`) con un helper `runPhase()` que llama a `onPhaseError(phase, err)` y vuelve a lanzar el error. `routes/apps.ts` conecta ese callback a `captureAgentError` con `phase + jobId + userId + appId`, así cada fallo aparece en Sentry etiquetado con la fase exacta donde explotó (no como genérico "runJob").
- **Breadcrumbs (timeline antes del error)**:
  - Servidor (`app.ts`): middleware por petición que registra `method`, `path`, `status` y `durationMs` cuando `res` finaliza.
  - Servidor (`apps.ts`): breadcrumb `job:start` y un breadcrumb por cada cambio de fase (`phase:<nombre>`) con `jobId`, progreso y nota.
  - Cliente (`appforge/src/lib/sentry.ts`): `breadcrumbsIntegration` activado explícitamente para `fetch`, `xhr`, `console`, `dom` e `history`, así Sentry capta automáticamente todas las llamadas de React Query, navegaciones y clics relevantes.