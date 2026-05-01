# Maris AI

## Overview

Maris AI is a full-stack SaaS platform that converts natural language prompts into functional web applications using AI. It aims to democratize web development by providing intuitive AI-powered tools for rapid prototyping and deployment, serving individual developers and small businesses. The platform operates on a credit-based system, offering free trials and paid credit packages for app generation. Its business vision is to make web development accessible to a broader audience, reducing the need for specialized coding skills and accelerating the development lifecycle.

## User Preferences

- I prefer a dark theme with violet/cyan accents for the UI.
- The UI should incorporate shadcn/ui components and Framer Motion animations for a modern and fluid user experience.
- The system should prioritize Spanish for all user-visible copy in generated applications, while keeping identifiers in English.
- I expect the AI to automatically include a backend when generating apps for marketplace, e-commerce, social, or SaaS platforms.
- I prefer that there are no strict size limits imposed on generated frontend bundles, acknowledging that larger apps may consume more credits.
- I prefer that generated bundles do not silently drop custom CSS files and that the preview accurately reflects all styles.

## System Architecture

Maris AI features a React frontend, a Node.js/Express backend, and shared libraries, designed for asynchronous, multi-agent AI-driven application generation. The system emphasizes a modular, scalable architecture with a focus on real-time feedback and autonomous error correction.

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

**Memoria persistente del agente y del chat (3 capas)**:
- Implementado en `artifacts/api-server/src/lib/agentMemoryContext.ts` y `agentMemoryExtractor.ts`.
- Capa 1 — historial de chat: últimos 12 turnos de la app actual, capados a 600 chars/turno.
- Capa 2 — `generated_apps.agent_notes` (text, 3KB cap): notas persistentes por app (decisiones de diseño, paleta, etc.).
- Capa 3 — tabla `user_preferences` (PK `userId`, text `notes` 3KB cap): preferencias cross-app válidas para todas las apps del usuario.
- `loadAgentMemory(userId, appId?)` se llama antes de cada `generateApp(...)` en `apps.ts runJob`. El bloque "## CONTEXTO PERSISTENTE" se inyecta al inicio del prompt (planner/architect/coder/patcher comparten el mismo userContent). Las notas se inyectan como DATOS, no como instrucciones, y se sanitizan contra prompt-injection ("ignora las instrucciones anteriores", role-swap, etc.).
- Tras commit exitoso del job (post-tx), un `runMemoryExtractor` fire-and-forget (Haiku, JSON estricto) destila aprendizajes durables y los hace merge+dedupe en `agent_notes` y `user_preferences`. Falla en silencio.
- CRUD: `GET/PUT /api/apps/:id/notes` y `GET/PUT /api/me/preferences`. UI: panel colapsable `<AgentNotesPanel/>` reusable, montado como `<AppNotesSection/>` en `app-detail.tsx` (chat) y `<UserPreferencesSection/>` en `dashboard.tsx`.

**Persistent Job Queue**:
- Generation jobs are managed by `pg-boss` (Postgres-backed queue) for robust, asynchronous processing.
- Supports job concurrency control, retries with exponential backoff, and orphan job reclamation.
- Provides real-time queue position observability for users.

**Deployment Architecture**:
- Generated apps can be publicly deployed with unique slugs using sandboxed iframes for security, exported as ZIP files, pushed to GitHub, and forked.
- `backendCode` is explicitly included in the edit prompt context for AI to modify backend aspects.
- **Vercel external deploy** (`lib/vercelDeploy.ts` + `POST /api/apps/:id/deploy/vercel`): pushes the same self-contained `index.html` produced by `buildDeployHtml` to the user's Vercel account via the Vercel REST API (`/v9/projects` to create, `/v13/deployments` with `target=production` to deploy). The first click creates a Vercel project named `maris-<appId>-<slug>` and persists `vercelProjectId` on the app row; subsequent clicks reuse the same project so the URL stays stable. The new `vercelDeployUrl` column is exposed in the API and the dashboard renders a "Vercel" link + "Re-desplegar" button once present, or a "Desplegar en Vercel" CTA otherwise. Requires the `VERCEL_TOKEN` server secret.

**Versions & rollback** (`app_revisions` table + `lib/appRevisions.ts`):
- Every successful create / edit / healthcheck / visualTester / evaluator commit snapshots `frontendCode`, `backendCode` and a short `source` label into `app_revisions` inside the same transaction (with index `(app_id, created_at desc)`).
- `GET /api/apps/:id/revisions` lists them; `POST /api/apps/:id/revisions/:revisionId/restore` rolls the app back. Restore takes a row-level `FOR UPDATE` lock and rejects with `409` if a queued/running generation job exists for that app, so a rollback can never race with the worker. The frontend `RevisionHistorySection` panel in `app-detail.tsx` shows the list with confirm-before-restore.

**Plantillas pre-fabricadas** (`lib/templates.ts`):
- 6 curated starter templates (`saas-dashboard`, `landing-saas`, `tienda-online`, `habit-tracker`, `snake-2d`, `notas-pwa`) exposed via `GET /api/templates` (no auth — they're just metadata + seed prompt). The `TemplateGallery` component on the dashboard renders them as cards above the kind tabs; clicking one calls `setKind()` + `setPrompt()` so the user lands inside the existing generation flow with the right intent and a starter prompt pre-filled. Icon names are sent as Lucide identifiers and mapped client-side in a `TEMPLATE_ICONS` dict.

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
## Auditoría y arreglos (Mayo 2026)

Tras la revisión interna del codebase, se aplicaron los siguientes endurecimientos:

- **Seguridad — `routes/debugBundle.ts`**: el endpoint `GET /api/__debug/bundle/:id` ahora exige `requireAuth + requireAdmin`. Antes era accesible sin sesión (sólo bloqueado por `NODE_ENV=production`), lo que en cualquier entorno de staging exponía el código fuente de cualquier app por id.
- **Seguridad — Live Preview iframe (`components/live-preview.tsx`)**: el iframe que renderiza código generado por el LLM ahora usa `sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"`. Sin `allow-top-navigation*` para impedir que una app maliciosa secuestre la pestaña del usuario.
- **Estabilidad — Live Preview**: la promesa que espera `server-ready` ahora limpia el listener y el `setTimeout` en TODAS las salidas (resolve, exit-failure, timeout). Antes, los reintentos acumulaban handlers/timers.
- **Idempotencia de cobros — `lib/credits.ts`**: nuevo helper `creditPurchase()` que hace `INSERT ... ON CONFLICT DO NOTHING RETURNING id` + bump de `users.credits` dentro de una sola transacción. `routes/billing.ts` (polling de éxito) y `routes/stripeWebhook.ts` (webhook Stripe) ahora lo usan, eliminando la race condition que podía doble-acreditar al usuario.
- **Schema — `lib/db/src/schema/creditTransactions.ts`**: añadido `uniqueIndex("credit_tx_stripe_session_uq")` sobre `(user_id, stripe_session_id)`. NO parcial (en Postgres `NULL != NULL` dentro de unique index, así que las filas `kind='use'` con sessionId NULL siguen permitiendo duplicados sin restricción). El índice no parcial también permite que `ON CONFLICT (user_id, stripe_session_id)` infiera el constraint sin predicado adicional.
- **Resiliencia — Stripe webhook**: ante un fallo transitorio de DB ahora se devuelve **500** para que Stripe reintente automáticamente (~3 días de back-off). La operación es idempotente, así que es seguro reintentar.
- **UI — `pages/dashboard.tsx`**: `KIND_META[kind]` se accede con fallback (`KIND_META[kind] ?? KIND_META.fullstack`) para evitar crashes si llega un `kind` fuera de la unión. El texto del costo ahora es dinámico (`Costo: N créditos`) en vez del literal `"Costo: 1 crédito"`.
- **Cancelación — `components/agent-log-stream.tsx`**: el `queryFn` ahora propaga el `signal` de React Query al cliente generado, así un poll en vuelo se cancela al cambiar de job o desmontar.
- **Cancelación — `pages/debug-preview.tsx`**: el `fetch` del bundle ahora usa un `AbortController` que se aborta en cleanup del efecto.
- **Accesibilidad — `pages/app-detail.tsx`**: añadidos `aria-label` y `title` a los botones icon-only (enviar mensaje, eliminar app).
- **Concurrencia — `routes/apps.ts` (`enqueueGeneration`)**: añadido `pg_advisory_xact_lock(1296126537, appId)` dentro de la transacción del enqueue + re-check de jobs in-flight. La namespace 0x4D415249 ("MARI") evita colisión con otros locks. El lock se libera automáticamente al commit/rollback. Antes, dos requests concurrentes para la misma app podían pasar el check pre-tx (ambos veían 0 in-flight), insertar dos jobs y doble-cobrar el crédito. La pre-check sigue como fast-path (mayoría de 409 sin abrir tx); el lock+re-check garantiza correctitud bajo concurrencia real. Se devuelve 409 con sentinel `APP_BUSY` cuando se pierde la carrera.

## Nuevos kinds de proyecto (Mayo 2026 — fase 1 cheat-sheet usuario)

Maris ahora soporta 9 tipos de proyecto en lugar de 6. Añadidos: **vue**, **svelte**, **nextjs**.

| Kind | Coste | INTENT resumido |
|------|-------|-----------------|
| vue | 1 | Vue 3 SPA + Vite + vue-router + Pinia + Tailwind, Composition API + `<script setup lang="ts">`. |
| svelte | 1 | SvelteKit + Svelte 5 runes (`$state`/`$derived`/`$effect`, no la sintaxis legacy `$:`), file-based routing, +server.ts para APIs. |
| nextjs | 2 | Next.js 14+ App Router (NO Pages Router), Server Components por defecto, `app/api/<route>/route.ts` para endpoints. |

Cambios aplicados:
- `routes/apps.ts`: extendidos `ProjectKind`, `KIND_COSTS`, `KIND_INTENTS`. Las INTENT incluyen reglas anti-pitfall (no `$:` en svelte, no Pages Router en next, etc).
- `lib/templates.ts`: extendido `TemplateKind` y añadidas 3 plantillas nuevas (`vue-todo`, `svelte-weather`, `nextjs-blog`). Total: 15 templates.
- `lib/api-spec/openapi.yaml`: enum `kind` ampliado y descripciones de coste actualizadas; `pnpm --filter @workspace/api-spec run codegen` regenera el cliente y los esquemas zod.
- `dashboard.tsx`: extendidos `Kind` y `KIND_META`. Iconos lucide nuevos: `Component` (vue), `Flame` (svelte), `Server` (nextjs), más `ListTodo`/`CloudSun`/`Newspaper` para los templates.
- `TEMPLATE_ICONS` ampliado con los nuevos iconos para que la galería los renderice.

Pendientes del cheat-sheet del usuario (próximas sesiones, en orden):
1. Backend Python (FastAPI/Django) además de Node — kinds `python-api` / `django`.
2. Juegos: subkinds explícitos para Phaser 2D y Three.js 3D (hoy se eligen dentro del INTENT genérico, separarlos da plantillas mejor especializadas).
3. Plantillas IA/ML (Python + Jupyter + scikit-learn/TF/PyTorch).
4. Generación de Dockerfile + docker-compose.yml para los proyectos exportados.

## Planner — el flujo nunca se salta validación (Mayo 2026)

Síntoma reportado por el usuario: una petición pequeña entró por `fast-patch`, el log dijo "saltando investigación y diseño" y se entregó código con un error de dependencia. Sentía que Maris "se saltaba pasos" como un humano descuidado.

Causa real: el `fastPatchEdit` SÍ valida el bundle y SÍ tiene un loop de auto-reparación (1 intento) antes de escalar a `feature` con el pipeline completo. Lo que estaba mal era:
1. La heurística metía cualquier prompt corto en `fast-patch`, incluyendo reportes de bug/dependencia, donde el síntoma puede esconder un problema más amplio.
2. El system-prompt del planner-LLM no tenía una regla explícita "errores → nunca fast-patch".
3. `planSummaryEs` decía "saltando investigación y diseño" — texto engañoso que no mencionaba la validación que SÍ se hace.

Cambios en `artifacts/api-server/src/lib/planner.ts`:
- Nuevo `BUG_RX` que matchea error/fallo/crash/dependencia/cannot find/module not found/pantalla en blanco/repara/arregla/corrige/etc. Si matchea y hay app existente, fuerza `PLAN_FEATURE` (architect + frontend + validate + patch). Tiene prioridad sobre `COSMETIC_RX`.
- `PLANNER_SYSTEM` ampliado: regla explícita de que cualquier reporte técnico va a `feature`, nunca a `fast-patch`, más una "regla de oro" — ante la duda, escalar.
- `planSummaryEs` reescrito: ya no dice "saltando X". Para `fast-patch` deja claro que se valida y se escala automáticamente si falla. Para `full-build` enumera todas las fases para que el usuario vea el rigor.
- Eliminados "arregla|corrige|fix" de `COSMETIC_RX` (ahora viven en `BUG_RX`).

Comportamiento que NO cambia (ya estaba bien):
- `fastPatchEdit` valida el bundle resultante y tiene auto-repair.
- Si el fast-patch no converge, se escala a `feature` con `PLAN_FEATURE.phases` completas (ver generate.ts:1969-1983).
- `runValidatePatchLoop` ya estaba bloqueando entrega si quedaba un error de compilación.

### Refinamiento tras code-review (misma sesión)

El architect detectó 2 issues en BUG_RX:
- `404|500|importar|repara` eran demasiado amplios → falsos positivos en frases inocentes ("quiero importar un CSV", "preparar el deploy").
- El LLM podía devolver `fast-patch` para un bug y la heurística no lo re-validaba.

Fix:
- BUG_RX ahora exige contexto técnico explícito ("error 404" en vez de "404", "import faltante" en vez de "importar"). "preparar" ya no matchea por word-boundary `\b`.
- Post-guard determinístico añadido en `planExecution`: si el LLM dice fast-patch pero `BUG_RX.test(prompt)` es true, se promueve a `feature` con razón explícita. Garantiza que NINGÚN bug pueda colarse al shortcut, venga del LLM o de la heurística.
- Test aislado de regex: 15/15 casos correctos (8 reportes técnicos escalados, 7 cosméticos/features no escalados).

## Dominio personalizado — gate por plan, no por gasto (Mayo 2026)

Regla anterior (mal): "Conecta tu dominio propio cuando acumules 50 € en compras". Esto bloqueaba a usuarios con planes pequeños (10 €, 20 €) y no se ajustaba a la realidad de producto.

Regla nueva:
- **Plan gratis**: solo deploy con el subdominio de preview que asigna Maris AI (sin dominio propio).
- **Cualquier plan de pago** (cualquier compra > 0 €, da igual el tamaño): desbloquea dominio propio.
- **Admin / propietario** (`rrhh.milchollos@gmail.com`): desbloqueado siempre, créditos ilimitados, todo gratis.

Cambios:
- `lib/auth.ts`: `OWNER_EMAIL = "rrhh.milchollos@gmail.com"` hardcodeado en `adminEmailSet()`. La env var `ADMIN_EMAILS` sigue funcionando como extensión, pero el propietario nunca puede quedarse fuera por una env mal configurada.
- `lib/credits.ts`: nuevo `userHasAnyPurchase(userId)` (LIMIT 1, índice compuesto). `CUSTOM_DOMAIN_MIN_SPEND_CENTS` deprecated y puesto a 0.
- `routes/apps.ts` `POST /apps/:id/domain`: gate cambiado a `isAdmin || hasPurchase`. 402 con mensaje claro "necesitas plan de pago" en vez de "te faltan X €".
- `routes/apps.ts` `GET /apps/:id/domain`: respuesta ahora incluye `unlocked: boolean` y `unlockReason: "admin" | "purchase" | null`. `requiredCents` siempre 0 (legacy).
- `lib/api-spec/openapi.yaml`: añadidos `unlocked` y `unlockReason` en `CustomDomainStatus`. `requiredCents` marcado deprecated. Codegen regenerado.
- `app-detail.tsx`: usa `data.unlocked` (con fallback a la regla vieja por compatibilidad). Mensaje rediseñado, sin barra de progreso ni "X € / 50 €".
- `lib/db/src/schema/creditTransactions.ts`: añadido índice `credit_tx_user_kind_idx (user_id, kind)` para que `userHasAnyPurchase` y los listados de transacciones del panel admin no degraden con volumen.

Verificación: typecheck verde 4 paquetes, db push aplicado, índice presente en pg_indexes, /api/healthz ok.
