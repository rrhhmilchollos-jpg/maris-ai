import { anthropic } from "@workspace/integrations-anthropic-ai";

const SYSTEM_PROMPT = `You are AppForge. Generate a complete production-quality web app as STRICT JSON only.

Schema:
{"title":"2-4 words","description":"1-2 sentence pitch","techStack":["React","TS","Tailwind",...],"frontendCode":"all frontend files as one string","backendCode":"all backend files OR 'No backend required for this app.'"}

Use '// === FILE: <path> ===' to separate files inside frontendCode/backendCode. Include index.html, src/main.tsx, src/App.tsx, src/index.css, package.json, vite.config.ts, tsconfig.json, tailwind.config.ts, postcss.config.js. Use React 18 + TS + Tailwind v3.

Rules:
- Real working code, no TODOs, no stubs.
- Pure frontend? backendCode = "No backend required for this app.".
- Polished layout, real copy, no lorem ipsum.
- If Research context is provided, recreate that product's look/sections/branding faithfully.
- HARD LIMIT: combined output strictly under 70 KB. If running long, reduce: fewer seed items, shorter copy, condense Tailwind, drop secondary screens. Never leave strings unterminated.
- Close every quote, brace and bracket. JSON MUST be valid.
- Output ONLY the JSON object. No fences, no prose.`;

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
        model: "claude-haiku-4-5",
        max_tokens: 1500,
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
            content: `Quick web research for an app builder (max 2 searches). Produce a concise brief (~400 words max) for: "${prompt}"

Focus on: core sections/pages, key features, brand colors & typography, signature visual elements, sample content. Plain text only, no preamble.`,
          },
        ],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("research timeout")), 20000),
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
  onChars?: (charsSoFar: number) => void,
): Promise<GenerateAttemptResult> {
  // Streaming for lower TTFB and live progress.
  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  let accumulated = "";
  let lastReport = 0;
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      accumulated += event.delta.text;
      // Throttle progress callbacks to once every ~1500 chars (~5%).
      if (onChars && accumulated.length - lastReport >= 1500) {
        lastReport = accumulated.length;
        onChars(accumulated.length);
      }
    }
  }
  const response = await stream.finalMessage();

  const truncated = response.stop_reason === "max_tokens";
  let raw = accumulated.trim();
  if (!raw) {
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { truncated, error: "El modelo no devolvió contenido de texto." };
    }
    raw = textBlock.text.trim();
  }
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

  // Live progress: stream chars and map them to a 35→85% progress range.
  const TARGET_CHARS = 50_000;
  const onChars = (chars: number) => {
    const ratio = Math.min(1, chars / TARGET_CHARS);
    const pct = 35 + Math.round(ratio * 50);
    onProgress?.({
      phase: "generating",
      progress: pct,
      note: `Generando código… (${Math.round(chars / 1000)} KB)`,
    });
  };

  // First attempt: 32k tokens, full creative leeway.
  let attempt = await singleGenerate(baseUserContent, 32000, onChars);

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
- Target combined output around 40 KB.
- One single page only (no router, no multi-screen).
- ~5 seed items max in any list.
- Concise Tailwind classes, no verbose comments.
- Finish the JSON properly. Close every brace and quote.`;
    attempt = await singleGenerate(compactContent, 24000, onChars);
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
