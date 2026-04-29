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

/** Source language the generated app uses. Affects file extensions + prompt rules. */
export type GenLanguage = "typescript" | "javascript";

/* ============================================================================
 * AppForge multi-agent generation pipeline.
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
  return `You are AppForge's Senior Frontend Engineer. You ship interfaces that look like they came from a top product studio (Linear, Vercel, Stripe, Arc, Raycast). Generate a complete, production-quality React frontend as STRICT JSON only.

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

const BACKEND_SYSTEM_PROMPT = `You are AppForge's Senior Backend Engineer. Generate a complete, production-quality Node/Express backend as STRICT JSON only. Your code is what would pass a senior code review at a serious startup.

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

const ARCHITECT_SYSTEM_PROMPT = `You are AppForge's Senior Product Architect. You design the file structure for a web app the team will build. You think like a product manager AND an engineer: every page must serve a real user job, every component must have a clear purpose, and the structure must be ambitious enough to feel like a real product (not a demo).

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

const DESIGNER_SYSTEM_PROMPT = `You are AppForge's Senior UI/UX Designer. You produce design systems with personality — never generic, never "bootstrap blue". You think in terms of brands like Linear, Vercel, Notion, Stripe, Arc, Raycast, Cred, Loom: distinct, confident, modern. Output STRICT JSON only.

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

const INTEGRATION_SYSTEM_PROMPT = `You are AppForge's Integration Architect. Decide which third-party services this app realistically needs (auth, payments, AI, storage, email, maps, analytics).

Output STRICT JSON only:
{"services":[{"name":"Clerk","why":"User auth","envVars":["CLERK_PUBLISHABLE_KEY"],"setupSteps":["Create Clerk app","Copy publishable key into env"]}]}

Rules:
- Max 4 services. Only include what's truly needed for the requested app.
- Prefer well-known services: Clerk (auth), Stripe (payments), OpenAI/Anthropic (AI), Replit Object Storage / S3 (file uploads), Resend (email), Google Maps (maps), PostHog (analytics).
- Each service: 1-2 envVars, 2-3 short setupSteps in Spanish.
- If the app is a simple landing page, calculator, or self-contained demo, return {"services":[]}.
- Output ONLY the JSON object.`;

const TEST_SYSTEM_PROMPT = `You are AppForge's Test Engineer. Generate basic but REAL test scaffolding for a React+TS+Vite app.

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
  return `You are AppForge's Patcher. Apply ONLY the listed fixes to the frontend bundle. Preserve everything else exactly.

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

function shouldResearch(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return CLONE_KEYWORDS.some((kw) => lower.includes(kw));
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

async function researchTopic(prompt: string): Promise<string> {
  // Hard 7s cap so the pipeline stays snappy. Best-effort only.
  return withTimeout(
    (async () => {
      try {
        const research = await (anthropic.messages.create as any)({
          model: "claude-haiku-4-5",
          max_tokens: 1000,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
          messages: [
            {
              role: "user",
              content: `Quick web research (1 search max). Produce a concise brief (~250 words) for: "${prompt}"

Focus on: core sections/pages, signature features, brand colors & typography, sample content. Plain text only, no preamble.`,
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
    7000,
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
): Promise<string | null> {
  if (issues.length === 0) return null;
  const issueList = issues
    .map((i, idx) => `${idx + 1}. [${i.file}] Problem: ${i.problem}\n   Fix: ${i.fix}`)
    .join("\n");
  return withTimeout(
    (async () => {
      try {
        // Patcher (the "Debugger") → claude-haiku-4-5. Haiku is ~3x faster
        // than Sonnet and the patcher only needs to apply small, well-described
        // diffs to a known bundle, so the quality cost is minimal.
        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 16000,
          system: buildPatcherSystemPrompt(language),
          messages: [
            {
              role: "user",
              content: `ISSUES TO FIX:
${issueList}

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
): Promise<string> {
  const MAX_ITERATIONS = 2;
  let finalFrontend = initialBundle;

  // Seed the loop with the QA-suggested issues so they're addressed even if
  // the bundle technically builds.
  let pendingIssues: BuildIssue[] = qaReport.ok
    ? []
    : qaReport.issues.map((i) => ({ file: i.file, message: `${i.problem} → ${i.fix}` }));

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    const baseProgress = baseProgressStart + iter * 3;
    onProgress?.({
      phase: "validating",
      progress: Math.min(baseProgress, 92),
      note: `🔍 Validación en memoria (intento ${iter}/${MAX_ITERATIONS})…`,
    });
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
      break;
    }

    if (iter === MAX_ITERATIONS) {
      // Out of iterations — keep the best bundle we have and surface a note.
      onProgress?.({
        phase: "validating",
        progress: 92,
        note: `⚠️ Quedan ${combined.length} problema(s) tras ${MAX_ITERATIONS} intentos. Empaquetando lo que hay…`,
      });
      break;
    }

    onProgress?.({
      phase: "fixing",
      progress: Math.min(baseProgress + 2, 92),
      note: `🔧 Auto-reparación ${iter}/${MAX_ITERATIONS}: corrigiendo ${combined.length} problema(s)…`,
    });
    const patched = await patchBundle(
      finalFrontend,
      combined.map((i) => ({
        file: i.file,
        problem: `Build error${i.line ? ` at line ${i.line}` : ""}: ${i.message}`,
        fix: "Fix the import / symbol / syntax so the file compiles.",
      })),
      language,
    );
    if (!patched) {
      onProgress?.({
        phase: "fixing",
        progress: Math.min(baseProgress + 2, 92),
        note: `⚠️ El reparador no pudo aplicar el cambio. Empaquetando bundle anterior…`,
      });
      break;
    }
    if (patched === finalFrontend) {
      onProgress?.({
        phase: "fixing",
        progress: Math.min(baseProgress + 2, 92),
        note: `⚠️ El reparador devolvió el mismo bundle (sin cambios). Cortando bucle.`,
      });
      break;
    }
    finalFrontend = patched;
  }

  return finalFrontend;
}

/* ----------------------------- edit mode ---------------------------------- */

function buildEditSystemPrompt(language: GenLanguage): string {
  const isTS = language === "typescript";
  const tsLine = isTS
    ? "- This is a TypeScript app. Type annotations and interfaces are fine."
    : "- This is a plain JavaScript app (.jsx/.js). Do NOT introduce ANY TypeScript syntax: no `: Type`, `interface`, `type Foo = …`, `as Foo`, no generics like `useState<string>`. The current bundle has no tsconfig — keep it that way.";
  return `You are AppForge editing an existing web app. You are a careful, surgical engineer: you understand what the user is asking for, you change ONLY what's needed to deliver it, and you preserve everything else exactly. The user's iteration loop depends on you NOT silently breaking unrelated things.

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

async function singleEditPass(
  prompt: string,
  previous: PreviousApp,
  onChars: (chars: number) => void,
  coderModel: string | undefined,
  language: GenLanguage,
): Promise<GeneratedAppPayload> {
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
    if (provider === "gemini-flash") {
      const stream = await gemini.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: finalUserContent }] }],
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 32768,
          responseMimeType: "application/json",
        },
      });
      let lastReport = 0;
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
    } else if (provider === "gpt-5") {
      // OpenAI GPT-5 (Codex-grade) via Replit AI Integrations proxy.
      // Streaming so we surface progress and avoid the 10-min non-stream cap.
      const stream = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 32000,
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
          if (accumulated.length - lastReport >= 1500) {
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
          if (accumulated.length - lastReport >= 1500) {
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
  let parsed = extractJsonObject<GeneratedAppPayload>(accumulated.trim());
  if (!parsed || typeof parsed.frontendCode !== "string") {
    const retry = await callModel(
      "RECORDATORIO ESTRICTO: tu respuesta DEBE ser exclusivamente un objeto JSON válido " +
      "(sin texto antes ni después, sin ```json ni comentarios) con las claves " +
      `"title", "description", "techStack", "frontendCode" y "backendCode". ` +
      `frontendCode debe contener TODOS los archivos del frontend en el formato // === FILE: path === ` +
      "y backendCode el server.js completo (o un placeholder si no hay backend).",
    );
    accumulated = retry.text;
    finishReason = retry.finishReason;
    parsed = extractJsonObject<GeneratedAppPayload>(accumulated.trim());
  }
  if (!parsed || typeof parsed.frontendCode !== "string") {
    const preview = accumulated.slice(0, 200).replace(/\s+/g, " ").trim();
    throw new Error(
      `No pudimos analizar la respuesta del modelo en modo edición. ` +
      `Inicio de la respuesta: "${preview}…". Vuelve a intentarlo o cambia de modelo en el menú "Modelo".`,
    );
  }
  // Refuse a bundle that was clearly cut off mid-output. Even if the JSON
  // parses, the contents are partial — better to surface the failure so the
  // user retries than to ship a half-edit silently.
  if (finishReason === "MAX_TOKENS") {
    throw new Error("La respuesta del modelo se cortó por límite de tokens. Vuelve a intentarlo con un cambio más pequeño.");
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

export interface PreviousApp {
  title: string;
  description: string;
  techStack: string[];
  frontendCode: string;
  backendCode: string;
}

export async function generateApp(
  prompt: string,
  onProgress?: (p: GenerateProgress) => void,
  previous?: PreviousApp,
  coderModel?: string,
  language: GenLanguage = "typescript",
): Promise<GeneratedAppPayload> {
  // Edit mode: skip the multi-agent pipeline; we already have a working app.
  if (previous) {
    onProgress?.({ phase: "generating", progress: 20, note: "Aplicando cambios al código…" });
    const TARGET = 50_000;
    const onChars = (chars: number) => {
      const ratio = Math.min(1, chars / TARGET);
      onProgress?.({
        phase: "generating",
        progress: 20 + Math.round(ratio * 50),
        note: `Aplicando cambios… (${Math.round(chars / 1000)} KB)`,
      });
    };
    const result = await singleEditPass(prompt, previous, onChars, coderModel, language);

    // Edit mode used to skip validation entirely, so a single bad token from
    // the coder (trailing comma, garbage identifier like "née", invented
    // package import) would ship straight to the user's preview as a parse
    // error. Run the same validate→patch loop the initial pipeline uses so
    // edits get the same safety net.
    const fixedFrontend = await runValidatePatchLoop(
      result.frontendCode,
      { ok: true, issues: [] },
      onProgress,
      /* baseProgressStart */ 70,
      language,
    );

    onProgress?.({ phase: "parsing", progress: 90, note: "Procesando archivos…" });
    return { ...result, frontendCode: fixedFrontend };
  }

  /* === Phase 1: research first (capped 7s), then architect with context === */
  let research = "";
  if (shouldResearch(prompt)) {
    onProgress?.({
      phase: "researching",
      progress: 6,
      note: "🔎 Investigador buscando referencias en la web (máx 7s)…",
    });
    research = await researchTopic(prompt);
  }

  onProgress?.({
    phase: "architecting",
    progress: 14,
    note: research
      ? "🧠 Arquitecto diseñando estructura con contexto de la web…"
      : "🧠 Arquitecto diseñando la estructura del proyecto…",
  });
  const plan = await withTimeoutOrThrow(
    architectPlan(prompt, research),
    60_000,
    "architect",
  );

  // Defensive: ensure backendNeeded is a boolean so missing field doesn't
  // silently skip backend generation.
  if (typeof plan.backendNeeded !== "boolean") {
    plan.backendNeeded = false;
  }

  onProgress?.({
    phase: "integrating",
    progress: 20,
    note: `Plan listo: ${plan.pages.length} página(s), ${plan.components.length} componente(s). 🔌 Integraciones + 🎨 diseño en paralelo…`,
  });

  /* === Phase 2 (parallel): integrations + design system =================== */
  const [integrationSpec, design] = await Promise.all([
    specifyIntegrations(plan, prompt),
    designSystem(plan, research),
  ]);

  const integrationsNote = integrationSpec.services.length > 0
    ? `Servicios sugeridos: ${integrationSpec.services.map((s) => s.name).join(", ")}.`
    : "Sin servicios externos requeridos.";

  onProgress?.({
    phase: "generating",
    progress: 32,
    note: `${integrationsNote} Diseño "${design.vibe}" listo. ⚡ Ingeniero de frontend escribiendo ${plan.frontendFiles.length} archivo(s)…`,
  });

  /* === Phase 3 (parallel): frontend + backend ============================= */
  const TARGET_CHARS = 60_000;
  const frontendPromise = withTimeoutOrThrow(
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
  );
  const backendPromise = generateBackendCode(plan, prompt);

  const [frontendResult, backendResult] = await Promise.all([frontendPromise, backendPromise]);

  if (!frontendResult.code) {
    throw new Error(
      frontendResult.truncated
        ? "El ingeniero de frontend se quedó sin tokens. Pide una app más pequeña o más específica."
        : `No pudimos analizar el frontend. Detalle: ${frontendResult.error ?? "desconocido"}`,
    );
  }

  /* === Phase 4 (parallel): QA review + Test Engineer ====================== */
  onProgress?.({
    phase: "reviewing",
    progress: 78,
    note: "✅ Revisor de calidad y 🧪 Test Engineer trabajando en paralelo…",
  });
  const [report, testCode] = await Promise.all([
    reviewBundle(frontendResult.code, plan),
    generateTests(plan, frontendResult.code),
  ]);

  /* === Phase 5: AUTONOMOUS LOOP (validate → patch → re-validate) ========== */
  // Same logic as before, now extracted into a helper so edit mode can reuse it.
  const finalFrontend = await runValidatePatchLoop(
    frontendResult.code,
    report,
    onProgress,
    /* baseProgressStart */ 80,
    language,
  );

  const testNote = testCode ? "✅ Tests generados. " : "";
  onProgress?.({
    phase: "parsing",
    progress: 94,
    note: `${testNote}📦 Empaquetando archivos…`,
  });

  /* === Final assembly: tests + SETUP.md =================================== */
  const setupNotes = buildSetupNotes(integrationSpec);
  const testsAppendix = testCode ? `\n\n${testCode}` : "";

  return {
    title: plan.title.slice(0, 200),
    description: plan.description.slice(0, 1000),
    techStack: plan.techStack,
    frontendCode: finalFrontend + testsAppendix + setupNotes,
    backendCode: backendResult.code || "No backend required for this app.",
  };
}
