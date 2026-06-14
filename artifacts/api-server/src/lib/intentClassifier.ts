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
import { analyzeSpanishIntent, firstMatchedTerm, SPANISH_LEXICON_PROMPT_SUMMARY } from "./spanishIntentLexicon";

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
  // Operaciones directas sobre BD/CRM — requieren contexto de datos REAL
  /\b(mongodb|mongo\s*db|base\s+de\s+datos|bbdd|database|colecci[oó]n|collection)\b/i,
  /\b(insertar|inserta|inyectar|persistir|grabar)\b.*\b(en\s+(?:la\s+)?(?:base\s+de\s+datos|crm|bbdd|mongodb|colecci[oó]n))\b/i,
  /\b(registra|registrar|alta|dar\s+de\s+alta)\b.*\b(usuario|cliente|lead|trabajador|empleado)\b.*\b(en\s+(?:la\s+)?(?:base\s+de\s+datos|crm|bbdd|mongodb|sistema))\b/i,
  // CRM/pipeline de ventas — solo cuando hay contexto de operación sobre datos
  /\b(crm|pipeline|leads?)\b.*\b(a[ñn]ade|agrega|inserta|registra|elimina|borra|actualiza)\b/i,
  /\b(a[ñn]ade|agrega|inserta|registra)\b.*\b(crm|pipeline|leads?|base\s+de\s+datos|bbdd|mongodb)\b/i,
  // Credenciales/acceso — solo cuando se pide operar sobre cuentas reales
  /\b(credenciales|password|contrase[ñn]a)\b.*\b(a[ñn]ade|agrega|cambia|modifica|revocar|eliminar)\b/i,
  /\b(asigna|otorga)\b.*\b(rol|permiso|acceso)\b.*\b(usuario|cuenta|admin)\b/i,
  // Patrones inequívocos de operación de datos
  /\b(en\s+(?:la\s+)?(?:base\s+de\s+datos|crm|bbdd|mongodb))\b.*\b(como\s+(?:trabajador|empleado|admin|lead|agente|comercial))\b/i,
  /\b(a[ñn]ade|agrega|inserta|registra)\b.*\b(con\s+(?:este|su|el)\s+(?:correo|email)\b.*\bcontrase[ñn]a)\b/i,
  /\b(eliminar|borra|borrar|desactivar|revocar)\b.*\b(registro|lead|credenciales|mongodb|base\s+de\s+datos|crm)\b/i,
  // Consultas sobre datos reales del sistema
  /\b(muestra|lista|consulta)\b.*\b(todos\s+los|todas\s+las)\b.*\b(usuarios|clientes|leads|registros)\b.*\b((?:en|del?|de\s+la)\s+(?:crm|sistema|base\s+de\s+datos|bbdd))\b/i,
];

// Patrones que son SIEMPRE ENGINE_DEV aunque suenen a datos
// (el usuario quiere un cambio en la UI/código, no operar sobre datos reales)
const ALWAYS_DEV_PATTERNS: RegExp[] = [
  /\b(ponme|hazme|quiero\s+que|necesito\s+que)\b.*\b(aparezca|muestre|se\s+vea|funcione)\b/i,
  /\b(no\s+funciona|está\s+roto|hay\s+un\s+error|no\s+carga|pantalla\s+en\s+blanco|falla|crash)\b/i,
  /\b(cambia|modifica|actualiza|arregla|corrige|añade|agrega|quita|elimina)\b.*\b(el\s+botón|la\s+página|el\s+color|el\s+diseño|el\s+menú|el\s+formulario|la\s+sección|el\s+componente|el\s+estilo|la\s+vista|el\s+texto)\b/i,
  /\b(completa|termina|implementa|desarrolla)\b.*\b(la\s+app|la\s+web|las\s+páginas|el\s+backend|el\s+frontend)\b/i,
  /\b(genera|crea|construye|haz)\b.*\b(una\s+(?:app|web|página|sección|pantalla|vista|panel|dashboard))\b/i,
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
  // ALWAYS_DEV_PATTERNS cubre frases inequívocas de desarrollo
  // ("continúa/termina la app", "no funciona X", "pantalla en blanco",
  // "cambia el botón"...). Antes solo se usaban para VETAR "execute" dentro
  // de looksLikeExecution, pero nunca disparaban "edit" por sí mismas — si
  // tampoco matcheaban DEV_KEYWORD_PATTERNS, la petición caía al clasificador
  // LLM, que podía (y lo hizo, p.ej. con "continúa/termina la app")
  // devolver "question" y NO crear ningún job, dejando al usuario sin
  // respuesta real. Ahora estos patrones bastan por sí solos para "edit",
  // de forma determinista y sin coste de LLM.
  return DEV_KEYWORD_PATTERNS.some((re) => re.test(message)) || ALWAYS_DEV_PATTERNS.some((re) => re.test(message));
}

function looksLikeExecution(message: string): boolean {
  // Si el mensaje claramente quiere un cambio en la UI/código, NO es execute
  if (ALWAYS_DEV_PATTERNS.some((re) => re.test(message))) return false;
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

== MOTORES ==

"execute" = ENGINE_EXEC.
El usuario pide operar sobre DATOS REALES en producción: insertar/registrar/borrar usuarios, leads, clientes, credenciales, CRM, MongoDB, APIs externas. NO se toca código. "reply" vacío.
Ejemplos: "registra a Juan como cliente", "borra el lead 42", "inserta este producto en la BD".

"edit" = ENGINE_DEV.
El usuario quiere que Maris AI cambie/construya/arregle CÓDIGO FUENTE: diseño, páginas, componentes, botones, colores, lógica, rutas, backend, endpoints, correcciones de errores, añadir funcionalidades, cambiar textos en la UI. "reply" vacío.
Ejemplos: "añade una página de contacto", "cambia el color del botón a azul", "arregla el error del login", "haz que el formulario valide el email", "pon el logo más grande", "crea la sección de precios".

"research" = ENGINE_RESEARCH.
El usuario pide buscar información externa o analizar una URL. No modifica la app. "reply" vacío.

"question" = ENGINE_INFO.
El usuario solo pregunta algo, no pide ninguna acción. "reply" en ESPAÑOL, máximo 300 caracteres. Tono directo y humano — como un compañero técnico que conoce bien el proyecto. Sin saludos, sin "¿algo más?", sin "Puedo ayudarte con...". Usa el nombre de la app si está disponible. Sé específico.

== REGLAS DE PRIORIDAD ==
1. Si involucra datos reales de producción (CRM, MongoDB, usuarios reales) → "execute"
2. Si pide cambiar/añadir/arreglar algo en la app o su código → "edit"
3. Si pide investigar una URL o buscar en internet → "research"
4. Si solo pregunta sin pedir acción → "question"
5. En caso de duda entre "edit" y cualquier otro → siempre "edit"

== CASOS ESPECIALES — SIEMPRE "edit" ==
- "ponme X", "hazme X", "quiero X en la app" → edit (el usuario quiere un cambio visual/funcional)
- "no funciona X", "hay un error en X", "está roto X" → edit (arreglo de código)
- "añade X" cuando X es una funcionalidad, sección o elemento UI → edit
- "cambia X", "modifica X" cuando X es parte de la interfaz → edit
- "completa las páginas", "termina la app", "implementa X" → edit

== CASOS "execute" (SOLO si opera datos reales) ==
- "registra/inserta/guarda [persona/lead] en [CRM/BD/MongoDB]" → execute
- "borra el [usuario/cliente/registro] de [BD/CRM]" → execute
- "actualiza el campo [X] del registro [Y] en [MongoDB/CRM]" → execute

No uses Markdown en "reply". No expliques tu razonamiento. Solo el JSON.

Léxico español:
${SPANISH_LEXICON_PROMPT_SUMMARY}`;

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
  const spanish = analyzeSpanishIntent(ctx.message);
  const execution = spanish.isDataOperation || looksLikeExecution(ctx.message);
  const edit = spanish.isDevOperation || looksLikeEdit(ctx.message);
  const research = spanish.isResearch || looksLikeResearch(ctx.message);

  // REGLA CLAVE: ENGINE_EXEC SIEMPRE tiene prioridad sobre ENGINE_DEV cuando
  // la petición involucra datos/CRM/usuarios/registros, aunque también contenga
  // verbos de desarrollo. Esto evita que "añade un usuario a la CRM" regenere el frontend.
  if (execution) {
    const term = firstMatchedTerm(spanish, ["action.", "domain."]) || "datos/CRM";
    ctx.log.info({ reason: "spanish-lexicon exec", hasEdit: edit, spanish }, "Intent classifier short-circuit → execute");
    return { intent: "execute", engine: "ENGINE_EXEC", reply: "", reason: `spanish-lexicon execute (${term})` };
  }

  if (edit) {
    const term = firstMatchedTerm(spanish, ["action.", "domain."]) || "código/UI";
    ctx.log.info({ reason: "spanish-lexicon dev", spanish }, "Intent classifier short-circuit → edit");
    return { intent: "edit", engine: "ENGINE_DEV", reply: "", reason: `spanish-lexicon edit (${term})` };
  }

  if (research) {
    const term = firstMatchedTerm(spanish, ["action.research", "domain.research"]) || "investigación";
    ctx.log.info({ reason: "spanish-lexicon research", spanish }, "Intent classifier short-circuit → research");
    return { intent: "research", engine: "ENGINE_RESEARCH", reply: "", reason: `spanish-lexicon research (${term})` };
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
