import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getOpenAI } from "./openai";

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

const FRONTEND_SYSTEM_PROMPT = `You are AppForge's Frontend Engineer. Generate a complete, production-quality React frontend as STRICT JSON only.

Schema:
{"frontendCode":"all frontend files as one string"}

Use '// === FILE: <path> ===' to separate files inside frontendCode. ALWAYS include:
- index.html, package.json, vite.config.ts, tsconfig.json, tailwind.config.ts, postcss.config.js
- src/main.tsx, src/App.tsx, src/index.css
- src/pages/<Name>.tsx for every page in the plan
- src/components/<Name>.tsx for every component in the plan
- src/lib/<name>.ts for every util in the plan (cn helper, formatters, etc.)
- src/hooks/<name>.ts for every hook in the plan
- src/types/index.ts when types are shared

Stack: React 18 + TypeScript + Tailwind v3 + wouter (if multi-page) + lucide-react icons. Apply the provided design system EXACTLY (colors, fonts, spacing) via the Tailwind config and global CSS.

Rules:
- Real working code. No TODOs, no stubs, no lorem ipsum. Every page renders meaningful content.
- Use the file list from the plan as the MINIMUM — split UI into the listed files, do not collapse them into App.tsx.
- Polished layout, real copy in the user's language, accessible markup.
- Combined output must stay under 70 KB. Trim seed data before truncating files.
- Close every quote, brace and bracket. Output ONLY the JSON object.`;

const BACKEND_SYSTEM_PROMPT = `You are AppForge's Backend Engineer. Generate a complete, production-quality Node/Express backend as STRICT JSON only.

Schema:
{"backendCode":"all backend files as one string OR 'No backend required for this app.'"}

Use '// === FILE: <path> ===' to separate files. When a backend is needed include:
- package.json, tsconfig.json, src/index.ts (express bootstrap), src/routes/<name>.ts (one per resource), src/db/schema.ts (drizzle), src/lib/<name>.ts as needed.

Stack: Node 20 + Express 5 + TypeScript + Drizzle ORM + PostgreSQL. Use zod for input validation. Real working handlers, no stubs.

If the plan says no backend, return exactly: {"backendCode":"No backend required for this app."}

Rules:
- Combined output under 35 KB.
- Close every brace and quote. Output ONLY the JSON object.`;

const ARCHITECT_SYSTEM_PROMPT = `You are AppForge's Architect. You design the file structure for a web app the team will build.

Output STRICT JSON only matching this schema:
{
  "title": "2-4 word product name",
  "description": "1-2 sentence pitch",
  "techStack": ["React","TypeScript","Tailwind", ...],
  "pages": [{"name":"Home","route":"/","purpose":"…"}],
  "components": [{"name":"Hero","purpose":"…"}],
  "hooks": [{"name":"useFoo","purpose":"…"}],
  "utils": [{"name":"formatPrice","purpose":"…"}],
  "dataModels": [{"name":"Product","fields":["id","name","price"]}],
  "frontendFiles": ["src/pages/Home.tsx", "src/components/Hero.tsx", ...],
  "backendNeeded": false,
  "backendFiles": []
}

Rules:
- Aim for 8-15 frontend files total (pages + components + hooks + utils). NEVER collapse into one file.
- Set backendNeeded=true ONLY if the app genuinely needs persistence/auth/payments/AI/server-side logic. Pure marketing sites, calculators, single-user tools = false.
- techStack: 4-7 entries.
- Output ONLY the JSON object.`;

const DESIGNER_SYSTEM_PROMPT = `You are AppForge's UI/UX Designer. Produce a tight design system as STRICT JSON only.

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
- Keep tailwindExtend small and valid JSON.
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

const PATCHER_SYSTEM_PROMPT = `You are AppForge's Patcher. Apply ONLY the listed fixes to the frontend bundle. Preserve everything else exactly.

Output STRICT JSON only:
{"frontendCode":"all frontend files as one string"}

Rules:
- Use '// === FILE: <path> ===' separators.
- Return the FULL bundle (every file, not just patched ones).
- Don't introduce new bugs. Don't remove existing files unless the fix explicitly says so.
- Combined output under 70 KB. Close every brace and quote. Output ONLY the JSON object.`;

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
    max_tokens: 2000,
    system: ARCHITECT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Architect returned no text.");
  const plan = extractJsonObject<ProjectPlan>(text.text);
  if (!plan || !plan.title || !Array.isArray(plan.frontendFiles)) {
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
    const response = await withTimeoutOrThrow(
      getOpenAI().chat.completions.create({
        model: "gpt-5-mini",
        max_completion_tokens: 1500,
        messages: [
          { role: "system", content: DESIGNER_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
      45_000,
      "designer",
    );
    raw = response.choices[0]?.message?.content ?? "";
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

async function generateFrontendCode(
  plan: ProjectPlan,
  design: DesignSystem,
  research: string,
  prompt: string,
  onChars: (chars: number) => void,
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

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 30000,
    system: FRONTEND_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  let accumulated = "";
  let lastReport = 0;
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      accumulated += event.delta.text;
      if (accumulated.length - lastReport >= 1500) {
        lastReport = accumulated.length;
        onChars(accumulated.length);
      }
    }
  }
  const final = await stream.finalMessage();
  const truncated = final.stop_reason === "max_tokens";
  let raw = accumulated.trim();
  if (!raw) {
    const t = final.content.find((b) => b.type === "text");
    if (!t || t.type !== "text") return { code: "", truncated, error: "Frontend agent returned no text." };
    raw = t.text.trim();
  }
  const parsed = extractJsonObject<{ frontendCode?: string }>(raw);
  if (!parsed || typeof parsed.frontendCode !== "string") {
    return { code: "", truncated, error: "JSON inválido del Frontend Engineer." };
  }
  return { code: parsed.frontendCode, truncated: false };
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
    const response = await withTimeoutOrThrow(
      getOpenAI().chat.completions.create({
        model: "gpt-5-mini",
        max_completion_tokens: 8000,
        messages: [
          { role: "system", content: BACKEND_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
      90_000,
      "backend-engineer",
    );
    const raw = response.choices[0]?.message?.content ?? "";
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

async function patchBundle(
  frontendCode: string,
  issues: QAIssue[],
): Promise<string | null> {
  if (issues.length === 0) return null;
  const issueList = issues
    .map((i, idx) => `${idx + 1}. [${i.file}] Problem: ${i.problem}\n   Fix: ${i.fix}`)
    .join("\n");
  return withTimeout(
    (async () => {
      try {
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 24000,
          system: PATCHER_SYSTEM_PROMPT,
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
    60_000,
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

/* ----------------------------- edit mode ---------------------------------- */

const EDIT_SYSTEM_PROMPT = `You are AppForge editing an existing web app. Apply the user's requested change while preserving everything else that works.

Output STRICT JSON only matching:
{"title":"…","description":"…","techStack":[…],"frontendCode":"…","backendCode":"…"}

Rules:
- Use '// === FILE: <path> ===' separators inside frontendCode/backendCode.
- Return the FULL updated bundles (every file, not just the changed ones).
- Keep the title and overall structure unless the user explicitly asks to change them.
- Do NOT regress existing features. No TODOs.
- Combined output under 70 KB. Close every brace and quote. Output ONLY the JSON object.`;

async function singleEditPass(
  prompt: string,
  previous: PreviousApp,
  onChars: (chars: number) => void,
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

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 32000,
    system: EDIT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  let accumulated = "";
  let lastReport = 0;
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      accumulated += event.delta.text;
      if (accumulated.length - lastReport >= 1500) {
        lastReport = accumulated.length;
        onChars(accumulated.length);
      }
    }
  }
  await stream.finalMessage();
  const parsed = extractJsonObject<GeneratedAppPayload>(accumulated.trim());
  if (!parsed || typeof parsed.frontendCode !== "string") {
    throw new Error("No pudimos analizar la respuesta del modelo en modo edición.");
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
): Promise<GeneratedAppPayload> {
  // Edit mode: skip the multi-agent pipeline; we already have a working app.
  if (previous) {
    onProgress?.({ phase: "generating", progress: 25, note: "Aplicando cambios al código…" });
    const TARGET = 50_000;
    const onChars = (chars: number) => {
      const ratio = Math.min(1, chars / TARGET);
      onProgress?.({
        phase: "generating",
        progress: 25 + Math.round(ratio * 60),
        note: `Aplicando cambios… (${Math.round(chars / 1000)} KB)`,
      });
    };
    const result = await singleEditPass(prompt, previous, onChars);
    onProgress?.({ phase: "parsing", progress: 90, note: "Procesando archivos…" });
    return result;
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
    }),
    180_000,
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

  /* === Phase 4: structured QA review ====================================== */
  onProgress?.({
    phase: "reviewing",
    progress: 80,
    note: "✅ Revisor de calidad comprobando el bundle…",
  });
  const report = await reviewBundle(frontendResult.code, plan);

  /* === Phase 5: self-healing — patch only if QA found real issues ========= */
  let finalFrontend = frontendResult.code;
  if (!report.ok && report.issues.length > 0) {
    onProgress?.({
      phase: "fixing",
      progress: 86,
      note: `🔧 Auto-reparación: corrigiendo ${report.issues.length} problema(s)…`,
    });
    const patched = await patchBundle(frontendResult.code, report.issues);
    if (patched) {
      finalFrontend = patched;
    }
  }

  onProgress?.({
    phase: "parsing",
    progress: 94,
    note: report.ok
      ? "Revisión OK. 📦 Empaquetando archivos…"
      : `Aplicado parcheo de QA. 📦 Empaquetando…`,
  });

  /* === Final assembly: append SETUP.md when there are integrations ======== */
  const setupNotes = buildSetupNotes(integrationSpec);

  return {
    title: plan.title.slice(0, 200),
    description: plan.description.slice(0, 1000),
    techStack: plan.techStack,
    frontendCode: finalFrontend + setupNotes,
    backendCode: backendResult.code || "No backend required for this app.",
  };
}
