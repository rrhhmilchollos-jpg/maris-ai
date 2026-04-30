import { anthropic } from "@workspace/integrations-anthropic-ai";
import { ai as gemini } from "@workspace/integrations-gemini-ai";
import OpenAI from "openai";

// OpenAI client via Replit AI Integrations proxy. Same env-var pattern as the
// other providers — the proxy URL + dummy API key are auto-provisioned.
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});
import { validateBundle, type BuildIssue } from "./validate";
import { logger } from "./logger";
import { recallSimilar, rememberPatch, buildRecallExamplesBlock, extractFixHint, redactSecrets } from "./agentMemory";
import { formatMemoryBlock, type AgentMemoryContext } from "./agentMemoryContext";
import { planExecution, planSummaryEs, PLAN_FEATURE } from "./planner";

/** Source language the generated app uses. Affects file extensions + prompt rules. */
export type GenLanguage = "typescript" | "javascript";

/* ============================================================================
 * Maris AI multi-agent generation pipeline.
 *
 * Roles:
 *   - Researcher    (Claude Haiku 4.5 + web_search)  — fast 7s reference brief
 *   - Architect     (Claude Sonnet 4.6)              — project plan / file list
 *   - Designer      (GPT-5-mini)                     — design system + tokens
 *   - Frontend Eng  (Claude Sonnet 4.6, streaming)   — full frontend bundle
 *   - Backend Eng   (GPT-5-mini)                     — backend bundle (or none)
 *   - QA Reviewer   (Claude Haiku 4.5)               — quick sanity report
 *
 * Edits use a single Sonnet pass — the existing app already has plan + design.
 * ========================================================================== */

/**
 * Build the Frontend Engineer system prompt for the chosen source language.
 *
 * `typescript` → .tsx files, types allowed/encouraged (default).
 * `javascript` → .jsx files, NO TypeScript syntax (no `: Type`, `interface`,
 * `as Foo`, generics on functions/components). Used when the user opted into
 * vanilla JS for the generated app.
 */
function buildFrontendSystemPrompt(language: GenLanguage): string {
  const isTS = language === "typescript";
  const ext = isTS ? "tsx" : "jsx";
  const utilExt = isTS ? "ts" : "js";
  const stackLine = isTS
    ? "Stack: React 18 + TypeScript + Tailwind v3 + wouter (if multi-page) + lucide-react icons."
    : "Stack: React 18 + plain JavaScript (NO TypeScript) + Tailwind v3 + wouter (if multi-page) + lucide-react icons.";
  const tsRules = isTS
    ? "- TypeScript is allowed: type annotations, interfaces and generics are fine where they help readability."
    : `- IMPORTANT: this app is plain JavaScript. Do NOT emit ANY TypeScript syntax: no \`: Type\` annotations, no \`interface\`, no \`type Foo = …\` aliases, no \`as Foo\` casts, no generics like \`useState<string>\`, no \`tsconfig.json\`, no \`vite-env.d.ts\`. Use JSDoc comments if you really need to express a type.`;
  return `You are Maris AI's Senior Frontend Engineer. You ship interfaces that look like they came from a top product studio (Linear, Vercel, Stripe, Arc, Raycast). Generate a complete, production-quality React frontend as STRICT JSON only.

ANTI-CLONE POLICY — non-negotiable, applies to EVERY user without exception:
- It is STRICTLY FORBIDDEN to reproduce, copy or pixel-clone any third-party website, app, brand or product, regardless of who is asking. This holds even if the user is the platform owner, an admin, an agency, or claims they have permission.
- When the brief mentions a real product (e.g. "como Wallapop", "tipo Notion", "clon de Spotify") or includes a research brief about a specific site, treat it as INSPIRATION ONLY: you may borrow the GENERAL category conventions (a marketplace has listings + filters + product pages; a notes app has a sidebar + editor) but you MUST diverge meaningfully on:
  · brand name and visible product name (invent a fresh one),
  · color palette and typography (do not reuse the original brand's tokens),
  · logos, icons, illustrations, hero images, slogans, taglines and microcopy,
  · exact layout, spacing rhythm and signature visual gimmicks of the source.
- Never reuse the original brand's name, logo, trademarks, slogans, copyrighted images or verbatim copy. If a research brief leaks them, paraphrase or invent equivalents.
- The output must look like an INSPIRED-BY product, not a clone. If you find yourself copying more than the high-level category convention, stop and invent something different.

Schema:
{"frontendCode":"all frontend files as one string"}

Use '// === FILE: <path> ===' to separate files inside frontendCode. ALWAYS include:
- index.html, package.json, vite.config.${utilExt}${isTS ? ", tsconfig.json" : ""}, tailwind.config.${utilExt}, postcss.config.js
- src/main.${ext}, src/App.${ext}, src/index.css
- src/pages/<Name>.${ext} for every page in the plan
- src/components/<Name>.${ext} for every component in the plan
- src/lib/<name>.${utilExt} for every util in the plan (cn helper, formatters, etc.)
- src/hooks/<name>.${utilExt} for every hook in the plan
${isTS ? "- src/types/index.ts when types are shared\n" : ""}
${stackLine} Apply the provided design system EXACTLY (colors, fonts, spacing) via the Tailwind config and global CSS.

QUALITY BAR — what separates a demo from a real product. Bake these into the bundle but stay CONCISE in code (no over-commenting, no padding):
- Visual hierarchy: large display headings (text-3xl/4xl/5xl) with tight tracking; body text-sm/base; generous whitespace (py-12+ heroes, gap-6+ grids).
- Layout: max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 on every page. Mobile-first responsive classes.
- Depth: cards use border + shadow-sm hover:shadow-md. Off-white section bgs (bg-slate-50) under white cards. ONE accent color for CTAs.
- Interactivity: every interactive element has hover, focus-visible ring, active state, transition-all duration-200. Cards lift on hover (hover:-translate-y-0.5).
- Real interactivity (not static): useState/useMemo for filters, search, tabs, modals (with Esc + backdrop close), toggles. NEVER just static arrays.
- States: loading skeletons (animate-pulse), empty states (icon + headline + sub + CTA in Spanish), errors, disabled. EVERY list/table has an empty state.
- Icons: lucide-react in headers, buttons, empty states.
- Animation: define keyframes (fadeIn, slideUp) in src/styles/animations.css, apply on heroes/modals/on-mount.
- Accessibility: semantic HTML, labels for every input, aria-hidden on decorative icons, descriptive Spanish alt on every <img>.
- Mobile: works at 375px, hamburger nav if needed, grids reflow grid-cols-1 sm:grid-cols-2 lg:grid-cols-3.

CSS — encouraged beyond Tailwind:
- src/index.css holds the @tailwind directives PLUS the design system globals (CSS variables, body styles, smooth scroll, font smoothing antialiased).
- For animations, keyframes, scrollbar styling, complex hover states or component-scoped polish that's awkward in Tailwind utilities, ADD dedicated files like src/styles/animations.css, src/styles/scrollbar.css, src/styles/<component>.css and import them from src/main.${ext} (or from the component that uses them). Real CSS rules — no @apply outside index.css.

LANGUAGE — ALL user-visible copy MUST be in Spanish (es-ES):
- Every label, button, heading, placeholder, alt text, error message, empty state, tooltip → Spanish. Use natural, friendly product copy ("Aún no has añadido productos", "Explorar catálogo", "Guardar cambios"), not literal translations.
- Seed/mock data (product names, descriptions, user names, comments, addresses) → Spanish where it makes sense (Spanish names: Lucía, Mateo, Sofía, Diego, Carmen; Spanish cities: Madrid, Barcelona, Sevilla, Valencia, Bilbao).
- Identifiers, variable names, file names, type names → English (standard code).
- HTML lang attribute → "es".

DATA — seed enough to look real:
- Lists/grids: 6-12 realistic items minimum (products, posts, users, etc.) with varied images, prices, dates, statuses.
- Detail pages: full content (description, specs, reviews, related items).
- User data: 3-5 plausible Spanish people with avatars (Unsplash photo-1500000000000-... portrait URLs).
- Avoid lorem ipsum. Avoid "Producto 1", "Producto 2" — give them real-sounding Spanish names.

SYNTAX — code must parse with a strict ${isTS ? "TypeScript" : "JavaScript"} parser (Babel/SWC/esbuild):
${tsRules}
- NO trailing commas after the last element of an object literal, array literal or call argument list when followed immediately by a closing token. Specifically NEVER write \`,,\` (double comma) or \`,)\` or \`,]\` or \`,}\` patterns where the second comma was a typo.
- NO non-ASCII characters inside identifiers, keywords or punctuation. Non-ASCII is allowed ONLY inside string literals and JSX text. Examples of FORBIDDEN garbage tokens: \`née\`, \`café\` as a property name, smart quotes \`"…"\` instead of plain \`"\`, em-dashes inside code.
- Every string must be properly terminated with the SAME quote it started with. Long URLs and descriptions are common offenders — re-check them.
- Every \`{\`, \`(\`, \`[\` must have a matching \`}\`, \`)\`, \`]\`. Every JSX tag must close.
- All bare imports (e.g. \`import { Route } from 'wouter'\`) must come from packages that actually exist on npm. Stick to: react, react-dom, wouter, lucide-react, clsx, tailwind-merge, date-fns, zod. Do not invent package names.
- Every \`.map(item => …)\` over an array MUST give the rendered element a stable \`key={item.id ?? \`\${prefix}-\${index}\`}\`.
- Hooks (useState/useEffect/useMemo) at the top of the component body, never inside conditionals/loops.

IMAGES — placeholders are encouraged:
- Use \`https://images.unsplash.com/photo-…\` URLs (or \`https://picsum.photos/…\`) for hero/product/avatar images and ALWAYS write a meaningful, descriptive Spanish \`alt="…"\` (the more specific the alt, the better the AI replacement: "sofá modular gris en salón luminoso" beats "imagen 1"). A separate AI agent will replace these with real generated images later, using the alt text as the prompt.
- For avatars, prefer compact crops (e.g. portrait-style Unsplash photos). For heroes, prefer wide cinematic photos.

WOUTER v3 — the preview ships wouter ^3.x, where \`<Link>\` ITSELF renders as the anchor tag. NEVER nest \`<a>\` (or \`<button>\`) inside \`<Link>\` — doing so produces invalid \`<a><a>…</a></a>\` markup that throws "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node." at runtime and silently kills the entire \`<main>\` subtree. Pass \`className\`, \`onClick\`, \`aria-label\` etc. DIRECTLY to \`<Link>\` and put plain text/icons as children:
- WRONG: \`<Link href="/x"><a className="btn">Ir</a></Link>\`
- RIGHT: \`<Link href="/x" className="btn">Ir</Link>\`
The same applies to \`<Route>\` — render children directly, do not wrap in \`<a>\`.

EXPORTS & IMPORTS — be consistent so imports actually resolve at runtime:
- Match every \`import { X }\` to a named \`export { X }\`/\`export function X\`/\`export const X\` in the target file. Match every \`import X from\` to an \`export default …\`. Mixing the two yields \`undefined\` and React renders nothing.
- Pick ONE convention per kind: components default-exported, hooks/utilities/constants/types named-exported — and stick to it across the bundle.

TAILWIND — the preview uses the Tailwind Play CDN (no postcss). This means:
- Custom theme tokens like \`bg-background\`, \`text-foreground\`, \`bg-primary\`, \`border-input\` only work if you ALSO declare them via the inline config script. Prefer concrete Tailwind classes (\`bg-white\`, \`text-slate-900\`, \`bg-orange-500\`) so the preview renders identically. You can still keep design-system colors as CSS variables in :root for use inside src/styles/*.css, but JSX className strings should use real Tailwind utilities.
- \`@apply\` inside src/index.css works only with REAL Tailwind utilities (not custom theme tokens). When in doubt, write plain CSS rules instead of \`@apply\`.

Rules:
- Real working code. No TODOs, no stubs, no lorem ipsum. Every page renders meaningful content with real interactions, not static markup.
- Use the file list from the plan EXACTLY — split UI into the listed files, do not collapse them into App.${ext}.
- Polished layout, accessible markup, semantic HTML, mobile-first responsive.
- NO SIZE LIMIT — generate every file the plan needs, in full. This is a paid product; bigger apps deliver more value. Never truncate or "TODO" a file to save tokens.
- Close every quote, brace and bracket. Output ONLY the JSON object.`;
}

const BACKEND_SYSTEM_PROMPT = `You are Maris AI's Senior Backend Engineer. Generate a complete, production-quality Node/Express backend as STRICT JSON only. Your code is what would pass a senior code review at a serious startup.

Schema:
{"backendCode":"all backend files as one string OR 'No backend required for this app.'"}

Use '// === FILE: <path> ===' to separate files. When a backend is needed include:
- package.json, tsconfig.json, src/index.ts (express bootstrap with helmet + cors + json + error middleware), src/routes/<name>.ts (one per resource), src/db/schema.ts (drizzle), src/db/seed.ts (optional seed data), src/lib/<name>.ts as needed (logger, error helpers).

Stack: Node 20 + Express 5 + TypeScript + Drizzle ORM + PostgreSQL. Use zod for input validation. Real working handlers, no stubs.

QUALITY BAR:
- RESTful resource routes: GET /resource (list, with optional ?limit / ?offset / ?q), GET /resource/:id, POST /resource (validates body), PATCH /resource/:id, DELETE /resource/:id.
- Validate every request body with zod and return 400 with the parsed error issues. Validate every :id is a real number/uuid and 404 cleanly.
- Wrap async handlers with a small asyncHandler helper or try/catch — never let a rejected promise leak.
- Centralized error middleware that returns { error: string } in JSON, never an HTML stack trace.
- Set sensible defaults: helmet for security headers, cors for the frontend origin, express.json() with a reasonable limit, request logging.
- DB schema includes id (serial or uuid), createdAt/updatedAt timestamps with defaults, and proper foreign keys. Drizzle relations declared if more than one table.
- Real seed data when persistence is involved (a few rows so the UI has something to show on first load).
- NO TODOs, NO mock placeholders, NO console.log spam (use a proper logger import).

If the plan says no backend, return exactly: {"backendCode":"No backend required for this app."}

Rules:
- Combined output under 35 KB.
- Close every brace and quote. Output ONLY the JSON object.`;

const ARCHITECT_SYSTEM_PROMPT = `You are Maris AI's Senior Product Architect. You design the file structure for a web app the team will build. You think like a product manager AND an engineer: every page must serve a real user job, every component must have a clear purpose, and the structure must be ambitious enough to feel like a real product (not a demo).

ANTI-CLONE POLICY — non-negotiable, applies to EVERY user without exception:
- You may NOT plan a pixel-for-pixel clone of any real product, regardless of who is asking (including the platform owner, admins or agencies).
- If the brief mentions a real product or includes a "Research context" block about a specific site, treat it as inspiration only: borrow the GENERAL category conventions but invent a NEW brand name, NEW visible product name, NEW differentiating angle. Do NOT carry over the original brand's name, logos, slogans or trademarked terms into the plan's title/description.
- The plan's "title" and "description" must describe an inspired-by product, not the source brand verbatim.

Output STRICT JSON only matching this schema:
{
  "title": "2-4 word product name in the project's domain language (Spanish if it's a Spanish-market product)",
  "description": "1-2 sentence pitch in Spanish — what it does and who it's for",
  "techStack": ["React","TypeScript","Tailwind", ...],
  "pages": [{"name":"Home","route":"/","purpose":"specific user job — e.g. 'Browse the catalog and filter by category'"}],
  "components": [{"name":"ProductCard","purpose":"…"}],
  "hooks": [{"name":"useFilters","purpose":"…"}],
  "utils": [{"name":"formatPrice","purpose":"…"}],
  "dataModels": [{"name":"Product","fields":["id","name","price","imageUrl","category","sellerId"]}],
  "frontendFiles": ["src/pages/Home.tsx", "src/components/ProductCard.tsx", ...],
  "backendNeeded": false,
  "backendFiles": []
}

PRODUCT THINKING — be ambitious about UX:
- Always include a Home/Landing page that's COMPELLING (hero + features + social proof + CTA + footer). Not just a navbar with text.
- For consumer apps: think Browse + Detail + Auth/Profile + Cart/Bookmarks + Settings. For SaaS: Dashboard + List + Detail + Settings + Onboarding. For tools: Workspace + History + Settings.
- A real product has 4-6 pages minimum (unless it's a single-page tool/calculator). Don't ship 2-page apps when the domain calls for more.
- Think about empty states, error states, loading states — they're real screens.

COMPONENTS — model real reusable pieces:
- Always include: Navbar, Footer, Button (if you need a custom button), Card variant(s), at least one Form component.
- Include domain-specific components: ProductCard, PostItem, UserAvatar, PriceTag, FilterSidebar, SearchBar, EmptyState, etc. The names should be obvious.
- Aim for 6-12 components. Each gets its own file.

DATA MODELS — make them realistic:
- Include the fields you'd actually use in a real schema (id, timestamps, relations, status enums).
- 2-5 models is healthy for most apps.

INTENT HINTS — when the user prompt starts with a bracketed hint like "[INTENT: …]", that's a top-priority directive from the dashboard's project-type tabs. Honor it strictly. The hint OVERRIDES the FULL-STACK RULE below — if the hint says backendNeeded=false, set backendNeeded=false even if there are full-stack keywords:
- "[INTENT: mobile-first PWA …]": all pages must be mobile-first, single-column, large tap targets (≥44px), bottom navigation bar component, design verified at 390px width. Add a mobile-style bottom nav component to components[].
- "[INTENT: landing page …]": output exactly 1 page (Home/Landing), backendNeeded MUST be false, focus everything on hero + features + social-proof + pricing + CTA + footer sections. Skip dashboards, auth, etc.
- "[INTENT: 2D game …]": output exactly 1 page (the Game itself). backendNeeded MUST be false. techStack must include "HTML5 Canvas" and may include "pixi.js". Plan a GameCanvas component (full game loop, rendering, input handling), a HUD component (score, lives, timer), a MainMenu component (start, instructions, high scores), and a GameOver component (final score, restart). Include 1 hook like useGameLoop. Data models: a Score model {value, date} for localStorage records. NEVER use multiple pages — the game lives in a single screen with internal state machine.
- "[INTENT: 3D game …]": output exactly 1 page (the Game itself). backendNeeded MUST be false. techStack must include "three", "@react-three/fiber", "@react-three/drei". Plan a Scene component (camera, lights, ground/skybox), a Player component, an Enemy/Obstacle component family, a HUD overlay component (score, controls help), MainMenu and GameOver components. Include hooks like useGameLoop and useKeyboardControls. Data models: a Score model for localStorage. SINGLE-PAGE game.
- "[INTENT: hybrid PWA …]": mobile-first design with bottom navigation, but ALSO plan PWA infrastructure: a "manifest.webmanifest" file in frontendFiles (described as "Web app manifest with name, short_name, icons, theme_color, background_color, display=standalone, start_url"), a "service-worker.js" file (described as "Offline-first service worker — cache the app shell on install, serve cached responses with network fallback"), a service-worker registration call in main.tsx, and an InstallPrompt component (catches beforeinstallprompt and shows an "Install app" button). techStack should include "PWA", "Service Worker". backendNeeded depends on the user's actual feature request.
- "[INTENT: …fullstack…]" or no intent prefix: behave as the rest of the rules describe.

FULL-STACK RULE — be aggressive about backendNeeded=true:
- Any of these triggers MUST set backendNeeded=true: marketplaces, ecommerce, social networks, SaaS, dashboards, chat apps, anything with user accounts, anything with persistence, anything that lists or stores user-generated content, anything with payments, anything with AI calls, anything called "clon de X" (clone of an existing product).
- Keywords that imply full-stack: "marketplace", "ecommerce", "tienda", "shop", "comprar", "vender", "carrito", "subasta", "red social", "comunidad", "foro", "chat", "mensajes", "publicar", "perfil", "cuenta", "login", "auth", "panel", "dashboard", "admin", "saas", "suscripción", "pago", "stripe", "blog", "cms", "reservas", "booking", "agenda", "calendar", "votar", "valorar", "reseña", "review", "API", "backend", "base de datos", "db", "clone", "clon".
- Pure landing pages, single-user calculators, simple games and tools without persistence are the only valid backendNeeded=false cases.

NO LIMITS — be ambitious:
- This is a paid product. Bigger apps = more value. Do NOT artificially shrink the plan.
- A real marketplace clone (Wallapop, eBay, Airbnb…) needs 8-15 pages, 12-25 components, multiple data models. Plan for it.
- Generate as many frontendFiles as the product genuinely needs. Quality AND quantity.

Rules:
- NEVER collapse everything into one file. Each page/component/hook/util gets its own file.
- techStack: 4-8 entries. Include the visible libraries (React, TypeScript, Tailwind, Wouter, Lucide) — not invented ones.
- Output ONLY the JSON object.`;

const DESIGNER_SYSTEM_PROMPT = `You are Maris AI's Senior UI/UX Designer. You produce design systems with personality — never generic, never "bootstrap blue". You think in terms of brands like Linear, Vercel, Notion, Stripe, Arc, Raycast, Cred, Loom: distinct, confident, modern. Output STRICT JSON only.

Schema:
{
  "theme": "light" | "dark" | "auto",
  "palette": {"primary":"#hex","secondary":"#hex","accent":"#hex","background":"#hex","foreground":"#hex","muted":"#hex"},
  "typography": {"sans":"font-name","display":"font-name","sizes":{"base":"16px","lg":"18px"}},
  "radius": "sm" | "md" | "lg" | "xl",
  "vibe": "1-line description of the visual mood — be specific, e.g. 'Confident, warm, premium — orange accents on near-black with generous whitespace'",
  "tailwindExtend": "JSON-stringified object you would put inside tailwind.config.ts theme.extend",
  "globalCSS": "string with @import or :root CSS variables you would put in src/index.css after @tailwind directives"
}

PALETTE GUIDANCE — pick a personality:
- Match the product's domain and tone. A second-hand marketplace might feel warm/orange/coral. A fintech tool feels deep-blue/teal. A health app feels green/sage. A creative tool feels violet/electric. A B2B SaaS feels indigo/slate.
- Primary should be SATURATED (not pastel). Secondary either complementary or a darker shade of primary. Accent for highlights/badges.
- Background should rarely be pure white — prefer warm off-whites (#FAFAF9) or cool greys (#F8FAFC) for sections, with white cards on top.
- ALWAYS verify text-on-background contrast hits WCAG AA (4.5:1 for body, 3:1 for large text).

TYPOGRAPHY:
- sans: pick a real Google Font that fits the vibe (Inter for SaaS, Manrope for product, Plus Jakarta Sans for friendly, Geist for technical, IBM Plex Sans for editorial). Default safe pick: 'Inter'.
- display: optional second font for large headlines (Cal Sans, Space Grotesk, Fraunces). Otherwise omit and reuse sans bold.
- The globalCSS string MUST include the @import url('https://fonts.googleapis.com/...') line(s) so the font actually loads — and apply font-family to body and h1-h6.

GLOBAL CSS — go beyond color variables. Always include:
- :root with --primary, --secondary, --accent, --background, --foreground, --muted as hex (no hsl wrapping).
- body { font-family: '<sans>', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
- html { scroll-behavior: smooth; }
- Optional: a subtle .gradient-radial or .glass utility class.

Rules:
- Real hex colors with good contrast. Match the product's domain and any research context provided.
- Keep tailwindExtend small and valid JSON. Most apps don't need tailwindExtend at all (use concrete utilities). Only add fontFamily entries here if you really need Tailwind to know about the custom font.
- Output ONLY the JSON object.`;

const INTEGRATION_SYSTEM_PROMPT = `You are Maris AI's Integration Architect. Decide which third-party services this app realistically needs (auth, payments, AI, storage, email, maps, analytics).

Output STRICT JSON only:
{"services":[{"name":"Clerk","why":"User auth","envVars":["CLERK_PUBLISHABLE_KEY"],"setupSteps":["Create Clerk app","Copy publishable key into env"]}]}

Rules:
- Max 4 services. Only include what's truly needed for the requested app.
- Prefer well-known services: Clerk (auth), Stripe (payments), OpenAI/Anthropic (AI), Replit Object Storage / S3 (file uploads), Resend (email), Google Maps (maps), PostHog (analytics).
- Each service: 1-2 envVars, 2-3 short setupSteps in Spanish.
- If the app is a simple landing page, calculator, or self-contained demo, return {"services":[]}.
- Output ONLY the JSON object.`;

const TEST_SYSTEM_PROMPT = `You are Maris AI's Test Engineer. Generate basic but REAL test scaffolding for a React+TS+Vite app.

Output STRICT JSON only:
{"testCode":"all test files as one string"}

Use '// === FILE: <path> ===' separators. ALWAYS produce:
- tests/setup.ts (vitest + @testing-library/jest-dom setup)
- vitest.config.ts (jsdom environment, points to tests/setup.ts)
- tests/<ComponentName>.test.tsx — 1 smoke test per listed component (max 3): render it, assert visible text.
- tests/<utilName>.test.ts — 1 unit test per listed util (max 2): import and call with a sample input.
- e2e/home.spec.ts — 1 Playwright test that loads "/" and checks the main heading.
- playwright.config.ts (basic chromium config)

Rules:
- Real working tests. No TODOs, no placeholders. Every test imports a real symbol and asserts something concrete.
- Combined output under 6 KB. Close every brace. Output ONLY the JSON object.`;

function buildPatcherSystemPrompt(language: GenLanguage): string {
  const isTS = language === "typescript";
  const tsLine = isTS
    ? "- This is a TypeScript bundle (.tsx/.ts). Type annotations are fine."
    : "- This is a plain JavaScript bundle (.jsx/.js). Do NOT introduce TypeScript syntax during patching (no `: Type`, no `interface`, no `as Foo`, no generics).";
  return `You are Maris AI's Patcher. Apply ONLY the listed fixes to the frontend bundle. Preserve everything else exactly.

Output STRICT JSON only:
{"frontendCode":"all frontend files as one string"}

LANGUAGE — preserve Spanish copy. If new copy is added, write it in Spanish too.

SYNTAX — the patched bundle must parse cleanly:
${tsLine}
- Remove every \`,,\` (double comma), \`,)\`, \`,]\` and \`,}\` pattern you find while patching.
- Strip any non-ASCII garbage characters from identifiers/keywords (e.g. \`née\`, smart quotes in code, zero-width spaces). Non-ASCII is fine inside strings and JSX text only.
- Re-balance every brace, bracket, paren and JSX tag.
- Bare imports must reference real packages: react, react-dom, wouter, lucide-react, clsx, tailwind-merge, date-fns, zod.

WOUTER v3 — \`<Link>\` already renders as \`<a>\`. If you see \`<Link …><a …>…</a></Link>\` in the bundle, FLATTEN IT: move the \`<a>\`'s className / onClick / aria-* props onto the \`<Link>\` and drop the inner \`<a>\` entirely. Nested anchors throw "Failed to execute 'removeChild' on 'Node'" and silently empty the page.

EXPORTS & IMPORTS — when patching, match every \`import { X }\` to a named export of \`X\` in the target file, and every \`import X from\` to an \`export default\`. If you spot a mismatch, fix the import side to match what the file actually exports.

Rules:
- Use '// === FILE: <path> ===' separators.
- Return the FULL bundle (every file, not just patched ones).
- Don't introduce new bugs. Don't remove existing files unless the fix explicitly says so.
- NO SIZE LIMIT — keep the bundle as large as it needs to be. Close every brace and quote. Output ONLY the JSON object.`;
}

export interface GeneratedAppPayload {
  title: string;
  description: string;
  techStack: string[];
  frontendCode: string;
  backendCode: string;
  /**
   * Architect's planned page list, persisted on `generated_apps.plannedPages`
   * so the autonomous evaluator can ground its vision pass in "the screens
   * we promised" instead of just the user's free-text intent. Only set on
   * the public assembly path (`generateApp`); auto-fix patches that don't
   * re-run the architect leave this undefined.
   */
  plannedPages?: Array<{ name: string; route?: string; purpose?: string }>;
}

export type GeneratePhase =
  | "researching"
  | "architecting"
  | "integrating"
  | "designing"
  | "generating"
  | "reviewing"
  | "validating"
  | "fixing"
  | "parsing";

export interface GenerateProgress {
  phase: GeneratePhase;
  progress: number;
  note?: string;
}

/**
 * Per-agent log line callback. The pipeline calls this whenever an individual
 * agent finishes a meaningful step ("Architect → 8 pages, 14 components",
 * "Coder → wrote frontend/pages/Home.tsx", "Validator → 0 errors"). The
 * callback is fire-and-forget — implementations MUST swallow their own errors
 * so a logging failure can never fail the generation. The route handler in
 * apps.ts wires this to a row insert in `job_logs` so the dashboard can
 * stream them to the user as a terminal-style live log.
 */
export type AgentLog = (
  agent: string,
  message: string,
  level?: "info" | "warn" | "error",
) => void;

/**
 * A user-supplied attachment that should inform the generation. The route
 * handler resolves uploads by id, decodes them, and passes a typed context
 * here. We deliberately keep this small: text-shaped files send their
 * decoded content (already truncated upstream to keep the prompt sane), and
 * images/PDFs only send metadata so the model knows they exist and what to
 * mimic — feeding raw image bytes to every LLM call is expensive and not
 * supported uniformly across the providers we use today.
 */
export interface AttachmentContext {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** UTF-8 decoded text content for text/* and JSON/CSV/etc. Undefined for images and PDFs. */
  textContent?: string;
}

/**
 * Build a markdown-ish block that summarises uploaded attachments and inlines
 * their text content where applicable. Prepended to the user prompt for both
 * initial generation and edit mode so the architect/coder always have it. Hard
 * caps total size at ~25 KB so a user uploading several large CSVs can't blow
 * the prompt budget. Images/PDFs become a one-line acknowledgement that asks
 * the model to treat them as references.
 */
export function buildAttachmentBlock(attachments: AttachmentContext[] | undefined): string {
  if (!attachments || attachments.length === 0) return "";
  const MAX_TOTAL = 25_000;
  const parts: string[] = ["[ARCHIVOS ADJUNTOS DEL USUARIO]"];
  let used = parts[0]!.length;
  for (const a of attachments) {
    const sizeKb = Math.max(1, Math.round(a.sizeBytes / 1024));
    if (a.textContent && a.textContent.trim().length > 0) {
      const remaining = MAX_TOTAL - used - 200;
      const text = remaining > 0 ? a.textContent.slice(0, remaining) : "";
      const block = `\n--- ${a.filename} (${a.mimeType}, ${sizeKb} KB) ---\n${text}${
        a.textContent.length > text.length ? "\n…(contenido truncado)" : ""
      }`;
      parts.push(block);
      used += block.length;
      if (used >= MAX_TOTAL) break;
    } else {
      const isImg = a.mimeType.startsWith("image/");
      const note = isImg
        ? `imagen de referencia visual — replica su estilo/colores/layout cuando sea relevante`
        : `documento de referencia — usa su contenido como contexto`;
      const line = `\n- ${a.filename} (${a.mimeType}, ${sizeKb} KB): ${note}.`;
      parts.push(line);
      used += line.length;
    }
  }
  parts.push("\n[FIN DE ADJUNTOS]\n");
  return parts.join("");
}

interface ProjectPlan {
  title: string;
  description: string;
  techStack: string[];
  pages: Array<{ name: string; route: string; purpose: string }>;
  components: Array<{ name: string; purpose: string }>;
  hooks: Array<{ name: string; purpose: string }>;
  utils: Array<{ name: string; purpose: string }>;
  dataModels: Array<{ name: string; fields: string[] }>;
  frontendFiles: string[];
  backendNeeded: boolean;
  backendFiles: string[];
}

interface DesignSystem {
  theme: string;
  palette: Record<string, string>;
  typography: { sans: string; display?: string; sizes?: Record<string, string> };
  radius: string;
  vibe: string;
  tailwindExtend: string;
  globalCSS: string;
}

interface IntegrationService {
  name: string;
  why: string;
  envVars: string[];
  setupSteps: string[];
}

interface IntegrationSpec {
  services: IntegrationService[];
}

interface QAIssue {
  file: string;
  problem: string;
  fix: string;
}

interface QAReport {
  ok: boolean;
  issues: QAIssue[];
}

interface AnyContentBlock {
  type: string;
  text?: string;
}

const CLONE_KEYWORDS = [
  "clon", "clone", "copia", "copy", "como ", "like ", "similar a", "similar to",
  "réplica", "replica", "imita", "estilo de", "version de", "versión de",
  "wallapop", "vinted", "airbnb", "twitter", "instagram", "tiktok", "uber",
  "amazon", "ebay", "spotify", "netflix", "youtube", "linkedin", "facebook",
  "whatsapp", "telegram", "discord", "slack", "notion", "trello", "asana",
  "stripe", "shopify", "github", "reddit", "pinterest", "snapchat", "twitch",
];

/**
 * Spanish trigger phrases that explicitly ask the agent to investigate
 * something on the web ("busca en X.com y dime cómo es su home", "investiga
 * patagonia.es", "analiza la home de stripe", …). When any of these appear
 * we always run the researcher, even if the prompt has no clone keyword.
 */
const RESEARCH_TRIGGER_PHRASES = [
  "busca en",
  "buscame",
  "búscame",
  "investiga",
  "analiza",
  "mira en",
  "mírate",
  "mirate",
  "echa un vistazo",
  "echale un vistazo",
  "échale un vistazo",
  "visita",
  "entra en",
  "consulta",
  "revisa la web",
  "revisa el sitio",
  "dime cómo es",
  "dime como es",
  "como es su home",
  "cómo es su home",
];

/**
 * Detects bare URLs or "domain.tld" patterns in a free-form prompt. The
 * regex intentionally accepts both `https://example.com/foo` and the bare
 * `example.com` shorthand the user often types — both are strong signals
 * that the user wants the researcher to fetch a specific page.
 */
const URL_LIKE = /\b(?:https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,})\b/i;

function shouldResearch(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  if (CLONE_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  if (RESEARCH_TRIGGER_PHRASES.some((p) => lower.includes(p))) return true;
  if (URL_LIKE.test(prompt)) return true;
  return false;
}

/* ----------------------------- helpers ------------------------------------ */

function extractJsonObject<T = any>(raw: string): T | null {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  try {
    return JSON.parse(s.slice(first, last + 1)) as T;
  } catch {
    return null;
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Reject after `ms` instead of returning a fallback. Use when there's no safe default. */
async function withTimeoutOrThrow<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/* ----------------------------- agents ------------------------------------- */

export async function researchTopic(prompt: string): Promise<string> {
  // 18s cap — we now allow up to 4 searches/fetches when the user asks the
  // agent to "busca en X.com y dime cómo es su home", which needs a couple
  // of round-trips (homepage + maybe a section). Still best-effort: on
  // timeout we fall back to no research and the architect proceeds blind.
  const hasUrl = URL_LIKE.test(prompt);
  return withTimeout(
    (async () => {
      try {
        const research = await (anthropic.messages.create as any)({
          model: "claude-haiku-4-5",
          max_tokens: 1500,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
          system: `You are Maris AI's web researcher. Produce a concise reference brief for the architect/designer who will build a NEW, ORIGINAL product inspired by what you find. Output:
- 1 short paragraph: what the source product/site does and who it's for.
- bullets: core sections/pages, signature features, dominant brand colors (hex if you can read them), typography family, microcopy tone.
- 1 short paragraph: differentiation suggestions — what an inspired-by product could do better or differently.

ANTI-CLONE: It is STRICTLY FORBIDDEN to encourage cloning. Do NOT repeat the source's exact slogans/taglines/logos verbatim. Paraphrase. The downstream agents will diverge on brand name, palette and copy. Stay factual; no preamble; plain text only; ≤350 words.`,
          messages: [
            {
              role: "user",
              content: hasUrl
                ? `Investiga la(s) URL(s) que aparecen en este encargo y devuelve el brief en español:\n\n"${prompt}"`
                : `Quick web research for the brief below. Produce the reference brief in Spanish:\n\n"${prompt}"`,
            },
          ],
        });
        const blocks: AnyContentBlock[] = research.content || [];
        return blocks
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("\n\n")
          .trim()
          .slice(0, 4000);
      } catch {
        return "";
      }
    })(),
    hasUrl ? 18_000 : 9_000,
    "",
  );
}

async function architectPlan(prompt: string, research: string): Promise<ProjectPlan> {
  const userContent = research
    ? `Design the file structure for this app:\n\n${prompt}\n\n---\nResearch context (treat as ground truth for branding & sections):\n${research}`
    : `Design the file structure for this app:\n\n${prompt}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: ARCHITECT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Architect returned no text.");
  const plan = extractJsonObject<ProjectPlan>(text.text);
  if (!plan || !plan.title || !Array.isArray(plan.frontendFiles)) {
    logger.error(
      {
        stopReason: (response as { stop_reason?: string }).stop_reason,
        rawPreview: text.text.slice(0, 600),
        rawTail: text.text.slice(-300),
      },
      "Architect returned invalid plan JSON",
    );
    throw new Error("El arquitecto no devolvió un plan válido.");
  }
  // Sane defaults for missing arrays.
  plan.pages = plan.pages ?? [];
  plan.components = plan.components ?? [];
  plan.hooks = plan.hooks ?? [];
  plan.utils = plan.utils ?? [];
  plan.dataModels = plan.dataModels ?? [];
  plan.backendFiles = plan.backendFiles ?? [];
  plan.techStack = plan.techStack ?? ["React", "TypeScript", "Tailwind"];
  return plan;
}

async function designSystem(plan: ProjectPlan, research: string): Promise<DesignSystem> {
  const summary = `Product: ${plan.title}\nDescription: ${plan.description}\nVibe needed for: ${plan.pages.map((p) => p.name).join(", ")}`;
  const userContent = research
    ? `${summary}\n\nDesign the visual system. Reference brand context:\n${research.slice(0, 1500)}`
    : summary;
  let raw = "";
  try {
    // Designer → gemini-2.5-flash. Flash is great at CSS/design JSON and is
    // measurably the fastest model we have access to for this kind of short
    // structured output.
    const response = await withTimeoutOrThrow(
      gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        config: {
          systemInstruction: DESIGNER_SYSTEM_PROMPT,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      }),
      15_000,
      "designer",
    );
    raw = response.text ?? "";
  } catch (_err) {
    // Fall through to default design below.
  }
  const design = extractJsonObject<DesignSystem>(raw);
  if (!design || !design.palette) {
    // Fallback to a sensible default so generation never blocks.
    return {
      theme: "light",
      palette: {
        primary: "#7c3aed",
        secondary: "#22d3ee",
        accent: "#f97316",
        background: "#0b0b12",
        foreground: "#f8fafc",
        muted: "#1e1e2a",
      },
      typography: { sans: "Inter, system-ui, sans-serif" },
      radius: "lg",
      vibe: "Modern, polished, dark-first SaaS aesthetic",
      tailwindExtend: "{}",
      globalCSS: "",
    };
  }
  return design;
}

interface CodeGenResult {
  code: string;
  truncated: boolean;
  error?: string;
}

/**
 * Resolve the user's model preference into the concrete provider call we
 * should make. Only "claude-sonnet-4-6" overrides the default; everything
 * else (auto, unknown, or explicit gemini-2.5-flash) routes to Gemini Flash
 * streaming. Architect/Backend models are *not* affected — only the Coder
 * role obeys this preference.
 */
type CoderProvider = "gemini-flash" | "claude-sonnet" | "gpt-5";
function resolveCoderProvider(coderModel?: string): CoderProvider {
  if (coderModel === "claude-sonnet-4-6") return "claude-sonnet";
  if (coderModel === "gpt-5" || coderModel === "gpt-5-codex" || coderModel === "gpt-5.4") return "gpt-5";
  return "gemini-flash";
}

async function generateFrontendCode(
  plan: ProjectPlan,
  design: DesignSystem,
  research: string,
  prompt: string,
  onChars: (chars: number) => void,
  coderModel: string | undefined,
  language: GenLanguage,
): Promise<CodeGenResult> {
  const planSummary = JSON.stringify({
    title: plan.title,
    pages: plan.pages,
    components: plan.components,
    hooks: plan.hooks,
    utils: plan.utils,
    dataModels: plan.dataModels,
    requiredFiles: plan.frontendFiles,
  });
  const designSummary = JSON.stringify(design);

  const userContent = `User request: ${prompt}

Project plan (you MUST implement every listed file):
${planSummary}

Design system (apply EXACTLY in tailwind.config.ts theme.extend and src/index.css):
${designSummary}
${research ? `\nResearch context (visual reference, treat as ground truth):\n${research.slice(0, 2000)}` : ""}

Now produce the JSON object with frontendCode containing every listed file.`;

  // Frontend Engineer (the "Coder") — model is selectable per-app.
  // Default ("auto" / "gemini-2.5-flash") → Gemini Flash streaming, which is
  // the fastest bulk-code model we have access to (~238 tok/s vs ~85 tok/s for
  // Sonnet). 32k output tokens ≈ 128KB is plenty of headroom for the bundle.
  // Override "claude-sonnet-4-6" → Anthropic non-streaming Sonnet, slower but
  // sometimes higher quality. The autonomous validate-then-patch loop below
  // is our safety net for any quality slips either way.
  const provider = resolveCoderProvider(coderModel);
  const systemPrompt = buildFrontendSystemPrompt(language);
  let accumulated = "";
  let truncated = false;
  if (provider === "gemini-flash") {
    const stream = await gemini.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 32768,
        responseMimeType: "application/json",
      },
    });
    let lastReport = 0;
    let finishReason: string | undefined;
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        accumulated += text;
        if (accumulated.length - lastReport >= 1500) {
          lastReport = accumulated.length;
          onChars(accumulated.length);
        }
      }
      const fr = chunk.candidates?.[0]?.finishReason;
      if (fr) finishReason = fr;
    }
    truncated = finishReason === "MAX_TOKENS";
  } else if (provider === "gpt-5") {
    // OpenAI GPT-5 (Codex-grade) via Replit AI Integrations proxy.
    // Streaming for progress + 10-min cap avoidance.
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 32000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      stream: true,
    });
    let lastReport = 0;
    let finishReason: string | undefined;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        accumulated += delta;
        if (accumulated.length - lastReport >= 1500) {
          lastReport = accumulated.length;
          onChars(accumulated.length);
        }
      }
      const fr = chunk.choices[0]?.finish_reason;
      if (fr === "length") finishReason = "MAX_TOKENS";
    }
    truncated = finishReason === "MAX_TOKENS";
  } else {
    // Claude Sonnet — streaming required when max_tokens is large enough that
    // the call could take >10min. We get progressive char counts for the UI
    // bonus too.
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 64000,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
    let lastReport = 0;
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        accumulated += event.delta.text;
        if (accumulated.length - lastReport >= 1500) {
          lastReport = accumulated.length;
          onChars(accumulated.length);
        }
      }
    }
    const final = await stream.finalMessage();
    truncated = final.stop_reason === "max_tokens";
    onChars(accumulated.length);
  }
  const raw = accumulated.trim();
  if (!raw) {
    return { code: "", truncated, error: "Frontend agent returned no text." };
  }
  const parsed = extractJsonObject<{ frontendCode?: string }>(raw);
  if (!parsed || typeof parsed.frontendCode !== "string") {
    return { code: "", truncated, error: "JSON inválido del Frontend Engineer." };
  }
  // Propagate the truncation flag so the caller can warn the user that the
  // bundle is partial. Even when the JSON parses, the actual file contents
  // inside frontendCode can still be cut off mid-line.
  return { code: parsed.frontendCode, truncated };
}

async function generateBackendCode(
  plan: ProjectPlan,
  prompt: string,
): Promise<CodeGenResult> {
  if (!plan.backendNeeded) {
    return { code: "No backend required for this app.", truncated: false };
  }
  const planSummary = JSON.stringify({
    title: plan.title,
    dataModels: plan.dataModels,
    requiredFiles: plan.backendFiles,
  });
  const userContent = `User request: ${prompt}

Backend plan (implement every listed file with real Express handlers):
${planSummary}

Now produce the JSON object with backendCode.`;

  try {
    // Switched from gpt-5-mini → claude-sonnet-4-6. Sonnet 4.6 is faster than
    // gpt-5-mini through the proxy and produces noticeably better Express code,
    // matching the model used by the Frontend Engineer for consistency.
    const response = await withTimeoutOrThrow(
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 5000,
        system: BACKEND_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
      45_000,
      "backend-engineer",
    );
    const t = response.content.find((b) => b.type === "text");
    const raw = t && t.type === "text" ? t.text : "";
    const parsed = extractJsonObject<{ backendCode?: string }>(raw);
    if (!parsed || typeof parsed.backendCode !== "string") {
      // Backend was needed but agent flaked. Degrade with a visible note instead
      // of silently shipping an app without its planned backend.
      return {
        code: `// Backend agent did not return valid output. Files planned: ${plan.backendFiles.join(", ")}`,
        truncated: false,
        error: "backend-agent-invalid-json",
      };
    }
    return { code: parsed.backendCode, truncated: false };
  } catch (err) {
    return {
      code: `// Backend agent failed (${(err as Error).message}). Files planned: ${plan.backendFiles.join(", ")}`,
      truncated: false,
      error: (err as Error).message,
    };
  }
}

async function specifyIntegrations(
  plan: ProjectPlan,
  prompt: string,
): Promise<IntegrationSpec> {
  // Best-effort, capped at 8s. If it flakes, we just skip the SETUP.md.
  return withTimeout(
    (async () => {
      try {
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 800,
          system: INTEGRATION_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `App: ${plan.title}
Description: ${plan.description}
User prompt: ${prompt}
Pages: ${plan.pages.map((p) => p.name).join(", ")}
Data models: ${plan.dataModels.map((m) => m.name).join(", ") || "none"}
Backend needed: ${plan.backendNeeded}`,
            },
          ],
        });
        const t = response.content.find((b) => b.type === "text");
        const raw = t && t.type === "text" ? t.text : "";
        const parsed = extractJsonObject<IntegrationSpec>(raw);
        if (!parsed || !Array.isArray(parsed.services)) return { services: [] };
        return {
          services: parsed.services
            .filter((s): s is IntegrationService => !!s && typeof s.name === "string")
            .slice(0, 4)
            .map((s) => ({
              name: String(s.name).slice(0, 40),
              why: String(s.why ?? "").slice(0, 200),
              envVars: Array.isArray(s.envVars) ? s.envVars.slice(0, 3).map(String) : [],
              setupSteps: Array.isArray(s.setupSteps)
                ? s.setupSteps.slice(0, 4).map((x) => String(x).slice(0, 200))
                : [],
            })),
        };
      } catch {
        return { services: [] };
      }
    })(),
    8000,
    { services: [] },
  );
}

async function reviewBundle(
  frontendCode: string,
  plan: ProjectPlan,
): Promise<QAReport> {
  // Structured QA pass: ask Haiku for actionable issues. Best-effort, never blocks.
  return withTimeout(
    (async () => {
      try {
        const expected = plan.frontendFiles.join(", ");
        const sample = frontendCode.slice(0, 12000);
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 700,
          messages: [
            {
              role: "user",
              content: `You are a QA reviewer for a React+TS+Tailwind bundle. Spot ONLY OBVIOUS bugs that would break runtime: missing imports, undefined symbols, wrong import paths, broken JSX, missing default exports for React components. Ignore stylistic issues.

Expected files: ${expected}

First 12KB of generated bundle:
${sample}

Return STRICT JSON ONLY:
{"ok":true} when everything looks fine,
OR {"ok":false,"issues":[{"file":"src/App.tsx","problem":"imports Button from non-existent path","fix":"Update import to './components/Button' or remove the import"}]}

Max 5 issues. Output ONLY the JSON object.`,
            },
          ],
        });
        const t = response.content.find((b) => b.type === "text");
        const raw = t && t.type === "text" ? t.text : "";
        const parsed = extractJsonObject<QAReport>(raw);
        if (!parsed) return { ok: true, issues: [] };
        return {
          ok: parsed.ok !== false,
          issues: Array.isArray(parsed.issues)
            ? parsed.issues
                .filter((i): i is QAIssue => !!i && typeof i.file === "string")
                .slice(0, 5)
            : [],
        };
      } catch {
        return { ok: true, issues: [] };
      }
    })(),
    8000,
    { ok: true, issues: [] },
  );
}

async function generateTests(
  plan: ProjectPlan,
  frontendCode: string,
): Promise<string> {
  // Best-effort, capped at 30s. If it flakes, we just skip the tests.
  return withTimeout(
    (async () => {
      try {
        const sample = frontendCode.slice(0, 6000);
        const componentNames = plan.components.slice(0, 3).map((c) => c.name).join(", ") || "App";
        const utilNames = plan.utils.slice(0, 2).map((u) => u.name).join(", ") || "(none)";
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 3000,
          system: TEST_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Generate tests for "${plan.title}".
Main components to test: ${componentNames}
Main utils to test: ${utilNames}
Pages: ${plan.pages.map((p) => `${p.name} (${p.route})`).join(", ")}

First 6KB of the frontend bundle (so you know real symbol names and import paths):
${sample}

Return the JSON object with testCode.`,
            },
          ],
        });
        const t = response.content.find((b) => b.type === "text");
        const raw = t && t.type === "text" ? t.text : "";
        const parsed = extractJsonObject<{ testCode?: string }>(raw);
        if (!parsed || typeof parsed.testCode !== "string") return "";
        // Sanity: must contain our file separator and at least one test file.
        if (!parsed.testCode.includes("// === FILE:")) return "";
        return parsed.testCode;
      } catch {
        return "";
      }
    })(),
    12_000,
    "",
  );
}

export async function patchBundle(
  frontendCode: string,
  issues: QAIssue[],
  language: GenLanguage = "typescript",
  memoryContext: string = "",
): Promise<string | null> {
  if (issues.length === 0) return null;
  const issueList = issues
    .map((i, idx) => `${idx + 1}. [${i.file}] Problem: ${i.problem}\n   Fix: ${i.fix}`)
    .join("\n");
  return withTimeout(
    (async () => {
      try {
        // Patcher → claude-haiku-4-5: small diffs on a known bundle, ~3× faster than Sonnet.
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 16000,
          system: buildPatcherSystemPrompt(language),
          messages: [
            {
              role: "user",
              content: `ISSUES TO FIX:
${issueList}
${memoryContext}
CURRENT FRONTEND BUNDLE:
${frontendCode}

Return the FULL patched bundle as JSON.`,
            },
          ],
        });
        const t = response.content.find((b) => b.type === "text");
        const raw = t && t.type === "text" ? t.text : "";
        const parsed = extractJsonObject<{ frontendCode?: string }>(raw);
        if (!parsed || typeof parsed.frontendCode !== "string") return null;
        if (parsed.frontendCode.length < frontendCode.length / 2) {
          // Sanity check: patcher returned something suspiciously short. Reject.
          return null;
        }
        return parsed.frontendCode;
      } catch {
        return null;
      }
    })(),
    35_000,
    null,
  );
}

function buildSetupNotes(spec: IntegrationSpec): string {
  if (spec.services.length === 0) return "";
  const lines: string[] = [
    "# Setup",
    "",
    "Esta app usa los siguientes servicios externos. Configúralos antes de desplegar.",
    "",
  ];
  for (const svc of spec.services) {
    lines.push(`## ${svc.name}`);
    lines.push("");
    if (svc.why) lines.push(`**Para qué**: ${svc.why}`);
    if (svc.envVars.length > 0) {
      lines.push("");
      lines.push("**Variables de entorno:**");
      for (const v of svc.envVars) lines.push(`- \`${v}\``);
    }
    if (svc.setupSteps.length > 0) {
      lines.push("");
      lines.push("**Pasos:**");
      svc.setupSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    }
    lines.push("");
  }
  return `\n\n// === FILE: SETUP.md ===\n${lines.join("\n")}`;
}

/* ------------------------ validate → patch loop --------------------------- */

/**
 * Run the autonomous validate-then-patch loop on a frontend bundle.
 *
 * Real esbuild build in memory ("ejecutar el código"). If it fails, we feed
 * the build errors back to the patcher and try again. Bounded to MAX_ITERATIONS
 * so the pipeline can never spiral.
 *
 * Used by BOTH initial generation and edit mode — keeps any broken bundle
 * (trailing commas, garbage tokens, missing imports) from reaching the user
 * regardless of how the bundle was produced.
 */
async function runValidatePatchLoop(
  initialBundle: string,
  qaReport: QAReport,
  onProgress: ((p: GenerateProgress) => void) | undefined,
  baseProgressStart: number,
  language: GenLanguage,
  log?: AgentLog,
  /**
   * Optional phase gates — when the planner explicitly excludes "validate" or
   * "patch" the loop is short-circuited and the initial bundle is returned
   * untouched. Defaults to `{ validate: true, patch: true }` so all existing
   * call sites keep their current behaviour.
   */
  phaseGates: { validate: boolean; patch: boolean } = { validate: true, patch: true },
): Promise<string> {
  const MAX_ITERATIONS = 2;
  let finalFrontend = initialBundle;
  const noop: AgentLog = () => {};
  const emit = log ?? noop;

  // If validation is disabled by the planner there's nothing to verify or
  // patch — ship the bundle as-is. This is intentional: only the most trivial
  // scopes (e.g. fast-patch) should ever skip validation.
  if (!phaseGates.validate) {
    emit("validator", "Plan dice saltar validación (alcance reducido). Bundle entregado sin verificar.", "warn");
    return finalFrontend;
  }

  // Seed the loop with the QA-suggested issues so they're addressed even if
  // the bundle technically builds.
  let pendingIssues: BuildIssue[] = qaReport.ok
    ? []
    : qaReport.issues.map((i) => ({ file: i.file, message: `${i.problem} → ${i.fix}` }));

  // Track the last (errorMessage, patchedBundle) pair so we can persist a
  // successful fix into agent_memory at the end of the loop.
  let lastErrorMessage: string | null = null;
  let lastPatchedBundle: string | null = null;

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    const baseProgress = baseProgressStart + iter * 3;
    onProgress?.({
      phase: "validating",
      progress: Math.min(baseProgress, 92),
      note: `🔍 Validación en memoria (intento ${iter}/${MAX_ITERATIONS})…`,
    });
    emit("validator", iter === 1 ? "🔍 build" : `🔍 build · intento ${iter}`);
    const validation = await validateBundle(finalFrontend);

    // Combine real build errors with any unresolved QA suggestions on the first
    // pass. After the first pass, only build errors drive the loop.
    const combined: BuildIssue[] = iter === 1
      ? [...validation.issues, ...pendingIssues].slice(0, 6)
      : validation.issues.slice(0, 6);
    pendingIssues = [];

    if (validation.ok && combined.length === 0) {
      onProgress?.({
        phase: "validating",
        progress: Math.min(baseProgress + 1, 93),
        note: `✅ Build OK en memoria (${validation.filesAnalyzed} archivo(s), ${validation.durationMs} ms).`,
      });
      emit("validator", `✓ build OK · ${validation.filesAnalyzed} archivo${validation.filesAnalyzed === 1 ? "" : "s"}`);
      // Persist the last successful patch into agent_memory so future runs
      // hitting the same error can reuse the fix.
      if (lastErrorMessage && lastPatchedBundle) {
        // Memory is shared across apps/users so we MUST NOT persist large
        // bundle slices. extractFixHint pulls only the lines around the
        // error location and redactSecrets strips obvious credentials.
        const fixHint = extractFixHint(lastPatchedBundle, lastErrorMessage);
        rememberPatch({
          errorMessage: redactSecrets(lastErrorMessage).slice(0, 1000),
          errorContext: `iter=${iter} bundleLen=${lastPatchedBundle.length}`,
          patch: fixHint,
          language,
        }).then((entry) => {
          if (entry) emit("memory", `🧠 aprendí esta solución (id ${entry.id})`);
        }).catch(() => {});
      }
      break;
    }

    if (iter === MAX_ITERATIONS) {
      // Out of iterations — keep the best bundle we have and surface a note.
      onProgress?.({
        phase: "validating",
        progress: 92,
        note: `⚠️ Quedan ${combined.length} problema(s) tras ${MAX_ITERATIONS} intentos. Empaquetando lo que hay…`,
      });
      emit("validator", `△ ${combined.length} detalle${combined.length === 1 ? "" : "s"} pendiente${combined.length === 1 ? "" : "s"}`, "warn");
      break;
    }

    onProgress?.({
      phase: "fixing",
      progress: Math.min(baseProgress + 2, 92),
      note: `🔧 Auto-reparación ${iter}/${MAX_ITERATIONS}: corrigiendo ${combined.length} problema(s)…`,
    });
    emit("patcher", `🔧 patch · ${combined.length}`);
    // Build a recall block from agent_memory using the FIRST issue's message
    // as the semantic query. Threshold filters keep low-confidence matches out.
    const primaryError = `${combined[0].message}${combined[0].file ? ` (in ${combined[0].file})` : ""}`;
    let memoryBlock = "";
    try {
      const matches = await recallSimilar(primaryError, { limit: 3, threshold: 0.7, language });
      if (matches.length > 0) {
        emit("memory", `🧠 recall · ${matches.length} fix(es) similar(es)`);
        memoryBlock = buildRecallExamplesBlock(matches);
      }
    } catch {
      /* recall is best-effort */
    }
    lastErrorMessage = primaryError;
    // Honour the planner's `patch` gate. When disabled we still surface the
    // validation findings via the log so the issue isn't silent, but we don't
    // attempt a fix.
    if (!phaseGates.patch) {
      emit("patcher", "Plan dice saltar parcheo. Errores reportados pero no corregidos.", "warn");
      break;
    }
    const patched = await patchBundle(
      finalFrontend,
      combined.map((i) => ({
        file: i.file,
        problem: `Build error${i.line ? ` at line ${i.line}` : ""}: ${i.message}`,
        fix: "Fix the import / symbol / syntax so the file compiles.",
      })),
      language,
      memoryBlock,
    );
    if (!patched) {
      onProgress?.({
        phase: "fixing",
        progress: Math.min(baseProgress + 2, 92),
        note: `⚠️ El reparador no pudo aplicar el cambio. Empaquetando bundle anterior…`,
      });
      emit("patcher", "△ patch sin cambios", "warn");
      break;
    }
    if (patched === finalFrontend) {
      onProgress?.({
        phase: "fixing",
        progress: Math.min(baseProgress + 2, 92),
        note: `⚠️ El reparador devolvió el mismo bundle (sin cambios). Cortando bucle.`,
      });
      emit("patcher", "△ patch idempotente", "warn");
      break;
    }
    emit("patcher", "✓ patch aplicado");
    finalFrontend = patched;
    lastPatchedBundle = patched;
  }

  return finalFrontend;
}

/* ----------------------------- edit mode ---------------------------------- */

function buildEditSystemPrompt(language: GenLanguage): string {
  const isTS = language === "typescript";
  const tsLine = isTS
    ? "- This is a TypeScript app. Type annotations and interfaces are fine."
    : "- This is a plain JavaScript app (.jsx/.js). Do NOT introduce ANY TypeScript syntax: no `: Type`, `interface`, `type Foo = …`, `as Foo`, no generics like `useState<string>`. The current bundle has no tsconfig — keep it that way.";
  return `You are Maris AI editing an existing web app. You are a careful, surgical engineer: you understand what the user is asking for, you change ONLY what's needed to deliver it, and you preserve everything else exactly. The user's iteration loop depends on you NOT silently breaking unrelated things.

Output STRICT JSON only matching:
{"title":"…","description":"…","techStack":[…],"frontendCode":"…","backendCode":"…"}

THINK BEFORE EDITING (do this internally, do not output the reasoning):
1. What does the user want? (literal request, plus what they OBVIOUSLY mean — "add a search bar" implies it should actually filter the existing list).
2. Which files do I need to touch? Usually 1-4 files. Touching every file is a red flag.
3. What MUST stay the same? Other pages, working components, image URLs, the design system, the navigation structure, working state.
4. After your edit, do all imports still resolve, do all routes still render, do all state hooks still work?

CHANGE DISCIPLINE — preserve unless asked to change:
- Keep file count and file names as-is. If the user says "add an X" → ADD a file/section, don't restructure.
- Keep the title, description, techStack, color palette and typography unless the user explicitly asks to change them.
- NEVER replace a working page/component with a simpler version. If you're rewriting it, the new version must do EVERYTHING the old one did, plus the requested change.
- Preserve any \`/api/apps/<n>/images/<n>\` URLs and any \`https://\`-prefixed image URLs VERBATIM — those are real generated images, NOT placeholders. Re-using an existing image URL is fine; inventing a new one is not.
- Preserve all existing \`useState\`/\`useReducer\`/\`useEffect\` logic that's unrelated to the request. If you must touch a hook, keep its dependency array correct.

BACKEND EDITS — backendCode IS in scope:
- The user can absolutely ask for backend work in this same chat (new endpoints, schema changes, auth, payments, "crea un backend completo", "añade una API para X"). When they do, you MUST rewrite \`backendCode\` to satisfy the request. Returning the old backendCode unchanged when the user asked for backend work is a hard failure — the user will think the agent is broken.
- For any user request containing words like "backend", "API", "endpoint", "ruta", "servidor", "base de datos", "db", "auth", "login", "registro", "guardar", "persistir", "subir", "upload", "stripe", "pago", "webhook" → treat backendCode as the primary scope and rewrite it as needed. Wire the matching frontend changes (fetch calls, forms) at the same time.
- A complete Node/Express + Drizzle + Postgres backend in \`backendCode\` should include: \`package.json\`, \`tsconfig.json\`, \`src/index.ts\` (express + helmet + cors + json + error middleware + request logging), one \`src/routes/<resource>.ts\` per resource, \`src/db/schema.ts\` (drizzle), \`src/db/seed.ts\` if useful, plus any \`src/lib/<helper>.ts\` (logger, error helpers). Use '// === FILE: <path> ===' separators. Use zod for input validation, helmet for security headers, cors locked to the frontend origin.
- If the current bundle has no backend yet ("No backend required for this app.") and the user is now asking for one, REPLACE that placeholder with a full backend bundle as described above — don't keep the placeholder.
- The "1-4 files" guidance above is for tweaks; full-backend or full-feature requests are allowed and expected to touch many files. Use judgment.

QUALITY — when ADDING new UI, match the existing style:
- Use the same Tailwind utility patterns the existing files use (same spacing scale, border style, shadow level, radius, color tokens).
- Reuse existing components when possible (e.g. an existing Button) instead of creating ad-hoc styled elements.
- Add icons (lucide-react) where it visually fits with the rest.
- Add hover/focus/active states. Add transitions. Match the polish of the rest of the app.
- All new copy in Spanish (es-ES).

LANGUAGE — ALL user-visible copy MUST be in Spanish (es-ES). Identifiers stay in English.

SYNTAX — code MUST parse with a strict ${isTS ? "TypeScript" : "JavaScript"} parser:
${tsLine}
- NEVER produce \`,,\` (double comma), \`,)\`, \`,]\` or \`,}\` patterns. No trailing commas immediately before a close token.
- NO non-ASCII characters inside identifiers/keywords/punctuation. Non-ASCII allowed ONLY in string literals and JSX text.
- Every string must be terminated with the same quote it started with (watch out for long URLs and Spanish descriptions with apostrophes).
- Every brace, bracket, paren and JSX tag must close.
- Every \`.map\` returns elements with a stable \`key\` prop.

WOUTER v3 — never write \`<Link><a>…</a></Link>\` (nested anchors crash the preview with "removeChild ... not a child"). \`<Link>\` already IS the \`<a>\`; pass className/onClick directly to it.

EXPORTS & IMPORTS — match every \`import { X }\` to a named export and every \`import X from\` to a default export. If you change a file's export style, also update its importers.
- Bare imports must reference real packages: react, react-dom, wouter, lucide-react, clsx, tailwind-merge, date-fns, zod. Do not invent package names.

Rules:
- Use '// === FILE: <path> ===' separators inside frontendCode/backendCode.
- Return the FULL updated bundles (every file, not just the changed ones).
- Do NOT regress existing features. No TODOs. No "I'll skip this for now" — if you can't satisfy a sub-part of the request, do the part you can and leave the rest exactly as it was.
- NO SIZE LIMIT — return the full bundle no matter how big. Close every brace and quote. Output ONLY the JSON object.`;
}

/**
 * Translate a raw file path (as the model emits it inside `// === FILE: … ===`)
 * into a friendly Spanish phrase suitable for the end-user log. We deliberately
 * NEVER show the literal path — the user doesn't care that the file is
 * `src/pages/Anuncios.tsx`, they care that "the robot is working on the Anuncios
 * page". This mirrors how emergent.sh communicates progress.
 *
 * Order of checks matters: more specific patterns first, then folder-based
 * fallbacks, then a generic "tocando archivos" catch-all.
 */
function friendlyFileLabel(rawPath: string, isBackend: boolean): string {
  // emergent.sh-style terse log: "📂 folder/file" — no verbs like
  // "Construyendo" or "Trabajando en…", just a quick visual flash of the
  // file the agent is touching, half-truncated for vibes. The previous
  // verbose Spanish phrasing made the stream feel slow ("the agent must
  // be doing a lot of thinking") even though it was actually fast — terse
  // file tokens make the same speed feel snappy and competent.
  const cleaned = rawPath.replace(/^[./\\]+/, "").trim();

  // Strip any leading "src/" so "src/pages/Anuncios.tsx" becomes
  // "pages/Anuncios" — same info, less noise. We keep nested folders
  // beyond the first because they're often meaningful (routes/api/foo).
  const noSrc = cleaned.replace(/^src\//i, "");

  // Drop the file extension. emergent.sh shows the bare path; the
  // extension just adds visual noise that all looks the same (.tsx, .ts).
  const noExt = noSrc.replace(/\.[a-z0-9]+$/i, "");

  // Cap to 36 chars with an ellipsis so very deep paths still fit on one
  // line in the narrow log column ("se vea como medio cortado").
  const MAX = 36;
  const truncated =
    noExt.length > MAX ? noExt.slice(0, MAX - 1) + "…" : noExt;

  // Backend files get a different glyph so the user can SEE the agent
  // crossing from frontend to backend.
  const glyph = isBackend ? "🔧" : "📂";
  return `${glyph} ${truncated}`;
}

async function singleEditPass(
  prompt: string,
  previous: PreviousApp,
  onChars: (chars: number) => void,
  coderModel: string | undefined,
  language: GenLanguage,
  log?: AgentLog,
): Promise<GeneratedAppPayload> {
  // Best-effort logger so call sites stay one-liners. Edit-mode logs are
  // pure UX — losing one must never cascade into a generation failure.
  const emit: AgentLog = log ?? (() => {});
  const userContent = `CURRENT APP:
- Title: ${previous.title}
- Description: ${previous.description}
- Tech stack: ${previous.techStack.join(", ")}

CURRENT FRONTEND CODE:
${previous.frontendCode}

CURRENT BACKEND CODE:
${previous.backendCode}

USER'S CHANGE REQUEST:
${prompt}

Return the FULL updated app as JSON.`;

  // Edit mode is also a "Coder" role → respects the same per-app model
  // override as the initial generation. Default Gemini Flash streaming, with
  // Anthropic Sonnet as the only opt-in alternative.
  const provider = resolveCoderProvider(coderModel);
  const systemPrompt = buildEditSystemPrompt(language);

  /**
   * Stateful "stream observer" that watches the JSON text as it pours out of
   * the model and surfaces meaningful events to the live log:
   *
   *  - When the stream first crosses the `"frontendCode": "` key we log
   *    "Reescribiendo el frontend…" so the user sees something instead of
   *    a 90-second silence.
   *  - Each `// === FILE: <path> ===` marker spotted inside frontendCode or
   *    backendCode emits a coder log line — exactly what emergent.sh does to
   *    convey "the agent is writing src/pages/Anuncios.tsx right now".
   *  - When the stream hits `"backendCode": "` we log "Generando backend…"
   *    so users asking for a full backend can SEE the backend phase begin.
   *
   * The observer only ever scans the *new* tail of the buffer (not the whole
   * accumulated text) so it stays cheap even on 100KB+ responses. It is
   * deliberately defensive: malformed streams must never crash the pipeline.
   */
  function makeStreamObserver() {
    let scanFrom = 0;
    let sawFrontendKey = false;
    let sawBackendKey = false;
    let inBackend = false;
    const seenFiles = new Set<string>();
    const FILE_MARKER = /\/\/\s*===\s*FILE:\s*([^=\n]+?)\s*===/g;
    return (buffer: string) => {
      try {
        const tail = buffer.slice(Math.max(0, scanFrom - 64));
        if (!sawFrontendKey && /"frontendCode"\s*:\s*"/.test(tail)) {
          sawFrontendKey = true;
          emit("coder", "📁 frontend/");
        }
        if (!sawBackendKey && /"backendCode"\s*:\s*"/.test(tail)) {
          sawBackendKey = true;
          inBackend = true;
          emit("coder", "📁 backend/");
        }
        FILE_MARKER.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = FILE_MARKER.exec(tail)) !== null) {
          // Inside JSON the model often emits forward slashes as `\/` — strip
          // those so the file matcher works the same on either form.
          const file = m[1].replace(/\\\//g, "/").trim().slice(0, 120);
          if (file && !seenFiles.has(file)) {
            seenFiles.add(file);
            // Translate the raw path into a human phrase before logging it
            // so the user never sees `src/pages/Anuncios.tsx` — only
            // "Trabajando en la página de Anuncios".
            emit("coder", friendlyFileLabel(file, inBackend));
          }
        }
        scanFrom = buffer.length;
      } catch {
        /* observer is best-effort — ignore */
      }
    };
  }

  /**
   * Run the chosen provider with an optional reminder appended to the user
   * content. Returns the raw accumulated text plus the finish reason so the
   * caller can inspect & retry.
   */
  async function callModel(extraReminder: string): Promise<{ text: string; finishReason?: string }> {
    const finalUserContent = extraReminder
      ? `${userContent}\n\n${extraReminder}`
      : userContent;
    let accumulated = "";
    let finishReason: string | undefined;
    const observe = makeStreamObserver();
    // Fire char-progress every 500 chars instead of every 1500. The cost is
    // a few extra `onProgress` callbacks per generation — cheap — and the UI
    // gets a much smoother "X KB so far" counter (3× more updates) so the
    // user perceives the agent as actively working instead of stalled.
    const PROGRESS_EVERY = 500;
    if (provider === "gemini-flash") {
      const stream = await gemini.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: finalUserContent }] }],
        config: {
          systemInstruction: systemPrompt,
          // 65536 ≈ 200 KB of JSON-escaped text, enough for a full
          // frontend (~80 KB) + a full backend bundle (~50 KB) in one
          // edit pass. The previous 32768 cap silently truncated the
          // model's output mid-string for any "crea un backend completo"
          // request and crashed the JSON parser downstream.
          maxOutputTokens: 65536,
          responseMimeType: "application/json",
        },
      });
      let lastReport = 0;
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          accumulated += text;
          observe(accumulated);
          if (accumulated.length - lastReport >= PROGRESS_EVERY) {
            lastReport = accumulated.length;
            onChars(accumulated.length);
          }
        }
        const fr = chunk.candidates?.[0]?.finishReason;
        if (fr) finishReason = fr;
      }
    } else if (provider === "gpt-5") {
      // OpenAI GPT-5 (Codex-grade) via Replit AI Integrations proxy.
      // Streaming so we surface progress and avoid the 10-min non-stream cap.
      const stream = await openai.chat.completions.create({
        model: "gpt-5.4",
        // Match Sonnet's 64k headroom — see the matching note on the
        // Gemini branch above. 32k was clipping bigger edits in half.
        max_completion_tokens: 64000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: finalUserContent },
        ],
        stream: true,
      });
      let lastReport = 0;
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          accumulated += delta;
          observe(accumulated);
          if (accumulated.length - lastReport >= PROGRESS_EVERY) {
            lastReport = accumulated.length;
            onChars(accumulated.length);
          }
        }
        const fr = chunk.choices[0]?.finish_reason;
        if (fr === "length") finishReason = "MAX_TOKENS";
      }
    } else {
      // Claude Sonnet — streaming so we don't hit the >10min non-stream cap.
      // 64k tokens is what we use during initial generation; same here.
      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 64000,
        system: systemPrompt,
        messages: [{ role: "user", content: finalUserContent }],
      });
      let lastReport = 0;
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          accumulated += event.delta.text;
          observe(accumulated);
          if (accumulated.length - lastReport >= PROGRESS_EVERY) {
            lastReport = accumulated.length;
            onChars(accumulated.length);
          }
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "max_tokens") finishReason = "MAX_TOKENS";
      onChars(accumulated.length);
    }
    return { text: accumulated, finishReason };
  }

  // First attempt + a single strict retry. The model occasionally returns
  // pre-amble text or wraps the JSON in a code fence which breaks
  // extractJsonObject. The retry adds an unambiguous reminder that the entire
  // response must be a JSON object with the documented keys.
  let { text: accumulated, finishReason } = await callModel("");

  // Truncation short-circuit: if the first attempt already hit the token
  // ceiling, retrying with the SAME prompt (and the same ceiling) will
  // burn another 30-90s of model time and end up with the same broken
  // JSON. Surface a clear, actionable error immediately instead of
  // running the wasteful retry. The user gets a refund + a clear next
  // step from the catch block in apps.ts.
  if (finishReason === "MAX_TOKENS") {
    emit(
      "coder",
      "△ respuesta cortada por límite de tokens",
      "warn",
    );
    throw new Error(
      "El cambio era demasiado grande para una sola pasada. " +
      "Pídelo en partes más pequeñas (por ejemplo: primero el backend, " +
      "y luego conectar el frontend) o cámbialo al modelo de calidad " +
      "(Claude Sonnet) desde el menú \"Modelo\".",
    );
  }

  let parsed = extractJsonObject<GeneratedAppPayload>(accumulated.trim());
  if (!parsed || typeof parsed.frontendCode !== "string") {
    emit("coder", "↻ reintento estricto");
    const retry = await callModel(
      "RECORDATORIO ESTRICTO: tu respuesta DEBE ser exclusivamente un objeto JSON válido " +
      "(sin texto antes ni después, sin ```json ni comentarios) con las claves " +
      `"title", "description", "techStack", "frontendCode" y "backendCode". ` +
      `frontendCode debe contener TODOS los archivos del frontend en el formato // === FILE: path === ` +
      "y backendCode el server.js completo (o un placeholder si no hay backend).",
    );
    accumulated = retry.text;
    finishReason = retry.finishReason;
    // Same short-circuit on the retry — don't waste time parsing if we
    // already know the response is truncated.
    if (finishReason === "MAX_TOKENS") {
      throw new Error(
        "El cambio era demasiado grande para una sola pasada. " +
        "Pídelo en partes más pequeñas o cambia al modelo de calidad " +
        "(Claude Sonnet) desde el menú \"Modelo\".",
      );
    }
    parsed = extractJsonObject<GeneratedAppPayload>(accumulated.trim());
  }
  if (!parsed || typeof parsed.frontendCode !== "string") {
    const preview = accumulated.slice(0, 200).replace(/\s+/g, " ").trim();
    throw new Error(
      `No pudimos analizar la respuesta del modelo en modo edición. ` +
      `Inicio de la respuesta: "${preview}…". Vuelve a intentarlo o cambia de modelo en el menú "Modelo".`,
    );
  }
  return {
    title: (parsed.title ?? previous.title).slice(0, 200),
    description: (parsed.description ?? previous.description).slice(0, 1000),
    techStack: Array.isArray(parsed.techStack) ? parsed.techStack : previous.techStack,
    frontendCode: parsed.frontendCode,
    backendCode: parsed.backendCode || "No backend required for this app.",
  };
}

/* ----------------------------- public API --------------------------------- */

/**
 * Fast path for trivial edits ("change button color", "rename title", "fix
 * typo"). Bypasses singleEditPass (which sends ALL the bundle through the
 * coder model) and instead asks the patcher to apply the user's request
 * directly. ~3× cheaper and ~5× faster than a full edit pass; falls back to
 * the full pipeline if the patcher returns nothing or the bundle still has
 * build errors after one validate iteration.
 */
async function fastPatchEdit(
  prompt: string,
  previous: PreviousApp,
  language: GenLanguage,
  log: AgentLog,
  onProgress?: (p: GenerateProgress) => void,
): Promise<GeneratedAppPayload | null> {
  onProgress?.({ phase: "fixing", progress: 30, note: "Aplicando parche directo…" });
  log("patcher", "Aplicando tu cambio directamente al bundle (modo rápido).");

  // Recall similar past fixes by user prompt — for cosmetic edits the prompt
  // itself is the best semantic key.
  let memoryBlock = "";
  try {
    const matches = await recallSimilar(prompt, { limit: 2, threshold: 0.78, language });
    if (matches.length > 0) {
      log("memory", `🧠 recall · ${matches.length} cambio(s) similar(es) ya hechos`);
      memoryBlock = buildRecallExamplesBlock(matches);
    }
  } catch {
    /* best-effort */
  }

  const issues: QAIssue[] = [
    {
      file: "user-request",
      problem: prompt.slice(0, 1500),
      fix: "Aplica EXACTAMENTE lo que pide la usuaria, modificando solo lo mínimo necesario. NO reescribas archivos enteros si no hace falta. Conserva todo el resto del bundle intacto.",
    },
  ];

  const patched = await patchBundle(previous.frontendCode, issues, language, memoryBlock);
  if (!patched || patched.length < 100) {
    log("patcher", "El parche directo devolvió un bundle vacío.", "warn");
    return null;
  }

  onProgress?.({ phase: "validating", progress: 75, note: "Validando el parche…" });
  const validation = await validateBundle(patched);
  if (!validation.ok && validation.issues.length > 0) {
    // Give it ONE auto-repair attempt before bailing to the full pipeline.
    const repaired = await runValidatePatchLoop(patched, { ok: true, issues: [] }, onProgress, 70, language, log);
    // CRITICAL: re-validate the repaired bundle. If it's STILL broken we must
    // fall back to the full edit pipeline rather than ship something the user
    // has to debug. Returning null tells the caller in generateApp to retry.
    const finalValidation = await validateBundle(repaired);
    if (!finalValidation.ok && finalValidation.issues.length > 0) {
      log(
        "patcher",
        `Parche directo no convergió tras auto-reparación (${finalValidation.issues.length} error(es)). Cayendo al flujo completo.`,
        "warn",
      );
      return null;
    }
    onProgress?.({ phase: "validating", progress: 100, note: "Parche aplicado." });
    return {
      title: previous.title,
      description: previous.description,
      techStack: previous.techStack,
      frontendCode: repaired,
      backendCode: previous.backendCode,
    };
  }

  // Save successful fast-patch into memory. Fast-patch isn't keyed on a build
  // error, so the "errorMessage" is just the user prompt — and we deliberately
  // do NOT persist any of the patched bundle (no error location to anchor a
  // safe snippet, plus user prompts may carry app-specific intent that would
  // poison cross-app recall). We store a short opaque marker instead so the
  // recall surface for fast-patch entries stays useful only for exact prompt
  // recurrences without leaking code.
  rememberPatch({
    errorMessage: redactSecrets(prompt).slice(0, 400),
    errorContext: "fast-patch user request",
    patch: "(fast-patch convergence; no code stored — recall by prompt only)",
    language,
  }).then((entry) => {
    if (entry) log("memory", `🧠 aprendí este cambio (id ${entry.id})`);
  }).catch(() => {});

  onProgress?.({ phase: "validating", progress: 100, note: "Parche aplicado." });
  log("patcher", "✓ parche aplicado y validado.");
  return {
    title: previous.title,
    description: previous.description,
    techStack: previous.techStack,
    frontendCode: patched,
    backendCode: previous.backendCode,
  };
}

export interface PreviousApp {
  title: string;
  description: string;
  techStack: string[];
  frontendCode: string;
  backendCode: string;
}

export type PhaseErrorReporter = (
  phase: string,
  err: unknown,
  extras?: Record<string, unknown>,
) => void;

export async function generateApp(
  prompt: string,
  onProgress?: (p: GenerateProgress) => void,
  previous?: PreviousApp,
  coderModel?: string,
  language: GenLanguage = "typescript",
  onAgentLog?: AgentLog,
  attachments?: AttachmentContext[],
  onPhaseError?: PhaseErrorReporter,
  agentMemory?: AgentMemoryContext,
): Promise<GeneratedAppPayload> {
  // Tiny helper that wraps each pipeline phase. If the phase throws we report
  // the error to the caller (Sentry capture lives there) tagged with the
  // phase name, then re-throw so the outer flow still aborts. Returning the
  // value untouched on success keeps call sites readable.
  const runPhase = async <T>(phase: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      try {
        onPhaseError?.(phase, err);
      } catch {
        /* monitoring must never crash the pipeline */
      }
      throw err;
    }
  };
  // Prepend persistent agent memory (cross-app preferences, per-app notes,
  // recent chat history). Same pattern as attachments: one upfront concat so
  // every downstream stage (planner, architect, coder, patcher) sees the
  // exact same enriched prompt without needing the memory parameter threaded
  // through every signature. Empty when there is nothing to inject, so it's
  // safe for first-time users / brand-new apps.
  const memoryBlock = formatMemoryBlock(agentMemory);
  if (memoryBlock) {
    prompt = `${memoryBlock}\n${prompt}`;
  }
  // Prepend any user-uploaded attachments to the prompt. The block is a clearly
  // delimited section so models know it's authoritative context (not part of
  // the natural-language ask). We do this once, before any agent runs, so every
  // downstream stage sees the same enriched prompt.
  const attachmentBlock = buildAttachmentBlock(attachments);
  if (attachmentBlock) {
    prompt = `${attachmentBlock}\n${prompt}`;
  }
  // Local helper so every call site is one line. The callback itself is
  // responsible for never throwing, but wrap defensively here too — a bug in
  // the caller's persistence layer must NOT take down a 5-credit generation.
  const log: AgentLog = (agent, message, level = "info") => {
    try {
      onAgentLog?.(agent, message, level);
    } catch {
      /* swallow — logs are best-effort */
    }
  };
  // 🧭 Planner runs FIRST for every request (new app or edit). It decides
  // which phases of the multi-agent pipeline to run. For "fast-patch" on an
  // existing app it shortcuts straight to the patcher; otherwise the
  // ExecutionPlan.phases array gates each downstream phase below.
  onProgress?.({ phase: "generating", progress: 5, note: "Planificando…" });
  let execPlan = await runPhase("planner", () =>
    planExecution(prompt, { hasExistingApp: !!previous }),
  );
  log("planner", planSummaryEs(execPlan));

  // Edit mode: skip the multi-agent pipeline; we already have a working app.
  if (previous) {
    // Fast-patch shortcut: skip the full coder pass and ask the patcher to
    // apply the user's request directly to the bundle. Saves ~60–90s on
    // cosmetic / one-line edits.
    if (execPlan.scope === "fast-patch") {
      const fastResult = await fastPatchEdit(prompt, previous, language, log, onProgress);
      if (fastResult) return fastResult;
      log("planner", "El parche directo no convergió; vuelvo al flujo de edición completo.", "warn");
      // CRITICAL: when fast-patch fails the fallback MUST run the full
      // validate+patch loop. Otherwise the original PLAN_FAST_PATCH gates
      // (`phases = ["patch"]`) would short-circuit runValidatePatchLoop and
      // ship unvalidated code. Promote the plan to "feature" so the rest of
      // this function takes the architected, validated, patched path.
      execPlan = {
        ...execPlan,
        scope: "feature",
        phases: PLAN_FEATURE.phases,
      };
      log("planner", "Promovido a alcance 'feature' con validación y parche obligatorios.");
    }

    onProgress?.({ phase: "generating", progress: 20, note: "Aplicando cambios al código…" });
    log("system", `Empezando a editar tu app (${Math.round(previous.frontendCode.length / 1000)} KB de código).`);
    log("coder", "Calentando motores…");
    const TARGET = 50_000;
    // Heartbeat every ~2.5s so the log feels alive even when the model is
    // chewing through a long backend bundle without crossing a file marker.
    let lastHeartbeatAt = Date.now();
    const onChars = (chars: number) => {
      const ratio = Math.min(1, chars / TARGET);
      onProgress?.({
        phase: "generating",
        progress: 20 + Math.round(ratio * 50),
        note: `Aplicando cambios… (${Math.round(chars / 1000)} KB)`,
      });
      const now = Date.now();
      if (now - lastHeartbeatAt > 2500) {
        lastHeartbeatAt = now;
        log("coder", `Construyendo… ${Math.round(chars / 1000)} KB y subiendo.`);
      }
    };
    // Authoritative phase dispatch for edit-mode based on the planner's
    // ExecutionPlan. For "feature" scope the planner returns
    // architect+frontend+validate+patch — we log each phase explicitly so the
    // user sees the dispatcher driving them, then route through singleEditPass
    // (which internally is a fused architect+frontend pass — the model
    // re-plans the change AND emits the new code in a single call) followed
    // by the gated validate+patch loop.
    if (execPlan.scope === "feature") {
      log("planner", `Despachando fases del plan: ${execPlan.phases.join(" → ")}`);
      if (execPlan.phases.includes("architect")) {
        log("architect", "Re-arquitectando para acomodar la nueva funcionalidad…");
      }
      if (execPlan.phases.includes("frontend")) {
        log("coder", "Frontend: aplicando la nueva funcionalidad…");
      }
    } else {
      log("coder", "Pensando…");
    }
    const result = await singleEditPass(prompt, previous, onChars, coderModel, language, log);
    log("coder", "Código listo, comprobando que todo encaje…");

    // Edit mode used to skip validation entirely, so a single bad token from
    // the coder (trailing comma, garbage identifier like "née", invented
    // package import) would ship straight to the user's preview as a parse
    // error. Run the same validate→patch loop the initial pipeline uses so
    // edits get the same safety net — gated on the planner's phases array so
    // a future "ultra-fast" scope could disable them.
    const fixedFrontend = await runValidatePatchLoop(
      result.frontendCode,
      { ok: true, issues: [] },
      onProgress,
      /* baseProgressStart */ 70,
      language,
      log,
      {
        validate: execPlan.phases.includes("validate"),
        patch: execPlan.phases.includes("patch"),
      },
    );

    onProgress?.({ phase: "parsing", progress: 90, note: "Procesando archivos…" });
    log("system", "Empaquetando todo…");
    return { ...result, frontendCode: fixedFrontend };
  }

  // Phase gates derived from the planner's ExecutionPlan.phases. Skipped phases
  // get sensible defaults so downstream code doesn't need to special-case.
  const runResearch = execPlan.phases.includes("research");
  const runDesign = execPlan.phases.includes("design");
  const runIntegration = execPlan.phases.includes("integration");
  const runQa = execPlan.phases.includes("qa");
  const runTests = execPlan.phases.includes("tests");

  /* === Phase 1: research first (capped 7s), then architect with context === */
  let research = "";
  if (runResearch && shouldResearch(prompt)) {
    onProgress?.({
      phase: "researching",
      progress: 6,
      note: "🔎 Investigador buscando referencias en la web (máx 7s)…",
    });
    log("researcher", "Buscando referencias en la web (máx 7s)…");
    research = await runPhase("researcher", () => researchTopic(prompt));
    if (research) {
      log("researcher", `Contexto recopilado: ${Math.round(research.length / 100) / 10} KB de notas para el arquitecto.`);
    } else {
      log("researcher", "Sin resultados útiles, sigo sin contexto extra.", "warn");
    }
  } else if (!runResearch) {
    log("researcher", "Plan dice saltar investigación (alcance reducido).");
  } else {
    log("researcher", "Prompt suficientemente concreto, salto la búsqueda web.");
  }

  onProgress?.({
    phase: "architecting",
    progress: 14,
    note: research
      ? "🧠 Arquitecto diseñando estructura con contexto de la web…"
      : "🧠 Arquitecto diseñando la estructura del proyecto…",
  });
  log("architect", research ? "Diseñando estructura con contexto de la web…" : "Diseñando estructura del proyecto…");
  const plan = await runPhase("architect", () =>
    withTimeoutOrThrow(architectPlan(prompt, research), 60_000, "architect"),
  );

  // Defensive: ensure backendNeeded is a boolean so missing field doesn't
  // silently skip backend generation.
  if (typeof plan.backendNeeded !== "boolean") {
    plan.backendNeeded = false;
  }

  log(
    "architect",
    `Plan "${plan.title}" — ${plan.pages.length} página(s), ${plan.components.length} componente(s), ${plan.hooks.length} hook(s), backend: ${plan.backendNeeded ? "sí" : "no"}.`,
  );
  if (plan.pages.length > 0) {
    log("architect", `Páginas: ${plan.pages.slice(0, 6).map((p) => p.name).join(", ")}${plan.pages.length > 6 ? "…" : ""}`);
  }

  onProgress?.({
    phase: "integrating",
    progress: 20,
    note: `Plan listo: ${plan.pages.length} página(s), ${plan.components.length} componente(s). 🔌 Integraciones + 🎨 diseño en paralelo…`,
  });
  if (runIntegration) log("integration", "Analizando servicios externos necesarios…");
  if (runDesign) log("designer", "Eligiendo paleta y tipografía…");

  /* === Phase 2 (parallel): integrations + design system =================== */
  // Both phases are gated by the planner. When skipped we use minimal defaults
  // so the frontend coder still has *something* to hang structure on.
  const integrationPromise = runIntegration
    ? runPhase("integrations", () => specifyIntegrations(plan, prompt))
    : Promise.resolve({ services: [], envVars: [] });
  // Minimal but complete DesignSystem fallback used when the planner skips the
  // design phase. Must satisfy every required field so downstream coders don't
  // have to null-check.
  const FALLBACK_DESIGN: DesignSystem = {
    theme: "dark",
    vibe: "moderno y limpio",
    palette: {
      primary: "#7c3aed",
      secondary: "#0ea5e9",
      background: "#0a0a0a",
      surface: "#111111",
      text: "#fafafa",
    },
    typography: { sans: "Inter, system-ui, sans-serif", display: "Inter, system-ui, sans-serif" },
    radius: "0.75rem",
    tailwindExtend: "",
    globalCSS: "",
  };
  const designPromise: Promise<DesignSystem> = runDesign
    ? runPhase("design", () => designSystem(plan, research))
    : Promise.resolve(FALLBACK_DESIGN);
  const [integrationSpec, design] = await Promise.all([integrationPromise, designPromise]);
  if (!runIntegration) log("integration", "Plan dice saltar integraciones (alcance reducido).");
  if (!runDesign) log("designer", "Plan dice saltar diseño (uso paleta por defecto).");

  const integrationsNote = integrationSpec.services.length > 0
    ? `Servicios sugeridos: ${integrationSpec.services.map((s) => s.name).join(", ")}.`
    : "Sin servicios externos requeridos.";

  if (integrationSpec.services.length > 0) {
    log("integration", `${integrationSpec.services.length} servicio(s): ${integrationSpec.services.map((s) => s.name).join(", ")}.`);
  } else {
    log("integration", "Sin servicios externos requeridos.");
  }
  log("designer", `Tema "${design.vibe}" listo (${Object.keys(design.palette).length} colores, fuente ${design.typography.sans}).`);

  onProgress?.({
    phase: "generating",
    progress: 32,
    note: `${integrationsNote} Diseño "${design.vibe}" listo. ⚡ Ingeniero de frontend escribiendo ${plan.frontendFiles.length} archivo(s)…`,
  });
  log("coder", `Generando frontend: objetivo ${plan.frontendFiles.length} archivo(s)…`);
  if (plan.backendNeeded) log("coder", "Generando backend en paralelo…");

  /* === Phase 3 (parallel): frontend + backend ============================= */
  const TARGET_CHARS = 60_000;
  const frontendPromise = runPhase("frontend", () =>
    withTimeoutOrThrow(
      generateFrontendCode(plan, design, research, prompt, (chars) => {
        const ratio = Math.min(1, chars / TARGET_CHARS);
        onProgress?.({
          phase: "generating",
          progress: 32 + Math.round(ratio * 45),
          note: `⚡ Ingeniero de frontend: ${Math.round(chars / 1000)} KB escritos…`,
        });
      }, coderModel, language),
      600_000,
      "frontend-engineer",
    ),
  );
  // Backend is gated by BOTH the planner phase AND the architect's
  // backendNeeded flag. If the planner explicitly excludes "backend" we skip
  // the call regardless of what the architect thought.
  const runBackend = execPlan.phases.includes("backend") && plan.backendNeeded;
  const backendPromise = runBackend
    ? runPhase("backend", () => generateBackendCode(plan, prompt))
    : Promise.resolve(null);

  // Frontend is the one mandatory phase: every non-fast-patch flow must
  // produce a bundle. If a future planner scope drops "frontend" we'd have
  // nothing to ship — fail loudly instead of silently producing junk.
  if (!execPlan.phases.includes("frontend")) {
    throw new Error(
      `El planificador devolvió un alcance sin fase 'frontend' (${execPlan.scope}). ` +
        "No es posible generar una app sin código de frontend.",
    );
  }
  const [frontendResult, backendResult] = await Promise.all([frontendPromise, backendPromise]);

  if (!frontendResult.code) {
    log("coder", `Frontend falló: ${frontendResult.truncated ? "truncado por tokens" : (frontendResult.error ?? "desconocido")}`, "error");
    throw new Error(
      frontendResult.truncated
        ? "El ingeniero de frontend se quedó sin tokens. Pide una app más pequeña o más específica."
        : `No pudimos analizar el frontend. Detalle: ${frontendResult.error ?? "desconocido"}`,
    );
  }
  log("coder", `Frontend listo: ${Math.round(frontendResult.code.length / 1000)} KB.`);
  if (plan.backendNeeded && backendResult?.code) {
    log("coder", `Backend listo: ${Math.round(backendResult.code.length / 1000)} KB.`);
  }

  /* === Phase 4 (parallel): QA review + Test Engineer ====================== */
  onProgress?.({
    phase: "reviewing",
    progress: 78,
    note: "✅ Revisor de calidad y 🧪 Test Engineer trabajando en paralelo…",
  });
  if (runQa) log("qa", "Revisando bundle en busca de bugs…");
  if (runTests) log("qa", "Generando tests en paralelo…");
  // Both QA review and Test Engineer are gated. When QA is skipped we use an
  // empty report (no issues to feed to the patcher); when Tests is skipped
  // we get back null and the bundle ships without test files.
  const reviewPromise = runQa
    ? runPhase("qa", () => reviewBundle(frontendResult.code, plan))
    : Promise.resolve({ ok: true, issues: [] } as QAReport);
  const testsPromise = runTests
    ? runPhase("tests", () => generateTests(plan, frontendResult.code))
    : Promise.resolve(null);
  const [report, testCode] = await Promise.all([reviewPromise, testsPromise]);
  if (!runQa) log("qa", "Plan dice saltar QA (alcance reducido).");
  if (!runTests) log("qa", "Plan dice saltar generación de tests.");
  const issueCount = report.issues?.length ?? 0;
  log(
    "qa",
    issueCount > 0
      ? `${issueCount} issue(s) detectada(s) — pasando al patcher.`
      : "Sin issues detectadas en revisión inicial.",
    issueCount > 0 ? "warn" : "info",
  );

  /* === Phase 5: AUTONOMOUS LOOP (validate → patch → re-validate) ========== */
  // Same logic as before, now extracted into a helper so edit mode can reuse it.
  log("validator", "Compilando bundle con esbuild para verificar sintaxis y dependencias…");
  const finalFrontend = await runPhase("validate-patch-loop", () =>
    runValidatePatchLoop(
      frontendResult.code,
      report,
      onProgress,
      /* baseProgressStart */ 80,
      language,
      log,
      {
        validate: execPlan.phases.includes("validate"),
        patch: execPlan.phases.includes("patch"),
      },
    ),
  );

  const testNote = testCode ? "✅ Tests generados. " : "";
  if (testCode) log("qa", `Tests generados (${Math.round(testCode.length / 1000)} KB).`);
  onProgress?.({
    phase: "parsing",
    progress: 94,
    note: `${testNote}📦 Empaquetando archivos…`,
  });
  log("system", "Empaquetando archivos finales…");

  /* === Final assembly: tests + SETUP.md =================================== */
  const setupNotes = buildSetupNotes(integrationSpec);
  const testsAppendix = testCode ? `\n\n${testCode}` : "";

  return {
    title: plan.title.slice(0, 200),
    description: plan.description.slice(0, 1000),
    techStack: plan.techStack,
    frontendCode: finalFrontend + testsAppendix + setupNotes,
    backendCode: backendResult?.code || "No backend required for this app.",
    // Expose the architect's planned page list so the route layer can persist
    // it on `generated_apps.plannedPages`. The autonomous visual evaluator
    // reads that column and feeds the page names + routes to the vision model
    // as ground truth ("did the rendered app actually contain these screens?").
    plannedPages: plan.pages.map((p) => ({
      name: p.name,
      route: p.route,
      purpose: p.purpose,
    })),
  };
}
