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
- Keep total combined output under 90 KB. Prioritize a complete, working core over many half-baked features.
- Output ONLY the JSON object. Nothing else. No \`\`\`json fence. No prose.`;

export interface GeneratedAppPayload {
  title: string;
  description: string;
  techStack: string[];
  frontendCode: string;
  backendCode: string;
}

interface AnyContentBlock {
  type: string;
  text?: string;
}

async function researchTopic(prompt: string): Promise<string> {
  try {
    const research = await (anthropic.messages.create as any)({
      model: "claude-sonnet-4-5",
      max_tokens: 3000,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 4,
        },
      ],
      messages: [
        {
          role: "user",
          content: `You are a research assistant for an app builder. Investigate the web and produce a concise brief (max ~1200 words) for this app idea:

"${prompt}"

If it mentions cloning, copying, or rebuilding an existing product or website (e.g. Wallapop, Vinted, Airbnb, Twitter, Instagram), search for:
- Core sections / pages / navigation
- Key features and user flows
- Brand colors, typography, logo style, taglines
- Sample listings or content patterns
- Anything visually distinctive

If it's an original idea, search for the closest reference products and best UX patterns.

Return ONLY the brief in plain text, no preamble, no markdown headers, just useful facts the builder can use directly.`,
        },
      ],
    });

    const blocks: AnyContentBlock[] = research.content || [];
    const text = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n\n")
      .trim();
    return text.slice(0, 8000);
  } catch (_err) {
    return "";
  }
}

export async function generateApp(prompt: string): Promise<GeneratedAppPayload> {
  // Step 1: Web research (best-effort, never blocks generation)
  const research = await researchTopic(prompt);

  const userContent = research
    ? `Generate an app for this request:\n\n${prompt}\n\n---\nResearch context (from web search, treat as ground truth for branding & features):\n${research}`
    : `Generate an app for this request:\n\n${prompt}`;

  // Step 2: Generation
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content");
  }
  let raw = textBlock.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1) {
    throw new Error("La respuesta del modelo no contenía un objeto JSON válido");
  }
  const jsonStr = raw.slice(first, last + 1);
  let parsed: GeneratedAppPayload;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(
      `No pudimos analizar la respuesta del modelo (probablemente truncada). ` +
        `Detalle: ${(e as Error).message}`,
    );
  }
  if (
    !parsed ||
    typeof parsed.title !== "string" ||
    typeof parsed.description !== "string" ||
    typeof parsed.frontendCode !== "string"
  ) {
    throw new Error("La respuesta del modelo no tiene los campos requeridos");
  }
  return {
    title: parsed.title.slice(0, 200),
    description: parsed.description.slice(0, 1000),
    techStack: Array.isArray(parsed.techStack) ? parsed.techStack : [],
    frontendCode: parsed.frontendCode,
    backendCode: parsed.backendCode || "No backend required for this app.",
  };
}
