/**
 * Deterministic chat-intent router for Maris AI.
 *
 * The product must not spend credits or enqueue code-generation jobs when the
 * user is asking for data/CRM/database operations, research, or plain answers.
 * This classifier acts as the first gate before credits, queues, file writes or
 * bundle generation. It deliberately separates two platform engines:
 *
 *   - ENGINE_DEV: build/edit code, UI, APIs, pages, components, workflows.
 *   - ENGINE_EXEC: operate on data, credentials, CRM records, MongoDB/API state.
 *
 * The legacy buckets `question`, `research` and `edit` are kept for backward
 * compatibility with existing route logic. `edit` maps to ENGINE_DEV and the new
 * `execute` bucket maps to ENGINE_EXEC.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Logger } from "pino";

export type ChatIntent = "question" | "research" | "edit" | "execute";
export type ExecutionEngine = "ENGINE_DEV" | "ENGINE_EXEC" | "ENGINE_INFO" | "ENGINE_RESEARCH";

export type ClassifiedIntent = {
  intent: ChatIntent;
  engine: ExecutionEngine;
  /** Short Spanish reply for `intent === "question"`. Always empty for the others. */
  reply: string;
  /** Deterministic reason useful for logs/UI badges. */
  reason: string;
};

/**
 * Words that indicate the user is asking the running platform to operate on
 * production data/state instead of rebuilding source files.
 */
const EXEC_KEYWORD_PATTERNS: RegExp[] = [
  /\b(registra|registrar|registro|alta|dar\s+de\s+alta)\b/i,
  /\b(insertar|inserta|inyectar|guarda|guardar|persistir|grabar)\b/i,
  /\b(mongodb|mongo\s*db|base\s+de\s+datos|bbdd|database|colecci[oó]n|collection)\b/i,
  /\b(crm|ventas|comercial(?:es)?|agente\s+comercial|lead|cliente|pipeline)\b/i,
  /\b(credenciales|password|contrase[ñn]a|email|correo|usuario|rol|permisos)\b/i,
  /\b(eliminar|borra|borrar|desactivar|revocar)\b.*\b(usuario|cliente|registro|lead|credenciales|crm|mongodb|base\s+de\s+datos)\b/i,
];

const DEV_KEYWORD_PATTERNS: RegExp[] = [
  /\b(bot[oó]n|p[aá]gina|componente|dise[ñn]o|estilo|maquetaci[oó]n|layout|css|html|react|tailwind|frontend|backend|api|endpoint|workflow|flujo)\b/i,
  /\b(a[ñn]ad[eaií]|agreg[aeo]|sum[aeo]|incluy[ae])\b.*\b(bot[oó]n|p[aá]gina|secci[oó]n|componente|campo|formulario|men[uú]|card|tarjeta|vista)\b/i,
  /\b(camb[ií]a?|modif[ií]c[aeo]|edit[aeo]|ajust[aeo]|actualiz[aeo])\b.*\b(c[oó]digo|dise[ñn]o|texto|color|estilo|vista|app|web|frontend|backend)\b/i,
  /\b(haz|hacer|crea|cr[eé]ame|construy[ae]|gener[aeo]|desarrolla|programa)\b.*\b(app|web|landing|dashboard|crm|panel|tienda|saas|juego|p[aá]gina)\b/i,
  /\b(arregl[aeo]|repar[aeo]|fix(?:ea)?|corrij[aeo]|debug)\b/i,
  /\b(rehaz|reescrib[ea]|redise[ñn][aeo]|refactoriz[aeo]|reempl[aá]z[aeo]|sustituy[ea])\b/i,
];

/** Legacy edit detector kept as a safety net for clear build requests. */
function looksLikeEdit(message: string): boolean {
  return DEV_KEYWORD_PATTERNS.some((re) => re.test(message));
}

function looksLikeExecution(message: string): boolean {
  return EXEC_KEYWORD_PATTERNS.some((re) => re.test(message));
}

export type ClassifierContext = {
  appTitle: string;
  appDescription: string;
  /** Persistent agent notes for the app (best effort, may be empty). */
  agentNotes?: string;
  /** Recent chat turns oldest → newest. */
  recentMessages: { role: "user" | "assistant" | string; content: string }[];
  message: string;
  log: Logger;
};

/** Quick local heuristic so we can short-circuit obvious research requests. */
const URL_LIKE = /(https?:\/\/|www\.)\S+/i;
const RESEARCH_TRIGGERS = [
  "busca en",
  "buscame",
  "búscame",
  "investiga",
  "mira la web",
  "mira en internet",
  "consulta",
];

function looksLikeResearch(message: string): boolean {
  const lower = message.toLowerCase();
  if (URL_LIKE.test(message)) return true;
  return RESEARCH_TRIGGERS.some((t) => lower.includes(t));
}

const SYSTEM_PROMPT = `Eres el enrutador determinista de intención de Maris AI.

Tu trabajo: leer el último mensaje del usuario en el chat de UNA app YA EXISTENTE y decidir qué motor debe ejecutarlo. Devuelves SOLO un JSON:

{"intent":"question"|"research"|"edit"|"execute","reply":"...","reason":"..."}

Reglas estrictas:

- "execute" = ENGINE_EXEC. El usuario pide operar sobre datos o estado real: registrar/insertar/guardar/eliminar usuarios, leads, clientes, credenciales, CRM, ventas, MongoDB, APIs de producción o bases de datos. NO se modifica código, NO se genera bundle, NO se compila. "reply" debe ir vacío.

- "edit" = ENGINE_DEV. El usuario quiere construir o cambiar código fuente: diseño, maquetación, lógica de negocio, botones, páginas, componentes, estilos, APIs, endpoints, workflows, deploy/preview o correcciones de la app. "reply" debe ir vacío.

- "research" = ENGINE_RESEARCH. El usuario pide buscar información externa o revisar una URL sin cambiar la app. "reply" debe ir vacío.

- "question" = ENGINE_INFO. El usuario pregunta algo sobre la app o Maris AI y no pide ninguna operación. En este caso "reply" debe contener una respuesta clara y útil en ESPAÑOL, máximo 500 caracteres, sin saludos ni cierres tipo "¿algo más?".

Prioridad: si hay una operación de datos/CRM/credenciales/MongoDB, elige "execute" aunque aparezcan verbos como añadir o eliminar. Si hay petición clara de código/UI/app, elige "edit". En caso de duda entre edit y question, elige "edit". No uses Markdown en "reply"; texto plano. No expliques tu razonamiento, solo el JSON.`;

function engineForIntent(intent: ChatIntent): ExecutionEngine {
  switch (intent) {
    case "execute": return "ENGINE_EXEC";
    case "research": return "ENGINE_RESEARCH";
    case "question": return "ENGINE_INFO";
    case "edit":
    default: return "ENGINE_DEV";
  }
}

function buildUserMessage(ctx: ClassifierContext): string {
  const lines: string[] = [];
  lines.push(`Título de la app: ${ctx.appTitle}`);
  if (ctx.appDescription) {
    lines.push(`Descripción: ${ctx.appDescription}`);
  }
  if (ctx.agentNotes && ctx.agentNotes.trim().length > 0) {
    const trimmed = ctx.agentNotes.trim().slice(0, 1500);
    lines.push(`Notas del agente sobre la app:\n${trimmed}`);
  }
  if (ctx.recentMessages.length > 0) {
    lines.push("");
    lines.push("Últimos mensajes del chat (orden cronológico):");
    for (const m of ctx.recentMessages) {
      const role = m.role === "user" ? "Usuario" : "Asistente";
      const content = m.content.slice(0, 400).replace(/\s+/g, " ").trim();
      lines.push(`- ${role}: ${content}`);
    }
  }
  lines.push("");
  lines.push(`Nuevo mensaje del usuario:\n"""${ctx.message}"""`);
  lines.push("");
  lines.push("Devuelve SOLO el JSON descrito.");
  return lines.join("\n");
}

function parseClassifierJson(raw: string): ClassifiedIntent | null {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(s.slice(first, last + 1));
  } catch {
    return null;
  }
  const intent = parsed?.intent;
  if (intent !== "question" && intent !== "research" && intent !== "edit" && intent !== "execute") {
    return null;
  }
  const reply = typeof parsed?.reply === "string" ? parsed.reply.trim() : "";
  const reason = typeof parsed?.reason === "string" ? parsed.reason.trim().slice(0, 180) : "model";
  return {
    intent,
    engine: engineForIntent(intent),
    reply: intent === "question" ? reply.slice(0, 800) : "",
    reason,
  };
}

const TIMEOUT_MS = 7_000;

export async function classifyChatIntent(
  ctx: ClassifierContext,
): Promise<ClassifiedIntent> {
  const execution = looksLikeExecution(ctx.message);
  const edit = looksLikeEdit(ctx.message);
  const research = looksLikeResearch(ctx.message);

  // ENGINE_EXEC has priority over generic edit verbs such as "añadir" when the
  // object is a user, credential, CRM record, MongoDB row/document, etc.
  if (execution && !edit) {
    ctx.log.info({ reason: "exec-keyword heuristic" }, "Intent classifier short-circuit → execute");
    return { intent: "execute", engine: "ENGINE_EXEC", reply: "", reason: "exec-keyword heuristic" };
  }

  if (execution && /\b(mongodb|base\s+de\s+datos|crm|credenciales|usuario|password|contrase[ñn]a|ventas|comercial|lead|cliente)\b/i.test(ctx.message)) {
    ctx.log.info({ reason: "exec-priority heuristic" }, "Intent classifier short-circuit → execute");
    return { intent: "execute", engine: "ENGINE_EXEC", reply: "", reason: "exec-priority heuristic" };
  }

  if (edit) {
    ctx.log.info({ reason: "dev-keyword heuristic" }, "Intent classifier short-circuit → edit");
    return { intent: "edit", engine: "ENGINE_DEV", reply: "", reason: "dev-keyword heuristic" };
  }

  if (research) {
    ctx.log.info({ reason: "research heuristic" }, "Intent classifier short-circuit → research");
    return { intent: "research", engine: "ENGINE_RESEARCH", reply: "", reason: "research heuristic" };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const userContent = buildUserMessage(ctx);
    const result: any = await (anthropic.messages.create as any)(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      },
      { signal: controller.signal },
    );
    const blocks: any[] = result?.content ?? [];
    const text = blocks
      .filter((b) => b?.type === "text" && typeof b?.text === "string")
      .map((b) => b.text as string)
      .join("\n")
      .trim();
    const parsed = parseClassifierJson(text);
    if (!parsed) {
      ctx.log.warn({ rawSnippet: text.slice(0, 200), heuristicResearch: research }, "Intent classifier returned unparseable JSON — defaulting to edit");
      return { intent: "edit", engine: "ENGINE_DEV", reply: "", reason: "fallback-unparseable" };
    }
    ctx.log.info({ intent: parsed.intent, engine: parsed.engine, replyLen: parsed.reply.length, reason: parsed.reason }, "Intent classifier decision");
    return parsed;
  } catch (err) {
    ctx.log.warn({ err, heuristicResearch: research }, "Intent classifier failed — defaulting to edit");
    return { intent: "edit", engine: "ENGINE_DEV", reply: "", reason: "fallback-error" };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
