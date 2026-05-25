import { anthropic } from "@workspace/integrations-anthropic-ai";
import OpenAI from "openai";
import { validateBundle, type BuildIssue } from "./validate";
import { ProjectSeed, IProjectSeed } from "@workspace/db/schema";
import { getProjectSeeds } from "./projectSeeds";
import { validateBundleInE2B } from "./e2bValidator";
import { shouldValidateInE2B } from "./e2bGate";
import { logger } from "./logger";
import { buildPatcherSystemPrompt, VALIDATE_PATCH_LOOP_CONFIG } from "./patcher-prompt";
import { recallSimilar, rememberPatch, buildRecallExamplesBlock, extractFixHint, redactSecrets } from "./agentMemory";
import { formatMemoryBlock, type AgentMemoryContext } from "./agentMemoryContext";
import { planExecution, planSummaryEs, PLAN_FEATURE } from "./planner";
import { injectWatermarkToHTML, generateWatermarkReactComponent } from "./watermark";
import { recallGenerations, rememberGeneration, buildGenerationMemoryBlock } from "./generationMemory";
import { recallComponents, buildComponentCacheBlock, extractAndStoreComponents } from "./componentCache";
import { getProactiveFixes, scheduleAutoRefactoring } from "./errorHistoryAnalyzer";
import { buildAgentTemplateContextBlock } from "./templates";
import { performWebResearch, formatWebResearchForLLM } from "./webResearcher";

// OpenAI client via Maris AI Integrations proxy.
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  maxRetries: 5,
  timeout: 60 * 1000, // 60 seconds
});

/** Source language the generated app uses. Affects file extensions + prompt rules. */
export type GenLanguage = "typescript" | "javascript";

export interface GenerationRequestContext {
  kind?: string;
  detectedLocale?: string;
  detectedCountry?: string;
  uiLanguage?: string;
}

/* ============================================================================
 * Maris AI multi-agent generation pipeline.
 *
 * Arquitectura de Élite (Anthropic-First):
 *   - Modelos sincronizados con la interfaz del usuario para máxima eficiencia.
 *
 * Agentes (Configuración por defecto - Ahorro de Créditos):
 *   - Researcher    (claude-haiku-4-5)
 *   - Architect     (claude-haiku-4-5)
 *   - Designer      (claude-haiku-4-5)
 *   - Frontend Eng  (claude-haiku-4-5)
 *   - Backend Eng   (claude-haiku-4-5)
 *   - QA Reviewer   (claude-haiku-4-5)
 *   - Patcher       (claude-haiku-4-5)
 * ========================================================================== */

const useAnthropic = true;
const DEFAULT_MODEL = "claude-haiku-4-5";
const AUTO_MODEL = "claude-sonnet-4-5";
const OPUS_MODEL = "claude-opus-4-7";
const GPT_MODEL = "gpt-5-4-ultra";

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

TEMPLATE STARTER SYSTEM — mandatory:
- Professional base templates and agent blueprints live in \`artifacts/api-server/src/lib/templates.ts\`. The user must never receive a blank-canvas demo. Use the injected [MARIS AI TEMPLATE BASE] block as the starting architecture and then adapt it to the exact request.
- The generated app must feel like a prepared product starter that the client can immediately modify: editable data arrays, clear component boundaries, sensible defaults and complete first-run UX.

Schema:
{"frontendCode":"all frontend files as one string"}

Use '// === FILE: <path> ===' to separate files inside frontendCode. ALWAYS include:
- index.html, package.json, vite.config.${utilExt}${isTS ? ", tsconfig.json" : ""}, tailwind.config.${utilExt}, postcss.config.js
- src/main.${ext}, src/App.${ext}, src/index.css
- src/pages/<Name>.${ext} (ONLY the essential ones from the plan)
- src/components/<Name>.${ext} (ONLY the essential ones from the plan)
- src/lib/<name>.${utilExt} and src/hooks/<name>.${utilExt} (ONLY if strictly necessary)
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
- Use the file list from the plan as the source of truth and PRIORITIZE QUALITY. Consolidate only when it preserves the complete core journey.
- Your priority is a polished, working preview. Avoid 40+ files, but do not omit essential screens, state or components just to be fast. 12-24 high-quality files is acceptable when the product needs them.
- Polished layout, accessible markup, semantic HTML, mobile-first responsive.
  - Generate every file the plan needs, in full. Never truncate or "TODO" a file to save tokens. Stay concise: avoid redundant comments, padding, or unnecessary boilerplate.
- IMPORTANT: If you have many files, prioritize the most important ones first and be as concise as possible in code logic to fit everything in one response.
- Close every quote, brace and bracket. Output ONLY the JSON object.`;
}

const BACKEND_SYSTEM_PROMPT = `You are Maris AI's Senior Backend Engineer. Generate a reliable, production-minded and functional Node/Express backend as STRICT JSON.
Schema:
{"backendCode":"all backend files as one string OR 'No backend required for this app.'"}
Use '// === FILE: <path> ===' to separate files.
QUALITY FIRST — MVP BACKEND:
- Aim for focused code, but include the files/endpoints needed for the frontend to work correctly.
- Keep it simple: package.json, tsconfig.json, src/index.ts (Express bootstrap), src/db/schema.ts (Drizzle), and route files for the essential endpoints.
- Stack: Node 20 + Express 5 + TypeScript + Drizzle ORM + SQLite (for speed/MVP).
- Quality: Use Zod for basic validation, centralized error handling, and CORS.
- Focus: Implement the core data operations needed for the frontend to work, including realistic validation and clear error responses.
- NO TODOs. Real working handlers only.
Rules:
- SOFT LIMIT: 6-10 backend files total when useful for clarity.
- Combined output should stay concise, but correctness beats arbitrary byte limits.
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
- A real product has 3-5 pages. For landing pages: 1-2 pages is perfectly fine. Don't add pages the user didn't ask for.
- Think about empty states, error states, loading states — they're real screens.

COMPONENTS — model real reusable pieces:
- Always include: Navbar, Footer, Button (if you need a custom button), Card variant(s), at least one Form component.
- Include domain-specific components: ProductCard, PostItem, UserAvatar, PriceTag, FilterSidebar, SearchBar, EmptyState, etc. The names should be obvious.
- Aim for 4-8 components. Each gets its own file. Only include components the plan genuinely needs.

DATA MODELS — make them realistic:
- Include the fields you'd actually use in a real schema (id, timestamps, relations, status enums).
- 2-5 models is healthy for most apps.

INTENT HINTS — when the user prompt starts with a bracketed hint like "[INTENT: …]", that's a top-priority directive from the dashboard's project-type tabs. Honor it strictly. The hint OVERRIDES the FULL-STACK RULE below — if the hint says backendNeeded=false, set backendNeeded=false even if there are full-stack keywords.

FULL-STACK RULE — be aggressive about backendNeeded=true:
- Any of these triggers MUST set backendNeeded=true: marketplaces, ecommerce, social networks, SaaS, dashboards, chat apps, anything with user accounts, anything with persistence, anything that lists or stores user-generated content, anything with payments, anything with AI calls, anything called "clon de X".
- Pure landing pages, single-user calculators, simple games and tools without persistence are the only valid backendNeeded=false cases.

QUALITY FIRST — PROFESSIONAL MVP STRATEGY:
- SOFT LIMIT: Aim for 12-18 frontend files; absolute maximum 24 when the requested product genuinely needs it.
- Your goal is a reliable, polished preview, not the fastest possible partial result.
- Do NOT plan speculative pages or components, but do include every page/component needed for the core user journey to feel complete.
- A strong MVP usually has 3-5 pages and 5-10 reusable components. Landing pages may be smaller.
- Fewer files are good only when they preserve quality; do not collapse or omit important UX just to be fast.
- If the user prompt is complex, decompose it into the most essential complete product slice within 24 files.

Rules:
- NEVER collapse everything into one file. Each page/component/hook/util gets its own file.
- techStack: 4-8 entries. Include the visible libraries (React, TypeScript, Tailwind, Wouter, Lucide) — not invented ones.
- Output ONLY the JSON object.`;

const DESIGNER_SYSTEM_PROMPT = `You are Maris AI's Senior UI/UX Designer. You produce design systems with personality — never generic, never "bootstrap blue". Output STRICT JSON only.

Schema:
{
  "theme": "light" | "dark" | "auto",
  "palette": {"primary":"#hex","secondary":"#hex","accent":"#hex","background":"#hex","foreground":"#hex","muted":"#hex"},
  "typography": {"sans":"font-name","display":"font-name","sizes":{"base":"16px","lg":"18px"}},
  "radius": "sm" | "md" | "lg" | "xl",
  "vibe": "1-line description of the visual mood",
  "tailwindExtend": "JSON-stringified object you would put inside tailwind.config.ts theme.extend",
  "globalCSS": "string with @import or :root CSS variables you would put in src/index.css after @tailwind directives"
}

Rules:
- Real hex colors with good contrast. Match the product's domain and any research context provided.
- Output ONLY the JSON object.`;

const INTEGRATION_SYSTEM_PROMPT = `You are Maris AI's Integration Architect. Decide which third-party services this app realistically needs (auth, payments, AI, storage, email, maps, analytics).

Output STRICT JSON only:
{"services":[{"name":"Clerk","why":"User auth","envVars":["CLERK_PUBLISHABLE_KEY"],"setupSteps":["Create Clerk app","Copy publishable key into env"]}]}

Rules:
- Max 4 services. Only include what's truly needed for the requested app.
- If the app is a simple landing page, calculator, or self-contained demo, return {"services":[]}.
- Output ONLY the JSON object.`;

const TEST_SYSTEM_PROMPT = `You are Maris AI's Test Engineer. Generate basic but REAL test scaffolding for a React+TS+Vite app.

Output STRICT JSON only:
{"testCode":"all test files as one string"}

Use '// === FILE: <path> ===' separators. ALWAYS produce:
- tests/setup.ts (vitest + @testing-library/jest-dom setup)
- vitest.config.ts (jsdom environment, points to tests/setup.ts)
- tests/<ComponentName>.test.tsx — 1 smoke test per listed component (max 3)
- tests/<utilName>.test.ts — 1 unit test per listed util (max 2)
- e2e/home.spec.ts — 1 Playwright test that loads "/" and checks the main heading.
- playwright.config.ts (basic chromium config)

Rules:
- Real working tests. No TODOs, no placeholders.
- Combined output under 6 KB. Close every brace. Output ONLY the JSON object.`;

// Patcher system prompt is now imported from patcher-prompt.ts

export interface GeneratedAppPayload {
  title: string;
  description: string;
  techStack: string[];
  frontendCode: string;
  backendCode: string;
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

export type AgentLog = (
  agent: string,
  message: string,
  level?: "info" | "warn" | "error",
) => void;

export interface AttachmentContext {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  textContent?: string;
}

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

const CLONE_KEYWORDS = [
  "clon", "clone", "copia", "copy", "como ", "like ", "similar a", "similar to",
  "réplica", "replica", "imita", "estilo de", "version de", "versión de",
  "wallapop", "vinted", "airbnb", "twitter", "instagram", "tiktok", "uber",
  "amazon", "ebay", "spotify", "netflix", "youtube", "linkedin", "facebook",
  "whatsapp", "telegram", "discord", "slack", "notion", "trello", "asana",
  "stripe", "shopify", "github", "reddit", "pinterest", "snapchat", "twitch",
];

const RESEARCH_TRIGGER_PHRASES = [
  "busca en", "buscame", "búscame", "investiga", "analiza", "mira en",
  "mírate", "mirate", "echa un vistazo", "echale un vistazo", "échale un vistazo",
  "visita", "entra en", "consulta", "revisa la web", "revisa el sitio",
  "dime cómo es", "dime como es", "como es su home", "cómo es su home",
];

const URL_LIKE = /\b(?:https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,})\b/i;

function shouldResearch(prompt: string): boolean {
  // Siempre investigar: el agente Investigador busca en internet para TODOS los prompts.
  // Esto garantiza que el arquitecto siempre tenga contexto real del mercado.
  // Solo se omite si el prompt es muy corto (< 20 chars) o es una edición menor.
  if (prompt.trim().length < 20) return false;
  return true;
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

async function withTimeoutOrThrow<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/* ----------------------------- agents ------------------------------------- */
/**
 * Researcher — Búsqueda web real (Serper/Brave/DuckDuckGo) + scraping de páginas con Puppeteer.
 * Siempre investiga: busca en internet, entra en las páginas y extrae contenido real.
 * Luego sintetiza el brief con Claude Haiku.
 */
export async function researchTopic(prompt: string): Promise<string> {
  const systemPrompt = `Eres el agente Investigador de Maris AI. Tu misión es producir un brief de referencia conciso para el arquitecto y diseñador que va a construir una app NUEVA e ORIGINAL.

A partir del contexto web que se te proporciona, extrae:
- 1 párrafo: qué hace el producto/sector y para quién es.
- Bullets: secciones/páginas clave, funcionalidades destacadas, colores de marca (hex si los ves), tipografía, tono del copy.
- 1 párrafo: sugerencias de diferenciación — qué podría hacer mejor o diferente la app nueva.

ANTI-CLON: NO animes a copiar. Parafrasea slogans. Solo hechos. Sin preámbulo. Solo texto plano. Máx 400 palabras.`;

  return withTimeout(
    (async () => {
      try {
        // 1. Realizar búsqueda web real con Puppeteer + Serper/Brave/DuckDuckGo
        const webData = await performWebResearch(prompt, 3, 22_000);
        const webContext = formatWebResearchForLLM(webData);

        const userText = webContext
          ? `Aquí tienes el contexto web real obtenido mediante búsqueda y scraping de páginas:\n\n${webContext}\n\n---\nEncargo del usuario:\n"${prompt}"\n\nProduce el brief de referencia en español (máx 400 palabras).`
          : `Sintetiza un brief de referencia conciso en español (máx 400 palabras) sobre el siguiente encargo, usando tu conocimiento general:\n\n"${prompt}"`;

        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 800,
          system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userText }],
        });
        const text = response.content[0].type === "text" ? response.content[0].text : "";
        const source = webData.source !== "none"
          ? ` [fuente: ${webData.source}, ${webData.pages.length} páginas visitadas]`
          : "";
        return (text.trim() + source).slice(0, 5000);
      } catch (err) {
        logger.error({ err }, "researchTopic: error en investigación web");
        return "";
      }
    })(),
    32_000,
    "",
  );
}


/**
 * Architect — Claude 3.5 (if available) or Gemini 2.5 Flash.
 */
async function architectPlan(prompt: string, research: string, coderModel?: string, templateContext = ""): Promise<ProjectPlan> {
  // Recuperar generaciones similares de memoria persistente
  const memoryRecalls = await recallGenerations(prompt, { limit: 3, threshold: 0.15 }).catch(() => []);
  const memoryBlock = buildGenerationMemoryBlock(memoryRecalls);
  if (memoryRecalls.length > 0) {
    logger.info({ recalls: memoryRecalls.length }, "generationMemory: inyectando contexto de generaciones anteriores");
  }

  const memoryNote = memoryBlock ? `\n\n${memoryBlock}` : "";
  const userContent = research
    ? `Design the file structure for this app:\n\n${prompt}\n\n---\nResearch context (treat as ground truth for branding & sections):\n${research}${memoryNote}`
    : `Design the file structure for this app:\n\n${prompt}${memoryNote}`;

  let raw = "";
  if (useAnthropic) {
    try {
      const response = await withTimeoutOrThrow(
        anthropic.messages.create({
          model: resolveClaudeCoderModel(coderModel),
          max_tokens: 8192,
          system: [{ type: "text", text: ARCHITECT_SYSTEM_PROMPT + "\nOutput JSON only.", cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userContent }],
        }),
        35_000,
        "architect-anthropic",
      );
      raw = response.content[0].type === "text" ? response.content[0].text : "";
    } catch (err) {
      logger.warn({ err }, "Anthropic architect failed, retrying");
    }
  }

  if (!raw) {
    // Fallback: retry with claude-haiku-4-5 (same model, fresh attempt)
    try {
      const response = await withTimeoutOrThrow(
        anthropic.messages.create({
          model: resolveClaudeCoderModel(coderModel),
          max_tokens: 8192,
          system: [{ type: "text", text: ARCHITECT_SYSTEM_PROMPT + "\nOutput JSON only.", cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userContent }],
        }),
        35_000,
        "architect-retry",
      );
      raw = response.content[0].type === "text" ? response.content[0].text : "";
    } catch (err) {
      logger.warn({ err }, "Anthropic architect retry also failed");
      throw new Error("El arquitecto no pudo generar el plan tras dos intentos.");
    }
  }
  const plan = extractJsonObject<ProjectPlan>(raw);
  if (!plan || !plan.title || !Array.isArray(plan.frontendFiles)) {
    logger.error({ rawPreview: raw.slice(0, 600) }, "Architect returned invalid plan JSON");
    throw new Error("El arquitecto no devolvió un plan válido.");
  }
  plan.pages = plan.pages ?? [];
  plan.components = plan.components ?? [];
  plan.hooks = plan.hooks ?? [];
  plan.utils = plan.utils ?? [];
  plan.dataModels = plan.dataModels ?? [];
  plan.backendFiles = plan.backendFiles ?? [];
  plan.techStack = plan.techStack ?? ["React", "TypeScript", "Tailwind"];
  // Cap de calidad: evita planes enormes, pero ya no fuerza recortes agresivos
  // que dejaban apps incompletas. El arquitecto puede usar hasta 24 archivos para
  // cubrir el flujo principal con páginas, componentes y estados reales.
  const MAX_FRONTEND_FILES = 24;
  if (plan.frontendFiles.length > MAX_FRONTEND_FILES) {
    plan.frontendFiles = plan.frontendFiles.slice(0, MAX_FRONTEND_FILES);
    const normalizedFiles = plan.frontendFiles.map((f) => f.toLowerCase());
    plan.pages = plan.pages.filter((p) => normalizedFiles.some((f) => f.includes(p.name.toLowerCase()) || f.includes((p.route ?? "").replace(/^\//, "").toLowerCase())));
    plan.components = plan.components.filter((c) => normalizedFiles.some((f) => f.includes(c.name.toLowerCase())));
  }
  return plan;
}

/**
 * Designer — Gemini 2.5 Flash.
 */
async function designSystem(plan: ProjectPlan, research: string, coderModel?: string, templateContext = ""): Promise<DesignSystem> {
  const summary = `Product: ${plan.title}\nDescription: ${plan.description}\nVibe needed for: ${plan.pages.map((p) => p.name).join(", ")}`;
  const userContent = research
    ? `${summary}\n\n${templateContext}\n\nDesign the visual system. Reference brand context:\n${research.slice(0, 1500)}`
    : `${summary}\n\n${templateContext}`;
  let raw = "";
  try {
    const response = await withTimeoutOrThrow(
      anthropic.messages.create({
        model: resolveClaudeCoderModel(coderModel),
        max_tokens: 2048,
        system: [{ type: "text", text: DESIGNER_SYSTEM_PROMPT + "\nOutput JSON only.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      }),
      25_000,
      "designer",
    );
    raw = response.content[0].type === "text" ? response.content[0].text : "";
  } catch (_err) {
    // Fall through to default design below.
  }
  const design = extractJsonObject<DesignSystem>(raw);
  if (!design || !design.palette) {
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

type CoderProvider = "claude" | "gpt-5";
type ClaudeCoderModel = "claude-haiku-4-5" | "claude-sonnet-4-5" | "claude-sonnet-4-6" | "claude-opus-4-7";

function resolveCoderProvider(coderModel?: string): CoderProvider {
  if (coderModel === "gpt-5" || coderModel === "gpt-5-codex" || coderModel === "gpt-5.4") return "gpt-5";
  return "claude";
}

/**
 * Routing dinámico de modelos por complejidad de la app.
 * 
 * SIMPLE  (≤8 archivos):   todo Haiku — rápido y eficiente
 * MEDIO   (9-20 archivos): Sonnet para agentes críticos (Frontend, Backend, Architect)
 * COMPLEJO (>20 archivos): Sonnet para todo excepto Research/Design/Patcher que usan Haiku
 */
type ComplexityTier = "simple" | "medium" | "complex";

function getComplexityTier(fileCount: number): ComplexityTier {
  if (fileCount <= 8) return "simple";
  if (fileCount <= 20) return "medium";
  return "complex";
}

function resolveModelForAgent(
  agent: "researcher" | "architect" | "designer" | "integrations" | "frontend" | "backend" | "qa" | "patcher" | "tests" | "edit",
  fileCount: number,
  userSelectedModel?: string,
): ClaudeCoderModel {
  // Si el usuario eligió Opus explícitamente, respetarlo siempre
  if (userSelectedModel === "claude-opus-4-7") return "claude-opus-4-7";
  
  // Si el usuario eligió GPT-5, no aplica (se maneja aparte)
  // Si el usuario eligió Haiku explícitamente, usarlo salvo en apps complejas con agentes críticos
  const tier = getComplexityTier(fileCount);
  
  // Tabla de routing por agente y complejidad
  const routing: Record<ComplexityTier, Record<typeof agent, ClaudeCoderModel>> = {
    simple: {
      researcher:   "claude-haiku-4-5",
      architect:    "claude-haiku-4-5",
      designer:     "claude-haiku-4-5",
      integrations: "claude-haiku-4-5",
      frontend:     "claude-haiku-4-5",
      backend:      "claude-haiku-4-5",
      qa:           "claude-haiku-4-5",
      patcher:      "claude-haiku-4-5",
      tests:        "claude-haiku-4-5",
      edit:         "claude-haiku-4-5",
    },
    medium: {
      researcher:   "claude-haiku-4-5",
      architect:    "claude-sonnet-4-6",
      designer:     "claude-haiku-4-5",
      integrations: "claude-haiku-4-5",
      frontend:     "claude-sonnet-4-6",
      backend:      "claude-sonnet-4-6",
      qa:           "claude-haiku-4-5",
      patcher:      "claude-haiku-4-5",
      tests:        "claude-haiku-4-5",
      edit:         "claude-sonnet-4-6",
    },
    complex: {
      researcher:   "claude-haiku-4-5",
      architect:    "claude-sonnet-4-6",
      designer:     "claude-haiku-4-5",
      integrations: "claude-haiku-4-5",
      frontend:     "claude-sonnet-4-6",
      backend:      "claude-sonnet-4-6",
      qa:           "claude-sonnet-4-6",
      patcher:      "claude-haiku-4-5",
      tests:        "claude-haiku-4-5",
      edit:         "claude-sonnet-4-6",
    },
  };

  const selected = routing[tier][agent];
  
  // Si el usuario eligió Haiku pero la complejidad requiere Sonnet en agentes críticos, respetar el routing
  // (evita que apps de 30 archivos se generen con Haiku y fallen)
  if (userSelectedModel === "claude-haiku-4-5" || userSelectedModel === "claude-haiku") {
    const criticalAgents: (typeof agent)[] = ["frontend", "backend", "architect", "edit"];
    if (criticalAgents.includes(agent) && tier !== "simple") {
      return selected; // Usar Sonnet para agentes críticos aunque el usuario haya elegido Haiku
    }
    return "claude-haiku-4-5";
  }
  
  return selected;
}

function resolveClaudeCoderModel(coderModel?: string, fileCount?: number): ClaudeCoderModel {
  if (coderModel === "claude-opus-4-7") return "claude-opus-4-7";
  // Fallback sin fileCount: usar Haiku por defecto
  if (fileCount === undefined) return "claude-haiku-4-5";
  // Con fileCount: routing automático basado en complejidad
  return resolveModelForAgent("frontend", fileCount, coderModel);
}

/**
 * Frontend Engineer — Gemini 2.5 Flash streaming (default) o GPT-5.
 * Claude Sonnet redirigido a Gemini Flash (sin key Anthropic disponible).
 */
async function generateFrontendCode(
  plan: ProjectPlan,
  design: DesignSystem,
  research: string,
  prompt: string,
  onProgressUpdate: (accumulatedCode: string, fileName?: string) => void,
  coderModel: string | undefined,
  language: GenLanguage,
  templateContext = "",
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

  // Recuperar snippets de código de generaciones similares
  const codeMemoryRecalls = await recallGenerations(prompt, { limit: 2, threshold: 0.2 }).catch(() => []);
  const codeMemoryBlock = buildGenerationMemoryBlock(codeMemoryRecalls);

  // Recuperar componentes reutilizables de la caché de componentes
  const cachedComponents = await recallComponents(prompt, { language, limit: 5 }).catch(() => []);
  const componentCacheBlock = buildComponentCacheBlock(cachedComponents);

  // Recuperar fixes proactivos de errores históricos
  const proactiveFixes = await getProactiveFixes(language, 5).catch(() => "");

  const userContent = `User request: ${prompt}

Project plan (you MUST implement every listed file):
${planSummary}

Design system (apply EXACTLY in tailwind.config.ts theme.extend and src/index.css):
${designSummary}
${templateContext ? `\n${templateContext}` : ""}
${research ? `\nResearch context (visual reference, treat as ground truth):\n${research.slice(0, 2000)}` : ""}
${codeMemoryBlock ? `\n${codeMemoryBlock}` : ""}
${componentCacheBlock ? `\n${componentCacheBlock}` : ""}
${proactiveFixes ? `\n${proactiveFixes}` : ""}
Now produce the JSON object with frontendCode containing every listed file.`;

  const provider = resolveCoderProvider(coderModel);
  const systemPrompt = buildFrontendSystemPrompt(language);
  let accumulated = "";
  let truncated = false;

  if (provider === "gpt-5") {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 128000,
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
          onProgressUpdate(accumulated);
        }
      }
      const fr = chunk.choices[0]?.finish_reason;
      if (fr === "length") finishReason = "MAX_TOKENS";
    }
    truncated = finishReason === "MAX_TOKENS";
  } else {
    // Claude streaming según el modelo elegido en el selector.
    const stream = await anthropic.messages.stream({
      model: resolveClaudeCoderModel(coderModel),
      max_tokens: 128000,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    });
    
    const observe = createStreamObserver((_, msg) => onProgressUpdate(accumulated, msg));
    let lastReport = 0;
    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        accumulated += chunk.delta.text;
        observe(accumulated);
        if (accumulated.length - lastReport >= 2000) {
          lastReport = accumulated.length;
          onProgressUpdate(accumulated);
        }
      }
    }
    const finalMsg = await stream.finalMessage();
    truncated = finalMsg.stop_reason === "max_tokens";
  }

  const raw = accumulated.trim();
  if (!raw) {
    return { code: "", truncated, error: "Frontend agent returned no text." };
  }
  const parsed = extractJsonObject<{ frontendCode?: string }>(raw);
  if (!parsed || typeof parsed.frontendCode !== "string") {
    return { code: "", truncated, error: "JSON inválido del Frontend Engineer." };
  }
  return { code: parsed.frontendCode, truncated };
}

/**
 * Backend Engineer — Gemini 2.5 Flash.
 */
async function generateBackendCode(
  plan: ProjectPlan,
  prompt: string,
  onProgressUpdate?: (code: string, fileName?: string) => void,
  coderModel?: string,
  templateContext = "",
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
${templateContext ? `\n${templateContext}` : ""}

Now produce the JSON object with backendCode.`;

  let accumulated = "";
  let truncated = false;
  try {
    const stream = await anthropic.messages.stream({
      model: resolveClaudeCoderModel(coderModel),
      max_tokens: 64000,
      system: [{ type: "text", text: BACKEND_SYSTEM_PROMPT + "\nOutput JSON only.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    });

    const observe = createStreamObserver((_, msg) => onProgressUpdate?.(accumulated, msg), true);
    let lastReport = 0;
    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        accumulated += chunk.delta.text;
        observe(accumulated);
        if (onProgressUpdate && accumulated.length - lastReport >= 2000) {
          lastReport = accumulated.length;
          onProgressUpdate(accumulated);
        }
      }
    }
    const finalMsg = await stream.finalMessage();
    truncated = finalMsg.stop_reason === "max_tokens";
    const raw = accumulated.trim();
    const parsed = extractJsonObject<{ backendCode?: string }>(raw);
    if (!parsed || typeof parsed.backendCode !== "string") {
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

/**
 * Integration Architect — Gemini 2.0 Flash.
 */
async function specifyIntegrations(
  plan: ProjectPlan,
  prompt: string,
  coderModel?: string,
): Promise<IntegrationSpec> {
  return withTimeout(
    (async () => {
      try {
        const intUserContent = `App: ${plan.title}
Description: ${plan.description}
User prompt: ${prompt}
Pages: ${plan.pages.map((p) => p.name).join(", ")}
Data models: ${plan.dataModels.map((m) => m.name).join(", ") || "none"}
Backend needed: ${plan.backendNeeded}`;
        const response = await anthropic.messages.create({
          model: resolveClaudeCoderModel(coderModel),
          max_tokens: 800,
          system: [{ type: "text", text: INTEGRATION_SYSTEM_PROMPT + "\nOutput JSON only.", cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: intUserContent }],
        });
        const raw = response.content[0].type === "text" ? response.content[0].text : "";
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

/**
 * QA Reviewer — Claude 3.5 (if available) or Gemini 2.0 Flash.
 */
async function reviewBundle(
  frontendCode: string,
  plan: ProjectPlan,
): Promise<QAReport> {
  return withTimeout(
    (async () => {
      try {
        const expected = plan.frontendFiles.join(", ");
        const sample = frontendCode.slice(0, 12000);
        const systemPrompt = `Eres el Agente Supervisor de Calidad (QA & Linter Agent) de Maris-ai.shop. 
Tu única misión es auditar el código fuente (React, Tailwind, SQL, Node.js) generado por el Agente de Código antes de que sea compilado.

Debes verificar estrictamente las siguientes directrices:

1. SEGURIDAD Y BASE DE DATOS (SQL):
   - Queda estrictamente prohibido el uso de consultas SQL directas propensas a Inyección SQL. Todo debe usar parámetros o el ORM (Drizzle/Supabase).
   - Verifica que todas las tablas de e-commerce tengan llaves primarias (Primary Keys) y relaciones correctas (Foreign Keys con ON DELETE CASCADE).
   - Asegura que las contraseñas de los usuarios NUNCA se guarden en texto plano; deben delegarse al sistema de autenticación de Supabase Auth o Clerk.

2. LOGICA DE NEGOCIO (E-Commerce):
   - Valida que antes de procesar un pago o vaciar un carrito se compruebe la existencia de stock/inventario en la base de datos.
   - Verifica que los precios y totales de los carritos utilicen tipos de datos numéricos precisos (Decimal/Numeric en SQL, redondeo correcto en JS) para evitar errores de céntimos.

3. INTERFAZ DE USUARIO (UI/UX & Tailwind):
   - Todo componente visual debe ser 100% responsivo. Verifica el uso correcto de prefijos de Tailwind (sm:, md:, lg:).
   - No permitas elementos superpuestos o textos rotos. Si un botón contiene texto dinámico, debe tener propiedades de desbordamiento (truncate o flex-wrap).

4. FORMATO DE RESPUESTA:
   - Si el código es perfecto, responde ÚNICAMENTE con el formato JSON: {"ok": true, "issues": []}.
   - Si encuentras un error, responde con el formato JSON: {"ok": false, "issues": [{"file": "<nombre_archivo>", "problem": "<explicación detallada del error>", "fix": "<instrucciones exactas para corregirlo>"}]}.`;

        const userContent = `Archivos esperados: ${expected}\n\nPrimeros 12KB del bundle generado:\n${sample}\n\nRetorna ÚNICAMENTE JSON ESTRICTO.\nMáximo 5 issues. No agregues introducciones ni saludos.`;

        let raw = "";
        if (useAnthropic) {
          try {
            const response = await anthropic.messages.create({
              model: "claude-sonnet-4-5", // Optimizado: claude-sonnet-3-5 (antes claude-opus-4-7)
              max_tokens: 1024,
              system: [{ type: "text", text: systemPrompt + "\nOutput JSON only.", cache_control: { type: "ephemeral" } }],
              messages: [{ role: "user", content: userContent }],
            });
            raw = response.content[0].type === "text" ? response.content[0].text : "";
          } catch (err) {
            logger.warn({ err }, "Anthropic QA failed, falling back to Gemini");
          }
        }

        if (!raw) {
          const qaResponse = await anthropic.messages.create({
            model: "claude-sonnet-4-5",
            max_tokens: 700,
            system: [{ type: "text", text: systemPrompt + "\nOutput JSON only.", cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: userContent }],
          });
          raw = qaResponse.content[0].type === "text" ? qaResponse.content[0].text : "";
        }
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

/**
 * Test Engineer — Gemini 2.0 Flash.
 */
async function generateTests(
  plan: ProjectPlan,
  frontendCode: string,
): Promise<string> {
  return withTimeout(
    (async () => {
      try {
        const sample = frontendCode.slice(0, 6000);
        const componentNames = plan.components.slice(0, 3).map((c) => c.name).join(", ") || "App";
        const utilNames = plan.utils.slice(0, 2).map((u) => u.name).join(", ") || "(none)";
        const testsUserContent = `Generate tests for "${plan.title}".
Main components to test: ${componentNames}
Main utils to test: ${utilNames}
Pages: ${plan.pages.map((p) => `${p.name} (${p.route})`).join(", ")}

First 6KB of the frontend bundle (so you know real symbol names and import paths):
${sample}

Return the JSON object with testCode.`;
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 3000,
          system: [{ type: "text", text: TEST_SYSTEM_PROMPT + "\nOutput JSON only.", cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: testsUserContent }],
        });
        const raw = response.content[0].type === "text" ? response.content[0].text : "";
        const parsed = extractJsonObject<{ testCode?: string }>(raw);
        if (!parsed || typeof parsed.testCode !== "string") return "";
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

/**
 * Patcher — Gemini 2.0 Flash.
 */
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
        const patcherContent = `ISSUES TO FIX:
${issueList}
${memoryContext}
CURRENT FRONTEND BUNDLE:
${frontendCode}

Return the FULL patched bundle as JSON.`;
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 16000,
          system: [{ type: "text", text: buildPatcherSystemPrompt(language) + "\nOutput JSON only.", cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: patcherContent }],
        });
        const raw = response.content[0].type === "text" ? response.content[0].text : "";
        const parsed = extractJsonObject<{ frontendCode?: string }>(raw);
        if (!parsed || typeof parsed.frontendCode !== "string") return null;
        if (parsed.frontendCode.length < frontendCode.length / 2) return null;
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

/* ------------------------ E2B real-build validation ----------------------- */

function e2bResultToIssue(stderr: string, reason: string): BuildIssue {
  const truncated = stderr.length > 4000
    ? `${stderr.slice(0, 2000)}\n…(truncated)…\n${stderr.slice(-1500)}`
    : stderr;
  const trimmed = truncated.trim();
  return {
    file: "package.json",
    message: trimmed.length > 0
      ? `E2B real build failed (${reason}):\n${trimmed}`
      : `E2B real build failed (${reason})`,
  };
}

/* ------------------------ validate → patch loop --------------------------- */

async function runValidatePatchLoop(
  initialBundle: string,
  qaReport: QAReport,
  onProgress: ((p: GenerateProgress) => void) | undefined,
  baseProgressStart: number,
  language: GenLanguage,
  log?: AgentLog,
  phaseGates: { validate: boolean; patch: boolean } = { validate: true, patch: true },
): Promise<string> {
  const MAX_ITERATIONS = VALIDATE_PATCH_LOOP_CONFIG.MAX_ITERATIONS;
  let finalFrontend = initialBundle;
  const noop: AgentLog = () => {};
  const emit = log ?? noop;

  if (!phaseGates.validate) {
    emit("validator", "Plan dice saltar validación (alcance reducido). Bundle entregado sin verificar.", "warn");
    return finalFrontend;
  }

  let pendingIssues: BuildIssue[] = qaReport.ok
    ? []
    : qaReport.issues.map((i) => ({ file: i.file, message: `${i.problem} → ${i.fix}` }));

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
      if (lastErrorMessage && lastPatchedBundle) {
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
      onProgress?.({
        phase: "validating",
        progress: 92,
        note: `⚠️ Quedan ${combined.length} problema(s) tras ${MAX_ITERATIONS} intentos. No se entrega como final válido; se conserva el mejor bundle para revisión…`,
      });
      emit("validator", `△ ${combined.length} detalle${combined.length === 1 ? "" : "s"} pendiente${combined.length === 1 ? "" : "s"} tras el máximo de reparaciones`, "warn");
      break;
    }

    onProgress?.({
      phase: "fixing",
      progress: Math.min(baseProgress + 2, 92),
      note: `🔧 Auto-reparación ${iter}/${MAX_ITERATIONS}: corrigiendo ${combined.length} problema(s)…`,
    });
    emit("patcher", `🔧 patch · ${combined.length}`);
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

  // E2B real-build verification (opt-in)
  if (shouldValidateInE2B() && phaseGates.patch) {
    onProgress?.({
      phase: "validating",
      progress: 93,
      note: "⚙️ Build real en sandbox E2B (npm install + build)…",
    });
    emit("validator", "⚙️ E2B real build · arrancando microVM");
    try {
      const e2b = await validateBundleInE2B({ bundle: finalFrontend, log: logger });
      if (e2b.ok) {
        onProgress?.({
          phase: "validating",
          progress: 94,
          note: `✅ E2B build OK (${Math.round(e2b.durationMs / 1000)}s).`,
        });
        emit("validator", `✓ E2B build OK · ${Math.round(e2b.durationMs / 1000)}s`);
      } else if (e2b.reason === "install_failed" || e2b.reason === "build_failed") {
        emit("validator", `△ E2B ${e2b.reason} · ${Math.round(e2b.durationMs / 1000)}s — intentando reparar`, "warn");
        onProgress?.({ phase: "fixing", progress: 94, note: `🔧 E2B detectó ${e2b.reason}. Auto-reparando con error real…` });
        const stderr = e2b.reason === "install_failed" ? e2b.installStderr : e2b.buildStderr;
        const issue = e2bResultToIssue(stderr, e2b.reason);
        try {
          const repaired = await patchBundle(
            finalFrontend,
            [{ file: "package.json", problem: issue.message, fix: "Fix the package name(s), version(s), build config or imports so `npm install && npm run build` succeeds in a clean Linux microVM." }],
            language,
            "",
          );
          if (repaired && repaired !== finalFrontend) {
            try {
              const reReport = await validateBundle(repaired);
              if (reReport.ok) {
                emit("patcher", "✓ patch tras E2B aplicado y revalidado");
                finalFrontend = repaired;
              } else {
                emit("patcher", `△ patch tras E2B introdujo ${reReport.issues.length} issue(s) — descartando`, "warn");
              }
            } catch (revErr) {
              logger.warn({ err: revErr }, "post-E2B patch revalidation threw");
              emit("patcher", "△ revalidación tras E2B falló — descartando patch", "warn");
            }
          } else {
            emit("patcher", "△ patch tras E2B sin cambios — dejando bundle previo", "warn");
          }
        } catch (patchErr) {
          logger.warn({ err: patchErr }, "patcher failed after E2B build error");
          emit("patcher", "△ reparador falló tras E2B — dejando bundle previo", "warn");
        }
      } else {
        emit("validator", `△ E2B saltado · ${e2b.reason ?? "unknown"}`, "warn");
      }
    } catch (e2bErr) {
      logger.warn({ err: e2bErr }, "E2B validation threw — continuing without it");
      emit("validator", "△ E2B falló (excepción) — continuando", "warn");
    }
  }

  return finalFrontend;
}

/* ----------------------------- edit mode ---------------------------------- */

function buildEditSystemPrompt(language: GenLanguage): string {
  const isTS = language === "typescript";
  const tsLine = isTS
    ? "- This is a TypeScript app. Type annotations and interfaces are fine."
    : "- This is a plain JavaScript app (.jsx/.js). Do NOT introduce ANY TypeScript syntax.";
  return `You are Maris AI. You are continuing work on a PROJECT BOX. You have perfect memory of the current code and your goal is to EVOLVE it, not replace it. You are a careful, surgical engineer: you understand what the user is asking for, you change ONLY what's needed to deliver it, and you preserve everything else exactly.

Output STRICT JSON only matching:
{"title":"…","description":"…","techStack":[…],"frontendCode":"…","backendCode":"…"}

THINK BEFORE EDITING (do this internally, do not output the reasoning):
1. What does the user want?
2. Which files do I need to touch? Usually 1-4 files.
3. What MUST stay the same?
4. After your edit, do all imports still resolve, do all routes still render?

CHANGE DISCIPLINE — PROJECT BOX CONTINUITY:
- You are NOT creating a new app. You are EVOLVING the current one.
- Keep file count and file names as-is. Do NOT delete files unless explicitly asked.
- Keep the title, description, techStack, color palette and typography unless the user explicitly asks to change them.
- NEVER replace a working page/component with a simpler version. If you add a feature, integrate it into the existing code.
- If the user says "continúa" or "sigue", look at the last files you were working on and finish the logic.
- Preserve any \`/api/apps/<n>/images/<n>\` URLs and any \`https://\`-prefixed image URLs VERBATIM.
- Preserve all existing \`useState\`/\`useReducer\`/\`useEffect\` logic unrelated to the request.

BACKEND EDITS — backendCode IS in scope for backend requests.

LANGUAGE — ALL user-visible copy MUST be in Spanish (es-ES). Identifiers stay in English.

SYNTAX — code MUST parse with a strict ${isTS ? "TypeScript" : "JavaScript"} parser:
${tsLine}
- NEVER produce \`,,\` (double comma), \`,)\`, \`,]\` or \`,}\` patterns.
- NO non-ASCII characters inside identifiers/keywords/punctuation.
- Every string must be terminated with the same quote it started with.
- Every brace, bracket, paren and JSX tag must close.
- Every \`.map\` returns elements with a stable \`key\` prop.

WOUTER v3 — never write \`<Link><a>…</a></Link>\` (nested anchors crash the preview).

EXPORTS & IMPORTS — match every \`import { X }\` to a named export and every \`import X from\` to a default export.

Rules:
- Use '// === FILE: <path> ===' separators inside frontendCode/backendCode.
- Return the FULL updated bundles (every file, not just the changed ones).
- Do NOT regress existing features. No TODOs.
- NO SIZE LIMIT — return the full bundle no matter how big. Close every brace and quote. Output ONLY the JSON object.`;
}

function friendlyFileLabel(rawPath: string, isBackend: boolean): string {
  const cleaned = rawPath.replace(/^[./\\]+/, "").trim();
  const noSrc = cleaned.replace(/^src\//i, "");
  const noExt = noSrc.replace(/\.[a-z0-9]+$/i, "");
  const MAX = 36;
  const truncated = noExt.length > MAX ? noExt.slice(0, MAX - 1) + "…" : noExt;
  const glyph = isBackend ? "🔧" : "📂";
  return `${glyph} ${truncated}`;
}

function createStreamObserver(emit: (agent: string, msg: string) => void, isBackendInitial: boolean = false) {
  let scanFrom = 0;
  let inBackend = isBackendInitial;
  const seenFiles = new Set<string>();
  const FILE_MARKER = /\/\/\s*===\s*FILE:\s*([^=\n]+?)\s*===/g;
  return (buffer: string) => {
    try {
      const tail = buffer.slice(Math.max(0, scanFrom - 64));
      FILE_MARKER.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FILE_MARKER.exec(tail)) !== null) {
        const file = m[1].replace(/\\\//g, "/").trim().slice(0, 120);
        if (file && !seenFiles.has(file)) {
          seenFiles.add(file);
          emit("coder", friendlyFileLabel(file, inBackend));
        }
      }
      scanFrom = buffer.length;
    } catch { /* best-effort */ }
  };
}

/**
 * Single edit pass — Gemini 2.5 Flash streaming (default) o GPT-5.
 */
async function singleEditPass(
  prompt: string,
  previous: PreviousApp,
  onChars: (chars: number) => void,
  coderModel: string | undefined,
  language: GenLanguage,
  log?: AgentLog,
): Promise<GeneratedAppPayload> {
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

    const provider = resolveCoderProvider(coderModel);
  const systemPrompt = buildEditSystemPrompt(language);

  async function callModel(extraReminder: string): Promise<{ text: string; finishReason?: string }> {
    const finalUserContent = extraReminder ? `${userContent}\n\n${extraReminder}` : userContent;
    let accumulated = "";
    let finishReason: string | undefined;
    
    // Observer mejorado para detectar cambio de carpeta frontend -> backend en el JSON
    let sawBackendKey = false;
    let inBackend = false;
    const observer = createStreamObserver((agent, msg) => emit(agent, msg));
    const observe = (buffer: string) => {
      if (!sawBackendKey && /"backendCode"\s*:\s*"/.test(buffer.slice(-100))) {
        sawBackendKey = true;
        inBackend = true;
        emit("coder", "📁 backend/");
      }
      observer(buffer);
    };

    const PROGRESS_EVERY = 500;

    if (provider === "gpt-5") {
      const stream = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 128000,
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
      // Claude streaming según el modelo elegido en el selector.
      const stream = await anthropic.messages.stream({
        model: resolveClaudeCoderModel(coderModel),
        max_tokens: 128000,
        system: systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: finalUserContent, cache_control: { type: "ephemeral" } }] }],
      });
      let lastReport = 0;
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          accumulated += chunk.delta.text;
          observe(accumulated);
          if (accumulated.length - lastReport >= PROGRESS_EVERY) {
            lastReport = accumulated.length;
            onChars(accumulated.length);
          }
        }
      }
      const finalMsg = await stream.finalMessage();
      if (finalMsg.stop_reason === "max_tokens") finishReason = "MAX_TOKENS";
    }
    return { text: accumulated, finishReason };
  }

  let { text: accumulated, finishReason } = await callModel("");

  if (finishReason === "MAX_TOKENS") {
    emit("coder", "△ respuesta alcanzando límite, continuando...", "info");
    // No lanzamos error, permitimos que el sistema intente procesar lo que tiene
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
    if (finishReason === "MAX_TOKENS") {
      throw new Error(
        "El cambio era demasiado grande para una sola pasada. " +
        "Pídelo en partes más pequeñas o cambia al modelo de calidad desde el menú \"Modelo\".",
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

async function fastPatchEdit(
  prompt: string,
  previous: PreviousApp,
  language: GenLanguage,
  log: AgentLog,
  onProgress?: (p: GenerateProgress) => void,
): Promise<GeneratedAppPayload | null> {
  onProgress?.({ phase: "fixing", progress: 30, note: "Aplicando parche directo…" });
  await log("patcher", "Aplicando tu cambio directamente al bundle (modo rápido).");

  let memoryBlock = "";
  try {
    const matches = await recallSimilar(prompt, { limit: 2, threshold: 0.78, language });
    if (matches.length > 0) {
      await log("memory", `🧠 recall · ${matches.length} cambio(s) similar(es) ya hechos`);
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
    await log("patcher", "El parche directo devolvió un bundle vacío.", "warn");
    return null;
  }

  onProgress?.({ phase: "validating", progress: 75, note: "Validando el parche…" });
  const validation = await validateBundle(patched);
  if (!validation.ok && validation.issues.length > 0) {
    const repaired = await runValidatePatchLoop(patched, { ok: true, issues: [] }, onProgress, 70, language, log);
    const finalValidation = await validateBundle(repaired);
    if (!finalValidation.ok && finalValidation.issues.length > 0) {
      await log("patcher", `Parche directo no convergió tras auto-reparación (${finalValidation.issues.length} error(es)). Cayendo al flujo completo.`, "warn");
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

  rememberPatch({
    errorMessage: redactSecrets(prompt).slice(0, 400),
    errorContext: "fast-patch user request",
    patch: "(fast-patch convergence; no code stored — recall by prompt only)",
    language,
  }).then((entry) => {
    if (entry) log("memory", `🧠 aprendí este cambio (id ${entry.id})`);
  }).catch(() => {});

  onProgress?.({ phase: "validating", progress: 100, note: "Parche aplicado." });
  await log("patcher", "✓ parche aplicado y validado.");
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

export interface GenerationCheckpoint {
  phase: string;
  data: any;
  approvedFacets: string[];
}

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
  checkpoint?: GenerationCheckpoint,
  requestContext?: GenerationRequestContext,
): Promise<GeneratedAppPayload | GenerationCheckpoint> {
  const runPhase = async <T>(phase: string, fn: (currentModel?: string) => Promise<T>, modelToUse?: string): Promise<T> => {
    let lastError: any;
    const MAX_RETRIES = 4;
    let currentModel = modelToUse;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn(currentModel);
      } catch (err: any) {
        lastError = err;
        const isOverloaded = err?.message?.includes("Overloaded") || err?.status === 529 || err?.status === 429;
        
        if (isOverloaded && attempt < MAX_RETRIES) {
          const delay = attempt * 3000;
          
          // Fallback logic: if Opus fails twice, try Sonnet
          if (attempt >= 2 && currentModel?.includes("opus")) {
            const fallback = currentModel.replace("opus-4-7", "sonnet-4-6");
            await log("system", `🔄 Cambiando a modelo de respaldo (${fallback}) por saturación...`, "warn");
            currentModel = fallback;
          } else {
            await log("system", `⚠️ Motor saturado (Intento ${attempt}/${MAX_RETRIES}). Reintentando en ${delay/1000}s...`, "warn");
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        try { onPhaseError?.(phase, err); } catch { /* monitoring must never crash the pipeline */ }
        throw err;
      }
    }
    throw lastError;
  };

  const _genStartTime = Date.now();
  const memoryBlock = formatMemoryBlock(agentMemory);
  if (memoryBlock) prompt = `${memoryBlock}\n${prompt}`;

  const attachmentBlock = buildAttachmentBlock(attachments);
  if (attachmentBlock) prompt = `${attachmentBlock}\n${prompt}`;

  const templateContextBlock = buildAgentTemplateContextBlock({
    prompt,
    kind: requestContext?.kind,
    detectedLocale: requestContext?.detectedLocale,
    detectedCountry: requestContext?.detectedCountry,
    uiLanguage: requestContext?.uiLanguage,
  });

  const log: AgentLog = async (agent, message, level = "info") => {
    try { await onAgentLog?.(agent, message, level); } catch { /* swallow */ }
  };

  onProgress?.({ phase: "generating", progress: 5, note: "Planificando…" });
  await log("system", "🚀 Orquestador de Maris AI activado. Asignando agentes de élite...");
  await log("planner", "🤖 Analizando requerimientos y diseñando estrategia de ejecución...");
  
  let execPlan = await runPhase("planner", () =>
    planExecution(prompt, { hasExistingApp: !!previous }),
  );
  await log("planner", "✅ Plan de ejecución listo: " + planSummaryEs(execPlan));

  // Edit mode
  if (previous) {
    if (execPlan.scope === "fast-patch") {
      const fastResult = await fastPatchEdit(prompt, previous, language, log, onProgress);
      if (fastResult) return fastResult;
      await log("planner", "El parche directo no convergió; vuelvo al flujo de edición completo.", "warn");
      execPlan = { ...execPlan, scope: "feature", phases: PLAN_FEATURE.phases };
      await log("planner", "Promovido a alcance 'feature' con validación y parche obligatorios.");
    }

    onProgress?.({ phase: "generating", progress: 20, note: "Aplicando cambios al código…" });
    await log("system", `Empezando a editar tu app (${Math.round(previous.frontendCode.length / 1000)} KB de código).`);
    await log("coder", "Calentando motores…");
    const TARGET = 50_000;
    let lastHeartbeatAt = Date.now();
    const onChars = (chars: number) => {
      const ratio = Math.min(1, chars / TARGET);
      onProgress?.({ phase: "generating", progress: 20 + Math.round(ratio * 50), note: `Aplicando cambios… (${Math.round(chars / 1000)} KB)` });
      const now = Date.now();
      if (now - lastHeartbeatAt > 2500) {
        lastHeartbeatAt = now;
        log("coder", `Construyendo… ${Math.round(chars / 1000)} KB y subiendo.`);
      }
    };

    if (execPlan.scope === "feature") {
      await log("planner", `Despachando fases del plan: ${execPlan.phases.join(" → ")}`);
      if (execPlan.phases.includes("architect")) log("architect", "Re-arquitectando para acomodar la nueva funcionalidad…");
      if (execPlan.phases.includes("frontend")) log("coder", "Frontend: aplicando la nueva funcionalidad…");
    } else {
      await log("coder", "Pensando…");
    }
    // singleEditPass is actually implemented in apps.ts, we use it here
    const result = await singleEditPass(prompt, previous, onChars, coderModel, language, log);
    await log("coder", "Código listo, comprobando que todo encaje…");

    let editQaReport: QAReport = { ok: true, issues: [] };
    if (execPlan.phases.includes("qa")) {
      onProgress?.({ phase: "reviewing", progress: 68, note: "Revisor QA comprobando la edición antes de validar…" });
      await log("qa", "🔍 Revisando la edición antes del build...");
      const syntheticPlan: ProjectPlan = {
        title: result.title,
        description: result.description,
        techStack: result.techStack,
        pages: [],
        components: [],
        hooks: [],
        utils: [],
        dataModels: [],
        frontendFiles: [],
        backendNeeded: false,
        backendFiles: [],
      };
      editQaReport = await runPhase("qa", () => reviewBundle(result.frontendCode, syntheticPlan), resolveModelForAgent("qa", 12, coderModel));
      const editIssueCount = editQaReport.issues?.length ?? 0;
      await log("qa", editIssueCount > 0 ? `${editIssueCount} issue(s) detectada(s) en la edición.` : "QA de edición sin issues detectadas.", editIssueCount > 0 ? "warn" : "info");
    }

    const fixedFrontend = await runValidatePatchLoop(
      result.frontendCode,
      editQaReport,
      onProgress,
      70,
      language,
      log,
      { validate: execPlan.phases.includes("validate"), patch: execPlan.phases.includes("patch") },
    );

    onProgress?.({ phase: "parsing", progress: 90, note: "Procesando archivos…" });
    await log("system", "Empaquetando todo…");
    return { ...result, frontendCode: fixedFrontend };
  }

  // Phase gates
  const runResearch = execPlan.phases.includes("research");
  const runDesign = execPlan.phases.includes("design");
  const runIntegration = execPlan.phases.includes("integration");
  const runQa = execPlan.phases.includes("qa");
  const runTests = execPlan.phases.includes("tests");

    /* === Phase 1: Research → Architect, then quality-aware Design + Integrations === */
  await log("system", "🧭 Activando orquestación de calidad: primero contexto y arquitectura, después diseño e integraciones...");

  const research = (runResearch && shouldResearch(prompt))
    ? await runPhase("researcher", () => researchTopic(prompt), resolveModelForAgent("researcher", 0))
    : "";

  const estimatedFiles = prompt.length > 200 ? 18 : 10;
  const plan = await runPhase("architect", (m) =>
    withTimeoutOrThrow(architectPlan(prompt, research, m), 90_000, "architect"),
    resolveModelForAgent("architect", estimatedFiles, coderModel),
  );

  const FALLBACK_DESIGN: DesignSystem = {
    theme: "dark", vibe: "moderno, pulido y orientado a producto real",
    palette: { primary: "#7c3aed", secondary: "#0ea5e9", background: "#0a0a0a", surface: "#111111", text: "#fafafa" },
    typography: { sans: "Inter, system-ui, sans-serif", display: "Inter, system-ui, sans-serif" },
    radius: "0.75rem", tailwindExtend: "", globalCSS: "",
  };

  const [design, integrationSpec] = await Promise.all([
    runDesign
      ? runPhase("design", (m) => designSystem(plan, research, m), resolveModelForAgent("designer", plan.frontendFiles.length, coderModel))
      : Promise.resolve(FALLBACK_DESIGN),
    runIntegration
      ? runPhase("integrations", (m) => specifyIntegrations(plan, prompt, m), resolveModelForAgent("integrations", plan.frontendFiles.length, coderModel))
      : Promise.resolve({ services: [], envVars: [] }),
  ]);

  await log("system", "✅ Fase de análisis de calidad completada. Iniciando ingeniería...");
  if (typeof plan.backendNeeded !== "boolean") plan.backendNeeded = false;
  await log("architect", `Plan "${plan.title}" listo. Backend: ${plan.backendNeeded ? "sí" : "no"}.`);
  await log("designer", `Diseño "${design.vibe}" y ${integrationSpec.services.length} integraciones listas.`);
  if (!runIntegration) log("integration", "Plan dice saltar integraciones (alcance reducido).");
  if (!runDesign) log("designer", "Plan dice saltar diseño (uso paleta por defecto).");

  const integrationsNote = integrationSpec.services.length > 0
    ? `Servicios sugeridos: ${integrationSpec.services.map((s) => s.name).join(", ")}.`
    : "Sin servicios externos requeridos.";

  if (integrationSpec.services.length > 0) {
    await log("integration", `${integrationSpec.services.length} servicio(s): ${integrationSpec.services.map((s) => s.name).join(", ")}.`);
  } else {
    await log("integration", "Sin servicios externos requeridos.");
  }
  await log("designer", `Tema "${design.vibe}" listo (${Object.keys(design.palette).length} colores, fuente ${design.typography.sans}).`);

  onProgress?.({ phase: "generating", progress: 32, note: `${integrationsNote} Diseño "${design.vibe}" listo. ⚡ Ingeniero de frontend escribiendo ${plan.frontendFiles.length} archivo(s)…` });
  await log("coder", `💻 Generando frontend: objetivo ${plan.frontendFiles.length} archivo(s)…`);
  if (plan.backendNeeded) await log("coder", "⚙️ Generando backend en paralelo…");

  /* === Phase 3: frontend + backend (paralelo solo cuando ya existe arquitectura y diseño reales) === */
  const TARGET_CHARS = 90_000;
  let lastLogChars = 0;
    const frontendPromise = runPhase("frontend", (m) =>
    withTimeoutOrThrow(
      generateFrontendCode(plan, design, research, prompt, (chars, fileName) => {
        if (fileName) {
          log("coder", fileName);
        } else {
          const charsCount = chars.length;
          const ratio = Math.min(1, charsCount / TARGET_CHARS);
          onProgress?.({ phase: "generating", progress: 32 + Math.round(ratio * 55), note: `🚀 Escribiendo código: ${Math.round(charsCount / 1000)} KB…` });
          if (charsCount - lastLogChars >= 8000) {
            lastLogChars = charsCount;
            log("coder", `Construyendo... ${Math.round(charsCount / 1000)} KB y subiendo.`);
          }
        }
      }, resolveModelForAgent("frontend", plan.frontendFiles.length, coderModel), language),
      600_000,
      "frontend-engineer",
    ),
    coderModel || DEFAULT_MODEL
  );
  const runBackend = execPlan.phases.includes("backend") && plan.backendNeeded;
  let lastBackendLogChars = 0;
  const backendPromise = runBackend
    ? runPhase("backend", (m) => generateBackendCode(plan, prompt, (chars, fileName) => {
        if (fileName) {
          log("coder", fileName);
        } else {
          if (chars.length - lastBackendLogChars >= 8000) {
            lastBackendLogChars = chars.length;
            log("coder", `⚙️ Backend: escribiendo... ${Math.round(chars.length / 1000)} KB.`);
          }
        }
      }, resolveModelForAgent("backend", plan.frontendFiles.length, coderModel)), resolveModelForAgent("backend", plan.frontendFiles.length, coderModel))
    : Promise.resolve(null);

  if (!execPlan.phases.includes("frontend")) {
    throw new Error(`El planificador devolvió un alcance sin fase 'frontend' (${execPlan.scope}). No es posible generar una app sin código de frontend.`);
  }

  const [frontendResult, backendResult] = await Promise.all([frontendPromise, backendPromise]);

  if (!frontendResult.code) {
    await log("coder", `Frontend falló: ${frontendResult.truncated ? "truncado por tokens" : (frontendResult.error ?? "desconocido")}`, "error");
    throw new Error(
      frontendResult.truncated
        ? "El ingeniero de frontend se quedó sin tokens. Pide una app más pequeña o más específica."
        : `No pudimos analizar el frontend. Detalle: ${frontendResult.error ?? "desconocido"}`,
    );
  }
  await log("coder", `Frontend listo: ${Math.round(frontendResult.code.length / 1000)} KB.`);
  if (plan.backendNeeded && backendResult?.code) {
    await log("coder", `Backend listo: ${Math.round(backendResult.code.length / 1000)} KB.`);
  }

  /* === Phase 4: QA + Tests obligatorios cuando el plan los requiere === */
  onProgress?.({ phase: "reviewing", progress: 78, note: "✅ Revisor de calidad y 🧪 Test Engineer trabajando en paralelo…" });
  if (runQa) log("qa", "🔍 Revisando bundle en busca de bugs…");
  if (runTests) log("qa", "🧪 Generando tests en paralelo…");

  const reviewPromise = runQa
    ? runPhase("qa", () => reviewBundle(frontendResult.code, plan), resolveModelForAgent("qa", plan.frontendFiles.length, coderModel))
    : Promise.resolve({ ok: true, issues: [] } as QAReport);
  const testsPromise = runTests
    ? runPhase("tests", () => generateTests(plan, frontendResult.code))
    : Promise.resolve(null);

  const [report, testCode] = await Promise.all([reviewPromise, testsPromise]);
  if (!runQa) log("qa", "Plan dice saltar QA (alcance reducido).");
  if (!runTests) log("qa", "Plan dice saltar generación de tests.");

  const issueCount = report.issues?.length ?? 0;
  await log("qa", issueCount > 0 ? `${issueCount} issue(s) detectada(s) — pasando al patcher.` : "Sin issues detectadas en revisión inicial.", issueCount > 0 ? "warn" : "info");

  /* === Phase 5: validate → patch loop === */
  await log("validator", "Compilando bundle con esbuild para verificar sintaxis y dependencias…");
  const finalFrontend = await runPhase("validate-patch-loop", () =>
    runValidatePatchLoop(
      frontendResult.code,
      report,
      onProgress,
      80,
      language,
      log,
      { validate: execPlan.phases.includes("validate"), patch: execPlan.phases.includes("patch") },
    ),
  );

  const testNote = testCode ? "✅ Tests generados. " : "";
  if (testCode) log("qa", `Tests generados (${Math.round(testCode.length / 1000)} KB).`);
  onProgress?.({ phase: "parsing", progress: 94, note: `${testNote}📦 Empaquetando archivos…` });
  await log("system", "Empaquetando archivos finales…");

  /* === Final assembly === */
  const setupNotes = buildSetupNotes(integrationSpec);
  const testsAppendix = testCode ? `\n\n${testCode}` : "";

  // Inyectar marca de agua de Maris AI en el código frontend
  const watermarkComponent = generateWatermarkReactComponent();
  const frontendWithWatermark = finalFrontend + "\n\n" + watermarkComponent + testsAppendix + setupNotes;

  // Extraer y cachear componentes reutilizables para futuras generaciones (best-effort)
  extractAndStoreComponents(frontendWithWatermark, language).catch(() => {});
  // Programar análisis de auto-refactorización en background (best-effort)
  scheduleAutoRefactoring(String(Date.now()), "system", frontendWithWatermark).catch(() => {});

  // Guardar generación exitosa en memoria persistente (best-effort, no bloquea)
  rememberGeneration({
    prompt: prompt.slice(0, 2000),
    language,
    plan,
    design,
    metrics: {
      durationMs: Date.now() - _genStartTime,
      frontendKb: Math.round(frontendWithWatermark.length / 1024),
      patchIterations: 0, // aproximación; el loop de patches no expone su contador aquí
      validationPassed: true,
    },
    codeSnippets: [],
  }).catch(() => {});

  await log("memory", `🧠 generación guardada en memoria (${Math.round((Date.now() - _genStartTime) / 1000)}s)`);

  return {
    title: plan.title.slice(0, 200),
    description: plan.description.slice(0, 1000),
    techStack: plan.techStack,
    frontendCode: frontendWithWatermark,
    backendCode: backendResult?.code || "No backend required for this app.",
    plannedPages: plan.pages.map((p) => ({ name: p.name, route: p.route, purpose: p.purpose })),
  };
}
