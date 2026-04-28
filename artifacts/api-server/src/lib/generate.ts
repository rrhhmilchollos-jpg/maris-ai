import { anthropic } from "@workspace/integrations-anthropic-ai";

const SYSTEM_PROMPT = `You are AppForge, an expert AI app generator. Given a user's plain-English request, you generate a complete, production-quality web application as a single self-contained code bundle.

Output STRICT JSON only — no markdown fences, no commentary outside the JSON. Schema:

{
  "title": "Short product name (2-4 words)",
  "description": "1-2 sentence pitch for what the app does and who it's for",
  "techStack": ["React", "TypeScript", "TailwindCSS", "Vite", ...],
  "frontendCode": "Full frontend implementation as a single string. Include: index.html, src/main.tsx, src/App.tsx, src/index.css, package.json, vite.config.ts, tsconfig.json, tailwind.config.ts, postcss.config.js. Separate each file with a clear delimiter line: '// === FILE: <path> ===' followed by the file content. Use modern React 18 + TS + TailwindCSS v3.",
  "backendCode": "Full backend implementation as a single string OR the literal string 'No backend required for this app.' if the app is purely frontend (e.g. uses localStorage). If a backend is needed, use Node.js + Express + TypeScript and include all files with the same '// === FILE: <path> ===' delimiter pattern."
}

Rules:
- Generate REAL working code. No stubs, no TODOs, no "// implement this".
- For pure frontend apps (calculators, todo lists, games, dashboards with seed data, etc.), set backendCode to "No backend required for this app." and put everything in frontendCode.
- For apps that need persistence beyond the browser, include a real Express + SQLite or in-memory backend.
- Make it visually polished — real layout, real colors, real hierarchy, real copy. No "lorem ipsum".
- If a "Research context" section is provided in the user message, USE IT to faithfully recreate the look, branding, sections, and core flows of the referenced product/site.
- HARD LIMIT: keep total combined output (frontendCode + backendCode) **strictly under 70 KB**. You MUST finish the JSON. If running long, reduce: fewer seed items, shorter copy, condense Tailwind classes, drop secondary screens. Never leave a string unterminated.
- Always close every quote, brace, and bracket. The JSON MUST be syntactically valid.
- Output ONLY the JSON object. Nothing else. No \`\`\`json fence. No prose.`;

export interface GeneratedAppPayload {
  title: string;
  description: string;
  techStack: string[];
  frontendCode: string;
  backendCode: string;
}

export type GeneratePhase = "researching" | "generating" | "parsing";

export interface GenerateProgress {
  phase: GeneratePhase;
  progress: number;
  note?: string;
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

async function researchTopic(prompt: string): Promise<string> {
  try {
    const research = await Promise.race([
      (anthropic.messages.create as any)({
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 2,
          },
        ],
        messages: [
          {
            role: "user",
            content: `Brief research for an app builder. Investigate the web (max 2 quick searches) and produce a concise brief (max ~600 words) for this app idea:

"${prompt}"

Focus on: core sections/pages, key features, brand colors & typography, signature visual elements, sample content patterns. Return ONLY the brief in plain text — no preamble, no markdown headers.`,
          },
        ],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("research timeout")), 30000),
      ),
    ]);

    const blocks: AnyContentBlock[] = (research as any).content || [];
    const text = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n\n")
      .trim();
    return text.slice(0, 6000);
  } catch (_err) {
    return "";
  }
}

interface GenerateAttemptResult {
  payload?: GeneratedAppPayload;
  truncated: boolean;
  error?: string;
}

async function singleGenerate(
  userContent: string,
  maxTokens: number,
): Promise<GenerateAttemptResult> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const truncated = response.stop_reason === "max_tokens";
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { truncated, error: "El modelo no devolvió contenido de texto." };
  }
  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1) {
    return {
      truncated,
      error: "La respuesta del modelo no contenía un objeto JSON válido.",
    };
  }
  const jsonStr = raw.slice(first, last + 1);
  try {
    const parsed = JSON.parse(jsonStr) as GeneratedAppPayload;
    if (
      !parsed ||
      typeof parsed.title !== "string" ||
      typeof parsed.description !== "string" ||
      typeof parsed.frontendCode !== "string"
    ) {
      return {
        truncated,
        error: "La respuesta del modelo no tiene los campos requeridos.",
      };
    }
    return {
      payload: {
        title: parsed.title.slice(0, 200),
        description: parsed.description.slice(0, 1000),
        techStack: Array.isArray(parsed.techStack) ? parsed.techStack : [],
        frontendCode: parsed.frontendCode,
        backendCode: parsed.backendCode || "No backend required for this app.",
      },
      truncated: false,
    };
  } catch (e) {
    return {
      truncated,
      error: `JSON inválido (${(e as Error).message})`,
    };
  }
}

export async function generateApp(
  prompt: string,
  onProgress?: (p: GenerateProgress) => void,
): Promise<GeneratedAppPayload> {
  let research = "";
  if (shouldResearch(prompt)) {
    onProgress?.({
      phase: "researching",
      progress: 10,
      note: "Buscando referencias en la web…",
    });
    research = await researchTopic(prompt);
  }

  onProgress?.({
    phase: "generating",
    progress: 35,
    note: research
      ? "Generando código con contexto de la web…"
      : "Generando código de la aplicación…",
  });

  const baseUserContent = research
    ? `Generate an app for this request:\n\n${prompt}\n\n---\nResearch context (from web search, treat as ground truth for branding & features):\n${research}`
    : `Generate an app for this request:\n\n${prompt}`;

  // First attempt: 32k tokens, full creative leeway.
  let attempt = await singleGenerate(baseUserContent, 32000);

  // If truncated or JSON invalid, retry once with a stricter "be concise" prompt.
  if (!attempt.payload) {
    onProgress?.({
      phase: "generating",
      progress: 60,
      note: "El primer intento se truncó. Reintentando con versión más compacta…",
    });
    const compactContent = `${baseUserContent}

---
PREVIOUS ATTEMPT FAILED: the JSON was ${attempt.truncated ? "TRUNCATED (ran out of tokens)" : "INVALID"}.
You MUST now produce a more compact version:
- Target combined output around 45 KB.
- One single page only (no router, no multi-screen). Showcase the core experience.
- ~5 seed items max in any list.
- Concise Tailwind classes, no verbose comments.
- Finish the JSON properly. Close every brace and quote.`;
    attempt = await singleGenerate(compactContent, 32000);
  }

  onProgress?.({
    phase: "parsing",
    progress: 85,
    note: "Procesando archivos generados…",
  });

  if (!attempt.payload) {
    throw new Error(
      attempt.truncated
        ? "El modelo se quedó sin tokens incluso en el reintento compacto. Pide una app más pequeña o sé más específico (una sola pantalla, sin clones masivos)."
        : `No pudimos analizar la respuesta del modelo. Detalle: ${attempt.error ?? "desconocido"}`,
    );
  }

  return attempt.payload;
}
