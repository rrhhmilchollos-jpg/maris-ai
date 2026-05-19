/**
 * Chat-intent classifier.
 *
 * Every message a user sends in the chat for an existing app used to enqueue
 * a full generation job — even when the message was a plain question
 * ("¿qué colores has usado?", "¿de qué va esta app?") or a research-only
 * request ("busca en stripe.com y dime cómo es su home"). That wasted
 * credits and made the agent feel dumb: it would regenerate the whole app
 * just to answer a question.
 *
 * This module asks Haiku to classify the intent BEFORE we touch credits or
 * the queue. Three buckets:
 *
 *   - "question": the user is asking about the existing app. Answer with
 *     plain text using app metadata + chat history. No code changes.
 *
 *   - "research": the user wants the agent to look something up on the web
 *     (URL, "busca en X.com…"). The route handler will call researchTopic()
 *     and return the brief as a chat reply. No code changes either.
 *
 *   - "edit": the user wants something built or changed. Goes through the
 *     normal generation pipeline (which decides patch vs full internally).
 *
 * The classifier is deliberately conservative: anything ambiguous defaults
 * to "edit" so we never silently refuse to build something the user asked
 * for. A short ≤500-char reply is included for the question case so the
 * route handler can save it directly without a second model call.
 *
 * Failure mode: if the API call throws or returns garbage, we fall back to
 * "edit" — better to do real work than to drop the message on the floor.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Logger } from "pino";

export type ChatIntent = "question" | "research" | "edit";

export type ClassifiedIntent = {
  intent: ChatIntent;
  /** Short Spanish reply for `intent === "question"`. Always empty for the others. */
  reply: string;
};

/**
 * Spanish imperative verbs that signal a real code change. If the user's
 * message contains ANY of these, we override the classifier and force
 * "edit" — even if the model thought it was a question. This is a hard
 * safety net: prompt injection in agent notes / chat history could trick
 * the classifier into "answering" a real edit request and silently
 * dropping the user's work. Better to spend 1 credit than to ignore them.
 *
 * Pattern uses word boundaries (\b...) to avoid matching inside other
 * words ("creas" → match, "creas que" → match, "increíble" → no match).
 * The trailing accent variants are listed explicitly because Spanish
 * imperatives often carry a written accent ("añádelo", "ponlo", etc.).
 */
const EDIT_VERB_PATTERNS: RegExp[] = [
  /\b(añad[eaií]|agreg[aeo]|sum[aeo]|incluy[ae])\b/i,
  /\b(camb[iíí]a?|modif[ií]c[aeo]|edit[aeo]|ajust[aeo]|actualiz[aeo])\b/i,
  /\b(haz|hac[eé]r?|crea|cre[aá]me|cre[aá]lo|construy[ae]|gener[aeo])\b/i,
  /\b(arregl[aeo]|repar[aeo]|fix[ea]?|corrij[aeo]|debug)\b/i,
  /\b(elimin[aeo]|borr[aeo]|quit[aeo]|remueve)\b/i,
  /\b(rehaz|rehac[eé]r?|reescrib[ea]|redise[ñn][aeo]|refactoriz[aeo])\b/i,
  /\b(pon|ponlo|ponle|p[oó]n[ml]e|colo[cq][aeo])\b/i,
  /\b(reempl[aá]z[aeo]|sustituy[ea])\b/i,
  /\b(ahora\s+(con|sin|usando|m[aá]s|menos))\b/i,
  /\b(qu[ií]ero\s+que\b)/i,
];

function looksLikeEdit(message: string): boolean {
  return EDIT_VERB_PATTERNS.some((re) => re.test(message));
}

export type ClassifierContext = {
  appTitle: string;
  appDescription: string;
  /** Persistent agent notes for the app (best effort, may be empty). */
  agentNotes?: string;
  /**
   * Recent chat turns oldest → newest. Each entry is one prior message.
   * Truncate to ~10 entries before passing in; we don't trim again here.
   */
  recentMessages: { role: "user" | "assistant" | string; content: string }[];
  message: string;
  log: Logger;
};

/** Quick local heuristic so we can short-circuit obvious research requests
 *  without spending a model call. The classifier still handles the long
 *  tail; this is just for the cheap, unambiguous cases. */
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

const SYSTEM_PROMPT = `Eres un clasificador de intención para Maris AI, un generador de apps web.

Tu trabajo: leer el último mensaje del usuario en el chat de UNA app YA EXISTENTE y decidir qué quiere hacer. Devuelves SOLO un JSON:

{"intent":"question"|"research"|"edit","reply":"..."}

Reglas estrictas:

- "question": el usuario PREGUNTA algo sobre la app actual o sobre cómo funciona Maris AI ("¿qué colores has usado?", "¿de qué va esta app?", "¿cuántos créditos cuesta una edición?", "explícame el código", "¿cómo publico la app?"). NO pide cambios. En este caso "reply" debe contener una respuesta clara y útil en ESPAÑOL, máximo 500 caracteres, sin saludos ni cierres tipo "¿algo más?".

- "research": el usuario pide explícitamente buscar en la web ("busca en stripe.com y dime cómo es su home", "investiga la competencia", "mira esta URL: https://..."). Pide INFORMACIÓN externa, no un cambio en la app. "reply" debe ir vacío "".

- "edit": el usuario quiere AÑADIR, MODIFICAR, ARREGLAR o REHACER algo en la app ("añade un botón verde", "cambia el título", "haz un dashboard", "no funciona el formulario, arréglalo", "ponlo más bonito", "ahora con login"). Cualquier petición de acción sobre el código va aquí. "reply" debe ir vacío "".

En caso de duda, elige "edit". No inventes respuestas para preguntas que requieren mirar el código que no tienes — si la pregunta es sobre detalles internos del bundle, contesta con lo que sí sabes (título, descripción, notas del agente). Nunca uses Markdown en "reply"; texto plano. No expliques tu razonamiento, solo el JSON.`;

function buildUserMessage(ctx: ClassifierContext): string {
  const lines: string[] = [];
  lines.push(`Título de la app: ${ctx.appTitle}`);
  if (ctx.appDescription) {
    lines.push(`Descripción: ${ctx.appDescription}`);
  }
  if (ctx.agentNotes && ctx.agentNotes.trim().length > 0) {
    // Keep notes short — the classifier doesn't need the full memory dump.
    const trimmed = ctx.agentNotes.trim().slice(0, 1500);
    lines.push(`Notas del agente sobre la app:\n${trimmed}`);
  }
  if (ctx.recentMessages.length > 0) {
    lines.push("");
    lines.push("Últimos mensajes del chat (orden cronológico):");
    for (const m of ctx.recentMessages) {
      const role = m.role === "user" ? "Usuario" : "Asistente";
      // Hard-cap each message so a giant prior reply doesn't blow the prompt.
      const content = m.content.slice(0, 400).replace(/\s+/g, " ").trim();
      lines.push(`- ${role}: ${content}`);
    }
  }
  lines.push("");
  lines.push(`Nuevo mensaje del usuario:\n"""${ctx.message}"""`);
  lines.push("");
  lines.push('Devuelve SOLO el JSON descrito.');
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
  if (intent !== "question" && intent !== "research" && intent !== "edit") {
    return null;
  }
  const reply = typeof parsed?.reply === "string" ? parsed.reply.trim() : "";
  return {
    intent,
    reply: intent === "question" ? reply.slice(0, 800) : "",
  };
}

const TIMEOUT_MS = 7_000;

/**
 * Classify the user's chat message. Returns "edit" on any failure so we
 * never silently lose a build request. Also short-circuits to "edit"
 * deterministically when the message contains a Spanish imperative
 * verb — that hard override prevents prompt injection in chat history /
 * agent notes from tricking the model into "answering" a real edit
 * request.
 */
export async function classifyChatIntent(
  ctx: ClassifierContext,
): Promise<ClassifiedIntent> {
  // Hard safety net: if the message contains an imperative verb ("añade",
  // "cambia", "haz", "arregla", …) the user clearly wants a build, not
  // an answer. Skip the model entirely. Cheap, deterministic, immune to
  // prompt injection. We still log what the heuristic saw so the
  // breadcrumb chain stays intact.
  if (looksLikeEdit(ctx.message)) {
    ctx.log.info(
      { reason: "edit-verb heuristic" },
      "Intent classifier short-circuit → edit",
    );
    return { intent: "edit", reply: "" };
  }
  const heuristic = looksLikeResearch(ctx.message);

  // AbortController so the SDK actually cancels the upstream request when
  // we hit the local timeout — otherwise a slow Haiku call keeps burning
  // tokens after we've already moved on.
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const userContent = buildUserMessage(ctx);
    const result: any = await (anthropic.messages.create as any)(
      {
        model: "claude-3-haiku-20240307",
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
      ctx.log.warn(
        { rawSnippet: text.slice(0, 200), heuristicResearch: heuristic },
        "Intent classifier returned unparseable JSON — defaulting to edit",
      );
      return { intent: "edit", reply: "" };
    }
    ctx.log.info(
      {
        intent: parsed.intent,
        replyLen: parsed.reply.length,
        heuristicResearch: heuristic,
      },
      "Intent classifier decision",
    );
    return parsed;
  } catch (err) {
    ctx.log.warn(
      { err, heuristicResearch: heuristic },
      "Intent classifier failed — defaulting to edit",
    );
    return { intent: "edit", reply: "" };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
