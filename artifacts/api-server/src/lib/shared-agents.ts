import { anthropic } from "@workspace/integrations-anthropic-ai";
import OpenAI from "openai";
import { logger } from "./logger";

// Lazy initialization — evita crash si OPENAI_API_KEY no está configurada al arrancar
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "dummy";
    _openai = new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey,
    });
  }
  return _openai;
}

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
  | "generating"
  | "integrations"
  | "integrating"
  | "testing"
  | "reviewing"
  | "qa"
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

// Orden de fallback optimizado para coste: Haiku primero para tareas simples, Sonnet para complejas
const CLAUDE_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-7"];

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
        // Límite de créditos de la organización — no tiene sentido reintentar
        const isOutOfCredits = err?.status === 529 || 
          String(err).includes("credit_balance") || 
          String(err).includes("insufficient_quota") ||
          String(err?.message || "").includes("credit") ||
          String(err?.error?.message || "").includes("credit");
        
        if (isOutOfCredits) {
          logger.warn({ role, err: err?.message }, "Anthropic API: créditos agotados — activando fallback automático a Gemini");
          // No lanzar excepción — salir del bucle de reintentos de Anthropic
          // y dejar que el sistema pruebe Gemini automáticamente
          break;
        }
        
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

  // Fallback a modelos alternativos cuando el principal no está disponible
  const geminiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      logger.info({ role }, "Fallback automático → Gemini (API gratuita)");
      
      // Mapear modelos Claude a equivalentes Gemini
      const geminiModel = (() => {
        if (String(params.model || "").includes("opus")) return "gemini-2.0-flash";
        if (String(params.model || "").includes("sonnet")) return "gemini-2.0-flash";
        return "gemini-2.0-flash"; // Haiku → Flash (más rápido y gratuito)
      })();

      const { GoogleGenAI } = await import("@google/genai");
      const gemini = new GoogleGenAI({ apiKey: geminiKey });
      
      // Construir el prompt combinando system + messages
      const systemText = params.system || "";
      const userMessages = (params.messages || []);
      const lastUser = userMessages.filter((m: any) => m.role === "user").slice(-1)[0];
      const userText = typeof lastUser?.content === "string" 
        ? lastUser.content 
        : JSON.stringify(lastUser?.content || "");
      
      const fullPrompt = systemText 
        ? `${systemText}

---

${userText}`
        : userText;

      const result = await gemini.models.generateContent({
        model: geminiModel,
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        config: { maxOutputTokens: Math.min(params.max_tokens || 4096, 8192) },
      });

      const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
      logger.info({ role, geminiModel, chars: text.length }, "Gemini fallback exitoso");
      
      return { content: [{ type: "text", text }] };
    } catch (geminiErr: any) {
      logger.warn({ role, err: geminiErr?.message }, "Gemini fallback falló — intentando OpenAI");
    }
  }

  // Segundo fallback
  try {
    logger.info({ role }, "Falling back to OpenAI (GPT-4o/5) for agent task");
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: params.system },
        ...params.messages
      ],
      max_tokens: Math.min(params.max_tokens || 4096, 16000),
    });
    
    const text = response.choices?.[0]?.message?.content || "";
    return { content: [{ type: "text", text }] };
  } catch (err) {
    logger.error({ role, err }, "Anthropic, Gemini y OpenAI fallaron para este agente");
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}


export function estimatePromptTokens(text: string): number {
  return Math.ceil(String(text || "").length / 4);
}

function bundleFilesForPrompt(bundle: string): Array<{ path: string; content: string; raw: string }> {
  const out: Array<{ path: string; content: string; raw: string }> = [];
  const parts = String(bundle || "").split(/\/\/\s*===\s*FILE:\s*/);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const path = part.slice(0, nl).trim().replace(/\s*===$/, "");
    const content = part.slice(nl + 1);
    if (path) out.push({ path, content, raw: `// === FILE: ${path} ===\n${content}` });
  }
  return out;
}

export function compactBundleForPrompt(bundle: string, hints: string[] = [], maxChars = 70_000): string {
  const files = bundleFilesForPrompt(bundle);
  if (files.length === 0) return String(bundle || "").slice(0, maxChars);
  const normalizedHints = hints.join(" ").toLowerCase();
  const critical = /(^|\/)(package\.json|vite\.config\.[jt]s|index\.html|src\/main\.[jt]sx?|src\/app\.[jt]sx?|src\/index\.(css|scss)|src\/styles?\.(css|scss))$/i;
  const scored = files.map((file, index) => {
    const haystack = `${file.path}\n${file.content.slice(0, 2000)}`.toLowerCase();
    let score = critical.test(file.path) ? 100 : 0;
    for (const hint of normalizedHints.split(/[^a-z0-9_\-/]+/).filter((h) => h.length >= 3)) {
      if (haystack.includes(hint)) score += 10;
      if (file.path.toLowerCase().includes(hint)) score += 25;
    }
    if (/component|page|route|modal|button|form|table|header|footer|navbar/i.test(file.path)) score += 5;
    return { ...file, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: typeof scored = [];
  let used = 0;
  for (const file of scored) {
    const size = file.raw.length + 2;
    if (selected.length > 0 && used + size > maxChars) continue;
    selected.push(file);
    used += size;
    if (used >= maxChars) break;
  }
  selected.sort((a, b) => a.index - b.index);
  const omitted = files.filter((f) => !selected.some((s) => s.path === f.path));
  const header = [
    `// === MARIS_PROMPT_CONTEXT: compacted bundle ===`,
    `// Included ${selected.length}/${files.length} files. Approx input tokens saved: ${Math.max(0, estimatePromptTokens(bundle) - estimatePromptTokens(selected.map((f) => f.raw).join("\n")))}.`,
    omitted.length ? `// Omitted files: ${omitted.map((f) => f.path).slice(0, 80).join(", ")}${omitted.length > 80 ? ", ..." : ""}` : `// No files omitted.`,
  ].join("\n");
  return `${header}\n${selected.map((f) => f.raw).join("\n")}`;
}

/* ----------------------------- patcher ------------------------------------ */

export function mergePatchIntoBundle(
  originalBundle: string,
  changedFiles: Record<string, string>,
  deletedFiles: string[] = []
): string {
  const files: Record<string, string> = {};
  // Parse original bundle
  const parts = originalBundle.split(/\/\/ === FILE: /);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const path = part.slice(0, nl).trim().replace(/ ===$/, "");
    if (path) files[path] = "// === FILE: " + part;
  }
  // Delete files explicitly requested by the patcher.
  for (const path of deletedFiles) {
    const normalizedPath = path.replace(/^\//, "").trim();
    if (normalizedPath) delete files[normalizedPath];
  }

  // Apply added/modified files. Existing paths are modified; new paths are added.
  for (const [path, content] of Object.entries(changedFiles)) {
    const normalizedPath = path.replace(/^\//, "").trim();
    if (!normalizedPath) continue;
    files[normalizedPath] = `// === FILE: ${normalizedPath} ===\n${content}`;
  }
  return Object.values(files).join("\n");
}

export function buildPatcherSystemPrompt(language: GenLanguage): string {
  const isTS = language === "typescript";
  const tsLine = isTS
    ? "- TypeScript bundle (.tsx/.ts): type annotations required. Fix type errors, missing interfaces, wrong generics."
    : "- JavaScript bundle (.jsx/.js): do NOT introduce TypeScript syntax. Fix JS-only issues.";
  return `You are Maris AI's testing-agent — the most advanced technical repair expert in the system.
Your mission: receive a list of errors detected in a React frontend bundle and FIX ALL OF THEM with surgical precision.
You are a senior full-stack engineer with 15+ years of experience in React, TypeScript, Vite, Tailwind, and modern web development.
Output STRICT JSON only:
{"changedFiles":{"src/App.tsx":"full updated content for changed file only"},"deletedFiles":[]}

LANGUAGE RULES:
- ALL user-visible copy MUST be in Spanish (es-ES).
- Code identifiers, variable names, file names → English only.

SYNTAX REPAIR:
${tsLine}
- Remove every ,, patterns.
- Every brace, bracket, paren and JSX tag must close.
- Match every import { X } to a named export and every import X from to a default export.
- Link in wouter v3 already renders as anchor. Never nest <a> inside <Link>.

Return ONLY changed files, not the full bundle. Output ONLY the JSON object.`;
}

export function buildFastPatchPrompt(): string {
  return `You are Maris AI's Fast Patcher. Apply ONLY the requested change to the frontend bundle.
Output STRICT JSON only:
{"changedFiles":{"src/App.tsx":"full file content here"},"deletedFiles":["src/OldComponent.tsx"]}

OPERATION SEMANTICS — obey the user literally:
- ADD / AÑADIR / AGREGAR means add the requested element/file/data only. Do not rewrite unrelated content.
- MODIFY / MODIFICAR / CAMBIAR / EDITAR means alter the existing target only. Do not duplicate it and do not create replacements unless asked.
- DELETE / ELIMINAR / BORRAR / QUITAR means remove the requested target only. Put removed file paths in deletedFiles; for inline removals, return only the file that contains the removal.

RULES:
- Identify the exact file(s) that need to change. Usually just 1 file.
- The key must match the exact filename in the bundle (e.g. "index.html", "src/App.tsx").
- Return the COMPLETE content of each changed file (not a diff, the full file).
- Keep ALL other files exactly as they are - do NOT include unchanged files.
- Never perform a full redesign/rebuild from a small add/modify/delete request.
- Output ONLY the JSON object. No markdown, no backticks, no explanation.`;
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
      max_tokens: 16000,
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
        if (parsed.frontendCode.length < 100) return null;
        return parsed.frontendCode;
      } catch {
        return null;
      }
    })(),
    240_000, // Aumentado a 4 minutos para evitar timeouts en Render
    null,
  );
}
