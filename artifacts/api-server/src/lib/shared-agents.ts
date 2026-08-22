export { anthropic as zocoia } from "@workspace/integrations-anthropic-ai";
// MOTOR DE IA: Ollama local propio de Maris AI.
// Todo el pipeline multi-agente (Researcher, Architect, Designer, Frontend,
// Backend, QA, Patcher, Repair y chat) utiliza los modelos instalados en Hetzner.
// Configuración: MARIS_LLM_URL + MARIS_LLM_API_KEY.
import { anthropic as claude, resolveClaudeModel, CLAUDE_MODELS } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import { recordApiUsage } from "./usageMeter";

// ─── Canal secundario: intento NO-streaming contra el gateway local ─────────
// Útil cuando el streaming se corta a mitad (parpadeo de red, proxy, etc.):
// una llamada messages.create simple suele completarse aunque el stream falle.
async function callClaudeNonStreaming(role: AgentRole, params: any, modelHint?: string): Promise<{ content: Array<{ type: string; text: string }> }> {
  const model = resolveClaudeModel(modelHint || CLAUDE_MODELS.standard);
  logger.warn({ role, model }, "⚡ Segundo intento no-streaming contra Ollama (messages.create)");

  const response: any = await raceWithTimeout(
    claude.messages.create({
      model,
      max_tokens: params.max_tokens || 4096,
      temperature: params.temperature ?? 0.7,
      ...(params.system ? { system: params.system } : {}),
      messages: params.messages || [],
    }) as unknown as Promise<any>,
    AI_CALL_TIMEOUT_MS * 2,
    `${role} Ollama non-streaming (modelo ${model})`,
  );

  const text = (response?.content || [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text || "")
    .join("");

  recordApiUsage({
    jobId: undefined,
    model,
    inputTokens: response?.usage?.input_tokens || 0,
    outputTokens: response?.usage?.output_tokens || 0,
    agent: `${role}-fallback`,
  });

  return { content: [{ type: "text", text }] };
}

/* --------------- Compatibilidad de formato (legado DeepSeek) --------------- */
// El pipeline se ejecutaba antes sobre DeepSeek-R1/Ollama. Claude no necesita
// estas reglas, pero se mantiene una versión neutra de la constante y el
// limpiador stripReasoning por compatibilidad con el código existente.

// Regla de formato seguro que se inyecta al final de TODOS los system prompts.
export const DEEPSEEK_SAFE_FORMAT_RULE =
  "\n\nIMPORTANT: Return the absolute raw code inside the file contents. Do not wrap code blocks in metadata definitions. " +
  "Never output field descriptions, JSON schemas or placeholders instead of the real code — always emit the complete, working file content. " +
  "When asked for JSON, return a single pure JSON object with no markdown fences and no commentary.";

// DeepSeek-R1 emite su razonamiento en <think>...</think> (o como campo
// reasoning_content). Si ese razonamiento se cuela en la respuesta, contamina
// el código generado y rompe el parseo — se elimina SIEMPRE antes de devolver.
export function stripReasoning(text: string): string {
  if (!text) return "";
  let out = String(text);
  out = out.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Corte a mitad de razonamiento: si abre <think> y nunca cierra, quedarse
  // con lo anterior; si el texto EMPIEZA dentro de un razonamiento sin
  // apertura (p.ej. streaming resumido) y aparece un cierre huérfano,
  // quedarse con lo posterior al cierre.
  const openIdx = out.indexOf("<think>");
  if (openIdx !== -1 && out.indexOf("</think>", openIdx) === -1) out = out.slice(0, openIdx);
  const orphanClose = out.indexOf("</think>");
  if (orphanClose !== -1 && out.lastIndexOf("<think>", orphanClose) === -1) out = out.slice(orphanClose + "</think>".length);
  return out.trim();
}

// Convierte system (string o bloques) a texto plano.
function systemToText(system: any): string {
  if (!system) return "";
  return typeof system === "string"
    ? system
    : (system as any[]).map((b: any) => b?.text || "").join("\n");
}


// Traducción de alias heredados al modelo propio de Maris AI.
export function marisModelFor(model: string): string {
  return resolveClaudeModel(model);
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

export type AgentRole = "researcher" | "architect" | "designer" | "frontend" | "backend" | "database" | "integrator" | "qa" | "devops" | "patcher" | "repair" | "system" | "memory" | "validator" | "testing" | "fixing" | "patching" | "coder" | "visual-evaluator" | "chat" | "classifier" | "crew" | "rag" | "tools" | "planner" | "data-ops" | "error-analysis" | "image-analysis" | "code-review" | "gating";

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

/**
 * Reemplaza extractJsonObject para el plan de reparación multi-archivo
 * (planMultiFileRepair) — formato de etiquetas tipo XML en vez de JSON.
 * ENCONTRADO en producción (caso real: PM Agent detectó 23-24 blockers en
 * un proyecto complejo): con un plan de 25-30 archivos, un corte de
 * tokens a mitad de la lista en JSON invalida el array ENTERO — ni
 * siquiera los archivos listados ANTES del corte se recuperan, porque
 * extractJsonObject exige un '{'...'}' balanceado de principio a fin.
 * Aquí cada <file>...</file> es un bloque independiente: la regex solo
 * recoge bloques que cerraron por completo, así que un corte a mitad del
 * archivo N nunca invalida los N-1 anteriores, que sí llegaron a
 * cerrarse. No usa el flag "s" (dotAll) de regex porque Node soporta esa
 * sintaxis desde ES2018, pero [\\s\\S] es equivalente y evita cualquier
 * duda de compatibilidad — capturas no codiciosas (.*?) para no
 * desbordarse hacia el siguiente bloque <file> si hay varios.
 */
export function extractResilientFilePlan(raw: string): MultiFilePlanItem[] {
  const plans: MultiFilePlanItem[] = [];
  const fileRegex = /<file>\s*<path>([\s\S]*?)<\/path>\s*<action>(rewrite|create|delete)<\/action>\s*<reason>([\s\S]*?)<\/reason>\s*<\/file>/g;
  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(raw)) !== null) {
    const path = match[1].trim();
    if (!path) continue;
    plans.push({
      path,
      action: match[2] as "rewrite" | "create" | "delete",
      reason: match[3].trim(),
    });
  }
  return plans;
}

export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// Modelos del motor propio disponibles como cadena de fallback.
const MARIS_MODELS = [CLAUDE_MODELS.standard, CLAUDE_MODELS.max, CLAUDE_MODELS.fast];

function fallbackMarisModels(model: string): string[] {
  // El modelo solicitado actúa de primario; el resto del motor propio queda
  // como respaldo sin salir de la infraestructura de Maris AI.
  const primary = resolveClaudeModel(model);
  return [primary, ...MARIS_MODELS.filter((m) => m !== primary)];
}

// Timeout duro para cualquier llamada a un proveedor de IA dentro de este
// archivo. Sin esto, una llamada no-streaming (zocoia.messages.create,
// Gemini, OpenAI) puede colgarse minutos si el proveedor se degrada, sin
// ningún chunk que activar un timeout de inactividad (eso solo aplica a
// streams) — el job entero queda en silencio hasta que el watchdog global
// (12 min) lo reinicia desde cero, perdiendo todo el trabajo ya hecho.
export async function raceWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
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
export const AI_CALL_TIMEOUT_MS = 90_000;

export async function createZocoMessageWithFallback(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  let lastError: unknown;
  const MAX_RETRIES = 2;

  const MIN_CACHEABLE_CHARS = 3500; 
  if (typeof params.system === "string" && params.system.length >= MIN_CACHEABLE_CHARS) {
    params = {
      ...params,
      system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
    };
  }

  if (params.messages && params.messages.length > 10) {
    logger.info({ role, originalLength: params.messages.length }, "CONTEXT OPTIMIZER: Comprimiendo historial...");
    const systemInstruction = params.messages[0].role === "system" ? params.messages.shift() : null;
    const lastUserMessage = params.messages.pop();
    const middleMessages = params.messages.slice(-4);
    const firstMessage = params.messages[0];
    
    params.messages = [
      ...(systemInstruction ? [systemInstruction] : []),
      firstMessage,
      { role: "user", content: "... [Contexto antiguo comprimido] ..." },
      ...middleMessages,
      lastUserMessage
    ].filter(Boolean);
  }

  // MOTOR OLLAMA LOCAL: se llama al gateway propio de Maris AI con streaming usando
  // el formato Messages nativo (system + messages con bloques). La firma y el
  // formato de retorno ({content:[{type:'text',text}]}) se mantienen idénticos
  // para que los 18+ consumidores del pipeline no necesiten cambios. Si el
  // modelo primario falla, se recorre la cadena de fallback de Claude.
  const candidates = fallbackMarisModels(model);

  for (const claudeModel of candidates) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await new Promise(r => setTimeout(r, Math.random() * 500));

        logger.info({ role, model: claudeModel }, "Iniciando stream con Ollama local...");

        let fullText = "";
        let usageInputTokens = 0;
        let usageOutputTokens = 0;
        const stream = claude.messages.stream({
          model: claudeModel,
          max_tokens: params.max_tokens || 4096,
          temperature: params.temperature ?? 0.7,
          ...(params.system ? { system: params.system } : {}),
          messages: params.messages || [],
        });

        // TIMEOUT DE INACTIVIDAD REAL por CHUNK (no al stream entero, que
        // puede tardar legítimamente varios minutos en archivos grandes): si
        // pasan AI_CALL_TIMEOUT_MS sin recibir ni un solo evento nuevo, se
        // considera colgado y se pasa al siguiente intento/modelo.
        const iterator = (stream as any)[Symbol.asyncIterator]();
        while (true) {
          const { value: chunk, done } = await raceWithTimeout(
            iterator.next(),
            AI_CALL_TIMEOUT_MS,
            `${role} stream chunk (modelo ${claudeModel})`,
          ) as { value: any; done: boolean };
          if (done) break;
          // Formato de eventos compatible expuesto por el gateway local.
          if (chunk?.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
            fullText += chunk.delta.text;
          }
          if (chunk?.type === "message_start" && chunk.message?.usage) {
            usageInputTokens = chunk.message.usage.input_tokens ?? usageInputTokens;
          }
          if (chunk?.type === "message_delta" && chunk.usage) {
            usageOutputTokens = chunk.usage.output_tokens ?? usageOutputTokens;
          }
        }

        fullText = stripReasoning(fullText);
        if (!fullText) throw new Error("Stream vacío");

        recordApiUsage({
          jobId: meterOpts?.jobId,
          model: claudeModel,
          inputTokens: usageInputTokens,
          outputTokens: usageOutputTokens,
          agent: role,
        });

        return { content: [{ type: "text", text: fullText }] };

      } catch (err: any) {
        lastError = err;
        const isRateLimit = err?.status === 429 || String(err).includes("rate_limit_exceeded");
        const isOverloaded = err?.status === 529 || String(err).includes("overloaded_error");
        const isTransient = isRateLimit || isOverloaded
          || err?.status >= 500
          || /timed out|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|network|fetch failed|Stream vacío/i.test(String(err?.message || err));

        if (isTransient && attempt < MAX_RETRIES - 1) {
          const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
          logger.warn({ role, model: claudeModel, attempt, delay, isRateLimit, isOverloaded }, "Fallo transitorio; reintentando...");
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        logger.warn({ role, model: claudeModel, err }, "Streaming de Claude falló con este modelo; probando siguiente candidato");
        break;
      }
    }
  }

  const finalErrorText = String((lastError as any)?.message || lastError || "");
  if (/timed out|timeout|HTTP 5\d\d|aborted|fetch failed/i.test(finalErrorText)) {
    logger.warn({ role, finalErrorText }, "El motor local agotó el límite o devolvió 5xx; se cierra el job sin una llamada secundaria redundante");
    throw lastError instanceof Error ? lastError : new Error(finalErrorText || "El motor local no respondió");
  }

  logger.warn({ role }, "Canal streaming de Claude falló — intentando canal secundario no-streaming (messages.create)...");
  try {
    const fb = await callClaudeNonStreaming(role, params, model);
    fb.content = fb.content.map((b: any) => (b.type === "text" ? { ...b, text: stripReasoning(b.text) } : b));
    if (!fb.content.some((b: any) => b.type === "text" && b.text)) {
      throw new Error("Respuesta vacía del canal secundario");
    }
    return fb;
  } catch (fallbackErr) {
    logger.error({ role, fallbackErr }, "Canal secundario no-streaming de Claude también falló");
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

/**
 * Variante de createZocoMessageWithFallback para llamadas con tool-calling
 * (bucles agenticos como marisCrewAI.ts y agentTools.ts).
 *
 * MOTOR CLAUDE NATIVO: Claude soporta tool calling de primera clase con el
 * MISMO protocolo que ya hablan los bucles agenticos existentes (tools con
 * input_schema, bloques tool_use/tool_result, stop_reason, tool_choice) —
 * los parámetros se pasan prácticamente tal cual a messages.create y la
 * respuesta nativa se devuelve sin transformación, así agentTools.ts y
 * marisCrewAI.ts siguen funcionando SIN ningún cambio.
 *
 * RESPALDO JSON PURO: se mantiene como última red de seguridad — si por
 * cualquier motivo la llamada con tools falla de forma persistente, se
 * reintenta sin tools instruyendo al modelo para devolver un JSON puro
 * {"tool": "nombre", "input": {...}} que el backend parsea con
 * extractJsonObject.
 */
export async function createZocoToolCallWithFallback(role: AgentRole, model: string, params: any, meterOpts?: { jobId?: string }): Promise<any> {
  let lastError: unknown;
  const MAX_RETRIES = 3;

  const systemText = systemToText(params.system);
  const hasTools = Array.isArray(params.tools) && params.tools.length > 0;

  // Instrucción de respaldo (JSON puro) para el último intento sin tools.
  const jsonFallbackSystem = () => {
    const toolList = (params.tools as any[]).map((t: any) => `- ${t.name}: ${t.description || ""}\n  input schema: ${JSON.stringify(t.input_schema || {})}`).join("\n");
    return `${systemText}\n\nAVAILABLE TOOLS:\n${toolList}\n\nTo call a tool, respond with ONLY a pure JSON object (no markdown fences, no commentary): {"tool": "<tool_name>", "input": { ...arguments... }}. If no tool is needed, respond with your final answer as plain text.`;
  };

  const candidates = fallbackMarisModels(model);
  for (const claudeModel of candidates) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const request: any = {
          model: claudeModel,
          max_tokens: params.max_tokens || 2048,
          temperature: params.temperature ?? 0.7,
          ...(params.system ? { system: params.system } : {}),
          messages: params.messages || [],
        };
        if (hasTools) {
          request.tools = params.tools;
          if (params.tool_choice) request.tool_choice = params.tool_choice;
        }
        const resp: any = await raceWithTimeout(
          claude.messages.create(request) as unknown as Promise<any>,
          AI_CALL_TIMEOUT_MS,
          `${role} tool call (modelo ${claudeModel})`,
        );
        // La respuesta nativa de Claude ya trae content blocks (text/tool_use),
        // stop_reason y usage {input_tokens, output_tokens} — formato idéntico
        // al que esperan los bucles agenticos. Solo se normaliza usage.
        recordApiUsage({
          jobId: meterOpts?.jobId,
          model: claudeModel,
          inputTokens: resp?.usage?.input_tokens || 0,
          outputTokens: resp?.usage?.output_tokens || 0,
          agent: role,
        });
        return {
          content: resp?.content || [],
          stop_reason: resp?.stop_reason || "end_turn",
          usage: {
            input_tokens: resp?.usage?.input_tokens ?? 0,
            output_tokens: resp?.usage?.output_tokens ?? 0,
          },
        };
      } catch (err: any) {
        lastError = err;
        const isRateLimit = err?.status === 429 || String(err).includes("rate_limit_exceeded");
        const isOverloaded = err?.status === 529 || String(err).includes("overloaded_error");
        const isTransient = isRateLimit || isOverloaded
          || err?.status >= 500
          || /timed out|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|network|fetch failed/i.test(String(err?.message || err));

        if (isTransient && attempt < MAX_RETRIES - 1) {
          const delay = Math.pow(2, attempt) * 1500 + Math.random() * 1000;
          logger.warn({ role, model: claudeModel, attempt, delay, isRateLimit, isOverloaded }, "Tool call: fallo transitorio; reintentando...");
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        logger.warn({ role, model: claudeModel, err }, "Tool call: fallo con este modelo; probando siguiente candidato");
        break;
      }
    }
  }

  logger.warn({ role }, "Tool call: canal principal falló — intentando respaldo de JSON puro sin tools...");
  try {
    const fbResult = await callClaudeNonStreaming(role, {
      ...params,
      tools: undefined,
      tool_choice: undefined,
      system: hasTools ? jsonFallbackSystem() : systemText,
    }, model);
    const text = stripReasoning(fbResult.content?.[0]?.text || "");
    // También en el respaldo se intenta detectar una tool call JSON pura.
    if (hasTools) {
      const parsed = extractJsonObject<{ tool?: string; input?: any }>(text);
      if (parsed && typeof parsed.tool === "string" && (params.tools as any[]).some((t: any) => t.name === parsed.tool)) {
        return {
          content: [{ type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2, 14)}`, name: parsed.tool, input: parsed.input || {} }],
          stop_reason: "tool_use",
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      }
    }
    return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
  } catch (fallbackErr) {
    logger.error({ role, fallbackErr }, "Respaldo de JSON puro también falló (tool call)");
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
  return `You are Maris AI's testing-agent — the most advanced technical repair expert in the system.\nYour mission: receive a list of errors detected in a React frontend bundle and FIX ALL OF THEM with surgical precision.\nYou are a senior full-stack engineer with 15+ years of experience in React, TypeScript, Vite, Tailwind, and modern web development.\nOutput STRICT JSON only:\n{"changedFiles":{"src/App.tsx":"full updated content for changed file only"},"deletedFiles":[]}\n\nLANGUAGE RULES:\n- ALL user-visible copy MUST be in Spanish (es-ES).\n- Code identifiers, variable names, file names → English only.\n\nSYNTAX REPAIR:\n${tsLine}\n- Remove every ,, patterns.\n- Every brace, bracket, paren and JSX tag must close.\n- Match every import { X } to a named export and every import X from to a default export.\n- Link in wouter v3 already renders as anchor. Never nest <a> inside <Link>.\n\nReturn ONLY changed files, not the full bundle. Output ONLY the JSON object.`;
}

export function buildFastPatchPrompt(): string {
  return `You are Maris AI's Fast Patcher. Apply ONLY the requested change to the frontend bundle.\nOutput STRICT JSON only:\n{"changedFiles":{"src/App.tsx":"full file content here"},"deletedFiles":["src/OldComponent.tsx"]}\n\nOPERATION SEMANTICS — obey the user literally:\n- ADD / AÑADIR / AGREGAR means add the requested element/file/data only. Do not rewrite unrelated content.\n- MODIFY / MODIFICAR / CAMBIAR / EDITAR means alter the existing target only. Do not duplicate it and do not create replacements unless asked.\n- DELETE / ELIMINAR / BORRAR / QUITAR means remove the requested target only. Put removed file paths in deletedFiles; for inline removals, return only the file that contains the removal.\n\nRULES:\n- Identify the exact file(s) that need to change. Usually just 1 file.\n- The key must match the exact filename in the bundle (e.g. "index.html", "src/App.tsx").\n- Return the COMPLETE content of each changed file (not a diff, the full file).\n- Keep ALL other files exactly as they are - do NOT include unchanged files.\n- Never perform a full redesign/rebuild from a small add/modify/delete request.\n- Output ONLY the JSON object. No markdown, no backticks, no explanation.`;
}

export async function patchBundle(
  frontendCode: string,
  issues: QAIssue[],
  language: GenLanguage = "typescript",
  memoryContext: string = "",
  model: string = "zoco-plus",
  jobId?: string,
): Promise<string | null> {
  if (issues.length === 0) return null;

  // MARIS-SHIELD: rechazar reparaciones masivas (>5 archivos distintos).
  // El pipeline clásico de una sola pasada falla matemáticamente con 15+ archivos
  // simultáneos saturando la ventana de contexto. Si hay muchos archivos afectados,
  // el CoreOrchestrator por hitos debe manejar la reparación (1 archivo por llamada).
  const affectedFiles = new Set(issues.map(i => i.file).filter(Boolean));
  if (affectedFiles.size > 5) {
    console.warn(`[MARIS-SHIELD] patchBundle rechazado: ${affectedFiles.size} archivos afectados supera el límite de 5. Delegando al orquestador por hitos.`);
    return null; // El repair agent detectará null y escalará al CoreOrchestrator
  }
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
        const response = await createZocoMessageWithFallback("patcher", model, {
          max_tokens: 24000,
          system: buildPatcherSystemPrompt(language) + "\nOutput JSON only.",
          messages: [
            {
              role: "user",
              content: `ISSUES TO FIX:\n${issueList}\n${memoryContext}\nCURRENT FRONTEND BUNDLE (only the most relevant files are shown — files NOT shown here are unrelated to these issues and must NOT be referenced as missing):\n${compactedBundle}\n\nReturn ONLY the changed/added files as JSON: {\"changedFiles\":{\"path\":\"full content\"},\"deletedFiles\":[\"path\"]}.`,
            },
          ],
        }, { jobId });
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
// Límite absoluto por ciclo: un reparador de calidad no debe convertirse en
// un regenerador de proyectos. Las reparaciones adicionales requieren una
// nueva ejecución explícita y una revisión del diagnóstico anterior.
export const MAX_FILES_PER_REPAIR_CYCLE = 3;

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
  // Search, ListingDetail, Search, ListingDetail, Favorites, Settings, Navbar, Footer, varios
  // hooks y utils): este planificador SOLO devolvía 1 archivo por llamada.
  const issueHints = [errorSummary];
  const compactedBundle = compactBundleForPrompt(bundle, issueHints, 70_000);

  return withTimeout(
    (async () => {
      try {
        const response = await createZocoMessageWithFallback("planner", model, {
          max_tokens: 4000,
          system: `You are Maris AI's multi-file repair planner. Your task is to analyze a frontend bundle and a summary of errors, then propose a plan to fix them across multiple files.\nOutput STRICT XML only, using <file><path>...</path><action>...</action><reason>...</reason></file> tags. Actions can be 'rewrite', 'create', or 'delete'.\n\nERROR SUMMARY:\n${errorSummary}\n\nCURRENT FRONTEND BUNDLE (only the most relevant files are shown — files NOT shown here are unrelated to these issues and must NOT be referenced as missing):\n${compactedBundle}\n\nReturn ONLY the XML plan. No markdown, no backticks, no explanation.`, 
          messages: [
            {
              role: "user",
              content: `Based on the error summary and the provided bundle, generate a plan to fix the issues. Focus on identifying which files need to be rewritten, created, or deleted. For each file, provide a brief reason for the action.`,
            },
          ],
        });
        const raw = (response.content[0] as any).text ?? "";
        const plan = extractResilientFilePlan(raw);
        return plan;
      } catch (err) {
        logger.error({ err }, "Error planning multi-file repair");
        return null;
      }
    })(),
    AI_CALL_TIMEOUT_MS,
    null,
  );
}

async function generateSingleFileContent(
  bundle: string,
  planItem: MultiFilePlanItem,
  errorSummary: string,
  language: GenLanguage,
  model: string,
): Promise<string | null> {
  const { path, action, reason } = planItem;
  if (action === "delete") return null; // Handled by mergePatchIntoBundle

  const issueHints = [path, reason, errorSummary];
  const compactedBundle = compactBundleForPrompt(bundle, issueHints, 70_000);

  return withTimeout(
    (async () => {
      try {
        const response = await createZocoMessageWithFallback("patcher", model, {
          max_tokens: 16000,
          system: `You are Maris AI's single-file repair agent. ${language === "typescript" ? "Return valid TypeScript/TSX." : "Return valid JavaScript/JSX without TypeScript syntax."}\n\nYour current task is to ${action} the file ${path} because: ${reason}.\n\nCRITICAL ROUTING RULE — CATCH-ALL ORDER: if you edit a router using wouter or react-router, the catch-all/NotFound route MUST ALWAYS be the last child of <Switch> or <Routes>. Never place it before real routes.\n\nOutput EXCLUSIVELY the raw file content. Do not wrap it in JSON, Markdown fences, explanations or prose.`,
          messages: [
            {
              role: "user",
              content: `CURRENT FRONTEND BUNDLE (only the most relevant files are shown — files NOT shown here are unrelated to these issues and must NOT be referenced as missing):\n${compactedBundle}\n\nGenerate the complete raw content for ${path}. Return only that file's content.`,
            },
          ],
        });
        const raw = ((response.content[0] as any).text ?? "")
          .trim()
          .replace(/^```(?:[a-zA-Z]+)?\s*/, "")
          .replace(/\s*```$/, "")
          .trim();
        return raw.length >= 20 ? raw : null;
      } catch (err) {
        logger.error({ err, path }, "Error generating file patch");
        return null;
      }
    })(),
    AI_CALL_TIMEOUT_MS,
    null,
  );
}

export async function patchBundleMultiFile(
  frontendCode: string,
  errorSummary: string,
  language: GenLanguage = "typescript",
  model: string = "zoco-plus",
  jobId?: string,
): Promise<string | null> {
  const plan = await planMultiFileRepair(frontendCode, errorSummary, language, model);
  if (!plan || plan.length === 0) return null;
  const boundedPlan = plan.slice(0, MAX_FILES_PER_REPAIR_CYCLE);
  if (plan.length > boundedPlan.length) {
    logger.warn(
      { plannedFiles: plan.length, maxFiles: MAX_FILES_PER_REPAIR_CYCLE, jobId },
      "Multi-file repair limitado por seguridad; los archivos restantes requieren una ejecución posterior",
    );
  }

  let currentBundle = frontendCode;
  const changedFiles: Record<string, string> = {};
  const deletedFiles: string[] = [];

  for (const planItem of boundedPlan) {
    if (planItem.action === "delete") {
      deletedFiles.push(planItem.path);
      continue;
    }

    // Generar el parche para cada archivo, con un reintento si falla
    let fileContent = await generateSingleFileContent(currentBundle, planItem, errorSummary, language, model);
    if (!fileContent) {
      logger.warn({ path: planItem.path }, "Primer intento de generación de archivo fallido, reintentando...");
      fileContent = await generateSingleFileContent(currentBundle, planItem, errorSummary, language, model);
    }

    if (fileContent) {
      changedFiles[planItem.path] = fileContent;
      // Aplicar el cambio al bundle actual para que las siguientes generaciones
      // de archivos tengan el contexto más actualizado.
      currentBundle = mergePatchIntoBundle(currentBundle, { [planItem.path]: fileContent });
    } else {
      logger.error({ path: planItem.path }, "Segundo intento de generación de archivo fallido. Saltando este archivo.");
    }
  }

  if (Object.keys(changedFiles).length === 0 && deletedFiles.length === 0) return null;

  return mergePatchIntoBundle(frontendCode, changedFiles, deletedFiles);
}

export async function createFastPatch(
  frontendCode: string,
  userPrompt: string,
  language: GenLanguage = "typescript",
  model: string = "zoco-plus",
  jobId?: string,
): Promise<string | null> {
  const issueHints = [userPrompt];
  const compactedBundle = compactBundleForPrompt(frontendCode, issueHints, 70_000);

  return withTimeout(
    (async () => {
      try {
        const response = await createZocoMessageWithFallback("patcher", model, {
          max_tokens: 16000,
          system: buildFastPatchPrompt(),
          messages: [
            {
              role: "user",
              content: `USER REQUEST:\n${userPrompt}\n\nCURRENT FRONTEND BUNDLE (only the most relevant files are shown — files NOT shown here are unrelated to this issue and must NOT be referenced as missing):\n${compactedBundle}\n\nReturn ONLY the changed/added files as JSON: {\"changedFiles\":{\"path\":\"full content\"},\"deletedFiles\":[\"path\"]}.`,
            },
          ],
        }, { jobId });
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

export async function createChatCompletion(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  // Implementación similar a createZoco IAMessageWithFallback pero para OpenAI/Gemini
  // Por ahora, simplemente reenvía a createZoco IAMessageWithFallback para simplificar
  // En un entorno real, esto debería tener su propia lógica de fallback para OpenAI/Gemini
  return createZocoMessageWithFallback(role, model, params, meterOpts);
}

export async function createToolCallCompletion(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<any> {
  // Implementación similar a createZoco IAToolCallWithFallback pero para OpenAI/Gemini
  // Por ahora, simplemente reenvía a createZoco IAToolCallWithFallback para simplificar
  // En un entorno real, esto debería tener su propia lógica de fallback para OpenAI/Gemini
  return createZocoToolCallWithFallback(role, model, params, meterOpts);
}

export async function createChatCompletionStream(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<AsyncIterable<any>> {
  // Implementación similar a createZoco IAMessageWithFallback pero para OpenAI/Gemini
  // Por ahora, simplemente reenvía a createZoco IAMessageWithFallback para simplificar
  // En un entorno real, esto debería tener su propia lógica de fallback para OpenAI/Gemini
  const response = await createZocoMessageWithFallback(role, model, params, meterOpts);
  // Convertir la respuesta a un AsyncIterable simulado para compatibilidad
  return (async function* () {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: response.content[0].text } };
  })();
}

export async function createToolCallCompletionStream(
  role: AgentRole,
  model: string,
  params: any,
  meterOpts?: { jobId?: string },
): Promise<AsyncIterable<any>> {
  // Implementación similar a createZoco IAToolCallWithFallback pero para OpenAI/Gemini
  // Por ahora, simplemente reenvía a createZoco IAToolCallWithFallback para simplificar
  // En un entorno real, esto debería tener su propia lógica de fallback para OpenAI/Gemini
  const response = await createZocoToolCallWithFallback(role, model, params, meterOpts);
  // Convertir la respuesta a un AsyncIterable simulado para compatibilidad
  return (async function* () {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: response.content[0].text } };
  })();
}
