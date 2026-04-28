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
- Keep total output under 30 KB combined.
- Output ONLY the JSON object. Nothing else. No \`\`\`json fence. No prose.`;

export interface GeneratedAppPayload {
  title: string;
  description: string;
  techStack: string[];
  frontendCode: string;
  backendCode: string;
}

export async function generateApp(prompt: string): Promise<GeneratedAppPayload> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Generate an app for this request:\n\n${prompt}`,
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
    throw new Error("Model output did not contain JSON object");
  }
  const jsonStr = raw.slice(first, last + 1);
  let parsed: GeneratedAppPayload;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse model JSON: ${(e as Error).message}`);
  }
  if (
    !parsed ||
    typeof parsed.title !== "string" ||
    typeof parsed.description !== "string" ||
    typeof parsed.frontendCode !== "string"
  ) {
    throw new Error("Model output missing required fields");
  }
  return {
    title: parsed.title.slice(0, 200),
    description: parsed.description.slice(0, 1000),
    techStack: Array.isArray(parsed.techStack) ? parsed.techStack : [],
    frontendCode: parsed.frontendCode,
    backendCode: parsed.backendCode || "No backend required for this app.",
  };
}
