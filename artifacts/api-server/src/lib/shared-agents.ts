import { anthropic } from "@workspace/integrations-anthropic-ai";
import OpenAI from "openai";
import { logger } from "./logger";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

/* ----------------------------- types -------------------------------------- */

export type GenLanguage = "typescript" | "javascript";

export interface QAIssue {
  file: string;
  problem: string;
  fix: string;
}

export interface QAReport {
  ok: boolean;
  issues: QAIssue[];
}

export interface BuildIssue {
  file: string;
  message: string;
  line?: number;
}

export interface ValidationReport {
  ok: boolean;
  issues: BuildIssue[];
  filesAnalyzed: number;
}

export type AgentRole = "researcher" | "architect" | "designer" | "frontend" | "backend" | "database" | "integrator" | "qa" | "devops" | "patcher" | "repair" | "system" | "memory" | "validator" | "testing" | "fixing" | "patching" | "coder";

export type ComplexityTier = "basic" | "standard" | "robust" | "ultra";

export type GeneratePhase = 
  | "starting"
  | "researching"
  | "architecting"
  | "designing"
  | "schema"
  | "frontend"
  | "backend"
  | "integrations"
  | "testing"
  | "patching"
  | "validating"
  | "fixing"
  | "parsing"
  | "queued"
  | "ready"
  | "failed";

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

export interface AgentModelChoice {
  role: AgentRole;
  label: string;
  model: any;
  reason: string;
}

export interface AgentModelPlan {
  tier: ComplexityTier;
  score: number;
  selectedCoderModel: string;
  auto: boolean;
  agents: Record<AgentRole, AgentModelChoice>;
}

/* ----------------------------- helpers ------------------------------------ */

export function extractJsonObject<T = any>(raw: string): T | null {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  const first = s.indexOf("{");
  if (first === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = first; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(first, i + 1)) as T; } catch {}
      }
    }
  }
  try { return JSON.parse(s) as T; } catch {}
  return null;
}

export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const CLAUDE_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-7"];

function fallbackClaudeModels(model: string): string[] {
  const primary = model === "gpt-5.4" ? "claude-sonnet-4-6" : model;
  return [primary, ...CLAUDE_MODELS.filter((m) => m !== primary)];
}

export async function createClaudeMessageWithFallback(role: AgentRole, model: string, params: any): Promise<any> {
  let lastError: unknown;
  const MAX_RETRIES = 3;
  
  // OPTIMIZACIÓN DE CONTEXTO: Si el historial de mensajes es muy largo, comprimimos el pasado
  if (params.messages && params.messages.length > 10) {
    logger.info({ role, originalLength: params.messages.length }, "CONTE TEXT OPTIMIZER: Comprimiendo historial de mensajes...");
    const systemInstruction = params.messages[0].role === "system" ? params.messages.shift() : null;
    const lastUserMessage = params.messages.pop();
    
    // Mantener solo los últimos 4 mensajes + el primero (contexto inicial) + el sistema
    const middleMessages = params.messages.slice(-4);
    const firstMessage = params.messages[0];
    
    params.messages = [
      ...(systemInstruction ? [systemInstruction] : []),
      firstMessage,
      { role: "user", content: "... [Contexto antiguo comprimido para ahorrar tokens] ..." },
      ...middleMessages,
      lastUserMessage
    ].filter(Boolean);
    logger.info({ newLength: params.messages.length }, "CONTEXT OPTIMIZER: Historial comprimido.");
  }

  // Try Anthropic first with exponential backoff
  for (const candidate of fallbackClaudeModels(model)) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Pequeño desfase aleatorio para evitar colisiones de agentes
        await new Promise(r => setTimeout(r, Math.random() * 500));
        return await anthropic.messages.create({ ...params, model: candidate });
      } catch (err: any) {
        lastError = err;
        const isRateLimit = err?.status === 429 || String(err).includes("rate_limit_exceeded");
        
        if (isRateLimit && attempt < MAX_RETRIES - 1) {
          const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
          logger.warn({ role, model: candidate, attempt, delay }, "Rate limit hit; retrying with backoff");
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        
        logger.warn({ role, model: candidate, err }, "Anthropic model failed; trying next candidate or fallback");
        break; // Probar el siguiente modelo candidato
      }
    }
  }

  // Fallback to OpenAI if Anthropic fails
  try {
    logger.info({ role }, "Falling back to OpenAI (GPT-4o/5) for agent task");
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // or "gpt-5.4" if available
      messages: [
        { role: "system", content: params.system },
        ...params.messages
      ],
      max_tokens: params.max_tokens || 4096,
    });
    
    // Adapt OpenAI response to match Anthropic's structure for the rest of the code
    const content = response.choices?.[0]?.message?.content || "";
    return {
      content: [
        {
          type: "text",
          text: content
        }
      ]
    };
  } catch (err) {
    logger.error({ role, err }, "Both Anthropic and OpenAI failed for agent task");
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

/* ----------------------------- patcher ------------------------------------ */

export function buildPatcherSystemPrompt(language: GenLanguage): string {
  const isTS = language === "typescript";
  const tsLine = isTS
    ? "- TypeScript bundle (.tsx/.ts): type annotations required. Fix type errors, missing interfaces, wrong generics."
    : "- JavaScript bundle (.jsx/.js): do NOT introduce TypeScript syntax. Fix JS-only issues.";
  return `You are Maris AI's testing-agent — the most advanced technical repair expert in the system.
Your mission: receive a list of errors detected in a React frontend bundle and FIX ALL OF THEM with surgical precision.
You are a senior full-stack engineer with 15+ years of experience in React, TypeScript, Vite, Tailwind, and modern web development.
Output STRICT JSON only:
{"frontendCode":"all frontend files as one string using // === FILE: <path> === separators"}

LANGUAGE RULES:
- ALL user-visible copy MUST be in Spanish (es-ES).
- Code identifiers, variable names, file names → English only.

SYNTAX REPAIR:
${tsLine}
- Remove every ,, patterns.
- Every brace, bracket, paren and JSX tag must close.
- Match every import { X } to a named export and every import X from to a default export.
- Link in wouter v3 already renders as anchor. Never nest <a> inside <Link>.

Return the FULL bundle. Output ONLY the JSON object.`;
}

export async function patchBundle(
  frontendCode: string,
  issues: QAIssue[],
  language: GenLanguage = "typescript",
  memoryContext: string = "",
  model: string = "claude-sonnet-4-6",
): Promise<string | null> {
  if (issues.length === 0) return null;
  const issueList = issues
    .map((i, idx) => `${idx + 1}. [${i.file}] Problem: ${i.problem}\n   Fix: ${i.fix}`)
    .join("\n");
  
  return withTimeout(
    (async () => {
      try {
        const response = await createClaudeMessageWithFallback("patcher", model, {
          max_tokens: 32000,
          system: buildPatcherSystemPrompt(language) + "\nOutput JSON only.",
          messages: [
            {
              role: "user",
              content: `ISSUES TO FIX:\n${issueList}\n${memoryContext}\nCURRENT FRONTEND BUNDLE:\n${frontendCode}\n\nReturn the FULL patched bundle as JSON.`,
            },
          ],
        });
        const raw = (response.content[0] as any).text ?? "";
        const parsed = extractJsonObject<{ frontendCode?: string }>(raw);
        if (!parsed || typeof parsed.frontendCode !== "string") return null;
        if (parsed.frontendCode.length < frontendCode.length / 2) return null;
        return parsed.frontendCode;
      } catch {
        return null;
      }
    })(),
    240_000, // Aumentado a 4 minutos para evitar timeouts en Render
    null,
  );
}
