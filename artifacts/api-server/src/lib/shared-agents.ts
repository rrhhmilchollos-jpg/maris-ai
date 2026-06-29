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

// Timeout duro para cualquier llamada a un proveedor de IA dentro de este
// archivo. Sin esto, una llamada no-streaming (anthropic.messages.create,
// Gemini, OpenAI) puede colgarse minutos si el proveedor se degrada, sin
// ningún chunk que activar un timeout de inactividad (eso solo aplica a
// streams) — el job entero queda en silencio hasta que el watchdog global
// (12 min) lo reinicia desde cero, perdiendo todo el trabajo ya hecho.
async function raceWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
const AI_CALL_TIMEOUT_MS = 90_000;

export async function createClaudeMessageWithFallback(role: AgentRole, model: string, params: any): Promise<any> {
  let lastError: unknown;
  const MAX_RETRIES = 3;

  // PROMPT CACHING AUTOMÁTICO — esta función es el punto central por el que
  // pasan prácticamente todos los agentes (Backend Engineer, Designer,
  // Patcher, etc.), muchos con system prompts grandes y FIJOS (el texto
  // nunca cambia entre llamadas: DESIGNER_SYSTEM_PROMPT ~3350 tokens,
  // BACKEND_SYSTEM_PROMPT_POSTGRES ~2650 tokens) — el caso de uso ideal
  // para prompt caching de Anthropic (90% de descuento en tokens leídos de
  // caché). Confirmado en el panel de uso real: 0% de tasa de aciertos de
  // caché en toda la plataforma, a pesar de que estos prompts se repiten en
  // miles de llamadas al día sin cambiar una letra.
  // Conversión automática y transparente: si params.system es un string
  // (el caso normal en todo el código existente) y supera el mínimo
  // cacheable de Sonnet (1024 tokens ≈ 4000 caracteres, usamos un margen
  // conservador), lo convertimos al formato de bloques con cache_control.
  // Si ya viene en formato array (algún caller ya lo gestiona explícitamente
  // como en otros puntos de apps.ts), no lo tocamos — evita doble conversión.
  const MIN_CACHEABLE_CHARS = 3500; // ≈ 1024 tokens con margen conservador
  if (typeof params.system === "string" && params.system.length >= MIN_CACHEABLE_CHARS) {
    params = {
      ...params,
      system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
    };
  }

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
        return await raceWithTimeout(
          anthropic.messages.create({ ...params, model: candidate }),
          AI_CALL_TIMEOUT_MS,
          `anthropic.messages.create(${candidate})`,
        );
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

  // ── FALLBACK 1: Gemini (gratuito) ────────────────────────────────────────
  // Se activa automáticamente cuando Anthropic no tiene créditos o falla.
  // Cuando Anthropic vuelve a tener créditos, el siguiente request lo usará de nuevo.
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

      const result = await raceWithTimeout(
        gemini.models.generateContent({
          model: geminiModel,
          contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
          config: { maxOutputTokens: Math.min(params.max_tokens || 4096, 8192) },
        }),
        AI_CALL_TIMEOUT_MS,
        `gemini.generateContent(${geminiModel})`,
      );

      const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
      logger.info({ role, geminiModel, chars: text.length }, "Gemini fallback exitoso");
      
      return { content: [{ type: "text", text }] };
    } catch (geminiErr: any) {
      logger.warn({ role, err: geminiErr?.message }, "Gemini fallback falló — intentando OpenAI");
    }
  }

  // ── FALLBACK 2: OpenAI ────────────────────────────────────────────────────
  try {
    logger.info({ role }, "Falling back to OpenAI (GPT-4o/5) for agent task");
    const response = await raceWithTimeout(
      getOpenAI().chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: params.system },
          ...params.messages
        ],
        max_tokens: Math.min(params.max_tokens || 4096, 16000),
      }),
      AI_CALL_TIMEOUT_MS,
      "openai.chat.completions.create(gpt-4o)",
    );
    
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

  // CRÍTICO: el bundle completo puede ser de cientos de KB. Pedirle al modelo
  // que devuelva el bundle entero reparado arriesga truncamiento por límite de
  // tokens en bundles grandes — exactamente el tipo de fallo silencioso de
  // reparación que más frustra a los usuarios. En su lugar: enviamos solo los
  // archivos relevantes (compactBundleForPrompt, ya existía pero no se usaba
  // aquí), el modelo devuelve SOLO los archivos que cambia (el formato real
  // que pide buildPatcherSystemPrompt: changedFiles/deletedFiles), y los
  // fusionamos de vuelta con mergePatchIntoBundle. Esto es estrictamente más
  // fiable: menos tokens de salida necesarios, menor riesgo de truncamiento,
  // y los archivos no tocados quedan garantizados intactos byte a byte.
  const issueHints = issues.flatMap((i) => [i.file, i.problem]);
  const compactedBundle = compactBundleForPrompt(frontendCode, issueHints, 70_000);

  return withTimeout(
    (async () => {
      try {
        const response = await createClaudeMessageWithFallback("patcher", model, {
          max_tokens: 24000,
          system: buildPatcherSystemPrompt(language) + "\nOutput JSON only.",
          messages: [
            {
              role: "user",
              content: `ISSUES TO FIX:\n${issueList}\n${memoryContext}\nCURRENT FRONTEND BUNDLE (only the most relevant files are shown — files NOT shown here are unrelated to these issues and must NOT be referenced as missing):\n${compactedBundle}\n\nReturn ONLY the changed/added files as JSON: {"changedFiles":{"path":"full content"},"deletedFiles":["path"]}.`,
            },
          ],
        });
        const raw = (response.content[0] as any).text ?? "";
        const parsed = extractJsonObject<{ changedFiles?: Record<string, string>; deletedFiles?: string[] }>(raw);
        if (!parsed || typeof parsed.changedFiles !== "object" || parsed.changedFiles === null) {
          return null;
        }
        const changedFiles = parsed.changedFiles;
        const deletedFiles = Array.isArray(parsed.deletedFiles) ? parsed.deletedFiles.map(String) : [];
        if (Object.keys(changedFiles).length === 0 && deletedFiles.length === 0) return null;
        const merged = mergePatchIntoBundle(frontendCode, changedFiles, deletedFiles);
        if (!merged || merged.length < 100) return null;
        return merged;
      } catch {
        return null;
      }
    })(),
    240_000, // Aumentado a 4 minutos para evitar timeouts en Render
    null,
  );
}

/* ----------------------- multi-file patcher -------------------------------- */
/**
 * patchBundle estándar (16K max_tokens, una sola respuesta JSON) está pensado
 * para parches quirúrgicos: 1-2 archivos pequeños. CASO REAL ENCONTRADO Y
 * DOCUMENTADO (app "MesaYa"): una reparación que necesitaba regenerar un
 * App.tsx grande (1000+ líneas, roto a mitad) Y crear 3 páginas nuevas
 * completas (Dashboard/Reservas/NuevaReserva) excede por mucho lo que cabe en
 * una sola respuesta JSON de 16K tokens — el modelo se queda sin presupuesto
 * a mitad de generación, produce JSON inválido/truncado, y patchBundle
 * devuelve null silenciosamente ("La reparación automática no produjo
 * cambios válidos"), sin ninguna pista real de qué pasó.
 *
 * patchBundleMultiFile divide esto en pasos independientes y verificables:
 * 1. Una llamada de PLANIFICACIÓN (barata, sin generar contenido) que decide
 *    qué archivos hay que tocar/crear y por qué — nunca el contenido en sí.
 * 2. Una llamada de GENERACIÓN POR ARCHIVO, cada una con su propio
 *    presupuesto completo de 16K tokens — un archivo de página real nunca
 *    se acerca a ese límite, así que el riesgo de truncamiento desaparece.
 * Si un archivo individual falla, solo se reintenta ese archivo (1 vez),
 * no toda la reparación — más barato y más fiable que repetir el ciclo
 * completo.
 */
export interface MultiFilePlanItem {
  path: string;
  action: "rewrite" | "create" | "delete";
  reason: string;
}

async function planMultiFileRepair(
  bundle: string,
  errorSummary: string,
  language: GenLanguage,
  model: string,
): Promise<MultiFilePlanItem[] | null> {
  // ENCONTRADO en producción (caso real: PM Agent detectó 23-24 blockers,
  // uno por cada archivo de un proyecto complejo — Landing, Dashboard,
  // Search, ListingDetail, Favorites, Settings, Navbar, Footer, varios
  // hooks y utils): este planificador SOLO devolvía 1 archivo en el plan
  // final ("0/1 archivo(s) completados", confirmado en logs reales).
  // Causa real: errorSummary se recortaba a 2000 caracteres antes de
  // mostrárselo al planificador — con 23-24 nombres de archivo y sus
  // razones en una sola lista de texto, ese límite corta la lista a mitad,
  // y el modelo solo ve (y por tanto solo planifica) una fracción real de
  // los archivos que de verdad necesitan arreglo. Además max_tokens:4000
  // para la SALIDA del plan es insuficiente para listar 23+ objetos JSON
  // con path/action/reason cada uno. Subido ambos límites — el plan en sí
  // es una lista corta de metadatos (no el contenido de los archivos, que
  // ya se generó como texto plano más abajo, ver el fix de
  // generateSingleFileContent), así que el riesgo de truncamiento de JSON
  // es mucho menor aquí, pero necesita más espacio real para listar todo.
  const compactedBundle = compactBundleForPrompt(bundle, [errorSummary], 50_000);
  const planPrompt = `You are Maris AI's Repair Planner. Given a broken/incomplete bundle and a repair instruction, decide WHICH FILES need to change — do NOT write any file content yet, only the plan.

INSTRUCTION:
${errorSummary.slice(0, 6000)}

CURRENT BUNDLE (relevant files):
${compactedBundle}

Output STRICT JSON only:
{"plan":[{"path":"src/App.tsx","action":"rewrite","reason":"corrupted, cut mid-generation"},{"path":"src/pages/Dashboard.tsx","action":"create","reason":"missing page referenced by App.tsx route"}]}

RULES:
- action is exactly one of: "rewrite" (file exists but is broken/incomplete), "create" (file is missing entirely), "delete" (file should be removed).
- List EVERY file that genuinely needs a change — don't omit any to save space, this step is cheap.
- Do not include files that are already correct and don't need touching.
- Output ONLY the JSON object.`;

  try {
    const response = await createClaudeMessageWithFallback("patcher", model, {
      max_tokens: 8000,
      system: "Output JSON only. No markdown, no explanation outside the JSON object.",
      messages: [{ role: "user", content: planPrompt }],
    });
    const raw = (response.content[0] as any).text ?? "";
    const parsed = extractJsonObject<{ plan?: MultiFilePlanItem[] }>(raw);
    if (!parsed || !Array.isArray(parsed.plan) || parsed.plan.length === 0) return null;
    return parsed.plan.filter((p) => p && typeof p.path === "string" && p.action);
  } catch {
    return null;
  }
}

async function generateSingleFileContent(
  bundle: string,
  filePath: string,
  action: "rewrite" | "create",
  reason: string,
  errorSummary: string,
  language: GenLanguage,
  model: string,
): Promise<string | null> {
  // ENCONTRADO en producción (caso real: proyecto con 23-24 archivos
  // bloqueantes detectados por el PM Agent, el Patcher Agent multi-archivo
  // fallaba con "0/1 archivo(s) completados" en bucle): pedir el contenido
  // de un archivo grande (ej. App.tsx de un proyecto complejo) ENVUELTO EN
  // JSON ({"content":"..."}) añade overhead real de escapado (cada salto
  // de línea se convierte en \n, cada comilla en \", etc.) que infla el
  // tamaño necesario en tokens de salida. Si el modelo se queda sin
  // presupuesto de max_tokens a mitad de generar ese string JSON (muy
  // plausible con un archivo real de cientos de líneas), la respuesta se
  // corta con una comilla sin cerrar — extractJsonObject (que busca un
  // '{'...'}' balanceado) NUNCA encuentra el cierre y devuelve null SIN
  // recuperar nada del contenido real ya generado, indistinguible de
  // cualquier otro tipo de fallo. CONFIRMADO con código real ejecutado
  // simulando exactamente este truncamiento. FIX: igual que ya hace
  // CoreOrchestrator.ts (mucho más probado en producción hoy mismo) —
  // pedir el código como TEXTO PLANO directo, sin envoltorio JSON, con
  // limpieza de fences markdown al final. Sin el overhead de escapado, y
  // si AÚN así se trunca, el contenido parcial real queda disponible
  // (aunque se descarte por la validación de longitud mínima existente)
  // en vez de perderse dentro de un JSON roto sin ningún diagnóstico.
  const isTS = language === "typescript";
  const existingFile = bundleFilesForPrompt(bundle).find((f) => f.path === filePath);
  const compactedBundle = compactBundleForPrompt(bundle, [filePath, errorSummary], 40_000);

  const systemPrompt = `You are Maris AI's Single-File Repair Engineer — generate ONE complete, working file.
${isTS ? "TypeScript (.tsx/.ts): include proper type annotations." : "JavaScript (.jsx/.js): no TypeScript syntax."}
ALL user-visible copy MUST be in Spanish (es-ES). Code identifiers in English.

ROUTING — this project uses "wouter", NOT react-router-dom. This is the #1 source of broken repairs — do not mix the two APIs:
- Navigation: \`const [location, setLocation] = useLocation();\` then \`setLocation("/path")\` to navigate. wouter has NO "useNavigate" hook — never import or call useNavigate, it does not exist in this package and the import will crash the whole app at runtime.
- Links: \`import { Link } from "wouter"\` then \`<Link href="/path">text</Link>\` (prop is "href", not "to").
- Route params: \`const [match, params] = useRoute("/users/:id");\` then \`params.id\`.
- If other files in this bundle already import from "wouter" with a certain pattern, follow that exact pattern for consistency — do not introduce a different routing library's conventions even if they're more common in general React knowledge.

Output EXCLUSIVELY the raw file content. No JSON wrapper, no markdown fences, no explanation before or after — just the code, starting from the first line of the file.`;

  const userPrompt = action === "create"
    ? `Create this NEW file from scratch: ${filePath}\nReason: ${reason}\nOriginal repair instruction (for context/consistency with the rest of the app):\n${errorSummary.slice(0, 1500)}\n\nOTHER FILES IN THIS BUNDLE (for context — shared types, components, styling conventions, routing):\n${compactedBundle}\n\nReturn ONLY the complete raw content of ${filePath}, no JSON, no markdown.`
    : `Rewrite this BROKEN file completely: ${filePath}\nReason it's broken: ${reason}\nOriginal repair instruction:\n${errorSummary.slice(0, 1500)}\n\nCURRENT (BROKEN) CONTENT of ${filePath}:\n${existingFile?.content?.slice(0, 8000) || "(file content not found in bundle — treat as needing full reconstruction based on context below)"}\n\nOTHER FILES IN THIS BUNDLE (for context — imports, shared types, routing that must stay consistent):\n${compactedBundle}\n\nReturn ONLY the complete fixed raw content of ${filePath}, no JSON, no markdown.`;

  try {
    const response = await createClaudeMessageWithFallback("patcher", model, {
      max_tokens: 24000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const raw = (response.content[0] as any).text ?? "";
    // Limpieza de fences markdown que el modelo a veces añade a pesar de
    // la instrucción — mismo patrón ya usado y probado en CoreOrchestrator.
    const content = raw
      .trim()
      .replace(/^```(?:tsx?|jsx?|typescript|javascript)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
    if (content.length < 20) return null;

    const knownBadImport = findKnownBadImport(content);
    if (knownBadImport) {
      // No aceptar contenido con un import que sabemos, con certeza, que no
      // existe en el paquete real (caso real: useNavigate importado de
      // wouter — esa función no existe en ese paquete, crashea la app
      // entera en runtime con "module does not provide an export named...",
      // y esbuild NO lo detecta porque no resuelve tipos/exports reales del
      // paquete, solo sintaxis). Devolver null aquí activa el único
      // reintento automático ya existente en patchBundleMultiFile.
      return null;
    }
    return content;
  } catch {
    return null;
  }
}

// Patrones de imports conocidos como rotos para las librerías que el
// Frontend Engineer tiene permitido usar — contaminación frecuente del
// modelo con la API de una librería más popular y similar (ej: confundir
// wouter con react-router-dom). Lista corta y de mantenimiento bajo:
// añadir aquí solo cuando se confirme un caso real en producción, no
// especular con problemas hipotéticos.
const KNOWN_BAD_IMPORT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /import\s*\{[^}]*\buseNavigate\b[^}]*\}\s*from\s*["']wouter["']/,
    reason: "useNavigate no existe en wouter (es de react-router-dom) — wouter usa useLocation()[1] para navegar",
  },
  {
    pattern: /import\s*\{[^}]*\buseHistory\b[^}]*\}\s*from\s*["']wouter["']/,
    reason: "useHistory no existe en wouter — wouter usa useLocation()[1] para navegar",
  },
];

function findKnownBadImport(content: string): string | null {
  for (const { pattern, reason } of KNOWN_BAD_IMPORT_PATTERNS) {
    if (pattern.test(content)) return reason;
  }
  return null;
}

export async function patchBundleMultiFile(
  bundle: string,
  errorSummary: string,
  language: GenLanguage = "typescript",
  model: string = "claude-sonnet-4-6",
  onProgress?: (message: string) => void,
): Promise<{ result: string | null; filesAttempted: number; filesSucceeded: number }> {
  const emit = onProgress || (() => {});

  emit("🗺️ Planificando qué archivos necesitan cambiarse…");
  const plan = await planMultiFileRepair(bundle, errorSummary, language, model);
  if (!plan || plan.length === 0) {
    emit("⚠️ No se pudo generar un plan de reparación multi-archivo.");
    return { result: null, filesAttempted: 0, filesSucceeded: 0 };
  }
  emit(`📋 Plan: ${plan.length} archivo(s) — ${plan.map((p) => `${p.action}:${p.path}`).join(", ")}`);

  let currentBundle = bundle;
  const changedFiles: Record<string, string> = {};
  const deletedFiles: string[] = [];
  let filesSucceeded = 0;

  for (const item of plan) {
    if (item.action === "delete") {
      deletedFiles.push(item.path);
      filesSucceeded++;
      emit(`🗑️ ${item.path} marcado para eliminar.`);
      continue;
    }
    emit(`✏️ Generando ${item.path} (${item.action === "create" ? "nuevo archivo" : "reescritura completa"})…`);

    let content = await generateSingleFileContent(currentBundle, item.path, item.action, item.reason, errorSummary, language, model);
    if (!content) {
      // Un reintento por archivo — si falla dos veces, se sigue con el resto
      // del plan en vez de abortar toda la reparación por un solo archivo.
      emit(`🔁 Reintentando ${item.path}…`, );
      content = await generateSingleFileContent(currentBundle, item.path, item.action, item.reason, errorSummary, language, model);
    }

    if (!content) {
      emit(`❌ No se pudo generar ${item.path} tras 2 intentos — se conserva el contenido anterior de este archivo.`, );
      continue;
    }

    changedFiles[item.path] = content;
    // Fusionar inmediatamente para que el siguiente archivo del plan tenga
    // contexto actualizado (ej: si Dashboard.tsx importa algo de App.tsx que
    // se acaba de corregir, debe verlo ya corregido, no el original roto).
    currentBundle = mergePatchIntoBundle(currentBundle, { [item.path]: content }, []);
    filesSucceeded++;
    emit(`✅ ${item.path} generado (${Math.round(content.length / 1000)} KB).`);
  }

  if (filesSucceeded === 0) {
    return { result: null, filesAttempted: plan.length, filesSucceeded: 0 };
  }

  const merged = mergePatchIntoBundle(bundle, changedFiles, deletedFiles);
  if (!merged || merged.length < 100) {
    return { result: null, filesAttempted: plan.length, filesSucceeded };
  }
  return { result: merged, filesAttempted: plan.length, filesSucceeded };
}
