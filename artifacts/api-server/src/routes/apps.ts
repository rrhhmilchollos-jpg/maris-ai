import { ai as gemini } from "@workspace/integrations-gemini-ai";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { MarisPnpmOrchestrator, CoreOrchestrator } from "@workspace/services";
import OpenAI from "openai";

// Lazy OpenAI client — evita crash al arrancar si la API key no está configurada
let _openaiApps: OpenAI | null = null;
function getOpenAIApps(): OpenAI {
  if (!_openaiApps) {
    _openaiApps = new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "dummy",
    });
  }
  return _openaiApps;
}
import { makeSlug } from "../lib/deployBundle";
import { validateBundle, type ValidationReport } from "../lib/validate";

// ── Validación de integridad del bundle ──────────────────────────────────────
// Detecta archivos TSX/TS truncados que pasan el QA pero fallan en el preview.
// Un archivo está truncado si: el JSX tiene tags abiertos sin cerrar al final,
// o si termina en mitad de una expresión (sin punto y coma, sin })
function detectTruncatedFiles(bundle: string): string[] {
  const truncated: string[] = [];
  const parts = bundle.split(/\/\/ === FILE: /);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const filename = part.slice(0, nl).trim().replace(/ ===$/, "");
    const code = part.slice(nl + 1).trimEnd();
    if (!filename.match(/\.(tsx?|jsx?)$/)) continue;
    // Detectar truncación: el archivo no termina con }, ), ; o un string
    const lastChar = code[code.length - 1];
    const lastLine = code.split("\n").pop() || "";
    const isTruncated = (
      (!["}", ")", ";", '"', "'", "`", ">"].includes(lastChar)) ||
      (lastLine.trim().endsWith("...") || lastLine.trim() === "") && code.length < 500
    );
    // También detectar JSX abierto: contar < y > de forma simple
    const openJSX = (code.match(/<[A-Z]/g) || []).length;
    const closeJSX = (code.match(/<\/[A-Z]/g) || []).length;
    if (Math.abs(openJSX - closeJSX) > 5) {
      truncated.push(filename);
    } else if (isTruncated && code.length > 100) {
      truncated.push(filename);
    }
  }
  return truncated;
}
import { runTestingAgent } from "../lib/tester";
import { runPMAgent, type EmergentArchitectBlueprint } from "../lib/emergentAgentPipeline";
import { detectIntegrations } from "../lib/fileToolsAgent";
import { 
  type GenLanguage, 
  type QAIssue, 
  type QAReport, 
  type BuildIssue,
  type AgentLog,
  type GeneratePhase,
  type GenerateProgress,
  type ComplexityTier,
  extractJsonObject,
  withTimeout,
  createClaudeMessageWithFallback,
  buildPatcherSystemPrompt,
  patchBundle,
  buildFastPatchPrompt,
  mergePatchIntoBundle,
  compactBundleForPrompt,
  estimatePromptTokens
} from "../lib/shared-agents";
import { validateBundleInE2B } from "../lib/e2bValidator";
import { shouldValidateInE2B } from "../lib/e2bGate";
import { logger } from "../lib/logger";
import { recallSimilar, rememberPatch, buildRecallExamplesBlock, extractFixHint, redactSecrets } from "../lib/agentMemory";
import { formatMemoryBlock, type AgentMemoryContext } from "../lib/agentMemoryContext";
import { planExecution, planSummaryEs, PLAN_FEATURE, PLAN_LANDING_FAST, isSimpleLandingRequest } from "../lib/planner";
import { TEMPLATES, buildAgentTemplateContextBlock } from "../lib/templates";
import { isAdminEmail } from "../lib/auth";
import { chargeCredits } from "../lib/credits";
import { pushAppToGitHub } from "../lib/githubPush";
import { executeDataOperation } from "../lib/dataOperationAgent";
import { MarisId, generateAppId } from "../lib/universalId";
import { connectDB } from "@workspace/db";
// KIND_COSTS se define localmente abajo para evitar conflictos de importación cíclica

interface RouteGenerationRequestContext {
  kind?: string;
  detectedLocale?: string;
  detectedCountry?: string;
  uiLanguage?: string;
  hasEverPaid?: boolean;  // false = usuario free → solo landing pages simples
}

/* ============================================================================
 * Maris AI multi-agent generation pipeline.
 *
 * Todos los agentes usan Anthropic (Claude) por defecto para mayor estabilidad:
 *   - Researcher    (Claude Sonnet/Haiku)  — referencia web
 *   - Architect     (Claude Sonnet)        — plan / estructura
 *   - Designer      (Claude Sonnet/Haiku)  — design system
 *   - Frontend Eng  (Claude Sonnet, streaming) — bundle frontend
 *   - Backend Eng   (Claude Sonnet/Haiku)  — bundle backend
 *   - QA Reviewer   (Claude Sonnet/Haiku)  — revisión
 *   - Patcher       (Claude Sonnet)        — auto-fix
 * ========================================================================== */

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
  
  IMPORTANT: You MUST ALWAYS include a 'vercel.json' file in the root with the following content to allow the app to be previewed in an iframe on marisai.es:
  {
    "headers": [
      {
        "source": "/(.*)",
        "headers": [
          {
            "key": "Content-Security-Policy",
            "value": "frame-ancestors * 'self' https://marisai.es https://www.marisai.es https://*.marisai.es https://maris-ai-api-server-production-fbad.up.railway.app https://*.railway.app https://*.vercel.app https://*.vercel.live"
          }
        ]
      }
    ]
  }

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
- Icons: lucide-react in headers, buttons, empty states. ONLY use icons that exist in lucide-react v0.344 — safe icons include: Home, User, Users, Settings, Search, Bell, Menu, X, Check, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ArrowLeft, ArrowRight, Plus, Minus, Edit, Trash, Eye, EyeOff, Lock, Unlock, Mail, Phone, MapPin, Calendar, Clock, Star, Heart, Bookmark, Share, Download, Upload, File, Folder, Image, Video, Music, Mic, Camera, Send, MessageSquare, AlertTriangle, AlertCircle, Info, CheckCircle, XCircle, Shield, Key, LogIn, LogOut, RefreshCw, RotateCcw, Loader, Loader2, Spinner, BarChart, BarChart2, BarChart3, LineChart, PieChart, TrendingUp, TrendingDown, Activity, Zap, Globe, Wifi, Bluetooth, Battery, Power, Sun, Moon, Cloud, Wind, Thermometer, Map, Navigation, Compass, Flag, Tag, Hash, Link, ExternalLink, Code, Terminal, Database, Server, Cpu, Monitor, Smartphone, Tablet, Laptop, Printer, HardDrive, Package, Box, Gift, ShoppingCart, CreditCard, DollarSign, Euro, Truck, Car, Plane, Train, Bike, Anchor, Building, Home, Store, Hotel, School, Hospital. NEVER use: Siren, Alarm, Police, FireTruck or any icon you are not 100% sure exists.
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
- CONCISE CODE: write clean, dense code without excessive comments, blank lines or padding. Each file should be as short as possible while being complete and functional. Avoid verbose JSDoc blocks. This maximises the number of files you can generate within the token budget.
- Close every quote, brace and bracket. Output ONLY the JSON object.`;
}

const BACKEND_SYSTEM_PROMPT = `You are Maris AI's Senior Backend Engineer. Generate a complete, production-quality Node/Express backend as STRICT JSON only. Your code is what would pass a senior code review at a serious startup.

Schema:
{"backendCode":"all backend files as one string OR 'No backend required for this app.'"}

Use '// === FILE: <path> ===' to separate files. When a backend is needed include:
- package.json, tsconfig.json, src/index.ts (express bootstrap with helmet + cors + json + error middleware), src/routes/<name>.ts (one per resource), src/models/<Name>.ts (Mongoose model), src/db/seed.ts (optional seed data), src/lib/<name>.ts as needed (logger, error helpers).

Stack: Node 20 + Express 5 + TypeScript + Mongoose + MongoDB. Use zod for input validation. Real working handlers, no stubs.

QUALITY BAR:
- RESTful resource routes: GET /resource (list, with optional ?limit / ?offset / ?q), GET /resource/:id, POST /resource (validates body), PATCH /resource/:id, DELETE /resource/:id.
- Validate every request body with zod and return 400 with the parsed error issues. Validate every :id is a real number/uuid and 404 cleanly.
- Wrap async handlers with a small asyncHandler helper or try/catch — never let a rejected promise leak.
- Centralized error middleware that returns { error: string } in JSON, never an HTML stack trace.
- Set sensible defaults: helmet for security headers, cors for the frontend origin, express.json() with a reasonable limit, request logging.
- Mongoose schemas include _id (auto), createdAt/updatedAt timestamps (timestamps: true), and proper refs for relations. Mongoose populate() for joins if more than one model.
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
  "pages": [
    {"name":"Home","route":"/","purpose":"Hero, features, social proof, and main CTAs"},
    {"name":"Catalog","route":"/catalog","purpose":"Browse and filter products/services"},
    {"name":"Contact","route":"/contact","purpose":"Contact form and company details"},
    {"name":"Dashboard","route":"/dashboard","purpose":"User/Admin control panel"}
  ],
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
- A real product has 5-8 pages minimum. Every main button in the Navbar/Hero MUST have its own dedicated page and route.
- If the app is about services (like alarms), include specific pages for: Home, Services/Alarms, Pricing/Kits, Contact, and a specialized page for the main value prop (e.g. "Escudo Vecinal").
- Think about empty states, error states, loading states — they're real screens.

COMPONENTS — model real reusable pieces:
- Always include: Navbar, Footer, Button (if you need a custom button), Card variant(s), at least one Form component.
- Include domain-specific components: ProductCard, PostItem, UserAvatar, PriceTag, FilterSidebar, SearchBar, EmptyState, etc. The names should be obvious.
- Aim for 6-12 components. Each gets its own file.

DATA MODELS — make them realistic:
- Include the fields you'd actually use in a real schema (id, timestamps, relations, status enums).
- 2-5 models is healthy for most apps.

INTENT HINTS — when the user prompt starts with a bracketed hint like "[INTENT: …]", that's a top-priority directive from the dashboard's project-type tabs. Honor it strictly. The hint OVERRIDES the FULL-STACK RULE below — if the hint says backendNeeded=false, set backendNeeded=false even if there are full-stack keywords.

FULL-STACK RULE — be aggressive about backendNeeded=true:
- Any of these triggers MUST set backendNeeded=true: marketplaces, ecommerce, social networks, SaaS, dashboards, chat apps, anything with user accounts, anything with persistence, anything that lists or stores user-generated content, anything with payments, anything with AI calls, anything called "clon de X".
- Pure landing pages, single-user calculators, simple games and tools without persistence are the only valid backendNeeded=false cases.

SCOPE LIMITS — crítico para que el frontend pueda generarse sin timeout:
- Apps standard (score 1-2): máximo 8 páginas, 12 componentes, 6 hooks. Si el prompt no menciona explícitamente decenas de funcionalidades, mantén el plan ajustado.
- Apps complejas (score 3+): máximo 12 páginas, 16 componentes, 8 hooks.
- NUNCA generes más de 50 frontendFiles en total — el frontend engineer no puede procesar más sin timeout.
- Prioriza CALIDAD sobre CANTIDAD: 6 páginas bien hechas > 19 páginas a medias.
- Si el producto genuinamente necesita más, indica en "description" que es una versión MVP y el usuario puede pedir más páginas después.

Rules:
- File structure: each page/component/hook/util gets its own file. EXCEPTION: if the total planned files exceed 25, consolidate all hooks into one src/hooks/index.ts, all utils into src/utils/index.ts, and all small components (under 50 lines each) into src/components/ui.tsx. This prevents token limit truncation on large apps.
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
- For payments, prefer "Stripe" (international/EU). For LatAm-specific apps (Argentina, México, Colombia…) prefer "Mercado Pago". If the user explicitly asks for PayPal, use "PayPal".
- If the app needs transactional email, use "Resend". For mass email/newsletters, use "SendGrid".
- If the app needs image uploads/galleries, use "Cloudinary". For large files (video, PDFs), use "AWS S3".
- If the app needs maps/locations, use "Google Maps".
- If the app needs appointment scheduling synced to a real calendar, use "Google Calendar".
- If the app needs AI-generated images (logos, product photos), use "OpenAI Images".
- If the app needs social login, use "Google OAuth" (or "Clerk" if it already handles auth broadly).
- If the app needs WhatsApp notifications, use "WhatsApp".
- If the app needs push notifications, use "OneSignal".
  Using these exact names lets the coder agents apply pre-verified, correct integration code (a "playbook").
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



export interface GeneratedAppPayload {
  title: string;
  description: string;
  techStack: string[];
  frontendCode: string;
  backendCode: string;
  plannedPages?: Array<{ name: string; route?: string; purpose?: string }>;
  requiredEnvVars?: Array<{ name: string; why: string; value?: string }>;
}



export interface AttachmentContext {
  id: number | string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  textContent?: string;
  dataBase64?: string; // Para imágenes — se pasa como vision a Claude
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
      const isVideo = a.mimeType.startsWith("video/");
      const note = isImg
        ? `imagen de referencia visual adjuntada por el usuario — analiza su estilo, colores, layout y estructura y replica/inspírate en ella para la app`
        : isVideo
        ? `vídeo de referencia adjuntado por el usuario — usa su contenido como contexto visual y funcional`
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
  // Siempre investigar para TODOS los prompts de apps nuevas.
  // El investigador busca en internet real (DuckDuckGo/Serper/Brave) para
  // obtener contexto del mercado antes de diseñar la arquitectura.
  // Solo se omite si el prompt es muy corto (edición menor < 20 chars).
  if (prompt.trim().length < 20) return false;
  return true;
}

/* ----------------------------- helpers ------------------------------------ */



async function withTimeoutOrThrow<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${label} timeout after ${ms}ms`);
      reject(error);
    }, ms);
  });

  try {
    const result = await Promise.race([p, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (err) {
    clearTimeout(timeoutId!);
    // If the original promise 'p' already had accumulated data attached to its error,
    // we want to make sure that data is available even if the timeout won the race.
    // However, since we can't easily 'wait' for 'p' after timeout, we rely on 
    // the fact that many async operations update a shared state or that 'p'
    // might have already rejected with data just before the timeout.
    throw err;
  }
}

/* ----------------------------- agents ------------------------------------- */

/**
 * Researcher — Gemini 2.0 Flash con google_search tool.
 */
export async function researchTopic(prompt: string, agentPlan = selectAgentModelPlan(prompt), logFn?: (agent: string, msg: string) => Promise<void>): Promise<string> {
  const hasUrl = URL_LIKE.test(prompt);
  const cleanPrompt = prompt.replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/, "").trim();

  return withTimeout(
    (async () => {
      try {
        // Tool calling real: el agente decide cuándo y qué buscar
        const { runAgentWithTools } = await import("../lib/agentTools");
        const result = await runAgentWithTools({
          role: "researcher",
          model: "claude-haiku-4-5-20251001", // Haiku es suficiente y más rápido para research
          systemPrompt: `Eres el agente investigador de Maris AI. Tu objetivo: producir un brief conciso en español para que el arquitecto diseñe la app correctamente.

USA la herramienta web_search si el prompt menciona una tecnología específica, un sector de negocio, una empresa real, o necesita datos actualizados. No busques para prompts genéricos como "crea una app de tareas".

OUTPUT: texto plano ≤400 palabras con:
- Qué hace el producto y para quién
- Páginas/secciones clave, funcionalidades principales
- Colores y fuentes sugeridos para el sector
- Contexto competitivo si aplica
Sin preámbulos, sin markdown pesado.`,
          userMessage: hasUrl
            ? `Investiga y genera brief para: "${cleanPrompt}"`
            : `Genera brief de referencia para: "${cleanPrompt}"`,
          maxIterations: 3,
          ctx: { log: logFn },
        });
        if (result.text.trim().length > 50) {
          const src = result.toolsUsed.includes("web_search") ? "[Fuente: búsqueda web en tiempo real]\n" : "[Fuente: conocimiento del modelo]\n";
          return src + result.text.trim().slice(0, 4000);
        }
      } catch (err) {
        logger.warn({ err }, "researcher tool-calling failed, falling back to direct call");
      }

      // Fallback: llamada directa sin tools
      try {
        const response = await createClaudeMessageWithFallback("researcher", agentPlan.agents.researcher.model, {
          max_tokens: 1500,
          system: `You are Maris AI's web researcher. Produce a concise reference brief in Spanish. Plain text only. ≤400 words.`,
          messages: [{ role: "user", content: `Brief for: "${cleanPrompt}"` }],
        });
        const text = (response.content[0] as any).text ?? "";
        if (text.trim().length > 50) return `[Fuente: conocimiento del modelo]\n${text.trim().slice(0, 4000)}`;
      } catch { /* continuar al fallback final */ }

      return `[Brief de emergencia]\nProducto: ${cleanPrompt.slice(0, 200)}\nApp web profesional, moderna y responsiva con las funcionalidades solicitadas.`;
    })(),
    hasUrl ? 20_000 : 15_000,
    `[Brief mínimo — timeout]\nProducto: ${cleanPrompt.slice(0, 200)}\nAplicación web profesional. Diseño moderno y responsivo.`,
  );
}

/**
 * Architect — Anthropic Claude Sonnet 4.6.
 */
async function architectPlan(prompt: string, research: string, templateContext = "", agentPlan = selectAgentModelPlan(prompt)): Promise<ProjectPlan> {
  const templateNote = templateContext ? `\n\n${templateContext}` : "";

  // Extrae lo que el usuario REALMENTE pide — quita los metadatos internos de Maris
  const cleanPrompt = prompt
    .replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "")
    .replace(/\[MARIS_ENGINE=[^\]]*\]/g, "")
    .replace(/\[ADMIN[^\]]*\]/g, "")
    .trim();

  // Analiza la complejidad real del prompt para dar instrucción de scope al arquitecto
  const complexity = classifyPromptComplexity(cleanPrompt);
  const scopeHint = complexity.tier === "basic"
    ? "SCOPE: This is a simple/basic request. Maximum 4 pages, 6 components. Do NOT over-engineer."
    : complexity.tier === "standard"
    ? "SCOPE: Standard app. Maximum 6 pages, 10 components. Build exactly what is asked, nothing more."
    : complexity.tier === "robust"
    ? "SCOPE: Complex app. Up to 8 pages, 14 components. Focus on the user's core use cases."
    : "SCOPE: Enterprise-level app. Up to 12 pages, 16 components. Prioritize the most critical modules first.";

  const userContent = research
    ? `${scopeHint}\n\nDesign the file structure for this app:\n\n${cleanPrompt}${templateNote}\n\n---\nResearch context (treat as ground truth for branding & sections):\n${research}`
    : `${scopeHint}\n\nDesign the file structure for this app:\n\n${cleanPrompt}${templateNote}`;

  const response = await withTimeoutOrThrow(
    anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      system: ARCHITECT_SYSTEM_PROMPT + "\nOutput JSON only.",
      messages: [{ role: "user", content: userContent }],
    }),
    90_000, // Increased from 60s to 90s to match outer timeout
    "architect",
  );

  const raw = (response.content[0] as any).text ?? "";
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

  // Límites hard en architectPlan — 64K tokens = ~28 archivos medianos
  // Con más archivos el coder se trunca y hay que reintentar
  const HARD_MAX_PAGES = 6;
  const HARD_MAX_COMPONENTS = 10;
  const HARD_MAX_FILES = 28;
  if (plan.pages.length > HARD_MAX_PAGES) {
    logger.warn({ pages: plan.pages.length }, "Architect plan too large — truncating pages");
    plan.pages = plan.pages.slice(0, HARD_MAX_PAGES);
  }
  if (plan.components.length > HARD_MAX_COMPONENTS) {
    plan.components = plan.components.slice(0, HARD_MAX_COMPONENTS);
  }
  if (plan.hooks.length > 6) plan.hooks = plan.hooks.slice(0, 6);
  if (plan.utils.length > 4) plan.utils = plan.utils.slice(0, 4);
  if (plan.frontendFiles.length > HARD_MAX_FILES) {
    const keptPages = new Set(plan.pages.map((p: any) => p.name));
    const keptComponents = new Set(plan.components.map((c: any) => c.name));
    plan.frontendFiles = plan.frontendFiles.filter((f: string) => {
      if (f.includes("/pages/")) return [...keptPages].some(n => f.includes(n));
      if (f.includes("/components/")) return [...keptComponents].some(n => f.includes(n));
      return true;
    }).slice(0, HARD_MAX_FILES);
  }

  return plan;
}

/**
 * Designer — Anthropic Claude Sonnet 4.6.
 */
async function designSystem(plan: ProjectPlan, research: string, templateContext = "", agentPlan = selectAgentModelPlan(plan.description ?? plan.title)): Promise<DesignSystem> {
  const summary = `Product: ${plan.title}\nDescription: ${plan.description}\nVibe needed for: ${plan.pages.map((p) => p.name).join(", ")}`;
  const templateNote = templateContext ? `\n\n${templateContext}` : "";
  const userContent = research
    ? `${summary}${templateNote}\n\nDesign the visual system. Reference brand context:\n${research.slice(0, 1500)}`
    : `${summary}${templateNote}`;
  let raw = "";
  try {
    const response = await withTimeoutOrThrow(
      createClaudeMessageWithFallback("designer", agentPlan.agents.designer.model, {
        max_tokens: 4096,
        system: DESIGNER_SYSTEM_PROMPT + "\nOutput JSON only.",
        messages: [{ role: "user", content: userContent }],
      }),
      15_000,
      "designer",
    );
    raw = (response.content[0] as any).text ?? "";
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
type ClaudeCoderModel = "claude-haiku-4-5" | "claude-haiku-4-5-20251001" | "claude-sonnet-4-6" | "claude-opus-4-7";

type AgentRole = "researcher" | "architect" | "designer" | "frontend" | "backend" | "database" | "integrator" | "qa" | "devops" | "patcher" | "repair";

interface AgentModelChoice {
  role: AgentRole;
  label: string;
  model: ClaudeCoderModel | "gpt-5.4";
  reason: string;
}



const CLAUDE_MODELS: ClaudeCoderModel[] = ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"];

function resolveCoderProvider(coderModel?: string): CoderProvider {
  const normalized = normalizeCoderModel(coderModel);
  if (normalized === "gpt-5.4") return "gpt-5";
  return "claude";
}

function normalizeCoderModel(coderModel?: string): string {
  const value = String(coderModel || "auto").trim().toLowerCase();
  if (!value || value === "auto" || value === "automatic") return "auto";
  if (["gpt-5", "gpt-5-codex", "gpt-5.4", "openai", "openai-gpt-5"].includes(value)) return "gpt-5.4";
  if (["claude-haiku", "claude-haiku-4-5", "haiku", "fast", "basic"].includes(value)) return "claude-haiku-4-5";
  if (["claude-opus", "claude-opus-4-7", "opus", "robust", "max"].includes(value)) return "claude-opus-4-7";
  if (["claude-sonnet", "claude-sonnet-4-6", "claude-4-8-sonnet", "sonnet", "claude-mithos", "gemini-3", "gemini-2.5-flash", "auto", "default"].includes(value)) return "claude-sonnet-4-6";
  return value;
}

function resolveClaudeCoderModel(coderModel?: string): ClaudeCoderModel {
  const normalized = normalizeCoderModel(coderModel);
  if (normalized === "claude-haiku-4-5") return "claude-haiku-4-5";
  if (normalized === "claude-opus-4-7") return "claude-opus-4-7";
  return "claude-sonnet-4-6";
}

function classifyPromptComplexity(prompt: string, context?: { kind?: string; hasExistingApp?: boolean }): { tier: ComplexityTier; score: number; reasons: string[] } {
  const text = prompt.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => { score += points; reasons.push(reason); };
  if (prompt.length > 350) add(1, "prompt detallado");
  if (prompt.length > 900) add(2, "prompt extenso");
  if (/(marketplace|saas|crm|erp|dashboard|admin|multiusuario|usuarios|roles|permisos|auth|login|registro|stripe|suscripci[oó]n|pagos|checkout|base de datos|mongodb|postgres|api|backend|webhook|tiempo real|chat|notificaciones|email|analytics|ia|agente|scraping|integraci[oó]n)/.test(text)) add(2, "funcionalidad de producto robusto");
  if (/(fullstack|backend|base de datos|crud|api|admin|panel|dashboard|stripe|auth|roles|webhook|notificaciones)/.test(text)) add(2, "requiere backend/integraciones");
  if (/(juego 3d|3d|three|webgl|pwa|offline|sincronizaci[oó]n|mobile|m[oó]vil|next|django|fastapi)/.test(text)) add(2, "stack especializado");
  if (/(landing|portfolio|portafolio|one page|p[aá]gina simple|blog simple|est[aá]tica)/.test(text)) add(-1, "alcance básico");
  if (context?.hasExistingApp) add(1, "edición de app existente");
  if (["landing", "vue", "svelte"].includes(context?.kind || "")) add(-1, "preset ligero");
  if (["game-3d", "nextjs", "python-api", "django", "fullstack"].includes(context?.kind || "")) add(2, "preset avanzado");
  // Ultra-complex: CRM/ERP/plataformas completas con múltiples módulos, muy completo, super completo, etc.
  if (/(totalmente completa|super completo|muy completo|m[uú]ltiples funcionalidades|m[uú]ltiples m[oó]dulos|completo con|panel completo|plataforma completa|sistema completo|todo incluido|todas las funcionalidades|funcionalidades completas|crm completo|erp completo|plataforma.*fisio|fisioterapeuta|cl[ií]nica|hospital|gesti[oó]n.*pacientes|historial.*m[eé]dico)/.test(text)) add(4, "proyecto ultra-complejo con múltiples módulos");
  if (prompt.length > 500) add(1, "prompt muy extenso");
  if (prompt.length > 1200) add(2, "prompt ultra-extenso");
  // Tiers: ultra >= 10, robust >= 7, standard >= 2, basic < 2
  const tier: ComplexityTier = score >= 10 ? "ultra" : score >= 7 ? "robust" : score >= 2 ? "standard" : "basic";
  return { tier, score, reasons };
}

function makeAgentChoice(role: AgentRole, label: string, model: AgentModelChoice["model"], reason: string): AgentModelChoice {
  return { role, label, model, reason };
}

function selectAgentModelPlan(prompt: string, requestedModel?: string, context?: { kind?: string; hasExistingApp?: boolean; isPaidUser?: boolean }) {
  const normalized = normalizeCoderModel(requestedModel);
  const auto = normalized === "auto";
  const complexity = classifyPromptComplexity(prompt, context);
  const isPaid = !!(context?.isPaidUser);

  // ── ESTRATEGIA DE MODELOS POR PLAN ───────────────────────────────────────
  // FREE: Haiku para todo excepto frontend (Sonnet mínimo para calidad aceptable)
  //       Límites de complejidad estrictos (4 páginas, 6 componentes, 20 archivos)
  // PAID: Sonnet para todo, sin límites de complejidad
  // ─────────────────────────────────────────────────────────────────────────
  const frontendModel: AgentModelChoice["model"] = auto
    ? "claude-sonnet-4-6" // Frontend siempre Sonnet — calidad mínima aceptable
    : (normalized === "gpt-5.4" ? "gpt-5.4" : resolveClaudeCoderModel(normalized));

  // Usuarios free usan Haiku en agentes auxiliares — ahorro del ~80% en tokens
  const auxModel: ClaudeCoderModel = isPaid ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
  const architectModel: ClaudeCoderModel = isPaid ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
  const qualityModel: ClaudeCoderModel = isPaid
    ? (complexity.tier === "basic" ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6")
    : "claude-haiku-4-5-20251001"; // Free siempre Haiku en QA

  const agents: Record<AgentRole, AgentModelChoice> = {
    researcher: makeAgentChoice("researcher", "Researcher", auxModel, "recopila contexto desde el primer prompt"),
    architect: makeAgentChoice("architect", "Architect", architectModel, "decide estructura, páginas y alcance"),
    designer: makeAgentChoice("designer", "Designer", auxModel, "define sistema visual"),
    frontend: makeAgentChoice("frontend", "Frontend", frontendModel, auto ? `auto por complejidad ${complexity.tier}` : "selección manual del usuario"),
    backend: makeAgentChoice("backend", "Backend", isPaid ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001", "implementa API cuando el plan la necesita"),
    database: makeAgentChoice("database", "Database", qualityModel, "modela datos y semillas"),
    integrator: makeAgentChoice("integrator", "Integrator", auxModel, "detecta auth, pagos y servicios externos"),
    qa: makeAgentChoice("qa", "QA Auditor", qualityModel, "revisa errores obvios y tests"),
    devops: makeAgentChoice("devops", "DevOps", auxModel, "verifica despliegue, scripts y configuración"),
    patcher: makeAgentChoice("patcher", "testing-agent", isPaid ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001", "testing-agent: experto técnico en reparación de errores de build/runtime"),
    repair: makeAgentChoice("repair", "Repair", "claude-sonnet-4-6", "recupera JSON malformado"),
  };
  return { tier: complexity.tier, score: complexity.score, selectedCoderModel: normalized, auto, agents };
}

function fallbackClaudeModels(model: AgentModelChoice["model"]): ClaudeCoderModel[] {
  const primary = model === "gpt-5.4" ? "claude-sonnet-4-6" : model;
  return [primary, ...CLAUDE_MODELS.filter((m) => m !== primary)];
}



async function streamClaudeTextWithFallback(role: AgentRole, model: AgentModelChoice["model"], params: any, onChars: (chars: number) => void): Promise<{ text: string; truncated: boolean; model: ClaudeCoderModel }> {
  let lastError: unknown;
  for (const candidate of fallbackClaudeModels(model)) {
    try {
      let accumulated = "";
      let lastReport = 0;
      let finishReason: string | undefined;
      const stream = anthropic.messages.stream({ ...params, model: candidate });
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          accumulated += chunk.delta.text;
          if (accumulated.length - lastReport >= 1500) {
            lastReport = accumulated.length;
            onChars(accumulated.length);
          }
        }
        if (chunk.type === "message_delta" && chunk.delta.stop_reason === "max_tokens") finishReason = "MAX_TOKENS";
      }
      return { text: accumulated, truncated: finishReason === "MAX_TOKENS", model: candidate };
    } catch (err) {
      lastError = err;
      logger.warn({ role, model: candidate, err }, "Streaming agent model failed; trying fallback");
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Frontend Engineer — Anthropic Claude Sonnet 4.6 (default) o GPT-5.
 * Optimizado para evitar timeouts y asegurar la generación completa.
 */
async function generateFrontendCode(
  plan: ProjectPlan,
  design: DesignSystem,
  research: string,
  prompt: string,
  onChars: (chars: number) => void,
  coderModel: string | undefined,
  language: GenLanguage,
  templateContext = "",
  agentPlan = selectAgentModelPlan(prompt, coderModel),
  onPartial?: (text: string) => void,
  isFreeUser = false,
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

  // Para apps con muchos archivos, consolidar todo en App.tsx para evitar truncación
  const totalFiles = plan.frontendFiles?.length || 0;
  const useSingleFile = totalFiles > 20 || isFreeUser;
  const fileStrategyNote = useSingleFile
    ? `

CRITICAL FILE STRATEGY — esta app tiene ${totalFiles} archivos planificados. Para evitar truncación por límite de tokens:
- Pon TODO el código React en src/App.tsx (tipos, utils, hooks, componentes, páginas, router — TODO en un solo archivo)
- Los únicos archivos separados permitidos son: index.html, package.json, vite.config.ts, tsconfig.json, tailwind.config.ts, postcss.config.js, src/main.tsx, src/index.css
- NUNCA crees archivos separados para hooks, componentes o páginas
- El App.tsx puede tener 1500-2000 líneas — eso está bien y es preferible a truncarse`
    : "";

  const userContent = `User request: ${prompt}
${templateContext ? `\n${templateContext}\n` : ""}
Project plan (you MUST implement every listed file):
${planSummary}${fileStrategyNote}

Design system (apply EXACTLY in tailwind.config.ts theme.extend and src/index.css):
${designSummary}
${research ? `\nResearch context (visual reference, treat as ground truth):\n${research.slice(0, 2000)}` : ""}

Now produce the JSON object with frontendCode containing every listed file.`;

  const frontendModel = agentPlan.agents.frontend.model;
  const provider = frontendModel === "gpt-5.4" ? "gpt-5" : resolveCoderProvider(frontendModel);
  const systemPrompt = buildFrontendSystemPrompt(language);
  let accumulated = "";
  let truncated = false;

  if (provider === "gpt-5") {
    try {
    const stream = await getOpenAIApps().chat.completions.create({
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
          onChars(accumulated.length);
          onPartial?.(accumulated);
        }
      }
      const fr = chunk.choices[0]?.finish_reason;
      if (fr === "length") finishReason = "MAX_TOKENS";
    }
    truncated = finishReason === "MAX_TOKENS";
    } catch (err) {
      logger.warn({ err }, "GPT frontend agent failed; falling back to Claude routing");
      const streamed = await streamClaudeTextWithFallback("frontend", "claude-sonnet-4-6", {
        max_tokens: 40000,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] as any,
        messages: [{ role: "user", content: userContent }],
      }, (chars) => { onChars(chars); onPartial?.(accumulated); });
      accumulated = streamed.text;
      truncated = streamed.truncated;
    }
  } else {
    // FREE: max 12k tokens (landing simple), PAID: 28k tokens (app completa)
    const maxTokensFrontend = isFreeUser ? 12000 : 40000; // paid: 40k para apps complejas como CRA
    const streamed = await streamClaudeTextWithFallback("frontend", frontendModel, {
      max_tokens: maxTokensFrontend,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] as any,
      messages: [{ role: "user", content: userContent }],
    }, (chars) => { onChars(chars); onPartial?.(accumulated); });
    accumulated = streamed.text;
    truncated = streamed.truncated;
  }

  const raw = accumulated.trim();
  if (!raw) {
    return { code: "", truncated, error: "Frontend agent returned no text." };
  }

  // Si el JSON está completo, parsearlo normalmente
  const parsed = extractJsonObject<{ frontendCode?: string }>(raw);
  if (parsed && typeof parsed.frontendCode === "string" && parsed.frontendCode.length > 500) {
    return { code: parsed.frontendCode, truncated };
  }

  // Si el JSON está truncado pero hay código acumulado (caso 82KB cortado),
  // intentar extraer los archivos ya completos del JSON parcial
  if (truncated && accumulated.length > 5000) {
    // Buscar el frontendCode dentro del JSON parcial
    const fcMatch = accumulated.match(/"frontendCode"\s*:\s*"([\s\S]*)/);
    if (fcMatch) {
      let partialCode = fcMatch[1];
      // Desescapar las secuencias JSON básicas
      partialCode = partialCode
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
      // Extraer solo los archivos completos (los que tienen el separador de inicio y fin)
      const filePattern = /\/\/ === FILE: [^\n]+\n[\s\S]*?(?=\/\/ === FILE: |$)/g;
      const completeFiles = partialCode.match(filePattern);
      if (completeFiles && completeFiles.length >= 3) {
        const extractedCode = completeFiles.join("\n");
        const extractedFiles = completeFiles.map((f: string) => {
          const nl = f.indexOf("\n");
          return nl !== -1 ? f.slice(0, nl).replace("// === FILE: ", "").replace(" ===", "").trim() : "";
        }).filter(Boolean);
        logger.info({ files: completeFiles.length, kb: Math.round(extractedCode.length / 1000) }, "generateFrontendCode: extracted partial files from truncated JSON");

        // Intentar continuar la generación pidiendo los archivos que faltan
        const plannedFiles = plan.frontendFiles || [];
        const missingFiles = plannedFiles.filter((f: string) => !extractedFiles.some((ef: string) => ef.includes(f.split("/").pop() || "")));

        if (missingFiles.length > 0 && extractedCode.length > 5000) {
          try {
            logger.info({ missingFiles: missingFiles.slice(0, 5) }, "Requesting missing files continuation");
            const continuationPrompt = `CONTINUACIÓN: El bundle anterior fue truncado. Ya tienes estos archivos completos:
${extractedFiles.join(", ")}

Genera SOLO los archivos que faltan en el mismo formato // === FILE: path ===:
${missingFiles.slice(0, 10).join(", ")}

Devuelve SOLO el código de los archivos faltantes, sin JSON wrapper, empezando directamente con // === FILE:`;
            const cont = await streamClaudeTextWithFallback("frontend", frontendModel, {
              max_tokens: isFreeUser ? 6000 : 16000,
              system: [{ type: "text", text: systemPrompt.slice(0, 2000) }] as any,
              messages: [
                { role: "user", content: userContent },
                { role: "assistant", content: JSON.stringify({ frontendCode: extractedCode.slice(0, 100) + "..." }) },
                { role: "user", content: continuationPrompt }
              ],
            }, () => {});
            if (cont.text && cont.text.length > 500) {
              const combined = extractedCode + "\n" + cont.text;
              return { code: combined, truncated: false };
            }
          } catch (contErr) {
            logger.warn({ contErr }, "Continuation request failed, using partial bundle");
          }
        }

        return { code: extractedCode, truncated: true };
      }
    }
    // Si no se pueden extraer archivos, marcar como truncado con el raw para el Repair Agent
    return { code: "", truncated: true, error: "JSON truncado — sin archivos extraíbles", _raw: accumulated } as any;
  }

  return { code: "", truncated, error: "JSON inválido del Frontend Engineer.", _raw: raw } as any;
}

/**
 * Backend Engineer — Anthropic Claude Sonnet 4.6.
 */
async function generateBackendCode(
  plan: ProjectPlan,
  prompt: string,
  templateContext = "",
  agentPlan = selectAgentModelPlan(prompt),
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
${templateContext ? `\n${templateContext}\n` : ""}
Backend plan (implement every listed file with real Express handlers):
${planSummary}

Now produce the JSON object with backendCode.`;

  try {
    const response = await withTimeoutOrThrow(
      createClaudeMessageWithFallback("backend", agentPlan.agents.backend.model, {
        max_tokens: 8192,
        system: BACKEND_SYSTEM_PROMPT + "\nOutput JSON only.",
        messages: [{ role: "user", content: userContent }],
      }),
      45_000,
      "backend-engineer",
    );
    const raw = (response.content[0] as any).text ?? "";
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
 * Landing Page Generator — Fallback de último recurso.
 * Genera SIEMPRE una landing page funcional y visualmente atractiva
 * sin backend ni base de datos. Es lo primero que el cliente debe ver.
 * Se activa cuando cualquier agente falla o hace timeout.
 */
async function generateLandingPage(
  prompt: string,
  language: GenLanguage,
  design?: DesignSystem,
  research?: string,
): Promise<CodeGenResult> {
  const ext = language === "typescript" ? "tsx" : "jsx";
  const utilExt = language === "typescript" ? "ts" : "js";
  const isTS = language === "typescript";

  const systemPrompt = `You are Maris AI's Emergency Landing Page Engineer.
Your ONLY job: generate a beautiful, fully functional landing page in React + Tailwind.
RULES — non-negotiable:
- NO backend, NO database, NO API calls, NO authentication, NO complex state.
- Pure frontend only: useState for basic interactions (tabs, accordion, mobile menu).
- ONE file: src/App.${ext} contains everything. Keep it under 400 lines.
- Include: hero section with headline + CTA button, features/benefits section (3 cards), how-it-works steps (3 steps), FAQ accordion (3 questions), footer.
- Use the design system colors if provided, otherwise use a clean professional palette.
- All text and copy in the same language as the user prompt.
- The landing MUST look like a real product — not a template placeholder. Use the prompt to infer the product name, tagline, and copy.
- Output STRICT JSON only: {"frontendCode":"..."}
- Use '// === FILE: <path> ===' separators. Always include: index.html, package.json, vite.config.${utilExt}${isTS ? ", tsconfig.json" : ""}, tailwind.config.${utilExt}, postcss.config.js, src/main.${ext}, src/App.${ext}, src/index.css
- Always add vercel.json with frame-ancestors: https://marisai.es https://www.marisai.es`;

  const designNote = design
    ? `\n\nDesign system to apply:\n${JSON.stringify({ colors: design.palette, fonts: design.typography }, null, 2)}`
    : "";
  const researchNote = research
    ? `\n\nReference brief (inspiration only):\n${research.slice(0, 800)}`
    : "";

  try {
    const streamed = await streamClaudeTextWithFallback(
      "frontend",
      "claude-haiku-4-5-20251001",
      {
        max_tokens: 10000,
        system: systemPrompt,
        messages: [{ role: "user", content: `Create a landing page for:\n\n${prompt}${designNote}${researchNote}\n\nReturn ONLY JSON: {"frontendCode":"..."}` }],
      },
      () => {},
    );
    const parsed = extractJsonObject<{ frontendCode?: string }>(streamed.text);
    if (parsed?.frontendCode && parsed.frontendCode.length > 500) {
      return { code: parsed.frontendCode, truncated: false };
    }
    return { code: "", truncated: false, error: "landing-page-empty" };
  } catch (err) {
    return { code: "", truncated: false, error: (err as Error).message };
  }
}

/**
 * Integration Architect — Gemini 2.0 Flash.
 */
async function specifyIntegrations(
  plan: ProjectPlan,
  prompt: string,
  agentModelPlan?: ReturnType<typeof selectAgentModelPlan>,
): Promise<IntegrationSpec> {
  const agentPlan = agentModelPlan ?? selectAgentModelPlan(prompt);
  return withTimeout(
    (async () => {
      try {
        const response = await createClaudeMessageWithFallback("integrator", agentPlan.agents.integrator.model, {
          max_tokens: 800,
          system: INTEGRATION_SYSTEM_PROMPT + "\nOutput JSON only.",
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
        const raw = (response.content[0] as any).text ?? "";
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
 * QA Reviewer — Gemini 2.0 Flash.
 */
async function reviewBundle(
  frontendCode: string,
  plan: ProjectPlan,
  agentPlan = selectAgentModelPlan(plan.description ?? plan.title),
): Promise<QAReport> {
  return withTimeout(
    (async () => {
      try {
        const expected = plan.frontendFiles.join(", ");
        const sample = frontendCode.slice(0, 12000);
        const response = await createClaudeMessageWithFallback("qa", agentPlan.agents.qa.model, {
          max_tokens: 700,
          system: "You are a QA reviewer for a React+TS+Tailwind bundle. Output JSON only.",
          messages: [
            {
              role: "user",
              content: `Spot ONLY OBVIOUS bugs that would break runtime: missing imports, undefined symbols, wrong import paths, broken JSX, missing default exports for React components. Ignore stylistic issues.

Expected files: ${expected}

First 12KB of generated bundle:
${sample}

Return STRICT JSON ONLY:
{"ok":true} when everything looks fine,
OR {"ok":false,"issues":[{"file":"src/App.tsx","problem":"imports Button from non-existent path","fix":"Update import to './components/Button' or remove the import"}]}

Max 5 issues.`,
            },
          ],
        });
        const raw = (response.content[0] as any).text ?? "";
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
  agentPlan = selectAgentModelPlan(plan.description ?? plan.title),
): Promise<string> {
  return withTimeout(
    (async () => {
      try {
        const sample = frontendCode.slice(0, 6000);
        const componentNames = plan.components.slice(0, 3).map((c) => c.name).join(", ") || "App";
        const utilNames = plan.utils.slice(0, 2).map((u) => u.name).join(", ") || "(none)";
        const response = await createClaudeMessageWithFallback("qa", agentPlan.agents.qa.model, {
          max_tokens: 3000,
          system: TEST_SYSTEM_PROMPT + "\nOutput JSON only.",
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
        const raw = (response.content[0] as any).text ?? "";
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
  agentModelPlan?: ReturnType<typeof selectAgentModelPlan>,
): Promise<string> {
  // Modelo del agente "patcher" según el plan (Sonnet para paid, Haiku para
  // free). Si no se pasa plan, patchBundle usa su valor por defecto
  // (claude-sonnet-4-6), igual que antes de este fix.
  const patcherModel = agentModelPlan?.agents.patcher.model;
  const MAX_ITERATIONS = 5; // testing-agent: hasta 5 rondas de reparación para proyectos ultra-complejos
  let finalFrontend = initialBundle;
  const noop: AgentLog = () => {};
  const emit = log ?? noop;

  // ── testing-agent: inicio ────────────────────────────────────────────
  emit("testing", "🧪 testing-agent activo — escaneando bundle en busca de errores…");
  onProgress?.({
    phase: "testing",
    progress: Math.min(baseProgressStart, 80),
    note: "🧪 testing-agent: analizando código generado…",
  });

  if (!phaseGates.validate) {
    emit("testing", "△ Testing Agent: validación omitida por plan reducido.", "warn");
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
    emit("testing", iter === 1 ? "🔍 Ejecutando análisis estático del bundle…" : `🔍 Re-análisis tras reparación (intento ${iter}/${MAX_ITERATIONS})…`);
    emit("validator", iter === 1 ? "🔍 build" : `🔍 build · intento ${iter}`);
    const validation = await validateBundle(finalFrontend);

    const combined: BuildIssue[] = iter === 1
      ? [...validation.issues, ...pendingIssues].slice(0, 6)
      : validation.issues.slice(0, 6);
    pendingIssues = [];

    if (validation.ok && combined.length === 0) {
      onProgress?.({
        phase: "testing",
        progress: Math.min(baseProgress + 1, 93),
        note: `✅ Testing Agent: sin errores detectados (${validation.filesAnalyzed} archivo(s)).`,
      });
      emit("testing", `✅ Sin errores — ${validation.filesAnalyzed} archivo(s) validado(s) correctamente.`);
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
        phase: "testing",
        progress: 92,
        note: `⚠️ Testing Agent: quedan ${combined.length} problema(s) tras ${MAX_ITERATIONS} intentos. Entregando mejor versión disponible…`,
      });
      emit("testing", `△ ${combined.length} problema(s) residual(es) tras ${MAX_ITERATIONS} intentos de reparación.`, "warn");
      emit("validator", `△ ${combined.length} detalle${combined.length === 1 ? "" : "s"} pendiente${combined.length === 1 ? "" : "s"}`, "warn");
      break;
    }

    onProgress?.({
      phase: "testing",
      progress: Math.min(baseProgress + 2, 92),
      note: `🔧 Testing Agent reparando ${combined.length} error(es) (intento ${iter}/${MAX_ITERATIONS})…`,
    });
    emit("testing", `🔧 Reparando ${combined.length} error(es): ${combined.slice(0, 2).map(i => i.file).join(", ")}${combined.length > 2 ? "…" : ""}`);
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
      emit("testing", "△ Reparación omitida por plan reducido.", "warn");
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
      patcherModel,
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
    emit("testing", "✓ Reparación aplicada — re-validando…");
    emit("patcher", "✓ patch aplicado");
    finalFrontend = patched;
    lastPatchedBundle = patched;
  }

  // E2B real-build verification (opt-in)
  if (shouldValidateInE2B() && phaseGates.patch) {
    onProgress?.({
      phase: "testing",
      progress: 93,
      note: "⚙️ Testing Agent: build real en sandbox E2B (npm install + build)…",
    });
    emit("testing", "⚙️ Ejecutando build real en microVM E2B…");
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
            patcherModel,
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
  return `You are Maris AI editing an existing web app. You are a careful, surgical engineer: you understand what the user is asking for, you change ONLY what's needed to deliver it, and you preserve everything else exactly.

Output STRICT JSON only matching:
{"title":"…","description":"…","techStack":[…],"frontendCode":"…","backendCode":"…"}

THINK BEFORE EDITING (do this internally, do not output the reasoning):
1. What EXACTLY does the user want? Read the request literally. Do not add unrequested features.
2. Is this ADD, MODIFY, DELETE, or FIX? Different operations, different scope.
3. Which files do I need to touch? Usually 1-3 files. If touching more than 5 files, reconsider.
4. What MUST stay exactly the same? Everything not mentioned in the request.
5. Am I about to rebuild/redesign/rename things the user didn't ask about? STOP. Only do what was asked.
6. After my edit, do all imports still resolve, do all routes still render?

CHANGE DISCIPLINE — preserve unless asked to change:
- For ADD/AÑADIR/AGREGAR requests: add only the requested target. Do not rename, redesign, remove, or duplicate unrelated elements.
- For MODIFY/MODIFICAR/CAMBIAR/EDITAR requests: modify the existing target in place. Do not create a second version and do not rebuild the app.
- For DELETE/ELIMINAR/BORRAR/QUITAR requests: remove only the requested target. Do not remove neighboring features.
- Keep file count and file names as-is unless the user explicitly asks to add/delete a file.
- Keep the title, description, techStack, color palette and typography unless the user explicitly asks to change them.
- NEVER replace a working page/component with a simpler version.
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

/**
 * Single edit pass — Gemini 2.5 Flash streaming (default) o GPT-5.
 */
/**
 * surgicalEditWithTools — Edición quirúrgica con tool calling real.
 * Para cambios pequeños (color, texto, un componente) usa read_file + patch_file
 * en vez de mandar todo el bundle. Ahorra tokens y es más precisa.
 * Solo se usa cuando el cambio parece pequeño (score < 3 en complejidad).
 */
async function surgicalEditWithTools(
  prompt: string,
  previous: PreviousApp,
  log: AgentLog,
): Promise<{ success: boolean; bundleUpdated?: string; filesChanged: string[] }> {
  try {
    const { runAgentWithTools } = await import("../lib/agentTools");
    const cleanPrompt = prompt.replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "").trim();

    // Lista de archivos disponibles para orientar al agente
    const fileList = previous.frontendCode
      .split(/\/\/ === FILE: /)
      .slice(1)
      .map(p => p.split("\n")[0].trim().replace(/ ===$/, ""))
      .filter(Boolean)
      .slice(0, 30)
      .join(", ");

    await log("coder", `🔧 Aplicando cambio quirúrgico: "${cleanPrompt.slice(0, 60)}…"`);

    const result = await runAgentWithTools({
      role: "editor",
      model: "claude-sonnet-4-6",
      maxIterations: 6,
      systemPrompt: `Eres el agente de edición quirúrgica de Maris AI.

Tu trabajo: aplicar EXACTAMENTE el cambio que pide el usuario usando herramientas, sin tocar nada más.

PROCESO OBLIGATORIO:
1. Lee el archivo relevante con read_file
2. Identifica el fragmento exacto a cambiar
3. Usa patch_file para el cambio (NUNCA write_file a menos que sea un archivo nuevo)
4. Si hay varios archivos afectados, repite para cada uno
5. Valida con validate_code si el cambio es código complejo

Archivos disponibles: ${fileList}

REGLAS:
- read_file ANTES de patch_file siempre
- patch_file usa texto EXACTO del archivo — cópialo textualmente del read_file
- Si el cambio afecta a más de 5 archivos → responde "COMPLEX" y no hagas nada
- Preserva TODO lo que no se pidió cambiar`,
      userMessage: `App: "${previous.title}"\n\nCambio solicitado: "${cleanPrompt}"`,
      ctx: {
        bundle: previous.frontendCode,
        appTitle: previous.title,
        log: async (agent, msg) => log(agent, msg),
      },
    });

    if (result.text.includes("COMPLEX") || !result.bundleUpdated) {
      return { success: false, filesChanged: [] };
    }

    await log("coder", `✅ Cambio aplicado en ${result.toolsUsed.filter(t => t === "patch_file" || t === "write_file").length} archivo(s) usando herramientas`);
    return {
      success: true,
      bundleUpdated: result.bundleUpdated,
      filesChanged: result.toolsUsed.filter(t => t === "patch_file" || t === "write_file"),
    };
  } catch (err) {
    logger.warn({ err }, "surgicalEditWithTools failed — falling back to singleEditPass");
    return { success: false, filesChanged: [] };
  }
}

async function singleEditPass(
  prompt: string,
  previous: PreviousApp,
  onChars: (chars: number) => void,
  coderModel: string | undefined,
  language: GenLanguage,
  log?: AgentLog,
): Promise<GeneratedAppPayload> {
  const emit: AgentLog = log ?? (() => {});
  
  // OPTIMIZACIÓN DE CONTEXTO: no enviar bundles completos salvo que sea imprescindible.
  // Anthropic factura por tokens de entrada y aquí estaba el mayor consumo.
  const MAX_CONTEXT_CHARS = 140000; // ~35k tokens de entrada como techo duro en edición completa
  let frontendCodeToPass = previous.frontendCode;
  let isContextOptimized = false;

  if (previous.frontendCode.length > MAX_CONTEXT_CHARS) {
    emit("system", "📦 Optimizando contexto: envío solo archivos relevantes al editor para ahorrar tokens...");
    frontendCodeToPass = compactBundleForPrompt(previous.frontendCode, [prompt], MAX_CONTEXT_CHARS);
    isContextOptimized = true;
    emit("system", `📉 Contexto reducido aprox. de ${estimatePromptTokens(previous.frontendCode)} a ${estimatePromptTokens(frontendCodeToPass)} tokens.`);
  }

  const userContent = `CURRENT APP:
- Title: ${previous.title}
- Description: ${previous.description}
- Tech stack: ${previous.techStack.join(", ")}

CURRENT FRONTEND CODE${isContextOptimized ? " (OPTIMIZED CONTEXT)" : ""}:
${frontendCodeToPass}

CURRENT BACKEND CODE:
${previous.backendCode.length > 50000 ? previous.backendCode.slice(0, 50000) + "\n// [TRUNCADO: backend demasiado grande; conserva el backend existente salvo que el usuario pida backend explícitamente.]" : previous.backendCode}

USER'S CHANGE REQUEST:
${prompt}

Return the FULL updated app as JSON. ${isContextOptimized ? "IMPORTANTE: Aunque te he enviado un contexto optimizado, debes devolver el código COMPLETO de los archivos que modifiques." : ""}`;

  const provider = resolveCoderProvider(coderModel);
  const systemPrompt = buildEditSystemPrompt(language);

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
          const file = m[1].replace(/\\\//g, "/").trim().slice(0, 120);
          if (file && !seenFiles.has(file)) {
            seenFiles.add(file);
            emit("coder", friendlyFileLabel(file, inBackend));
          }
        }
        scanFrom = buffer.length;
      } catch {
        /* observer is best-effort */
      }
    };
  }

  async function callModel(extraReminder: string): Promise<{ text: string; finishReason?: string }> {
    const finalUserContent = extraReminder ? `${userContent}\n\n${extraReminder}` : userContent;
    let accumulated = "";
    let finishReason: string | undefined;
    const observe = makeStreamObserver();
    const PROGRESS_EVERY = 500;

    try {

    if (provider === "gpt-5") {
      const stream = await getOpenAIApps().chat.completions.create({
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
    } else if (provider === "claude") {
      const stream = anthropic.messages.stream({
        model: resolveClaudeCoderModel(coderModel),
        max_tokens: 20000,
        system: systemPrompt,
        messages: [{ role: "user", content: finalUserContent }],
      });
      let lastReportC = 0;
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          accumulated += chunk.delta.text;
          observe(accumulated);
          if (accumulated.length - lastReportC >= PROGRESS_EVERY) { lastReportC = accumulated.length; onChars(accumulated.length); }
        }
        if (chunk.type === "message_delta" && chunk.delta.stop_reason === "max_tokens") finishReason = "MAX_TOKENS";
      }
    } else {
// Claude streaming según el modelo elegido en el selector.
      const stream = await anthropic.messages.stream({
        model: resolveClaudeCoderModel(coderModel),
        max_tokens: 20000,
        system: systemPrompt,
        messages: [{ role: "user", content: finalUserContent }],
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
        if (chunk.type === "message_delta" && chunk.delta.stop_reason === "max_tokens") finishReason = "MAX_TOKENS";
      }
    }
  } catch (err) {
      // Re-throw with accumulated text attached so caller can recover partial work
      (err as any).accumulated = accumulated;
      throw err;
    }
    return { text: accumulated, finishReason };
  }

  let accumulated = "";
  let finishReason: string | undefined;

  try {
    const res = await callModel("");
    accumulated = res.text;
    finishReason = res.finishReason;
  } catch (err) {
    // If we have partial content, wrap it in a successful return but mark it as an error
    // so the caller can decide whether to use the partial content.
    if ((err as any).accumulated && (err as any).accumulated.length > 500) {
      return {
        title: previous?.title || "App",
        description: previous?.description || "",
        techStack: previous?.techStack || [],
        frontendCode: (err as any).accumulated,
        backendCode: "",
        error: (err as any).message,
        accumulated: (err as any).accumulated
      } as any;
    }
    throw err;
  }

  if (finishReason === "MAX_TOKENS") {
    emit("coder", "△ respuesta alcanzando límite, continuando...", "info");
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
  log("patcher", "⚡ Parche quirúrgico — solo archivos afectados.");
  try {
    const resp = await createClaudeMessageWithFallback("patcher", "claude-sonnet-4-6", {
      max_tokens: 8000,
      system: buildFastPatchPrompt(),
      messages: [{ role: "user", content: `CHANGE: ${prompt.slice(0,1200)}\n\nBUNDLE (${Math.round(previous.frontendCode.length/1000)}KB):\n${previous.frontendCode.slice(0,55000)}\n\nReturn JSON with changedFiles and deletedFiles only.` }]
    });
    const raw = (resp.content[0] as any).text ?? "";
    const parsed = extractJsonObject<{changedFiles?:Record<string,string>; deletedFiles?: string[]}>(raw);
    log("patcher", `LLM raw (300): ${raw.slice(0,300)}`);
    const parsedChangedFiles = parsed?.changedFiles && typeof parsed.changedFiles === "object" ? parsed.changedFiles : {};
    const parsedDeletedFiles = Array.isArray(parsed?.deletedFiles) ? parsed!.deletedFiles.filter(Boolean) : [];
    if (Object.keys(parsedChangedFiles).length > 0 || parsedDeletedFiles.length > 0) {
      const merged = mergePatchIntoBundle(previous.frontendCode, parsedChangedFiles, parsedDeletedFiles);
      if (merged && merged.length > 100) {
        log("patcher", `✓ Parche aplicado — ${Object.keys(parsedChangedFiles).length} modificado(s), ${parsedDeletedFiles.length} eliminado(s): ${[...Object.keys(parsedChangedFiles), ...parsedDeletedFiles].join(", ")}`);
        onProgress?.({ phase: "validating", progress: 100, note: "Parche aplicado." });
        return { title: previous.title, description: previous.description, techStack: previous.techStack, frontendCode: merged, backendCode: previous.backendCode };
      }
    }
  } catch(err) { log("patcher", `Parche quirúrgico falló: ${err}`, "warn"); }
  log("patcher", "Parche quirúrgico no convergíó.", "warn");
  return null;
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
  requestContext?: RouteGenerationRequestContext,
  jobId?: string,
): Promise<GeneratedAppPayload> {
  const runPhase = async <T>(phase: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      try { onPhaseError?.(phase, err); } catch { /* monitoring must never crash the pipeline */ }
      // If the error has partial content (e.g. from a timeout), attach it to the error object
      // so that calling code can recover it even if it was wrapped in withTimeoutOrThrow.
      if ((err as any).accumulated) {
        (err as any).message = `${(err as any).message} (partial content attached)`;
      }
      throw err;
    }
  };

  const memoryBlock = formatMemoryBlock(agentMemory);
  if (memoryBlock) prompt = `${memoryBlock}\n${prompt}`;

  const attachmentBlock = buildAttachmentBlock(attachments);
  if (attachmentBlock) prompt = `${attachmentBlock}\n${prompt}`;

  const templateContextBlock = buildAgentTemplateContextBlock({
    prompt,
    kind: requestContext?.kind,
    detectedLocale: requestContext?.detectedLocale ?? extractPromptContext(prompt, "locale"),
    detectedCountry: requestContext?.detectedCountry ?? extractPromptContext(prompt, "country"),
    uiLanguage: requestContext?.uiLanguage ?? extractPromptContext(prompt, "uiLanguage"),
  });

  const log: AgentLog = async (agent, message, level = "info") => {
    try { await onAgentLog?.(agent, message, level); } catch { /* swallow */ }
  };

  onProgress?.({ phase: "generating", progress: Math.max((await GenerationJob.findById(jobId).select("progress").lean() as any)?.progress ?? 5, 5), note: "Planificando…" });

  // El Core Orchestrator por hitos queda detrás de una feature flag porque su salida
  // sólo empaqueta archivos parciales y puede dejar la preview sin un App React completo.
  // Para producción usamos por defecto el pipeline robusto de generación, validación y
  // parcheo que devuelve un bundle renderizable persistido en GeneratedApp.frontendCode.
  const wantsFullBuild = prompt.toLowerCase().includes("crea") || prompt.toLowerCase().includes("app") || !previous;
  const useMilestoneOrchestrator = process.env.MARIS_USE_MILESTONE_ORCHESTRATOR === "true";

  if (wantsFullBuild && useMilestoneOrchestrator) {
    await log("system", "🚀 Activando Core Orchestrator experimental (Estrategia de Hitos)...");
    const coreOrchestrator = new CoreOrchestrator(process.cwd());
    await log("system", "📋 Analizando arquitectura y planificando hitos...");
    await log("system", "📋 Mapa de ruta generado. Iniciando ejecución por hitos...");

    const milestoneResult = await coreOrchestrator.buildProjectIncremental(prompt, async (update: any) => {
      onProgress?.({
        phase: "generating",
        progress: update.progress,
        note: update.status
      });
      await log("coder", update.status);
    });

    const milestoneFrontend = String(milestoneResult.frontendCode || "").trim();
    if (milestoneFrontend.length >= 200 && /export\s+default\s+function\s+App|const\s+App\s*=|function\s+App\s*\(/.test(milestoneFrontend)) {
      const testedMilestone = await runPhase("testing", () =>
        runTestingAgent(milestoneFrontend, {
          jobId: jobId || "unknown",
          prompt,
          plan: { title: "Hitos", description: "Construcción por hitos" },
          language,
          log: log,
          onProgress,
        })
      );
      return {
        title: "Proyecto Generado por Hitos",
        description: "App construida mediante Task Splitting y Milestone Forking",
        techStack: ["React", "Node", "TypeScript"],
        frontendCode: testedMilestone,
        backendCode: milestoneResult.backendCode || "// Sin archivos backend generados para este hito."
      };
    }

    await log("system", "El orquestador experimental produjo un bundle incompleto; continúo con el pipeline robusto de generación.", "warn");
  }

  let execPlan = await runPhase("planner", () =>
    planExecution(prompt, { hasExistingApp: !!previous }),
  );
  logger.info({ plan: execPlan.scope }, "planner: plan listo");

  // ── SISTEMA DE NIVELES POR PAGO ──────────────────────────────────────────
  // FREE (sin haber pagado nunca): solo landing pages simples
  //   - Máx 4 páginas, 6 componentes, sin backend, modelo Haiku
  //   - El cliente puede seguir generando hasta agotar sus 50 créditos de bienvenida
  //   - Al realizar su PRIMERA compra Stripe confirma el pago → hasEverPaid=true
  //
  // PAID (primera compra confirmada por Stripe):
  //   - Sin límites de complejidad, Sonnet completo, proyectos grandes
  // ─────────────────────────────────────────────────────────────────────────
  const hasEverPaid = !!(requestContext?.hasEverPaid);
  const isFreeUser = !hasEverPaid && !previous; // ediciones siempre permitidas

  if (isFreeUser) {
    await log("system", "✨ Generando tu landing page gratuita. Para apps completas con backend, dashboard y sin límites → activa un plan.");
    // La primera generación de un usuario free se reduce a una landing de 1
    // página sin backend SOLO cuando el prompt describe eso — una landing de
    // presentación. Si describe un CRM/dashboard/panel/gestión de datos,
    // PLAN_LANDING_FAST (sin research/integration/backend/tests) entregaría
    // una app visualmente completa pero vacía (todo mockData, sin
    // persistencia), así que mantenemos PLAN_FULL en ese caso aunque
    // MAX_PAGES/backendNeeded sigan recortando el alcance más abajo.
    if (execPlan.scope === "full-build" && isSimpleLandingRequest(prompt)) {
      execPlan = { ...PLAN_LANDING_FAST };
      logger.info("planner: usuario free + landing simple — pipeline reducido a PLAN_LANDING_FAST");
    } else if (execPlan.scope === "full-build") {
      logger.info("planner: usuario free pero prompt requiere backend/datos — mantengo PLAN_FULL");
    }
  }

  const agentModelPlan = selectAgentModelPlan(prompt, coderModel, {
    kind: requestContext?.kind,
    hasExistingApp: !!previous,
    isPaidUser: hasEverPaid,
  });
  logger.info({ tier: agentModelPlan.tier, score: agentModelPlan.score, frontend: agentModelPlan.agents.frontend.model }, "planner: modelo seleccionado");

  // Edit mode
  if (previous) {
    if (execPlan.scope === "fast-patch") {
      const fastResult = await fastPatchEdit(prompt, previous, language, log, onProgress);
      if (fastResult) return fastResult;
      logger.warn("planner: parche directo no convergió");
      execPlan = { ...execPlan, scope: "feature", phases: PLAN_FEATURE.phases };
      logger.info("planner: promovido a feature scope");
    }

    onProgress?.({ phase: "generating", progress: 20, note: "Aplicando cambios al código…" });
    await log("system", `Revisando el código de tu app (${Math.round(previous.frontendCode.length / 1000)} KB) antes de aplicar los cambios…`);
    await log("coder", "Empezando a escribir el código de tu app…");
    const TARGET = 50_000;
    let lastHeartbeatAt = Date.now();
    const onChars = (chars: number) => {
      const ratio = Math.min(1, chars / TARGET);
      onProgress?.({ phase: "generating", progress: 20 + Math.round(ratio * 50), note: `Aplicando cambios… (${Math.round(chars / 1000)} KB)` });
      const now = Date.now();
      if (now - lastHeartbeatAt > 2500) {
        lastHeartbeatAt = now;
        void log("coder", `Construyendo… ${Math.round(chars / 1000)} KB y subiendo.`);
      }
    };

    if (execPlan.scope === "feature") {
      logger.info({ phases: execPlan.phases }, "planner: despachando fases");
      if (execPlan.phases.includes("architect")) await log("architect", "Re-arquitectando para acomodar la nueva funcionalidad…");
      if (execPlan.phases.includes("frontend")) await log("coder", "Frontend: aplicando la nueva funcionalidad…");
    } else {
      await log("coder", "Aplicando los cambios solicitados…");
    }
    // Para cambios simples → intentar edición quirúrgica con tool calling primero
    const cleanedPrompt = prompt.replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "").trim();
    const complexity = classifyPromptComplexity(cleanedPrompt, { hasExistingApp: true });
    let result: GeneratedAppPayload;

    if (complexity.score <= 2 && previous.frontendCode.length > 1000) {
      // Cambio simple → edición quirúrgica con tools (más precisa, menos tokens)
      const surgical = await surgicalEditWithTools(prompt, previous, log);
      if (surgical.success && surgical.bundleUpdated) {
        // Construir resultado compatible con GeneratedAppPayload
        result = {
          title: previous.title,
          description: previous.description,
          techStack: previous.techStack,
          frontendCode: surgical.bundleUpdated,
          backendCode: previous.backendCode,
          plannedPages: (previous as any).plannedPages || [],
          requiredEnvVars: (previous as any).requiredEnvVars || [],
        };
      } else {
        // Fallback al método completo si la edición quirúrgica falla
        result = await singleEditPass(prompt, previous, onChars, coderModel, language, log);
      }
    } else {
      // Cambio complejo → pipeline completo
      result = await singleEditPass(prompt, previous, onChars, coderModel, language, log);
    }
    log("coder", "Código listo, comprobando que todo encaje…");

    const fixedFrontend = await runValidatePatchLoop(
      result.frontendCode,
      { ok: true, issues: [] },
      onProgress,
      70,
      language,
      log,
      { validate: execPlan.phases.includes("validate"), patch: execPlan.phases.includes("patch") },
      agentModelPlan,
    );

    onProgress?.({ phase: "parsing", progress: 90, note: "Procesando archivos…" });
    log("system", "Empaquetando todo…");
    return { ...result, frontendCode: fixedFrontend };
  }

  // Phase gates
  const runResearch = execPlan.phases.includes("research");
  const runDesign = execPlan.phases.includes("design");
  const runIntegration = execPlan.phases.includes("integration");
  const runQa = execPlan.phases.includes("qa");
  const runTests = execPlan.phases.includes("tests");

  /* === Phase 1: research + architect === */
  let research = "";
  if (runResearch && shouldResearch(prompt)) {
    onProgress?.({ phase: "researching", progress: 6, note: "Analizando tu proyecto…" });
    logger.info("researcher: buscando contexto");
    research = await runPhase("researcher", () => researchTopic(prompt, agentModelPlan));
    if (research) {
      logger.info({ kb: Math.round(research.length / 100) / 10 }, "researcher: brief listo");
    }
  } else if (!runResearch) {
    logger.info("researcher: saltando investigación (alcance reducido)");
  } else {
    onProgress?.({ phase: "researching", progress: 6, note: "Analizando tu proyecto…" });
    logger.info("researcher: buscando contexto del mercado");
    research = await runPhase("researcher", () => researchTopic(prompt, agentModelPlan));
    if (research) {
      logger.info({ kb: Math.round(research.length / 100) / 10 }, "researcher: brief listo");
    }
  }

  onProgress?.({ phase: "architecting", progress: 14, note: "🧠 Diseñando la arquitectura de tu app…" });
  await log("architect", "Analizando tu idea y diseñando la estructura de la app…");

  // Heartbeat del arquitecto — actualiza updatedAt cada 25s Y escribe log cada 90s
  // Necesario porque el architect puede tardar 10-15 min en apps complejas
  let architectHeartbeatCount = 0;
  const architectHeartbeat = setInterval(async () => {
    try {
      architectHeartbeatCount++;
      if (jobId) await GenerationJob.findByIdAndUpdate(jobId, { $set: { updatedAt: new Date() } });
      // Escribir log visible cada 90s (3 ticks × 30s) para mantener vivo el zombie detector
      if (architectHeartbeatCount % 3 === 0) {
        await log("architect", "Planificando páginas y componentes…");
      }
    } catch { /* swallow */ }
  }, 30_000);

  let plan: ProjectPlan;
  try {
    plan = await runPhase("architect", () =>
      withTimeoutOrThrow(architectPlan(prompt, research, templateContextBlock, agentModelPlan), 90_000, "architect"),
    );
  } finally {
    clearInterval(architectHeartbeat);
  }

  if (typeof plan.backendNeeded !== "boolean") plan.backendNeeded = false;

  // Guardia de tamaño — si el arquitecto generó un plan demasiado grande, lo recortamos
  // antes de que llegue al frontend engineer para evitar timeouts
  // FREE: solo landing page — 1 página, sin backend, sin complejidad
  // PAID: app completa sin límites
  const MAX_PAGES = isFreeUser ? 1 : 8;
  const MAX_COMPONENTS = isFreeUser ? 4 : 12;
  const MAX_FILES = isFreeUser ? 8 : 45;

  if (isFreeUser) {
    // Usuario free: forzar landing page sin backend
    plan.backendNeeded = false;
    plan.backendFiles = [];
    if (plan.pages.length > MAX_PAGES || plan.frontendFiles.length > MAX_FILES) {
      await log("system", `⚡ Generando versión demo (${MAX_PAGES} páginas). Activa un plan para proyectos completos.`);
    }
  }

  if (plan.pages.length > MAX_PAGES || plan.frontendFiles.length > MAX_FILES) {
    if (!isFreeUser) {
      await log("architect", `⚠️ Plan demasiado grande (${plan.pages.length} páginas, ${plan.frontendFiles.length} archivos) — reduciendo a MVP para evitar timeout.`, "warn");
    }
    plan.pages = plan.pages.slice(0, MAX_PAGES);
    plan.components = plan.components.slice(0, MAX_COMPONENTS);
    plan.hooks = (plan.hooks ?? []).slice(0, isFreeUser ? 3 : 6);
    plan.utils = (plan.utils ?? []).slice(0, isFreeUser ? 2 : 4);
    const keptPages = new Set(plan.pages.map((p: any) => p.name));
    const keptComponents = new Set(plan.components.map((c: any) => c.name));
    plan.frontendFiles = plan.frontendFiles.filter((f: string) => {
      if (f.includes("/pages/")) return [...keptPages].some(n => f.includes(n));
      if (f.includes("/components/")) return [...keptComponents].some(n => f.includes(n));
      return true;
    }).slice(0, MAX_FILES);
    if (!isFreeUser) {
      await log("architect", `✅ Plan reducido: ${plan.pages.length} páginas, ${plan.frontendFiles.length} archivos — listo para generar.`);
    }
  }

  await log("architect", `Plan "${plan.title}" — ${plan.pages.length} página(s), ${plan.components.length} componente(s), ${plan.hooks.length} hook(s), backend: ${plan.backendNeeded ? "sí" : "no"}.`);
  if (plan.pages.length > 0) {
    await log("architect", `Páginas: ${plan.pages.slice(0, 6).map((p) => p.name).join(", ")}${plan.pages.length > 6 ? "…" : ""}`);
  }

  onProgress?.({ phase: "integrating", progress: 20, note: `Plan listo: ${plan.pages.length} página(s), ${plan.components.length} componente(s). 🔌 Integraciones + 🎨 diseño en paralelo…` });
  if (runIntegration) logger.info("integration: analizando");
  if (runDesign) logger.info("designer: eligiendo paleta");

  // Heartbeat entre fases — evita que el watchdog mate el job durante design+integration
  if (jobId) GenerationJob.findByIdAndUpdate(jobId, { $set: { updatedAt: new Date() } }).catch(() => {});
  const betweenPhasesHeartbeat = setInterval(() => {
    if (jobId) GenerationJob.findByIdAndUpdate(jobId, { $set: { updatedAt: new Date() } }).catch(() => {});
  }, 25_000);

  /* === Phase 2 (parallel): integrations + design === */
  const integrationPromise = runIntegration
    ? runPhase("integrations", () => specifyIntegrations(plan, prompt, agentModelPlan))
    : Promise.resolve({ services: [] });

  const FALLBACK_DESIGN: DesignSystem = {
    theme: "dark",
    vibe: "moderno y limpio",
    palette: { primary: "#7c3aed", secondary: "#0ea5e9", background: "#0a0a0a", surface: "#111111", text: "#fafafa" },
    typography: { sans: "Inter, system-ui, sans-serif", display: "Inter, system-ui, sans-serif" },
    radius: "0.75rem",
    tailwindExtend: "",
    globalCSS: "",
  };
  const designPromise: Promise<DesignSystem> = runDesign
    ? runPhase("design", () => designSystem(plan, research, templateContextBlock, agentModelPlan))
    : Promise.resolve(FALLBACK_DESIGN);

  // Timeout duro de 3 minutos en design+integration — si se cuelgan, usar fallbacks
  let integrationSpec: IntegrationSpec;
  let design: DesignSystem;
  try {
    const results = await Promise.race([
      Promise.all([integrationPromise, designPromise]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("design+integration timeout")), 3 * 60_000)
      ),
    ]) as [IntegrationSpec, DesignSystem];
    [integrationSpec, design] = results;
  } catch (err) {
    logger.warn({ err }, "design+integration timed out or failed — using fallbacks");
    integrationSpec = { services: [] };
    design = FALLBACK_DESIGN;
  }
  clearInterval(betweenPhasesHeartbeat);
  onProgress?.({ phase: "generating", progress: 32, note: "⚡ Construyendo tu app…" });
  logger.info({ files: plan.frontendFiles.length }, "coder: generando frontend");
  if (plan.backendNeeded) logger.info("coder: generando backend en paralelo");

  /* === Phase 3 (parallel): frontend + backend === */
  const TARGET_CHARS = 60_000;
  let lastLogChars = 0;
  // Shared accumulator so the timeout catch can recover partial code
  let frontendAccumulated = "";
  if (!execPlan.phases.includes("frontend")) {
    throw new Error(`El planificador devolvió un alcance sin fase 'frontend' (${execPlan.scope}). No es posible generar una app sin código de frontend.`);
  }

  // --- FASE 1: FRONTEND (MODO TURBO) ---
  // Para apps complejas como Seguxat, usamos una estrategia de generación paralela de archivos
  // para reducir el tiempo de espera de 10 min a menos de 4 min.
  const frontendResult = await runPhase("frontend", async () => {
    const coderHeartbeat = setInterval(() => {
      if (jobId) GenerationJob.findByIdAndUpdate(jobId, { $set: { updatedAt: new Date() } }).catch(() => {});
    }, 30_000);
    try {
      const turboModel = "claude-sonnet-4-6";
      const kind = requestContext?.kind || "fullstack";
      const complexity = classifyPromptComplexity(prompt, { kind });

      // ── SPECULATIVE GENERATION — para apps básicas/standard lanzamos 2 variantes en paralelo
      // La más rápida y válida gana. Reduce tiempo de generación ~40%.
      if (complexity.score <= 1 && !previous) { // Solo landing pages — score ≤ 1 para ahorrar tokens
        try {
          const { speculativeRace, buildStrategyModifier } = await import("../lib/speculativeGeneration");
          void log("system", "⚡ Generación especulativa activa — 2 variantes en paralelo para mayor velocidad…");

          const specResult = await speculativeRace(
            async (strategy) => {
              const strategyMod = buildStrategyModifier(strategy);
              const modifiedPrompt = prompt + strategyMod;
              const r = await generateFrontendCode(
                plan, design, research, modifiedPrompt,
                (chars) => {
                  const ratio = Math.min(1, chars / TARGET_CHARS);
                  onProgress?.({ phase: "generating", progress: 32 + Math.round(ratio * 30) });
                },
                turboModel, language, templateContextBlock, agentModelPlan,
              );
              return r.code;
            },
            async (code) => code.length > 5000 && code.includes("// === FILE:"),
            (variant) => {
              void log("coder", `⚡ Variante ${variant.strategy} completada en ${Math.round(variant.durationMs / 1000)}s`);
            },
          );

          clearInterval(coderHeartbeat);
          void log("system", `✅ Generación especulativa completada — variante "${specResult.winner.strategy}" ganó en ${Math.round(specResult.totalDurationMs / 1000)}s`);
          return { code: specResult.winner.frontendCode, truncated: false };
        } catch (specErr) {
          logger.warn({ specErr }, "Speculative generation failed — falling back to standard");
        }
      }

      // ── GENERACIÓN ESTÁNDAR (fallback o apps complejas) ──────────────────
      const result = await generateFrontendCode(plan, design, research, prompt, (chars) => {
        const ratio = Math.min(1, chars / TARGET_CHARS);
        onProgress?.({ phase: "generating", progress: 32 + Math.round(ratio * 30), note: `⚡ Construyendo tu app… ${Math.round(chars / 1000)} KB` });
        if (chars - lastLogChars >= 10000) {
          lastLogChars = chars;
          logger.info({ kb: Math.round(chars / 1000) }, "coder: frontend progress");
        }
      }, turboModel, language, templateContextBlock, agentModelPlan,
      (partial) => { frontendAccumulated = partial; }, isFreeUser);
      clearInterval(coderHeartbeat);
      return result;
    } catch (err) {
      clearInterval(coderHeartbeat);
      if (String((err as any).message || "").includes("timeout") && frontendAccumulated.length > 2000) {
        void log("coder", `Frontend-engineer timeout — usando código parcial acumulado.`, "warn");
        return { code: "", truncated: true, error: (err as any).message, accumulated: frontendAccumulated } as CodeGenResult;
      }
      throw err;
    }
  });

  // --- FASE 2: BACKEND (INTERACTIVO / A PETICIÓN) ---
  // Siguiendo la sugerencia del usuario, Maris AI ahora se detendrá tras el Frontend.
  // Solo generará el Backend si el usuario lo solicita explícitamente o si es una app muy simple que ya lo incluía en el plan inicial.
  // --- FASE 2: BACKEND (INTERACTIVO / A PETICIÓN) ---
  const runBackend = execPlan.phases.includes("backend") && plan.backendNeeded && (prompt.toLowerCase().includes("backend") || prompt.toLowerCase().includes("servidor") || prompt.toLowerCase().includes("base de datos"));
  
  let backendResult = null;
  if (runBackend) {
    backendResult = await runPhase("backend", async () => {
      await log("coder", "Construyendo el backend — API, rutas y base de datos…");
      return generateBackendCode(plan, prompt, templateContextBlock, agentModelPlan);
    });
  } else if (execPlan.phases.includes("backend") && plan.backendNeeded) {
    // Solo mostrar este mensaje si el frontend realmente terminó con código válido
    if (frontendResult.code && !frontendResult.truncated) {
      await log("coder", "Frontend terminado. El backend se ha pausado para tu revisión. Si te gusta el diseño, dime 'Continúa con el backend' y me pondré con ello.");
    }
  }

  // Si el frontend falló por timeout, tratarlo como truncado para reintentar con plan reducido
  // frontendResult.error comes from generateFrontendCode recovery, while frontendResult.code absence + catch in Promise.all handles the direct throw.
  const frontendTimedOut = (!frontendResult.code || frontendResult.error) && !frontendResult.truncated && String(frontendResult.error || "").includes("timeout");
  if (frontendTimedOut) {
    await log("coder", "Frontend-engineer timeout — reintentando con plan reducido y modelo más rápido…", "warn");
    frontendResult.truncated = true;
  }

  if (!frontendResult.code && frontendResult.truncated) {
    // Si hay código acumulado en el streaming, intentar extraerlo antes de reintentar
    const accumulated = frontendAccumulated || (frontendResult as any).accumulated || "";
    if (accumulated.length > 10000) {
      await log("coder", `Frontend truncado — intentando extraer archivos del streaming acumulado (${Math.round(accumulated.length / 1000)} KB)…`, "warn");
      // Intentar extraer archivos completos del JSON parcial
      const fcMatch = accumulated.match(/"frontendCode"\s*:\s*"([\s\S]*)/);
      if (fcMatch) {
        let partialCode = fcMatch[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        const filePattern = /\/\/ === FILE: [^\n]+\n[\s\S]*?(?=\/\/ === FILE: |$)/g;
        const completeFiles = partialCode.match(filePattern);
        if (completeFiles && completeFiles.length >= 3) {
          await log("coder", `✅ Extraídos ${completeFiles.length} archivos del streaming. Usando código parcial como base.`);
          frontendResult.code = completeFiles.join("\n");
        }
      }
    }

    // Si no se pudo extraer del streaming, reintentar con plan reducido
    if (!frontendResult.code) {
      await log("coder", "Frontend truncado por tokens, reintentando con plan reducido…", "warn");
      const reducedPlan = {
        ...plan,
        frontendFiles: plan.frontendFiles.slice(0, Math.ceil(plan.frontendFiles.length / 2)),
        pages: plan.pages.slice(0, 3),
        components: plan.components.slice(0, 8),
      };
      try {
        const retryResult = await generateFrontendCode(
          reducedPlan, design, research, prompt,
          (chars) => {
            onProgress?.({ phase: "generating", progress: 60 + Math.round(Math.min(chars / 60_000, 1) * 15), note: `⚡ Reintento con plan reducido: ${Math.round(chars / 1000)} KB…` });
          }, "claude-sonnet-4-6", language, templateContextBlock, selectAgentModelPlan(prompt, "claude-sonnet-4-6"), undefined, isFreeUser,
        );
        if (retryResult.code && retryResult.code.length > 500) {
          await log("coder", `✅ Frontend listo con plan reducido: ${Math.round(retryResult.code.length / 1000)} KB.`);
          frontendResult.code = retryResult.code;
        } else {
          // Reintento vacío — landing page como base
          await log("coder", "Reintento con plan reducido también falló — generando landing page funcional como base…", "warn");
          onProgress?.({ phase: "fixing", progress: 65, note: "🏗️ Generando landing page funcional como punto de partida…" });
          const landingResult = await generateLandingPage(prompt, language, design, research);
          if (landingResult.code && landingResult.code.length > 500) {
            await log("coder", `✅ Landing page lista (${Math.round(landingResult.code.length / 1000)} KB). Puedes pedirme que añada más funcionalidades paso a paso.`);
            frontendResult.code = landingResult.code;
          }
          // frontendResult.code puede ser "" aquí — el Repair Agent lo manejará abajo
        }
      } catch (retryErr) {
        // Si el reintento lanza excepción, usar código acumulado del primer intento
        const accumulated = (frontendResult as any).accumulated || frontendAccumulated;
        if (accumulated && accumulated.length > 2000) {
          await log("coder", "Reintento fallido — recuperando código parcial del primer intento como último recurso…", "warn");
          frontendResult.code = accumulated;
        } else {
          await log("coder", "Reintento fallido sin código acumulado — intentando landing page de emergencia…", "warn");
          try {
            const emergencyLanding = await generateLandingPage(prompt, language, design, research);
            if (emergencyLanding.code && emergencyLanding.code.length > 500) {
              frontendResult.code = emergencyLanding.code;
            }
          } catch { /* swallow — Repair Agent lo intentará */ }
        }
      }
    }
  } else if (!frontendResult.code || frontendResult.error) {
    // Si llegamos aquí y no hay código limpio pero el streaming avanzó, intentamos recuperar lo que haya
    if (String(frontendResult.error || "").includes("timeout") && (frontendResult as any).accumulated?.length > 1000) {
      await log("coder", "Timeout detectado pero hay código parcial acumulado. Intentando recuperar...", "warn");
      frontendResult.code = (frontendResult as any).accumulated;
    } else if (!frontendResult.code) {
      // Sin nada acumulado — landing page directa
      await log("coder", "Generando landing page funcional como base para continuar…", "warn");
      onProgress?.({ phase: "fixing", progress: 60, note: "🏗️ Preparando landing page funcional…" });
      const landingResult = await generateLandingPage(prompt, language, design, research);
      if (landingResult.code && landingResult.code.length > 500) {
        await log("coder", `✅ Landing page lista (${Math.round(landingResult.code.length / 1000)} KB). Puedes pedirme que añada más funcionalidades paso a paso.`);
        frontendResult.code = landingResult.code;
      }
    }
  }

  if (!frontendResult.code || frontendResult.code.length < 500) {
    // Si hay código pero muy corto, logarlo antes de activar repair
    if (frontendResult.code && frontendResult.code.length > 0) {
      await log("coder", `Frontend demasiado corto (${frontendResult.code.length} chars) — activando Repair Agent…`, "warn");
    } else {
      await log("coder", `Frontend falló (${frontendResult.error || "sin código"}), activando Repair Agent…`, "warn");
    }
    onProgress?.({ phase: "fixing", progress: 65, note: "🔧 Repair Agent: intentando recuperar código malformado…" });
    try {
      const repairResponse = await createClaudeMessageWithFallback("repair", agentModelPlan.agents.repair.model, {
        max_tokens: 10000,
        system: `You are a JSON Repair Agent. The Frontend Engineer returned malformed JSON.
Your job: extract or reconstruct the frontendCode and return ONLY valid JSON: {"frontendCode":"..."}
The frontendCode must use '// === FILE: <path> ===' separators between files.
Output STRICT JSON only, no markdown, no explanation.`,
        messages: [{
          role: "user",
          content: `Original user request: ${prompt}\n\nThe Frontend Engineer returned this malformed output (first 12000 chars):\n${((frontendResult as any)._raw || frontendAccumulated || "unavailable").slice(0, 12000)}\n\nReconstruct a complete React+TypeScript+Tailwind frontend for the request above.\nReturn ONLY: {"frontendCode":"..."}`
        }]
      });
      const repairRaw = repairResponse.content[0].type === "text" ? repairResponse.content[0].text : "";
      const repairParsed = extractJsonObject<{ frontendCode?: string }>(repairRaw);
      if (repairParsed && typeof repairParsed.frontendCode === "string" && repairParsed.frontendCode.length > 500) {
        await log("coder", `Repair Agent recuperó el frontend (${Math.round(repairParsed.frontendCode.length / 1000)} KB). Continuando…`);
        frontendResult.code = repairParsed.frontendCode;
      } else {
        throw new Error("Repair Agent no pudo recuperar el frontend.");
      }
    } catch (repairErr) {
      await log("coder", `Repair Agent falló: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}. Generando landing page funcional…`, "warn");
      onProgress?.({ phase: "fixing", progress: 72, note: "🏗️ Entregando landing page funcional como base…" });
      // Nivel 3: Landing page — siempre funciona, sin backend ni DB
      const landingResult = await generateLandingPage(prompt, language, design, research);
      if (landingResult.code && landingResult.code.length > 500) {
        await log("coder", `✅ Landing page entregada (${Math.round(landingResult.code.length / 1000)} KB). El cliente puede verla ahora y pedir más funcionalidades paso a paso.`);
        frontendResult.code = landingResult.code;
      } else {
        // Nivel 4: Haiku con plan mínimo absoluto — última red de seguridad
        await log("coder", "Generando versión mínima de emergencia con modelo rápido…", "warn");
        onProgress?.({ phase: "fixing", progress: 76, note: "⚡ Versión mínima de emergencia…" });
        try {
          const lastResortResult = await generateFrontendCode(
            { ...plan, frontendFiles: plan.frontendFiles.slice(0, 3), pages: plan.pages.slice(0, 1), components: plan.components.slice(0, 4) },
            design, research, prompt,
            (chars) => { onProgress?.({ phase: "fixing", progress: 78, note: `⚡ Versión mínima: ${Math.round(chars / 1000)} KB…` }); },
            "claude-haiku-4-5-20251001", language, templateContextBlock,
          );
          if (lastResortResult.code && lastResortResult.code.length > 500) {
            await log("coder", `✅ Versión mínima lista (${Math.round(lastResortResult.code.length / 1000)} KB). Puedes ir añadiendo funcionalidades.`);
            frontendResult.code = lastResortResult.code;
          } else {
            throw new Error("last-resort-empty");
          }
        } catch {
          await log("coder", "No fue posible generar la app. Por favor intenta con un prompt más concreto.", "error");
          throw new Error("Tu descripción es muy extensa para procesarla de una vez. Prueba describiendo solo la pantalla principal y luego vamos añadiendo funcionalidades.");
        }
      }
    }
  }
  if (frontendResult.code && frontendResult.code.length >= 500) {
    await log("coder", `✅ Frontend listo: ${Math.round(frontendResult.code.length / 1000)} KB.`);
  }
  if (plan.backendNeeded && backendResult?.code) {
    await log("coder", `Backend listo: ${Math.round(backendResult.code.length / 1000)} KB.`);
  }

  /* === Phase 4 (parallel): QA + Tests === */
  onProgress?.({ phase: "reviewing", progress: 78, note: "✅ Revisor de calidad y 🧪 Test Engineer trabajando en paralelo…" });
  if (runQa) await log("qa", "Revisando bundle en busca de bugs…");
  if (runTests) await log("qa", "Generando tests en paralelo…");

  const reviewPromise = runQa
    ? runPhase("qa", () => reviewBundle(frontendResult.code, plan, agentModelPlan))
    : Promise.resolve({ ok: true, issues: [] } as QAReport);
  const testsPromise = runTests
    ? runPhase("tests", () => generateTests(plan, frontendResult.code, agentModelPlan))
    : Promise.resolve(null);

  const [report, testCode] = await Promise.all([reviewPromise, testsPromise]);
  if (!runQa) await log("qa", "Plan dice saltar QA (alcance reducido).");
  if (!runTests) await log("qa", "Plan dice saltar generación de tests.");

  const issueCount = report.issues?.length ?? 0;
  await log("qa", issueCount > 0 ? `${issueCount} issue(s) detectada(s) — pasando al patcher.` : "Sin issues detectadas en revisión inicial.", issueCount > 0 ? "warn" : "info");

  /* === Phase 5: Testing Agent (Systematic Validation & Repair) === */
  const testedFrontend = await runPhase("testing", async () => {
    const result = await runTestingAgent(frontendResult.code, {
      jobId: jobId || "unknown",
      prompt,
      plan,
      language,
      log: log,
      onProgress,
    });
    
    // Validación de Salud Post-Despliegue (Nivel 3 del plan)
    logger.info(`[QA] Verificando salud de navegación para Job ${jobId}`);
    const navIssues = await validateBundle(result);
    if (navIssues.issues.length > 0) {
      logger.warn(`[QA] Se detectaron ${navIssues.issues.length} problemas de navegación tras el Testing Agent.`);
    }
    return result;
  });

  /* === Phase 6: validate → patch loop (Final Polish) === */
  await log("validator", "Compilando bundle con esbuild para verificar sintaxis y dependencias…");
  const finalFrontend = await runPhase("validate-patch-loop", () =>
    runValidatePatchLoop(
      testedFrontend,
      report,
      onProgress,
      80,
      language,
      log,
      { validate: execPlan.phases.includes("validate"), patch: execPlan.phases.includes("patch") },
      agentModelPlan,
    ),
  );

  /* === Phase 7: PM Agent Quality Gate (Emergent.sh Style) === */
  onProgress?.({ phase: "qa", progress: 95, note: "📋 PM Agent: verificando que la app cumple todos los requisitos del usuario…" });
  await log("qa", "📋 PM Agent activado — Quality Gate final al estilo emergent.sh…");
  const emergentBlueprint: EmergentArchitectBlueprint = {
    title: plan.title,
    description: plan.description,
    pages: plan.pages.map(p => ({ name: p.name, route: p.route, purpose: p.purpose, components: [] })),
    dataModels: plan.dataModels.map(m => ({ name: m.name, fields: [] })),
    apiEndpoints: [],
    backendNeeded: plan.backendNeeded,
    techStack: plan.techStack,
    frontendFiles: plan.frontendFiles,
    backendFiles: plan.backendFiles ?? [],
    integrations: integrationSpec.services.map(s => s.name),
    complexity: agentModelPlan.tier === "ultra" ? "enterprise" : agentModelPlan.tier === "robust" ? "advanced" : agentModelPlan.tier === "standard" ? "standard" : "basic",
  };
  try {
    const pmValidation = await runPMAgent(prompt, emergentBlueprint, finalFrontend, (msg) => void log("qa", msg));
    if (pmValidation.score >= 80) {
      await log("qa", `✅ PM Agent: app aprobada (${pmValidation.score}/100). ${pmValidation.summary}`);
    } else if (pmValidation.score >= 60) {
      await log("qa", `⚠️ PM Agent: score ${pmValidation.score}/100 — ${pmValidation.summary}`, "warn");
    } else {
      await log("qa", `🔧 PM Agent: score ${pmValidation.score}/100 — se recomienda revisar la app antes del deploy.`, "warn");
    }
    const blockers = pmValidation.issues.filter(i => i.severity === "blocker");
    if (blockers.length > 0) {
      await log("qa", `⚠️ PM Agent detectó ${blockers.length} blocker(s): ${blockers.map(b => b.requirement).join(", ")}`, "warn");
    }
  } catch (pmErr) {
    await log("qa", "PM Agent: validación omitida por error interno.", "warn");
  }

  /* === Phase 7b: Integration Agent Enhanced (Emergent.sh Style) === */
  const detectedIntegrations = detectIntegrations(prompt, plan.description);
  if (detectedIntegrations.length > 0) {
    logger.info({ integrations: detectedIntegrations.map((i: any) => i.name) }, "integration: detectadas");
  }

  const testNote = testCode ? "✅ Tests generados. " : "";
  if (testCode) await log("qa", `Tests generados (${Math.round(testCode.length / 1000)} KB).`);
  onProgress?.({ phase: "parsing", progress: 96, note: `${testNote}📦 Empaquetando archivos…` });
  await log("system", "Empaquetando archivos finales…");

  /* === Final assembly === */
  const setupNotes = buildSetupNotes(integrationSpec);
  const testsAppendix = testCode ? `\n\n${testCode}` : "";

  return {
    title: plan.title.slice(0, 200),
    description: plan.description.slice(0, 1000),
    techStack: plan.techStack,
    frontendCode: (finalFrontend.includes('// === FILE: vercel.json ===') 
      ? finalFrontend 
      : finalFrontend + `\n\n// === FILE: vercel.json ===\n{\n  "headers": [\n    {\n      "source": "/(.*)",\n      "headers": [\n        {\n          "key": "Content-Security-Policy",\n          "value": "frame-ancestors * 'self' https://marisai.es https://www.marisai.es https://*.marisai.es https://maris-ai-api-server-production-fbad.up.railway.app https://*.railway.app https://*.vercel.app https://*.vercel.live"\n        },\n        {\n          "key": "X-Frame-Options",\n          "value": "ALLOWALL"\n        }\n      ]\n    }\n  ]\n}`) + testsAppendix + setupNotes,
    backendCode: backendResult?.code || "No backend required for this app.",
    plannedPages: plan.pages.map((p) => ({ name: p.name, route: p.route, purpose: p.purpose })),
  };
}

/* === REST API — /api/apps === */
import { Router } from "express";
import {
  GeneratedApp,
  AppMessage,
  JobLog,
  GenerationJob,
  AppImage,
  AppRuntimeError,
  AppRevision,
  User,
  UserNotification,
  CreditTransaction,
} from "@workspace/db/schema";
import { ChatAttachment } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { generateRateLimiter } from "../middlewares/rateLimit";
import { enqueueGenerateJob } from "../lib/jobQueue";
import { classifyChatIntent, type ClassifiedIntent } from "../lib/intentClassifier";
import { buildProjectMap, resolveTargetFromPrompt, type ProjectMap } from "../lib/projectMap";
import mongoose from "mongoose";

const router = Router();

const KIND_COSTS: Record<string, number> = {
  fullstack:    3, // Proyecto complejo full-stack
  landing:      1, // App simple / Landing
  vue:          2, // App mediana
  svelte:       2, // App mediana
  mobile:       2, // App mediana
  nextjs:       3, // Proyecto complejo
  "python-api": 3, // Proyecto complejo
  django:       3, // Proyecto complejo
  "hybrid-pwa": 3, // Proyecto complejo
  "game-2d":    3, // Proyecto complejo
  "game-3d":    5, // Proyecto muy complejo
};



const COUNTRY_TO_UI_LANGUAGE: Record<string, string> = {
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es", EC: "es", UY: "es", PY: "es", BO: "es", CR: "es", PA: "es", DO: "es", GT: "es", HN: "es", NI: "es", SV: "es", PR: "es",
  US: "en", GB: "en", IE: "en", CA: "en", AU: "en", NZ: "en",
  FR: "fr", BE: "fr", CH: "de", DE: "de", AT: "de", IT: "it", PT: "pt", BR: "pt", NL: "nl", PL: "pl"
};

function firstHeaderValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" ? value : undefined;
}

function extractPromptContext(prompt: string | undefined, key: string): string | undefined {
  if (!prompt) return undefined;
  const match = prompt.match(new RegExp(`${key}=([^;\n]+)`));
  const value = match?.[1]?.trim();
  return value && value !== "unknown" ? value : undefined;
}

function detectRequestLocale(req: any): { country?: string; uiLanguage: string; locale: string; source: string } {
  const country = (
    firstHeaderValue(req.headers?.["cf-ipcountry"]) ||
    firstHeaderValue(req.headers?.["x-vercel-ip-country"]) ||
    firstHeaderValue(req.headers?.["x-country-code"]) ||
    firstHeaderValue(req.headers?.["x-appengine-country"])
  )?.toUpperCase();

  const acceptLanguage = firstHeaderValue(req.headers?.["accept-language"]);
  const acceptedLocale = acceptLanguage?.split(",")[0]?.trim();
  const acceptedLanguage = acceptedLocale?.split("-")[0]?.toLowerCase();
  const countryLanguage = country ? COUNTRY_TO_UI_LANGUAGE[country] : undefined;
  const uiLanguage = countryLanguage || acceptedLanguage || "es";
  const locale = acceptedLocale || (country ? `${uiLanguage}-${country}` : uiLanguage);
  return { country, uiLanguage, locale, source: countryLanguage ? "ip-country-header" : acceptedLanguage ? "accept-language" : "fallback" };
}

const GENERATION_INTENT_RE = /\b(app|aplicaci[oó]n|web|website|landing|tienda|ecommerce|saas|dashboard|crm|erp|juego|game|portal|panel|crear|crea|cr[eé]ame|generar|genera|construir|construye|desarrollar|desarrolla|programar|programa|diseñar|diseña|modificar|modifica|cambiar|cambia|arreglar|arregla|fix|build|create|generate|make|develop|code|deploy|preview|proyecto)\b/i;

const SMALL_TALK_RE = /^(hola+|buenas+|hey+|hi+|hello+|saludos+|qu[eé] tal\??|como estas\??|c[oó]mo est[aá]s\??|gracias+|ok+|vale+|test+|prueba+|probando+|ping+)$/i;

function getConversationalOnlyReply(content: string, hasAttachments = false): string | null {
  const normalized = String(content || "").trim().replace(/\s+/g, " ");
  if (!normalized || hasAttachments) return null;
  if (GENERATION_INTENT_RE.test(normalized)) return null;

  const stripped = normalized
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!¡¿?.,;:()\[\]{}"'`´]/g, "")
    .trim();
  const wordCount = stripped.split(/\s+/).filter(Boolean).length;

  const isGreeting = SMALL_TALK_RE.test(stripped);
  const isVeryShortSmallTalk = wordCount <= 3 && /^(hola|buenas|hey|hi|hello|saludos|gracias|ok|vale|test|prueba|probando|ping)(\s|$)/i.test(stripped);

  if (!isGreeting && !isVeryShortSmallTalk) return null;

  const replies = [
    "Dime qué quieres cambiar en la app y lo hago. Por ejemplo: \"arregla el login\", \"añade un modo oscuro\" o \"conecta Stripe al botón de pago\".",
    "Estoy aquí. Cuéntame qué necesitas — un cambio de diseño, una nueva función, algo que no funciona...",
    "Listo para trabajar. ¿Qué modificamos?",
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

function stripRequestLocalePrefix(prompt: string | undefined): string {
  return String(prompt || "")
    .replace(/^\[MARIS AI REQUEST LOCALE\][^\n]*\n/i, "")
    .trim();
}

function summarizeUserIntentForConsole(prompt: string): string {
  const clean = stripRequestLocalePrefix(prompt).replace(/\s+/g, " ").trim();
  if (!clean) return "refinamiento solicitado en la app";
  return clean.length > 190 ? `${clean.slice(0, 187)}…` : clean;
}

function countBundleFiles(code: unknown): number {
  const text = typeof code === "string" ? code : "";
  const matches = text.match(/\/\/ === FILE:/g);
  return matches?.length || 0;
}

function detectConsoleChangeAreas(prompt: string, result: any): string[] {
  const text = `${stripRequestLocalePrefix(prompt)} ${result?.title || ""} ${result?.description || ""}`.toLowerCase();
  const areas = new Set<string>();
  if (/stripe|pago|checkout|suscrip|plan|precio|billing|factur/.test(text)) areas.add("pagos, planes y conversión");
  if (/preview|vista|pantalla blanca|carga|vercel|deploy|desplieg/.test(text)) areas.add("preview, carga y despliegue");
  if (/bot[oó]n|cta|click|enlace|link|naveg/.test(text)) areas.add("botones, enlaces e interacción");
  if (/archivo|upload|subir|documento|adjunt/.test(text)) areas.add("subida de archivos y formularios");
  if (/diseñ|ui|ux|responsive|m[oó]vil|tablet|estilo/.test(text)) areas.add("diseño responsive y experiencia visual");
  if (/api|backend|base de datos|mongo|server|endpoint/.test(text)) areas.add("backend, datos e integraciones");
  if (Array.isArray(result?.requiredEnvVars) && result.requiredEnvVars.length > 0) areas.add("variables de entorno necesarias");
  if (areas.size === 0) areas.add("arquitectura, frontend y calidad general");
  return Array.from(areas).slice(0, 5);
}

async function buildAppUpdatedConsoleReply(args: {
  prompt: string;
  result: any;
  appTitle?: string;
  creditsRemaining?: number;
}): Promise<string> {
  const { prompt, result, appTitle, creditsRemaining } = args;
  const title = result?.title || appTitle || "tu app";
  const frontendFiles = countBundleFiles(result?.frontendCode);
  const backendFiles = countBundleFiles(result?.backendCode);
  const totalFiles = (frontendFiles || 0) + (backendFiles || 0);
  const hasBackend = (backendFiles || 0) > 0;

  try {
    const { generateUpdateCompleteMessage } = await import("../lib/marisPersona");
    return await generateUpdateCompleteMessage({
      userRequest: prompt,
      appTitle: title,
      filesChanged: totalFiles,
      hasBackend,
      creditsRemaining,
    });
  } catch {
    // Fallback si la IA falla
    return `Hecho. Los cambios en **${title}** están guardados. Refresca el preview para verlos.`;
  }
}

// ── POST /api/apps ────────────────────────────────────────────────────────
// ── CLERK USER COUNT — para el panel admin ───────────────────────────────────
router.get("/clerk-user-count", requireAuth, async (req: any, res: any) => {
  try {
    const { clerkClient } = await import("@clerk/express");
    const { connectDB } = await import("../lib/db");
    const { User } = await import("@workspace/db/schema");
    await connectDB();

    const clerkTotal = await clerkClient.users.getCount();
    const mongoTotal = await User.countDocuments();
    const diff = Math.max(0, clerkTotal - mongoTotal);

    res.json({ clerkTotal, mongoTotal, diff,
      message: diff > 0 ? `${diff} usuario(s) en Clerk sin sincronizar` : "Sincronizado" });
  } catch (err: any) {
    logger.error({ err }, "clerk-user-count error");
    res.status(500).json({ error: String(err) });
  }
});

// ── CLERK SYNC — sincroniza usuarios de Clerk a MongoDB ──────────────────────
router.post("/clerk-sync-users", requireAuth, async (req: any, res: any) => {
  try {
    const { clerkClient } = await import("@clerk/express");
    const { connectDB } = await import("../lib/db");
    const { User } = await import("@workspace/db/schema");
    const { isAdminEmail } = await import("../lib/auth");
    await connectDB();

    let synced = 0, skipped = 0, offset = 0;
    const limit = 100;

    while (true) {
      const page = await clerkClient.users.getUserList({ limit, offset });
      if (page.data.length === 0) break;

      for (const cu of page.data) {
        const email = cu.emailAddresses?.[0]?.emailAddress ?? "";
        if (!email) { skipped++; continue; }
        const existing = await User.findOne({ $or: [{ _id: cu.id }, { email }] }).lean();
        if (existing) { skipped++; continue; }
        try {
          await User.create({
            _id: cu.id, email,
            fullName: [cu.firstName, cu.lastName].filter(Boolean).join(" ") || undefined,
            imageUrl: cu.imageUrl ?? undefined,
            credits: isAdminEmail(email) ? 999999999 : 50,
            planCredits: isAdminEmail(email) ? 0 : 50,
            freeCreditsUsed: !isAdminEmail(email),
            plan: "free",
            createdAt: new Date(cu.createdAt),
          });
          synced++;
        } catch { skipped++; }
      }

      if (page.data.length < limit) break;
      offset += limit;
      if (offset > 5000) break;
    }

    res.json({ ok: true, synced, skipped,
      message: `Sincronizados ${synced} usuarios. ${skipped} ya existían.` });
  } catch (err: any) {
    logger.error({ err }, "clerk-sync-users error");
    res.status(500).json({ error: String(err) });
  }
});

router.get("/models", requireAuth, async (req: any, res: any) => {
  const availableModels = [
    { id: "auto", name: "Auto (Claude Sonnet 4.6)", description: "Selección inteligente optimizada para velocidad y precisión." },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", description: "Modelo por defecto. Alta calidad y estabilidad para Vibe Coding." },
    { id: "claude-sonnet-4-8", name: "Claude 4.8 Sonnet", description: "El estándar de oro para ingeniería. Requiere créditos extra." },
    { id: "claude-4-8-pro", name: "Claude 4.8 Pro (Opus)", description: "Razonamiento profundo para arquitecturas complejas. Coste premium." },
    { id: "gpt-5-4", name: "GPT-5.4 (OpenAI Ultra)", description: "Potencia extrema de la nueva generación de OpenAI. Coste premium." }
  ];
  res.json(availableModels);
});

// ── QUICK CHAT — Maris responde sin generar nada (para consultas en el dashboard) ──
// POST /api/apps/quick-chat
router.post("/apps/quick-chat", requireAuth, async (req: any, res: any) => {
  try {
    const { message, history = [], appContext } = req.body ?? {};
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message requerido" }); return;
    }

    // Detectar feedback negativo para el loop de mejora
    const msgLower = message.toLowerCase();
    const negativeFeedback = /no era lo que|no es lo que|esto no está bien|esto no esta bien|no me gusta|está mal|esta mal|no funciona bien|no es correcto|incorrecto|equivocado|mal resultado/.test(msgLower);
    const positiveFeedback = /muy bien|perfecto|excelente|genial|me gusta|está bien|esta bien|bien hecho|gracias|funciona bien/.test(msgLower);
    const feedbackType = negativeFeedback ? "negative" : positiveFeedback ? "positive" : null;

    // Construir historial para contexto
    const historyMessages = (Array.isArray(history) ? history : [])
      .slice(-6)
      .map((m: any) => ({
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: String(m.text || "").slice(0, 300),
      }));

    const appContextBlock = appContext
      ? `\n\nApps del usuario: ${appContext}`
      : "";

    const systemPrompt = `Eres Maris, la IA de Maris AI — plataforma española para crear apps con IA.

El usuario está en el panel principal. Respóndele de forma útil, cercana y directa en español.${appContextBlock}

PRECIOS ACTUALES DE MARIS AI (úsalos si pregunta):
- Plan Gratuito: 3 créditos al registrarse, sin tarjeta
- Plan Pro: 20€/mes — 50 créditos/mes
- Plan Startup: 49€/mes — 150 créditos/mes
- Coste por generación: 1-5 créditos según tipo (landing=1cr, app completa=3cr, juego 3D=5cr)

CAPACIDADES:
- Genera apps React + TypeScript + Tailwind completas
- Frontend + Backend (Node/Express) + MongoDB
- Deploy a Vercel con un clic
- 9 agentes IA especializados trabajando en paralelo

TONO: Cercano, directo, máximo 2-3 frases. Sin "¿en qué más puedo ayudarte?". Sin saludos formales. Si el usuario tiene apps, úsalas como contexto.`;

    const messages: any[] = [
      ...historyMessages,
      { role: "user", content: message.slice(0, 500) },
    ];

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 350,
      system: systemPrompt,
      messages,
    });

    const reply = (response.content[0] as any).text?.trim() ?? "¡Hola! Cuéntame qué necesitas.";
    res.json({
      ok: true,
      reply,
      feedbackDetected: !!feedbackType,
      feedbackType,
    });
  } catch (err) {
    logger.error({ err }, "quick-chat error");
    res.json({ ok: true, reply: "¡Hola! Estoy aquí. ¿Tienes alguna duda o quieres construir algo?" });
  }
});

// ── FEEDBACK LOOP — guarda patrones de insatisfacción para mejorar generaciones ──
router.post("/apps/feedback", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const userId = req.userId!;
    const { message, type, appId } = req.body ?? {};
    if (!message || !type) { res.json({ ok: true }); return; }

    // Guardar en agentMemory para que futuras generaciones del usuario sean mejores
    const { AgentMemory } = await import("@workspace/db/schema");
    const existing = await AgentMemory.findOne({ userId }).lean() as any;
    const feedbackKey = type === "negative" ? "negativeFeedback" : "positiveFeedback";
    const entry = { message: message.slice(0, 200), appId, createdAt: new Date().toISOString() };

    if (existing) {
      const current = existing[feedbackKey] || [];
      current.push(entry);
      // Máximo 20 entradas por tipo
      await AgentMemory.findByIdAndUpdate(existing._id, {
        $set: { [feedbackKey]: current.slice(-20), updatedAt: new Date() }
      });
    } else {
      await AgentMemory.create({
        userId,
        [feedbackKey]: [entry],
      });
    }

    logger.info({ userId, type, messagePreview: message.slice(0, 50) }, "feedback loop: entrada guardada");
    res.json({ ok: true });
  } catch (err) {
    logger.warn({ err }, "feedback loop error — ignorando");
    res.json({ ok: true });
  }
});

// ── PLAN PREVIEW — el arquitecto analiza el prompt y propone el plan al usuario ──
// POST /api/apps/plan-preview
// Devuelve un resumen del plan propuesto SIN generar código, para que el usuario
// confirme qué quiere antes de gastar créditos
router.post("/apps/plan-preview", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const { prompt, kind } = req.body ?? {};
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt requerido" }); return;
    }

    const cleanPrompt = prompt
      .replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "")
      .replace(/\[MARIS_ENGINE=[^\]]*\]/g, "")
      .trim()
      .slice(0, 3000); // Limitar para no saturar Haiku

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: `Eres el Arquitecto de Maris AI. Analiza el prompt y devuelve SOLO JSON válido, sin texto adicional, sin markdown, sin explicaciones:
{
  "title": "nombre corto del proyecto en español",
  "summary": "1-2 frases de qué vas a construir exactamente",
  "included": ["funcionalidad que SÍ pidió el usuario (máx 4)"],
  "extras": [{"id": "id_unico", "label": "Nombre del extra", "why": "Por qué sería útil"}],
  "estimatedPages": 4,
  "backendNeeded": false
}

REGLAS:
- Si el prompt menciona una URL o web de referencia (ej: "algo como dejalia.com", "al estilo airbnb"), úsala como inspiración para el title y summary. El title debe ser original, NO el nombre de la web de referencia.
- "included": las funcionalidades clave que el usuario pidió o que tiene la web de referencia. Máx 4 items.
- "extras": funcionalidades útiles que NO mencionó. Máx 3. Si no hay extras claros, devuelve [].
- "backendNeeded": true si el prompt pide auth, pagos, BD real, API propia, o si la web de referencia claramente los necesita.
- Devuelve ÚNICAMENTE el JSON. Nada más.`,
      messages: [{ role: "user", content: `Prompt: "${cleanPrompt}"
Tipo: ${kind || "fullstack"}` }],
    });

    const raw = (response.content[0] as any).text?.trim() ?? "";
    // Extraer JSON aunque venga con markdown o texto extra
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) {
      logger.warn({ raw: raw.slice(0, 200) }, "plan-preview: no JSON found in response");
      res.status(500).json({ error: "No se pudo generar el plan" }); return;
    }
    let plan: any;
    try {
      plan = JSON.parse(raw.slice(first, last + 1));
    } catch (parseErr) {
      logger.warn({ raw: raw.slice(0, 200), parseErr }, "plan-preview: JSON parse failed");
      res.status(500).json({ error: "Plan malformado" }); return;
    }
    // Garantizar estructura mínima
    plan.title = plan.title || cleanPrompt.slice(0, 40);
    plan.summary = plan.summary || `App de tipo ${kind || "web"} basada en: ${cleanPrompt.slice(0, 80)}`;
    plan.included = Array.isArray(plan.included) ? plan.included : [];
    plan.extras = Array.isArray(plan.extras) ? plan.extras : [];
    res.json({ ok: true, plan });
  } catch (err) {
    logger.error({ err }, "plan-preview error");
    res.status(500).json({ error: "Error generando preview del plan" });
  }
});

router.post("/apps", requireAuth, generateRateLimiter, async (req: any, res: any) => {
  try {
    const { prompt, model, language, attachments, kind } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt es requerido" });
    const safeAttachments = Array.isArray(attachments) ? attachments : [];
    const conversationalReply = getConversationalOnlyReply(prompt, safeAttachments.length > 0);
    if (conversationalReply) {
      return res.status(200).json({
        conversationOnly: true,
        reply: conversationalReply,
        message: conversationalReply,
        creditsCost: 0,
        creditsRemaining: req.dbUser?.credits,
      });
    }
    const userId = req.userId as string;
    const isAdmin = isAdminEmail(req.dbUser?.email);
    // ── SISTEMA DE CRÉDITOS DUAL (Free vs Paid) ──────────────────────────────
    // PLAN FREE (prueba generosa de 10 créditos):
    //   - 1 app = 6 créditos fijos (cualquier tipo de app)
    //   - 20 modificaciones = 0.2 créditos c/u = 4 créditos
    //   - Total: 6 + (20 × 0.2) = 10 créditos exactos
    //
    // PLAN PAID (verificado por Stripe — quema rápida):
    //   - Coste = KIND_COSTS[kind] × 10
    //   - landing   = 1 × 10 = 10 créditos
    //   - vue/svelte = 2 × 10 = 20 créditos
    //   - fullstack  = 3 × 10 = 30 créditos
    //   - game-3d    = 5 × 10 = 50 créditos
    // ─────────────────────────────────────────────────────────────────────────
    const isPaid = !!req.dbUser?.isPremium || (req.dbUser?.plan && req.dbUser?.plan !== "free");
    const kindKey = (kind || "fullstack") as keyof typeof KIND_COSTS;
    const baseCost = KIND_COSTS[kindKey] ?? 3;
    const cost = isPaid ? (baseCost * 10) : 6;

    const charge = await chargeCredits({
      userId,
      isAdmin,
      amount: cost,
      description: `Sesión de ingeniería Maris AI (${kind || "fullstack"}): ${prompt.slice(0, 50)}...`,
    });

    if (!charge.ok) {
      return res.status(402).json({
        error: "Créditos insuficientes",
        required: cost,
        current: req.dbUser?.credits,
        isPaid,
        hint: isPaid
          ? `Este tipo de app (${kind || "fullstack"}) cuesta ${cost} créditos en plan de pago.`
          : "Necesitas créditos para generar apps.",
      });
    }

    const requestLocale = detectRequestLocale(req);
    const generationPrompt = `[MARIS AI REQUEST LOCALE] uiLanguage=${requestLocale.uiLanguage}; locale=${requestLocale.locale}; country=${requestLocale.country || "unknown"}; source=${requestLocale.source}. Use this for all user-visible copy unless the user explicitly asks for another language.\n${prompt}`;

    const hasEverPaid = !!(req.dbUser?.hasEverPaid || req.dbUser?.isPremium || (req.dbUser?.plan && req.dbUser?.plan !== "free"));

    // Limpiar jobs anteriores atascados del mismo usuario antes de crear uno nuevo.
    // IMPORTANTE: excluye jobs en awaitingApproval=true — esos están PAUSADOS
    // legítimamente esperando respuesta del usuario (p.ej. en otra pestaña/
    // proyecto), no "atascados". Sin esta exclusión, iniciar una generación
    // para el Proyecto B mientras el Proyecto A espera tu aprobación marcaba
    // el Job A como fallido, dejando esa app a medias.
    try {
      const staleThreshold = new Date(Date.now() - 2 * 60 * 1000); // 2 minutos
      await GenerationJob.updateMany(
        {
          userId,
          status: { $in: ["queued", "running"] },
          awaitingApproval: { $ne: true },
          updatedAt: { $lt: staleThreshold },
        },
        { $set: { status: "failed", phase: "failed", errorMessage: "Job cancelado — nuevo job iniciado por el usuario.", updatedAt: new Date() } }
      );
    } catch (cleanErr) {
      logger.warn({ cleanErr }, "No se pudo limpiar jobs anteriores — continuando");
    }

    const jobId = new mongoose.Types.ObjectId().toString();
    await GenerationJob.create({
      _id: jobId,
      userId,
      prompt: generationPrompt,
      coderModel: model || "claude-sonnet-4-6",
      language: language || "typescript",
      kind: kind || "fullstack",
      status: "queued",
      phase: "queued",
      progress: 0,
      isAdmin,
      hasEverPaid,
    });

    await enqueueGenerateJob(jobId);
    runJobById(jobId).catch(err => logger.error({ err, jobId }, "Immediate job run error"));
    res.status(201).json({ id: jobId, creditsCost: cost, creditsRemaining: charge.newBalance });
  } catch (err) {
    logger.error({ err }, "POST /api/apps error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

// ── GET /api/apps ─────────────────────────────────────────────────────────

router.get("/apps", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const userId = req.userId as string;
    const apps = await GeneratedApp.find({ userId }, { frontendCode: 0, backendCode: 0 }).sort({ createdAt: -1 }).lean();
    
    // Serializar fechas para evitar problemas de serialización
    const serializedApps = apps.map((app: any) => ({
      ...app,
      createdAt: app.createdAt ? (typeof app.createdAt === 'string' ? app.createdAt : app.createdAt.toISOString()) : new Date().toISOString(),
      updatedAt: app.updatedAt ? (typeof app.updatedAt === 'string' ? app.updatedAt : app.updatedAt.toISOString()) : new Date().toISOString(),
    }));
    
    res.json(serializedApps);
  } catch (err) {
    logger.error({ err }, "GET /api/apps error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

// ── GET /api/apps/:id ─────────────────────────────────────────────────────
router.get("/apps/:id", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const app = await GeneratedApp.findOne({ _id: req.params.id, userId });
    if (!app) return res.status(404).json({ error: "App no encontrada" });
    res.json(app);
  } catch (err) {
    logger.error({ err }, "GET /api/apps/:id error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── POST /api/apps/:id/github ─────────────────────────────────────────────
router.post("/apps/:id/github", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const app = await GeneratedApp.findOne({ _id: req.params.id, userId });
    if (!app) return res.status(404).json({ error: "App no encontrada" });

    if (!app.frontendCode || String(app.frontendCode).trim().length < 20) {
      return res.status(400).json({ error: "La app todavía no tiene frontend listo para subir." });
    }

    // Cargar el usuario para obtener su token OAuth de GitHub
    const dbUser = req.dbUser || await User.findById(userId).lean();
    const userGitHubToken = (dbUser as any)?.githubAccessToken || null;

    // Si no tiene GitHub conectado, devolver instrucciones claras
    if (!userGitHubToken) {
      return res.status(401).json({
        error: "GitHub no conectado",
        message: "Conecta tu cuenta de GitHub primero. Haz clic en el botón GitHub del proyecto para vincular tu cuenta.",
        connectUrl: "/api/github/connect",
        needsConnect: true,
      });
    }

    const { repoName: customRepoName, isPrivate } = req.body || {};

    const result = await pushAppToGitHub({
      title: app.title || "Maris AI App",
      description: app.description || app.prompt || "Proyecto generado con Maris AI",
      frontendBundle: app.frontendCode,
      existingRepoFullName: app.githubRepoFullName || null,
      userGitHubToken,
      isPrivate: isPrivate ?? false,
      repoName: customRepoName || undefined,
    });

    const updated = await GeneratedApp.findOneAndUpdate(
      { _id: req.params.id, userId },
      {
        githubRepoUrl: result.url,
        githubRepoFullName: result.repoFullName,
      },
      { new: true },
    );

    res.json({
      ok: true,
      url: result.url,
      repoFullName: result.repoFullName,
      updated: result.updated,
      app: updated,
    });
  } catch (err) {
    logger.error({ err, appId: req.params.id, userId: req.userId }, "POST /api/apps/:id/github error");
    res.status(500).json({ error: err instanceof Error ? err.message : "No se pudo subir a GitHub" });
  }
});

// ── DELETE /api/apps/:id ──────────────────────────────────────────────────
router.delete("/apps/:id", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const appId = req.params.id;

    const app = await GeneratedApp.findOne({ _id: appId, userId });
    if (!app) return res.status(404).json({ error: "App no encontrada" });

    await Promise.all([
      GeneratedApp.deleteOne({ _id: appId }),
      AppMessage.deleteMany({ appId }),
      AppImage.deleteMany({ appId }),
      AppRuntimeError.deleteMany({ appId }),
      AppRevision.deleteMany({ appId }),
      GenerationJob.deleteMany({ appId }),
      JobLog.deleteMany({ jobId: appId }),
    ]);

    logger.info({ userId, appId }, "App eliminada exitosamente");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId: req.userId, appId: req.params.id }, "DELETE /api/apps/:id error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

// ── POST /api/apps/:id/fork ──────────────────────────────────────────────────
// Fork / duplicar proyecto (estilo Emergent.sh): crea una copia exacta del
// código actual (frontend + backend + páginas planificadas) como un nuevo
// proyecto independiente del mismo usuario. Útil como "punto de restauración"
// antes de pedir un cambio grande/arriesgado — si la IA rompe algo en el
// proyecto original, el fork queda intacto.
// No cuesta créditos: es una copia en base de datos, sin generación de IA.
router.post("/apps/:id/fork", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const original = await GeneratedApp.findOne({ _id: req.params.id, userId }).lean() as any;
    if (!original) return res.status(404).json({ error: "App no encontrada" });
    if (!original.frontendCode) {
      return res.status(400).json({ error: "Esta app no tiene código generado todavía, no se puede duplicar." });
    }

    const customTitle = typeof req.body?.title === "string" && req.body.title.trim()
      ? req.body.title.trim().slice(0, 200)
      : `${original.title} (copia)`;

    // ID Universal Maris AI para el fork — vinculado al mismo usuario propietario
    let marisId: string;
    try {
      const owner = await User.findById(userId).lean() as any;
      const userMarisId = owner?.marisId ?? MarisId.user();
      marisId = await generateAppId(userMarisId);
    } catch {
      marisId = MarisId.project(MarisId.user());
    }

    const fork = await GeneratedApp.create({
      userId,
      title: customTitle,
      prompt: original.prompt,
      description: original.description,
      techStack: original.techStack,
      frontendCode: original.frontendCode,
      backendCode: original.backendCode,
      status: "ready",
      coderModel: original.coderModel,
      language: original.language,
      kind: original.kind,
      plannedPages: original.plannedPages ?? [],
      requiredEnvVars: original.requiredEnvVars ?? [],
      hasWatermark: original.hasWatermark,
      // Identidad de despliegue propia — el fork NO comparte dominio,
      // repo de GitHub ni estado de despliegue del original.
      publicSlug: makeSlug(),
      marisId,
    });

    logger.info({ userId, originalAppId: req.params.id, forkAppId: String(fork._id) }, "App duplicada (fork)");

    res.json({
      ok: true,
      id: String(fork._id),
      title: fork.title,
      marisId: fork.marisId,
    });
  } catch (err) {
    logger.error({ err }, "POST /api/apps/:id/fork error");
    res.status(500).json({ error: "Error al duplicar la app." });
  }
});

// ── PATCH /api/apps/:id/showcase ─────────────────────────────────────────────
// Publica o retira un proyecto de la galería pública /showcase. Gratis.
// Para publicar, la app debe estar desplegada (tiene una URL de demo en vivo)
// — no tiene sentido mostrar un proyecto sin demo funcional.
router.patch("/apps/:id/showcase", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const isPublic = !!req.body?.isPublic;

    const app = await GeneratedApp.findOne({ _id: req.params.id, userId });
    if (!app) return res.status(404).json({ error: "App no encontrada" });

    if (isPublic) {
      const hasDemoUrl = !!(app.vercelDeployUrl || app.vercelCustomDomain || app.customDomain);
      if (!hasDemoUrl) {
        return res.status(400).json({ error: "Despliega la app antes de publicarla en la galería pública." });
      }
      if (!app.publicSlug) app.publicSlug = makeSlug();
      app.isPublic = true;
      app.showcasePublishedAt = new Date();
    } else {
      app.isPublic = false;
    }
    await app.save();

    logger.info({ userId, appId: req.params.id, isPublic: app.isPublic }, "Showcase toggle");
    res.json({ ok: true, isPublic: app.isPublic, publicSlug: app.publicSlug });
  } catch (err) {
    logger.error({ err }, "PATCH /api/apps/:id/showcase error");
    res.status(500).json({ error: "Error al actualizar el estado de la galería." });
  }
});


// Pre-Deployment Health Check (estilo Emergent.sh): valida el bundle completo
// (frontend + backend) buscando errores de build/runtime, y si encuentra
// problemas reparables intenta arreglarlos automáticamente con el patcher
// antes de que el usuario haga deploy. Cuesta 30 créditos (se descuentan al
// instante, admins ilimitados). Devuelve un informe con los problemas
// encontrados/arreglados.
const HEALTH_CHECK_COST = 30;

router.post("/apps/:id/health", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const app = await GeneratedApp.findOne({ _id: req.params.id, userId });
    if (!app) return res.status(404).json({ error: "App no encontrada" });
    if (!app.frontendCode) return res.status(400).json({ error: "Esta app no tiene código generado todavía." });

    const dbUser = await User.findById(userId).lean() as any;
    const isAdmin = isAdminEmail(dbUser?.email);

    // Cobro inmediato y atómico — si no hay créditos suficientes, no se ejecuta nada.
    const charge = await chargeCredits({
      userId,
      isAdmin,
      amount: HEALTH_CHECK_COST,
      description: `Pre-Deployment Health Check — ${app.title || "App"}`,
    });
    if (!charge.ok) {
      return res.status(402).json({
        error: "No tienes suficientes créditos para el Health Check.",
        creditsRequired: HEALTH_CHECK_COST,
      });
    }

    const language: GenLanguage = (app.techStack ?? []).some((t: string) => /javascript/i.test(t))
      ? "javascript"
      : "typescript";

    // 1) Validar frontend
    const frontendReport = await validateBundle(app.frontendCode);
    let backendReport: ValidationReport | null = null;
    if (app.backendCode) {
      try {
        backendReport = await validateBundle(app.backendCode);
      } catch (err) {
        logger.warn({ err }, "health-check: backend validation failed, skipping");
      }
    }

    const allIssues: BuildIssue[] = [
      ...frontendReport.issues,
      ...(backendReport?.issues ?? []),
    ];

    let updatedFrontend: string | null = null;
    let updatedBackend: string | null = null;
    let repaired = false;

    // 2) Si hay problemas, intentar reparar automáticamente (1 ciclo de patch)
    if (allIssues.length > 0) {
      const qaIssues: QAIssue[] = allIssues.slice(0, 6).map((i) => ({
        file: i.file,
        problem: i.message,
        fix: "Corrige este error de build/runtime sin cambiar el diseño ni la funcionalidad existente.",
      }));

      try {
        const patchedFrontend = await patchBundle(app.frontendCode, qaIssues, language);
        if (patchedFrontend) {
          const reValidated = await validateBundle(patchedFrontend);
          if (reValidated.issues.length < frontendReport.issues.length) {
            updatedFrontend = patchedFrontend;
            repaired = true;
          }
        }
      } catch (err) {
        logger.warn({ err }, "health-check: frontend auto-repair failed");
      }
    }

    // 3) Guardar bundle reparado (si lo hay) y registrar el resultado del check
    const finalFrontendIssues = updatedFrontend
      ? (await validateBundle(updatedFrontend)).issues
      : frontendReport.issues;

    const update: any = {
      lastHealthCheckAt: new Date(),
      lastHealthCheckReport: {
        ok: finalFrontendIssues.length === 0 && (backendReport?.issues.length ?? 0) === 0,
        frontendIssues: finalFrontendIssues,
        backendIssues: backendReport?.issues ?? [],
        repaired,
        checkedAt: new Date(),
      },
    };
    if (updatedFrontend) update.frontendCode = updatedFrontend;
    if (updatedBackend) update.backendCode = updatedBackend;

    await GeneratedApp.findByIdAndUpdate(app._id, { $set: update });

    logger.info(
      { appId: String(app._id), userId, issuesFound: allIssues.length, repaired },
      "Pre-Deployment Health Check completado",
    );

    const allRemainingIssues = [...finalFrontendIssues, ...(backendReport?.issues ?? [])];
    const ok = allRemainingIssues.length === 0;

    res.json({
      ok,
      status: ok ? "pass" : "fail",
      issues: allRemainingIssues.map((i) => `[${i.file}] ${i.message}`),
      repaired,
      issuesFoundBeforeRepair: allIssues.length,
      creditsCharged: isAdmin ? 0 : HEALTH_CHECK_COST,
      creditsRemaining: charge.newBalance,
    });
  } catch (err) {
    logger.error({ err }, "POST /api/apps/:id/health error");
    res.status(500).json({ error: "Error al ejecutar el Health Check." });
  }
});


router.get("/apps/:id/active-job", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const app = await GeneratedApp.findOne({ _id: req.params.id, userId });
    if (!app) return res.status(404).json({ error: "App no encontrada" });

    const job = await GenerationJob.findOne({
      appId: req.params.id,
      userId,
      status: { $nin: ["succeeded", "failed"] },
    }).sort({ updatedAt: -1, createdAt: -1 });

    if (!job) return res.json(null);

    res.json({
      id: String(job._id),
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      appId: job.appId,
      errorMessage: job.errorMessage,
      updatedAt: job.updatedAt,
      currentAgent: job.currentAgent,
      awaitingApproval: job.awaitingApproval,
      approvedFacets: job.checkpointData?.approvedFacets ?? [],
    });
  } catch (err) {
    logger.error({ err, appId: req.params.id }, "GET /api/apps/:id/active-job error");
    res.status(500).json({ error: "Error interno" });
  }
});


function redactOperationalSecrets(text: string): string {
  return String(text || "")
    .replace(/([Pp]assword|contrase[ñn]a|clave)\s*[:=]\s*([^\s/;]+)/g, "$1: [REDACTADO]")
    .replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (email) => {
      const [name, domain] = email.split("@");
      if (!name || !domain) return "[email-redactado]";
      return `${name.slice(0, 2)}***@${domain}`;
    });
}

function extractOperationalTargets(text: string): string[] {
  const lower = text.toLowerCase();
  const targets = new Set<string>();
  if (/crm|ventas|comercial|lead|cliente/.test(lower)) targets.add("CRM / ventas");
  if (/mongodb|mongo\s*db|base de datos|bbdd|database/.test(lower)) targets.add("MongoDB / base de datos");
  if (/credenciales|password|contrase[ñn]a|usuario|rol|permisos/.test(lower)) targets.add("credenciales y permisos");
  if (targets.size === 0) targets.add("operación de datos");
  return Array.from(targets);
}

function buildEngineExecutionReply(content: string, classified: ClassifiedIntent): string {
  const targets = extractOperationalTargets(content);
  const safeSummary = redactOperationalSecrets(content).replace(/\s+/g, " ").trim();
  return [
    "---",
    "**ENGINE_EXEC activado.**",
    "",
    "La petición se ha clasificado como operación de datos/CRM, por lo que Maris AI ha bloqueado el flujo de desarrollo: no se ha tocado HTML, CSS, JavaScript, Node.js, bundle, preview ni cola de compilación.",
    "",
    `**Destino detectado:** ${targets.join(", ")}.`,
    `**Acción recibida:** ${safeSummary || "operación directa sobre datos"}.`,
    `**Motivo de enrutamiento:** ${classified.reason}.`,
    "",
    "Para ejecutar una escritura real sobre una base de datos externa, configura un handler seguro del motor EXEC con variables de entorno de producción y reglas explícitas de colección/campos. Hasta entonces, esta ruta actúa como barrera determinista anti-recompilación y no simula cambios de código.",
    "---",
  ].join("\n");
}

// ── GET /api/apps/:id/messages ────────────────────────────────────────────
router.get("/apps/:id/messages", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const app = await GeneratedApp.findOne({ _id: req.params.id, userId }, { _id: 1 });
    if (!app) return res.status(404).json({ error: "App no encontrada" });
    const messages = await AppMessage.find({ appId: req.params.id }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    logger.error({ err }, "GET /api/apps/:id/messages error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── POST /api/apps/:id/messages ───────────────────────────────────────────
router.post("/apps/:id/messages", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const { content, attachmentIds, isAutoRepair: isAutoRepairRaw } = req.body;
    const isAutoRepair = isAutoRepairRaw === true;
    if (!content || typeof content !== "string" || !content.trim()) return res.status(400).json({ error: "content es requerido" });
    const trimmedContent = content.trim();
    const safeAttachmentIds = Array.isArray(attachmentIds)
      ? attachmentIds.filter((id: unknown) => typeof id === "string" && id.trim()).map((id: string) => id.trim())
      : [];
    const isAdmin = isAdminEmail(req.dbUser?.email);

    const app = await GeneratedApp.findOne({ _id: req.params.id, userId });
    if (!app) return res.status(404).json({ error: "App no encontrada" });

    // ── AUTO-REPARACIÓN ──────────────────────────────────────────────────────
    // El frontend dispara esto cuando el iframe de preview reporta "página en
    // blanco" (#root nunca montó nada). Es un fallo NUESTRO (de la generación
    // anterior), así que: no se cobran créditos, se avisa de inmediato en el
    // chat ("voy a revisarlo…"), se salta la clasificación de intención
    // (sabemos que es un arreglo de código) y al terminar el job se publica
    // un mensaje de cierre (éxito o petición de más información).
    if (isAutoRepair) {
      await AppMessage.create({
        appId: req.params.id,
        role: "assistant",
        content: "He detectado un problema cargando la vista previa de tu app. Dame un momento, voy a revisarlo y solucionarlo automáticamente…",
      });

      const requestLocale = detectRequestLocale(req);
      const generationPrompt = `[MARIS AI REQUEST LOCALE] uiLanguage=${requestLocale.uiLanguage}; locale=${requestLocale.locale}; country=${requestLocale.country || "unknown"}; source=${requestLocale.source}. Use this for all user-visible copy unless the user explicitly asks for another language.\n[MARIS_ENGINE=ENGINE_DEV; INTENT_REASON=auto-repair: preview report\u00f3 p\u00e1gina en blanco]\n${trimmedContent}`;

      const jobId = new mongoose.Types.ObjectId().toString();
      await GenerationJob.create({
        _id: jobId,
        userId,
        prompt: generationPrompt,
        editAppId: req.params.id,
        attachmentIds: [],
        coderModel: app.coderModel || "auto",
        language: app.language || "typescript",
        kind: app.kind || "fullstack",
        status: "queued",
        phase: "queued",
        progress: 0,
        isAdmin,
        isAutoRepair: true,
      });

      await enqueueGenerateJob(jobId);
      runJobById(jobId).catch(err => logger.error({ err, jobId }, "Auto-repair job run error"));
      return res.status(201).json({ id: jobId, engine: "ENGINE_DEV", intent: "edit", creditsCost: 0, creditsRemaining: req.dbUser?.credits, isAutoRepair: true });
    }

    const conversationalReply = getConversationalOnlyReply(trimmedContent, safeAttachmentIds.length > 0);
    if (conversationalReply) {
      await AppMessage.create({ appId: req.params.id, role: "user", content: trimmedContent });
      await AppMessage.create({ appId: req.params.id, role: "assistant", content: conversationalReply });
      return res.status(200).json({
        conversationOnly: true,
        reply: conversationalReply,
        message: conversationalReply,
        creditsCost: 0,
        creditsRemaining: req.dbUser?.credits,
      });
    }

    const recentMessages = await AppMessage.find({ appId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    const classified = await classifyChatIntent({
      appTitle: app.title || "App sin título",
      appDescription: app.description || "",
      agentNotes: app.agentNotes || "",
      recentMessages: recentMessages
        .reverse()
        .map((m: any) => ({ role: String(m.role || "assistant"), content: String(m.content || "") })),
      message: trimmedContent,
      log: req.log || logger,
    });

    if (classified.intent === "question") {
      // Usar la persona unificada de Maris para responder con tono humano
      let reply: string;
      try {
        const { generateMarisReply } = await import("../lib/marisPersona");
        reply = await generateMarisReply({
          userMessage: trimmedContent,
          appTitle: app.title,
          appDescription: app.description,
          recentMessages: recentMessages.reverse().map((m: any) => ({ role: String(m.role), content: String(m.content || "").slice(0, 300) })),
        });
      } catch {
        reply = classified.reply || "Dime qué quieres cambiar en la app y me pongo a ello.";
      }
      await AppMessage.create({ appId: req.params.id, role: "user", content: trimmedContent, attachmentIds: JSON.stringify(safeAttachmentIds) });
      await AppMessage.create({ appId: req.params.id, role: "assistant", content: reply });
      return res.status(200).json({
        conversationOnly: true,
        engine: classified.engine,
        intent: classified.intent,
        reply,
        message: reply,
        creditsCost: 0,
        creditsRemaining: req.dbUser?.credits,
      });
    }

    if (classified.intent === "research") {
      await AppMessage.create({ appId: req.params.id, role: "user", content: trimmedContent, attachmentIds: JSON.stringify(safeAttachmentIds) });
      const reply = await researchTopic(trimmedContent);
      await AppMessage.create({ appId: req.params.id, role: "assistant", content: reply });
      return res.status(200).json({
        conversationOnly: true,
        engine: classified.engine,
        intent: classified.intent,
        reply,
        message: reply,
        creditsCost: 0,
        creditsRemaining: req.dbUser?.credits,
      });
    }

    if (classified.intent === "execute") {
      await AppMessage.create({ appId: req.params.id, role: "user", content: trimmedContent, attachmentIds: JSON.stringify(safeAttachmentIds) });
      // ENGINE_EXEC: ejecutar la operación de datos REAL con el dataOperationAgent
      // Primero construir el Project Map para saber exactamente dónde operar
      let projectMapData: ProjectMap | null = null;
      try {
        const frontendCode = app.frontendCode || "";
        const backendCode = app.backendCode || "";
        projectMapData = buildProjectMap(
          req.params.id,
          app.title || "App sin título",
          frontendCode,
          backendCode
        );
        // Resolver el target exacto del prompt del usuario
        const target = resolveTargetFromPrompt(trimmedContent, projectMapData);
        logger.info({ target }, "PROJECT_MAP: target resuelto para ENGINE_EXEC");
      } catch (mapErr) {
        logger.warn({ mapErr }, "PROJECT_MAP: no se pudo construir el mapa, continuando sin él");
      }

      let reply: string;
      try {
        const execResult = await executeDataOperation({
          appId: req.params.id,
          userId,
          message: trimmedContent,
          appTitle: app.title || "App sin título",
          appDescription: app.description || "",
          agentNotes: app.agentNotes || "",
          projectMap: projectMapData ? JSON.stringify(projectMapData) : undefined,
          log: req.log || logger,
        });
        reply = execResult.message;

        if (execResult.success) {
          // GitHub sync eliminado — solo se sube a GitHub cuando el usuario lo solicita explícitamente
        }
      } catch (execErr) {
        logger.error({ execErr }, "ENGINE_EXEC error");
        reply = `⚠️ Error ejecutando la operación: ${execErr instanceof Error ? execErr.message : String(execErr)}. Por favor, inténtalo de nuevo con más detalle.`;
      }
      await AppMessage.create({ appId: req.params.id, role: "assistant", content: reply });
      return res.status(200).json({
        operationOnly: true,
        engine: classified.engine,
        intent: classified.intent,
        reply,
        message: reply,
        creditsCost: 0,
        creditsRemaining: req.dbUser?.credits,
      });
    }

    // ── SISTEMA DE CRÉDITOS DUAL (Free vs Paid) — ENGINE_DEV / MODIFICACIONES ─
    // Solo se cobra cuando el clasificador ha decidido que la petición modifica código.
    const isPaid = !!req.dbUser?.isPremium || (req.dbUser?.plan && req.dbUser?.plan !== "free");
    const cost = isPaid ? 5 : 0.2;

    const charge = await chargeCredits({
      userId,
      isAdmin,
      amount: cost,
      description: `Refinamiento ENGINE_DEV: ${app.title}`,
    });

    if (!charge.ok) {
      return res.status(402).json({
        error: "Créditos insuficientes",
        required: cost,
        current: req.dbUser?.credits,
        isPaid,
        hint: isPaid
          ? `Cada modificación cuesta ${cost} créditos en plan de pago.`
          : "Necesitas créditos para modificar apps.",
      });
    }

    await AppMessage.create({ appId: req.params.id, role: "user", content: trimmedContent, attachmentIds: JSON.stringify(safeAttachmentIds) });

    const requestLocale = detectRequestLocale(req);
    const generationPrompt = `[MARIS AI REQUEST LOCALE] uiLanguage=${requestLocale.uiLanguage}; locale=${requestLocale.locale}; country=${requestLocale.country || "unknown"}; source=${requestLocale.source}. Use this for all user-visible copy unless the user explicitly asks for another language.\n[MARIS_ENGINE=ENGINE_DEV; INTENT_REASON=${classified.reason}]\n${trimmedContent}`;

    const jobId = new mongoose.Types.ObjectId().toString();
    await GenerationJob.create({
      _id: jobId,
      userId,
      prompt: generationPrompt,
      editAppId: req.params.id,
      attachmentIds: safeAttachmentIds,
      coderModel: app.coderModel || "auto",
      language: app.language || "typescript",
      kind: app.kind || "fullstack",
      status: "queued",
      phase: "queued",
      progress: 0,
      isAdmin,
    });

    await enqueueGenerateJob(jobId);
    runJobById(jobId).catch(err => logger.error({ err, jobId }, "Immediate job run error"));
    res.status(201).json({ id: jobId, engine: classified.engine, intent: classified.intent, creditsCost: cost, creditsRemaining: charge.newBalance });
  } catch (err) {
    logger.error({ err }, "POST /api/apps/:id/messages error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

// ── POST /api/apps/:id/retry ──────────────────────────────────────────────
router.post("/apps/:id/retry", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const app = await GeneratedApp.findOne({ _id: req.params.id, userId });
    if (!app) return res.status(404).json({ error: "App no encontrada" });

    const isAdmin = isAdminEmail(req.dbUser?.email);
    // ── SISTEMA DE CRÉDITOS DUAL (Free vs Paid) — REINTENTAR ────────────────
    // Mismo coste que generar la app desde cero (usa el kind de la app existente)
    // ─────────────────────────────────────────────────────────────────────────
    const isPaid = !!req.dbUser?.isPremium || (req.dbUser?.plan && req.dbUser?.plan !== "free");
    const appKindKey = (app.kind || "fullstack") as keyof typeof KIND_COSTS;
    const baseCostRetry = KIND_COSTS[appKindKey] ?? 3;
    const cost = isPaid ? (baseCostRetry * 10) : 6;

    const charge = await chargeCredits({
      userId,
      isAdmin,
      amount: cost,
      description: `Reintento de ingeniería Maris AI (${app.kind || "fullstack"}): ${app.title?.slice(0, 50) ?? ""}`,
    });

    if (!charge.ok) {
      return res.status(402).json({
        error: "Créditos insuficientes",
        required: cost,
        current: req.dbUser?.credits,
        isPaid,
        hint: isPaid
          ? `Reintentar esta app (${app.kind || "fullstack"}) cuesta ${cost} créditos en plan de pago.`
          : "Necesitas créditos para reintentar la generación.",
      });
    }

    const requestLocale = detectRequestLocale(req);
    const generationPrompt = `[MARIS AI REQUEST LOCALE] uiLanguage=${requestLocale.uiLanguage}; locale=${requestLocale.locale}; country=${requestLocale.country || "unknown"}; source=${requestLocale.source}. Use this for all user-visible copy unless the user explicitly asks for another language.\n${app.prompt}`;

    const jobId = new mongoose.Types.ObjectId().toString();
    await GenerationJob.create({
      _id: jobId,
      userId,
      prompt: app.prompt,
      editAppId: req.params.id,
      coderModel: app.coderModel || "auto",
      language: app.language || "typescript",
      kind: app.kind || "fullstack",
      status: "queued",
      phase: "queued",
      progress: 0,
      isAdmin,
    });

    await enqueueGenerateJob(jobId);
    runJobById(jobId).catch(err => logger.error({ err, jobId }, "Immediate job run error"));
    res.status(201).json({ id: jobId, creditsCost: cost, creditsRemaining: charge.newBalance });
  } catch (err) {
    logger.error({ err }, "POST /api/apps/:id/retry error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error interno" });
  }
});

// ── PUT /api/apps/:id/model ───────────────────────────────────────────────
router.put("/apps/:id/model", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: "model es requerido" });
    const updated = await GeneratedApp.findOneAndUpdate(
      { _id: req.params.id, userId },
      { coderModel: model },
      { new: true },
    );
    if (!updated) return res.status(404).json({ error: "App no encontrada" });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PUT /api/apps/:id/model error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── PUT /api/apps/:id/auto-publish ────────────────────────────────────────
router.put("/apps/:id/auto-publish", requireAuth, async (req: any, res: any) => {
  try {
    const userId = req.userId as string;
    const { enabled } = req.body;
    const updated = await GeneratedApp.findOneAndUpdate(
      { _id: req.params.id, userId },
      { autoPublish: !!enabled },
      { new: true },
    );
    if (!updated) return res.status(404).json({ error: "App no encontrada" });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PUT /api/apps/:id/auto-publish error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── GET /api/models ───────────────────────────────────────────────────────
router.get("/models", async (_req: any, res: any) => {
  try {
    const models = [
      { id: "auto", name: "Auto (9 agentes: básico → robusto)", provider: "maris", recommended: true },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (rápido / básico)", provider: "anthropic" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (equilibrado)", provider: "anthropic" },
      { id: "claude-opus-4-7", name: "Claude Opus 4.7 (robusto / máxima calidad)", provider: "anthropic" },
      { id: "gpt-5.4", name: "GPT-5.4 (frontend alternativo con fallback Claude)", provider: "openai" },
      { id: "claude-4-8-sonnet", name: "Compatibilidad: Claude 4.8 Sonnet → Sonnet 4.6", provider: "anthropic" },
      { id: "claude-mithos", name: "Compatibilidad: Claude Mithos → Sonnet 4.6", provider: "anthropic" },
      { id: "gemini-3", name: "Compatibilidad: Gemini 3 → Sonnet 4.6", provider: "anthropic" },
    ];
    res.json(models);
  } catch (err) {
    logger.error({ err }, "GET /api/models error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── GET /api/templates ────────────────────────────────────────────────────
router.get("/templates", async (_req: any, res: any) => {
  try {
    res.json(TEMPLATES);
  } catch (err) {
    logger.error({ err }, "GET /api/templates error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ── Exports requeridos por index.ts ───────────────────────────────────────
export async function reclaimOrphanedJobs(opts: { userId?: string } = {}): Promise<void> {
  await connectDB();
  const STALE_MS = 20 * 60 * 1000;
  const ZOMBIE_MS = 12 * 60 * 1000;
  const now = new Date();
  const staleDate = new Date(now.getTime() - STALE_MS);

  const orphanedQueued = await GenerationJob.find({
    status: "queued",
    updatedAt: { $lt: staleDate },
    ...(opts.userId ? { userId: opts.userId } : {}),
  });

  for (const job of orphanedQueued) {
    logger.info({ jobId: job._id }, "Re-enqueuing orphaned queued job");
    await enqueueGenerateJob(String(job._id));
  }

  // Auto-corregir jobs que completaron bien pero tienen status incorrecto
  // failed·done = completó correctamente, el jobQueue catch lo sobreescribió
  // failed·reviewing = completó pero el 422 de GitHub lo marcó como failed
  await GenerationJob.updateMany(
    { status: { $in: ["failed", "reviewing"] }, phase: "done" },
    { $set: { status: "succeeded", updatedAt: now } },
  );

  // Limpiar jobs atascados en "reviewing" más de 30 minutos — el cliente ya fue notificado
  const reviewingCutoff = new Date(now.getTime() - 30 * 60_000);
  await GenerationJob.updateMany(
    { status: "reviewing", updatedAt: { $lt: reviewingCutoff } },
    { $set: { status: "failed", errorMessage: "Solicitud procesada por el equipo de soporte. Puedes hacer una nueva generación." } },
  );

  const orphanedRunningJobs = await GenerationJob.find({
    status: "running",
    updatedAt: { $lt: staleDate },
    awaitingApproval: { $ne: true },
    ...(opts.userId ? { userId: opts.userId } : {}),
  });
  for (const job of orphanedRunningJobs) {
    logger.info({ jobId: job._id }, "Re-enqueuing orphaned running job");
    await GenerationJob.updateOne(
      { _id: job._id },
      { $set: { status: "queued", phase: "queued", updatedAt: now } },
    );
    await enqueueGenerateJob(String(job._id));
  }
  if (orphanedRunningJobs.length > 0) {
    logger.info({ count: orphanedRunningJobs.length }, "Re-enqueued stale running jobs");
  }

  // Detección de zombies: jobs running sin ningún log en los últimos 6 minutos
  // IMPORTANTE: usamos la fecha del último log, NO updatedAt del job
  // porque updatedAt se actualiza con el heartbeat pero el proceso puede estar colgado
  const sixMinAgo = new Date(now.getTime() - ZOMBIE_MS);
  const runningJobs = await GenerationJob.find({
    status: "running",
    createdAt: { $lt: sixMinAgo }, // solo jobs que llevan más de 6 min
    awaitingApproval: { $ne: true },
    ...(opts.userId ? { userId: opts.userId } : {}),
  }).lean();

  for (const job of runningJobs) {
    // Usar updatedAt del job (actualizado por el heartbeat silencioso cada 30s)
    // NO el último log — los heartbeats son silenciosos y no escriben logs
    const jobUpdatedAt = new Date((job as any).updatedAt || (job as any).createdAt).getTime();
    const jobAge = now.getTime() - jobUpdatedAt;

    if (jobAge > ZOMBIE_MS) {
      logger.warn({ jobId: job._id, jobAge }, "Zombie job detected — no activity for 6min, force re-queuing");
      await GenerationJob.updateOne(
        { _id: job._id },
        // NO resetear progress a 0 — mantener el último progreso conocido para que el cliente no vea retroceso
        { $set: { status: "queued", phase: "queued", updatedAt: now } },
      );
      await JobLog.create({
        jobId: String(job._id),
        agent: "watchdog",
        level: "warn",
        message: "⚠️ Job sin actividad detectado por el watchdog. Reiniciando automáticamente…",
      });
      await enqueueGenerateJob(String(job._id));
    }
  }
}

export async function runJobById(jobId: string): Promise<void> {
  await connectDB();
  const job = await GenerationJob.findById(jobId);
  if (!job) return;

  const log = async (agent: string, message: string, level: string = "info") => {
    await JobLog.create({ jobId, agent, message, level });
  };

  // Heartbeat inmediato — escribe el primer log antes de hacer cualquier cosa
  // para que el watchdog y el admin puedan ver que el job está vivo
  await log("system", `🚀 Job iniciado. Prompt: "${job.prompt.replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/, "").slice(0, 80)}…"`);

  // Heartbeat periódico — actualiza updatedAt cada 30s para que el watchdog
  // no lo marque como zombie mientras los agentes trabajan en silencio
  const heartbeatInterval = setInterval(async () => {
    try {
      await GenerationJob.findByIdAndUpdate(jobId, { $set: { updatedAt: new Date() } });
    } catch { /* swallow — never crash the pipeline */ }
  }, 30_000);

  const onProgress = async (p: GenerateProgress) => {
    await GenerationJob.findByIdAndUpdate(jobId, {
      $set: { phase: p.phase, progress: p.progress, updatedAt: new Date() },
    });
  };

  const onPartialCode = async (code: string) => {
    await GenerationJob.findByIdAndUpdate(jobId, {
      $set: { partialFrontendCode: code, updatedAt: new Date() },
    });
  };

  try {
    let previousApp: any = undefined;
    if (job.editAppId) {
      previousApp = await GeneratedApp.findById(job.editAppId).lean();
    }

    // Determinar si el usuario es FREE o PAID de forma robusta
    // 1. Campo hasEverPaid del job (nuevo)
    // 2. Campo hasEverPaid/isPremium del usuario en BD (fuente de verdad)
    // 3. Si tiene apps previas generadas → ya no es cuenta nueva
    // 4. isAdmin siempre tiene acceso completo
    let hasEverPaid = !!(job as any).hasEverPaid || !!(job as any).isAdmin;
    if (!hasEverPaid) {
      try {
        const dbUser = await User.findById(job.userId).lean() as any;
        if (dbUser?.hasEverPaid || dbUser?.isPremium || (dbUser?.plan && dbUser?.plan !== "free")) {
          hasEverPaid = true;
        }
        // Admin emails siempre tienen acceso completo
        if (!hasEverPaid && dbUser?.email && isAdminEmail(dbUser.email)) {
          hasEverPaid = true;
        }
        // Si tiene apps previas, no tratarlo como cuenta nueva
        if (!hasEverPaid) {
          const appCount = await GeneratedApp.countDocuments({ userId: job.userId });
          if (appCount > 1) hasEverPaid = true; // >1 porque esta misma generación puede contar
        }
      } catch { /* si falla la consulta, usar el valor del job */ }
    }

    // Cargar adjuntos del job desde la BD y convertirlos a AttachmentContext
    let jobAttachments: AttachmentContext[] = [];
    try {
      const attachmentIds = (job as any).attachmentIds ?? [];
      if (attachmentIds.length > 0) {
        const rows = await ChatAttachment.find({ _id: { $in: attachmentIds } }).lean() as any[];
        jobAttachments = rows.map((row: any) => ({
          id: row._id,
          filename: row.filename,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          textContent: row.mimeType.startsWith("text/") || row.mimeType === "application/json"
            ? Buffer.from(row.dataBase64, "base64").toString("utf8").slice(0, 30000)
            : undefined,
          // Para imágenes: pasar base64 para que Claude pueda verlas directamente
          dataBase64: row.mimeType.startsWith("image/") ? row.dataBase64 : undefined,
        }));
        if (jobAttachments.length > 0) {
          await log("system", `📎 ${jobAttachments.length} archivo(s) adjunto(s) cargado(s): ${jobAttachments.map((a: any) => a.filename).join(", ")}`);
        }
      }
    } catch (attachErr) {
      logger.warn({ attachErr, jobId }, "Error cargando adjuntos — continuando sin ellos");
    }

    // ── AGENT MEMORY — cargar preferencias del usuario antes de generar ──────
    let jobAgentMemory: import("../lib/agentMemoryContext").AgentMemoryContext | undefined;
    try {
      const { loadAgentMemory } = await import("../lib/agentMemoryContext");
      const editAppId = (job as any).editAppId ? String((job as any).editAppId) : undefined;
      jobAgentMemory = await loadAgentMemory(job.userId, editAppId);
      if (jobAgentMemory.userPreferences) {
        await log("system", `🧠 Preferencias del usuario cargadas — personalizando generación…`);
      }
    } catch (memErr) {
      logger.warn({ memErr, jobId }, "Error cargando agent memory — continuando sin ella");
    }

    // ── RAG — buscar apps similares del usuario para reutilizar componentes ──
    let ragContextBlock = "";
    if (!job.editAppId) { // Solo en generaciones nuevas, no en ediciones
      try {
        const { findSimilarApps, buildRAGContextBlock } = await import("../lib/ragApps");
        const cleanForRag = (job.prompt || "").replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "").trim();
        const similar = await findSimilarApps(job.userId, cleanForRag, 2);
        if (similar.length > 0) {
          ragContextBlock = buildRAGContextBlock(similar);
          await log("system", `🔍 ${similar.length} app(s) similar(es) encontrada(s) — reutilizando patrones…`);
        }
      } catch (ragErr) {
        logger.warn({ ragErr, jobId }, "RAG lookup failed — continuing without context");
      }
    }

    // ── A/B TESTING — seleccionar variante de system prompt óptima ───────────
    let abVariantId = "default";
    let abPromptModifier = "";
    try {
      const { selectPromptVariant } = await import("../lib/promptABTesting");
      const ab = await selectPromptVariant(job.kind || "fullstack");
      abVariantId = ab.variantId;
      abPromptModifier = ab.modifier;
    } catch { /* no bloquear */ }

    // Enriquecer el prompt con RAG + A/B modifier
    const enrichedJobPrompt = job.prompt +
      (ragContextBlock ? `\n\n${ragContextBlock}` : "") +
      abPromptModifier;

    const result = await generateApp(
      enrichedJobPrompt, // ← Prompt enriquecido con RAG + A/B testing
      onProgress,
      previousApp,
      job.coderModel,
      (job.language as any) || "typescript",
      log,
      jobAttachments,
      undefined,
      jobAgentMemory,  // ← Memoria del usuario para personalizar generación
      {
        kind: job.kind,
        detectedLocale: extractPromptContext(job.prompt, "locale"),
        detectedCountry: extractPromptContext(job.prompt, "country"),
        uiLanguage: extractPromptContext(job.prompt, "uiLanguage"),
        hasEverPaid,
      },
      jobId,
    );

    if ((result as any).phase?.startsWith("awaiting_")) {
      const checkpoint = result as any;
      await GenerationJob.findByIdAndUpdate(jobId, {
        $set: {
          status: "awaiting_approval",
          phase: checkpoint.phase,
          awaitingApproval: true,
          checkpointData: checkpoint,
          updatedAt: new Date(),
        },
      });
      await log("system", "⏸️ Generación pausada: esperando aprobación del usuario.");
      return;
    }

    const finalResult = result as any;

    if (job.editAppId) {
      await GeneratedApp.findByIdAndUpdate(job.editAppId, {
        $set: {
          title: finalResult.title,
          description: finalResult.description,
          techStack: finalResult.techStack,
          frontendCode: finalResult.frontendCode,
          backendCode: finalResult.backendCode,
          plannedPages: finalResult.plannedPages || [],
          requiredEnvVars: finalResult.requiredEnvVars || [],
          status: "ready",
        },
      });
      await AppMessage.create({
        appId: job.editAppId,
        role: "assistant",
        content: await buildAppUpdatedConsoleReply({
          prompt: job.prompt,
          result: finalResult,
          appTitle: previousApp?.title,
        }),
      });

      // ── Corrección de soporte admin: marcar parche inmutable + notificar cliente ──
      if ((job as any).isAdmin) {
        const patchNote = (job.prompt || "").replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "").replace(/\[ADMIN REPAIR\]/i, "").trim().slice(0, 200);
        await GeneratedApp.findByIdAndUpdate(job.editAppId, {
          $set: {
            adminPatchedAt: new Date(),
            adminPatchNote: patchNote,
          },
        });
        const appTitle = finalResult.title || previousApp?.title || "Tu app";
        await UserNotification.create({
          userId: job.userId,
          appId: String(job.editAppId),
          appTitle,
          type: "support_patch",
          message: `✅ Tu app **${appTitle}** ha sido actualizada por el equipo de soporte y ya está lista. Puedes verla y continuar editándola desde tu panel. Como compensación por las molestias, hemos añadido **10 créditos** a tu cuenta. Si encuentras algún problema adicional o tienes algún error más complejo, no dudes en contactarnos abriendo un **ticket de soporte** — estaremos encantados de ayudarte. 💜`,
          read: false,
        });
        // Compensación: 10 créditos + email de disculpas al cliente
        try {
          await User.findByIdAndUpdate(job.userId, { $inc: { credits: 10 } });
          await CreditTransaction.create({
            userId: job.userId,
            kind: "refund",
            amount: 10,
            description: "Compensación por incidencia — corrección aplicada por el equipo de soporte",
          });
          await log("system", "🎁 10 créditos de compensación añadidos al cliente.");

          // Email de disculpas automático
          const dbUser = await User.findById(job.userId).lean() as any;
          if (dbUser?.email) {
            const { sendApologyEmail } = await import("../lib/notify");
            await sendApologyEmail({
              userEmail: dbUser.email,
              userName: dbUser.fullName || undefined,
              appTitle,
              dashboardUrl: "https://www.marisai.es/dashboard",
              creditsCompensation: 10,
            });
            await log("system", `📧 Email de disculpas enviado a ${dbUser.email}`);
          }
        } catch (e) { logger.warn({ e }, "Error en compensación/email post-corrección"); }
        await log("system", `✅ Corrección de soporte aplicada correctamente. El cliente ha sido notificado.`);
      }

      // GitHub push eliminado — solo se sube a GitHub cuando el usuario lo solicita explícitamente
      // desde el botón "Subir a GitHub" en su panel de apps
    } else {
      // ── INTEGRIDAD DEL BUNDLE — detectar archivos truncados antes de guardar ──
      if (finalResult.frontendCode) {
        const truncatedFiles = detectTruncatedFiles(finalResult.frontendCode);
        if (truncatedFiles.length > 0) {
          await log("coder", `⚠️ ${truncatedFiles.length} archivo(s) truncado(s) detectado(s): ${truncatedFiles.join(", ")} — lanzando repair automático…`, "warn");
          // Marcar para que el repair agent lo arregle después de guardar
          (finalResult as any)._hasTruncatedFiles = true;
          (finalResult as any)._truncatedFiles = truncatedFiles;
        }
      }

      const app = await GeneratedApp.create({
        userId: job.userId,
        title: finalResult.title,
        prompt: job.prompt,
        description: finalResult.description,
        techStack: finalResult.techStack,
        frontendCode: finalResult.frontendCode,
        backendCode: finalResult.backendCode,
        plannedPages: finalResult.plannedPages || [],
        requiredEnvVars: finalResult.requiredEnvVars || [],
        language: job.language,
        kind: job.kind,
        status: "ready",
        publicSlug: makeSlug(),
        // ID Universal Maris AI — vinculado al usuario propietario
        // Formato: APP-USR001-001 (usuario 001, primera app de ese usuario)
        marisId: await (async () => {
          try {
            const owner = await User.findById(job.userId).lean() as any;
            const userMarisId = owner?.marisId ?? MarisId.user();
            return await generateAppId(userMarisId);
          } catch { return MarisId.project(MarisId.user()); }
        })(),
      });
      await GenerationJob.findByIdAndUpdate(jobId, { $set: { appId: String(app._id) } });

      // Mensaje de upgrade para usuarios free
      if (!(job as any).hasEverPaid && !(job as any).isAdmin) {
        await log("system", "🎉 ¡Tu app de demostración está lista! Para crear proyectos más grandes con backend, base de datos y más páginas, activa un plan desde la sección de precios.");
      }
    }

    // ════════════════════════════════════════════════════════════════
    // POST-GENERACIÓN: Image Agent + Visual Tester + Quality Check
    // ════════════════════════════════════════════════════════════════
    const savedAppId = job.editAppId || (await GenerationJob.findById(jobId).select("appId").lean() as any)?.appId;

    // ── 1. IMAGE AGENT — reemplaza placeholders Unsplash con imágenes reales ─
    if (savedAppId && finalResult?.frontendCode && process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
      try {
        await log("system", "🎨 Generando imágenes reales para tu app…");
        const { generateAppImages } = await import("../lib/imageAgent");
        const imgResult = await generateAppImages(savedAppId as any);
        if (imgResult.generated > 0) {
          await log("system", `✅ ${imgResult.generated} imagen(es) generada(s) y aplicadas en la app.`);
        }
      } catch (imgErr) {
        logger.warn({ imgErr, jobId }, "Image agent failed — continuing with placeholders");
      }
    }

    // ── 2. QUALITY CHECK — evaluación de calidad con IA ──────────────────────
    // NUNCA ejecutar en jobs de reparación automática — evita bucle infinito
    const isAutoRepairJob = (job.prompt || "").includes("[ADMIN REPAIR]") || (job as any).autoFixedFromJobId;
    if (savedAppId && finalResult?.frontendCode && finalResult.frontendCode.length > 1000 && !isAutoRepairJob) {
      try {
        const { evaluateJobQuality } = await import("../lib/aiAutopilot");
        const qeval = await evaluateJobQuality(jobId, String(savedAppId), finalResult.frontendCode, job.prompt || "");
        if (!qeval.pass) {
          await log("system", `⚠️ Calidad insuficiente (score: ${qeval.score}/100). Lanzando corrección automática…`);
          const patchPrompt = `[ADMIN REPAIR] La app generada tiene problemas de calidad: ${qeval.issues.slice(0, 3).join(", ")}. Corrígelos sin modificar lo que ya funciona. Prompt original: ${(job.prompt || "").slice(0, 200)}`;
          const patchJobId = new (await import("mongoose")).default.Types.ObjectId().toString();
          await GenerationJob.create({
            _id: patchJobId, userId: job.userId,
            prompt: `[MARIS AI REQUEST LOCALE] uiLanguage=es; locale=es-ES; country=ES; source=autopilot-quality. ${patchPrompt}`,
            editAppId: String(savedAppId), coderModel: "claude-sonnet-4-6",
            language: job.language || "typescript", kind: "edit",
            status: "queued", phase: "queued", progress: 0,
            isAdmin: true, hasEverPaid: true, autoFixedFromJobId: jobId,
          });
          await enqueueGenerateJob(patchJobId);
        } else {
          await log("system", `✅ Calidad aprobada (score: ${qeval.score}/100)`);
        }
      } catch { /* nunca bloquear el succeeded */ }
    }

    // ── 3. VISUAL TESTER — screenshot + Claude Vision (solo apps desplegadas) ─
    // Solo corre si la app tiene un publicSlug (está accesible como URL pública)
    if (savedAppId && !!(job as any).autoPublish) {
      try {
        const freshApp = await GeneratedApp.findById(savedAppId).select("publicSlug userId").lean() as any;
        if (freshApp?.publicSlug) {
          const baseUrl = process.env.MARIS_AI_PUBLIC_URL || "https://www.marisai.es";
          const { runAutoEvaluator } = await import("../lib/evaluator");
          const dbUser = await User.findById(job.userId).lean() as any;
          await log("system", "🔍 Evaluador visual analizando tu app con Puppeteer + IA…");
          runAutoEvaluator({
            appId: savedAppId,
            userId: job.userId,
            userIntent: (job.prompt || "").replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "").slice(0, 300),
            jobId: jobId as any,
            baseUrl,
            log: logger,
          }).catch(evalErr => logger.warn({ evalErr, jobId }, "Auto evaluator failed — app still ready"));
        }
      } catch (evalErr) {
        logger.warn({ evalErr }, "Visual tester hook failed");
      }
    }

    // ── A/B TESTING — registrar resultado para mejorar futuros prompts ────────
    try {
      const { recordVariantResult } = await import("../lib/promptABTesting");
      const finalScore = typeof (finalResult as any)?.qualityScore === "number"
        ? (finalResult as any).qualityScore : 80;
      await recordVariantResult(abVariantId, true, finalScore);
    } catch { /* nunca bloquear */ }

    await GenerationJob.findByIdAndUpdate(jobId, {
      $set: { status: "succeeded", phase: "done", progress: 100, updatedAt: new Date() },
    });
    if ((job as any).isAutoRepair && job.editAppId) {
      await AppMessage.create({
        appId: job.editAppId,
        role: "assistant",
        content: "¡Listo! He solucionado el problema — la vista previa de tu app ya está disponible. 🎉",
      }).catch(() => {});
    }
    clearInterval(heartbeatInterval);
  } catch (err) {
    clearInterval(heartbeatInterval);
    logger.error({ err, jobId }, "runJobById: Generation failed");
    const rawMessage = err instanceof Error ? err.message : "Error desconocido";
    
    // Mensaje amigable para el usuario cuando los créditos de API se agotan
    const isCreditsError = rawMessage.includes("API_CREDITS_EXHAUSTED");
    const errorMessage = isCreditsError
      ? "Las generaciones están temporalmente en pausa por mantenimiento del sistema. Tu créditos NO han sido consumidos. Inténtalo de nuevo en unos minutos."
      : rawMessage;
    
    await GenerationJob.findByIdAndUpdate(jobId, {
      $set: {
        status: isCreditsError ? "reviewing" : "failed",
        phase: isCreditsError ? "reviewing" : "failed",
        errorMessage,
        updatedAt: new Date(),
      },
    });
    await log("system", isCreditsError 
      ? "⏸️ Generación pausada temporalmente por mantenimiento del sistema. Tus créditos están seguros. Reintentaremos automáticamente." 
      : `Error: ${errorMessage}`, "error");

    if ((job as any).isAutoRepair && job.editAppId && !isCreditsError) {
      await AppMessage.create({
        appId: job.editAppId,
        role: "assistant",
        content: "He intentado solucionar el problema de la vista previa, pero necesito más información. ¿Qué ves exactamente en la vista previa (pantalla en blanco, un mensaje de error concreto…)? Dime si quieres que repare, modifique, elimine o añada algo y sigo desde ahí.",
      }).catch(() => {});
    }

    // Auto-diagnóstico IA — intenta corregir automáticamente
    try {
      const { autoDiagnoseFailedJob } = await import("../lib/aiAutopilot");
      autoDiagnoseFailedJob(jobId).catch(() => {}); // fire-and-forget
    } catch { /* nunca crashear el pipeline */ }

    // Notificar al admin si el job ha fallado varias veces
    try {
      const { notifyAdminJobFailed } = await import("../lib/notify");
      const dbUser = await User.findById(job.userId).lean() as any;
      const retryCount = (job as any).retryCount ?? 0;
      await notifyAdminJobFailed({
        userEmail: dbUser?.email || job.userId,
        userId: job.userId,
        jobId,
        appId: (job as any).appId || undefined,
        prompt: job.prompt || "",
        errorMessage,
        retryCount,
      });
    } catch { /* nunca crashear el pipeline por un fallo en la notificación */ }
  }
}


/**
 * runDeployForApp - Wrapper for deployAppToVercel used by the auto-evaluator.
 * Exported so evaluator.ts can call it via lazy import to avoid circular deps.
 */
export async function runDeployForApp(args: {
  appId: string;
  userId: string;
  log: import("pino").Logger;
}): Promise<{ url: string; slug: string }> {
  const { deployAppToVercel } = await import("../lib/vercelDeploy");
  const result = await deployAppToVercel(args);
  if (!result.ok) {
    throw new Error(`Deploy failed: ${JSON.stringify(result.failure)}`);
  }
  return {
    url: result.result.url,
    slug: (result.result as any).slug ?? "",
  };
}


// ── NOTIFICACIONES DE SOPORTE — el cliente lee sus avisos de corrección ──────
// GET /api/notifications — devuelve notificaciones no leídas del usuario autenticado
router.get("/notifications", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const userId = req.auth?.userId;
    const notifs = await UserNotification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json({ notifications: notifs });
  } catch (err) {
    res.status(500).json({ error: "Error cargando notificaciones" });
  }
});

// PATCH /api/notifications/:id/read — marcar como leída
router.patch("/notifications/:id/read", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const userId = req.auth?.userId;
    await UserNotification.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { read: true } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error actualizando notificación" });
  }
});

// PATCH /api/notifications/read-all — marcar todas como leídas
router.patch("/notifications/read-all", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const userId = req.auth?.userId;
    await UserNotification.updateMany({ userId, read: false }, { $set: { read: true } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error actualizando notificaciones" });
  }
});

// ── SSE STREAMING — código en tiempo real mientras se genera ────────────────
// GET /api/apps/:id/stream-code
// Emite eventos SSE con el código parcial generado en tiempo real
// El cliente puede mostrar el código apareciendo archivo por archivo
router.get("/apps/:id/stream-code", requireAuth, async (req: any, res: any) => {
  const userId = req.userId as string;
  const appId = req.params.id;

  // Verificar que la app pertenece al usuario
  const app = await GeneratedApp.findOne({ _id: appId, userId }, { _id: 1 }).lean();
  if (!app) { res.status(404).json({ error: "App no encontrada" }); return; }

  // Headers SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Buscar el job activo para esta app
  let lastCode = "";
  let lastJobId = "";
  let ticks = 0;
  const MAX_TICKS = 120; // 2 min máx

  const interval = setInterval(async () => {
    ticks++;
    if (ticks > MAX_TICKS) {
      send("done", { reason: "timeout" });
      clearInterval(interval);
      res.end();
      return;
    }

    try {
      // Buscar job activo para esta app
      const activeJob = await GenerationJob.findOne({
        $or: [{ appId }, { editAppId: appId }],
        status: { $in: ["running", "queued"] },
      }).select("_id partialFrontendCode phase progress").lean() as any;

      if (!activeJob) {
        // No hay job activo — app completada
        const finalApp = await GeneratedApp.findById(appId).select("frontendCode").lean() as any;
        if (finalApp?.frontendCode && finalApp.frontendCode !== lastCode) {
          send("complete", {
            code: finalApp.frontendCode.slice(0, 50000), // Limitar tamaño
            files: extractFileList(finalApp.frontendCode),
          });
        }
        send("done", { reason: "completed" });
        clearInterval(interval);
        res.end();
        return;
      }

      // Hay job activo — emitir progreso parcial
      if (activeJob._id !== lastJobId) lastJobId = String(activeJob._id);

      const partialCode = activeJob.partialFrontendCode || "";
      if (partialCode && partialCode !== lastCode && partialCode.length > lastCode.length) {
        lastCode = partialCode;
        const files = extractFileList(partialCode);
        send("partial", {
          phase: activeJob.phase,
          progress: activeJob.progress,
          files,
          latestFile: files[files.length - 1] || null,
          totalSize: Math.round(partialCode.length / 1024),
        });
      } else {
        // Solo emitir progreso si cambió
        send("progress", { phase: activeJob.phase, progress: activeJob.progress });
      }
    } catch (err) {
      logger.warn({ err }, "SSE stream-code error");
    }
  }, 1000);

  // Cleanup al desconectar
  req.on("close", () => {
    clearInterval(interval);
  });
});

function extractFileList(bundle: string): string[] {
  const matches = bundle.match(/\/\/ === FILE: ([^=\n]+) ===/g) || [];
  return matches.map(m => m.replace("// === FILE: ", "").replace(" ===", "").trim()).slice(0, 30);
}

// ── PREVIEW ENDPOINT — sirve el bundle HTML directamente ──────────────
// ── Sirve archivos individuales del bundle (CSS, assets) ─────────────────────
// GET /api/apps/:id/styles/:file  (ej: animations.css)
// GET /api/apps/:id/assets/:file
router.get("/apps/:id/styles/:file", async (req: any, res: any) => {
  try {
    await connectDB();
    const app = await GeneratedApp.findById(req.params.id).select("frontendCode").lean() as any;
    if (!app?.frontendCode) return res.status(404).type("text/css").send("/* not found */");

    const filename = req.params.file;
    const files: Record<string, string> = {};
    const parts = (app.frontendCode as string).split(/\/\/ === FILE: /);
    for (const part of parts) {
      if (!part.trim()) continue;
      const nl = part.indexOf("\n");
      if (nl === -1) continue;
      const p = part.slice(0, nl).trim().replace(/ ===$/, "");
      if (p) files[p] = part.slice(nl + 1);
    }

    // Buscar el archivo por nombre exacto o por path parcial
    const cssContent = files[`src/styles/${filename}`]
      || files[`styles/${filename}`]
      || files[filename]
      || Object.entries(files).find(([k]) => k.endsWith(`/${filename}`) || k.endsWith(filename))?.[1]
      || "";

    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.send(cssContent || `/* ${filename} not found in bundle */`);
  } catch (err) {
    res.status(500).type("text/css").send("/* error */");
  }
});

// GET /api/apps/:id/preview-debug — diagnóstico del preview
router.get("/apps/:id/preview-debug", async (req: any, res: any) => {
  try {
    await connectDB();
    const app = await GeneratedApp.findById(req.params.id).select("frontendCode title kind").lean() as any;
    if (!app?.frontendCode) return res.status(404).json({ error: "App no encontrada" });

    const bundleSize = app.frontendCode.length;
    const files: string[] = [];
    const parts = (app.frontendCode as string).split(/\/\/ === FILE: /);
    for (const part of parts) {
      if (!part.trim()) continue;
      const nl = part.indexOf("\n");
      if (nl === -1) continue;
      const p = part.slice(0, nl).trim().replace(/ ===$/, "");
      if (p) files.push(p);
    }

    let esbuildError = null;
    try {
      const { buildDeployHtml } = await import("../lib/deployBundle");
      await buildDeployHtml({ bundle: app.frontendCode, title: app.title || "Preview" });
    } catch (err: any) {
      esbuildError = err?.message || String(err);
    }

    res.json({
      appId: req.params.id,
      title: app.title,
      kind: app.kind,
      bundleSize,
      files,
      hasMainTsx: files.some(f => f.includes("main.tsx") || f.includes("main.jsx")),
      hasAppTsx: files.some(f => f.includes("App.tsx") || f.includes("App.jsx")),
      esbuildError,
      esbuildOk: !esbuildError,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/apps/:id/preview", async (req: any, res: any) => {
  try {
    await connectDB();
    const app = await GeneratedApp.findById(req.params.id).select("frontendCode title").lean() as any;
    if (!app?.frontendCode) return res.status(404).send("<h1>App no encontrada</h1>");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", "frame-ancestors *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; connect-src *; img-src * data: blob:; font-src *");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Intentar buildDeployHtml con esbuild (mejor calidad)
    try {
      const { buildDeployHtml } = await import("../lib/deployBundle");
      const html = await buildDeployHtml({ bundle: app.frontendCode, title: app.title || "Preview" });
      // Parchear la CSP del HTML generado para permitir esm.sh en iframe
      const patched = html.replace(
        /Content-Security-Policy[^<]*/g, ""
      );
      return res.send(patched);
    } catch (esbuildErr: any) {
      const errMsg = esbuildErr?.message || String(esbuildErr);
      logger.warn({ err: errMsg, appId: req.params.id }, "esbuild failed, using Babel fallback");
      res.setHeader("X-Preview-Mode", "babel-fallback");
      res.setHeader("X-Preview-Error", errMsg.slice(0, 200));
      // Si el error es de CSS import, intentar de nuevo sin CSS
      if (errMsg.includes("CSS") || errMsg.includes("css")) {
        try {
          const { buildDeployHtml } = await import("../lib/deployBundle");
          const bundleNoCss = (app.frontendCode as string).replace(/^import\s+['"][^'"]*\.css['"]\s*;?\s*$/gm, "// css removed");
          const html = await buildDeployHtml({ bundle: bundleNoCss, title: app.title || "Preview" });
          return res.send(html);
        } catch (e2) {
          logger.warn({ err: (e2 as any)?.message }, "esbuild retry without CSS also failed");
        }
      }
    }

    // Extraer archivos del bundle
    const files: Record<string, string> = {};
    const parts2 = (app.frontendCode as string).split(/\/\/ === FILE: /);
    for (const part of parts2) {
      if (!part.trim()) continue;
      const nl = part.indexOf("\n");
      if (nl === -1) continue;
      const p = part.slice(0, nl).trim().replace(/ ===$/, "");
      if (p) files[p] = part.slice(nl + 1);
    }

    // Si hay index.html completo, servirlo
    const rawHtml = files["index.html"] || files["public/index.html"];
    if (rawHtml && rawHtml.includes("<html")) return res.send(rawHtml);

    // Fallback con Babel — renderiza TSX en navegador limpiando imports externos
    const appCode = files["src/App.tsx"] || files["src/App.jsx"] || files["src/App.js"] || "";
    const mainCode = files["src/main.tsx"] || files["src/main.jsx"] || "";
    const cssCode = files["src/index.css"] || files["src/App.css"] || "";
    const appSizeKb = Math.round((app.frontendCode as string).length / 1024);
    const title = (app.title || "App").replace(/[<>"&]/g, "");

    // Limpiar imports externos — Babel en browser no puede resolverlos
    const cleanForBabel = (code: string) => code
      .replace(/^import\s+.*?\s+from\s+['"][^.\/][^'"]*['"]\s*;?\s*$/gm, "/* import externo eliminado */")
      .replace(/^import\s+['"][^.\/][^'"]*['"]\s*;?\s*$/gm, "/* import side-effect eliminado */")
      .replace(/^export\s+default\s+function\s+(\w+)/m, "function $1 /* default */")
      .replace(/^export\s+default\s+class\s+(\w+)/m, "class $1 /* default */")
      .replace(/^export\s+default\s+/m, "const __DefaultExport = ")
      .replace(/^export\s+\{[^}]+\}\s*;?\s*$/gm, "")
      .replace(/^export\s+(const|let|var|function|class|type|interface)\s+/gm, "$1 ");

    const cleanApp = cleanForBabel(appCode);
    const componentName = (appCode.match(/(?:function|class|const)\s+(App\w*)/)?.[1]) || "App";

    const fallback = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box}
body{font-family:'Inter',sans-serif;min-height:100vh;margin:0}
${cssCode}
</style>
</head>
<body>
<div id="root"></div>
<script>
/* Polyfills React hooks globals */
const {useState,useEffect,useRef,useCallback,useMemo,useContext,useReducer,useLayoutEffect,useId,useTransition,useDeferredValue,forwardRef,createContext,memo,Fragment,lazy,Suspense} = React;
/* Stubs para dependencias externas comunes */
const clsx = (...a) => a.flat().filter(Boolean).join(' ');
const cn = clsx;
const classNames = clsx;
/* lucide-react stub */
const LucideIcon = ({size=24,color='currentColor',...p}) => React.createElement('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:color,strokeWidth:2,...p});
window.lucideReact = new Proxy({default:LucideIcon},{get:(_,k)=>k==='default'?LucideIcon:LucideIcon});
/* recharts stub */
window.recharts = new Proxy({},{get:(_,k)=>()=>null});
/* framer-motion stub */
window.motion = {div:'div',span:'span',button:'button',section:'section',p:'p',h1:'h1',h2:'h2',h3:'h3',ul:'ul',li:'li'};
window.AnimatePresence = ({children})=>children;
</script>
<script type="text/babel" data-presets="react,typescript">
const {useState,useEffect,useRef,useCallback,useMemo,useContext,useReducer,forwardRef,createContext,memo,Fragment} = React;
const clsx = (...a) => a.flat().filter(Boolean).join(' ');
const cn = clsx;

${cleanApp}

/* Detectar y renderizar el componente principal */
const __toRender = (
  typeof ${componentName} !== 'undefined' ? ${componentName} :
  typeof App !== 'undefined' ? App :
  typeof __DefaultExport !== 'undefined' ? __DefaultExport :
  () => React.createElement('div',{style:{padding:'2rem',maxWidth:'600px',margin:'4rem auto',fontFamily:'Inter,sans-serif'}},
    React.createElement('h1',{style:{fontSize:'1.75rem',fontWeight:'700',marginBottom:'1rem'}},'${title}'),
    React.createElement('p',{style:{color:'#6B7280',marginBottom:'1.5rem'}},'App de ${appSizeKb}KB generada correctamente.'),
    React.createElement('div',{style:{background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:'8px',padding:'1rem',color:'#1D4ED8',fontSize:'0.9rem'}},
      'Para ver la app completa despliégala desde el panel con el botón Deploy.'
    )
  )
);

try {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(__toRender));
} catch(e) {
  document.getElementById('root').innerHTML = '<div style="padding:2rem;font-family:Inter,sans-serif"><h2 style="color:#E63946">Error renderizando preview</h2><pre style="margin-top:1rem;font-size:12px;color:#666;white-space:pre-wrap">'+e.message+'</pre><p style="margin-top:1rem;color:#666">La app se generó correctamente. Despliégala para verla completa.</p></div>';
}
</script>
</body>
</html>`;

    return res.send(fallback);
  } catch (err) {
    logger.error({ err }, "Preview error");
    res.status(500).send("<h1>Error cargando preview</h1>");
  }
});

export default router;
