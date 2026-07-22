import { createClaudeMessageWithFallback } from "./shared-agents";
import { logger } from "./logger";
import { appendAppNotes, appendUserPreferences } from "./agentMemoryContext";

const EXTRACTOR_MODEL = "zoco-flash";

export interface MemoryExtractorInput {
  userId: string;
  appId: string;
  userPrompt: string;
  appDescription: string;
}

/**
 * Post-edit memory extractor. Reads the user's most recent prompt + the
 * agent's high-level summary of what was just done, asks a small Haiku call
 * to surface durable insights, then merges them into:
 *
 *   - app_notes (per-app, shows up in every future edit of THIS app)
 *   - user_preferences (cross-app, shows up in EVERY future generation by
 *     this user, including brand-new apps)
 *
 * Designed to fail silently. Memory is an enhancement, not a feature on the
 * critical path. Anything that throws here just logs and returns — the
 * generation already succeeded by the time this runs.
 */
export async function runMemoryExtractor(input: MemoryExtractorInput): Promise<void> {
  // Strip the prompt of injected memory blocks if any survived. They start
  // with "## CONTEXTO PERSISTENTE" — we don't want the extractor to "remember"
  // the act of being shown its own memory.
  const cleanPrompt = input.userPrompt
    .split(/^##\s+CONTEXTO PERSISTENTE/m)
    .pop()!
    .trim()
    .slice(0, 2000);

  const systemPrompt = `Eres el agente de memoria a largo plazo de un generador de apps con IA. Tu trabajo es extraer aprendizajes DURADEROS sobre el usuario y su proyecto.

DEVUELVE EXACTAMENTE UN JSON con esta forma:
{
  "appNotes": ["nota corta 1", "nota corta 2"],
  "userPreferences": ["preferencia general 1"]
}

REGLAS ESTRICTAS:
- Solo añade ítems si son auténticamente útiles para futuras ediciones. Si no hay nada nuevo, devuelve listas vacías.
- "appNotes" = decisiones específicas de ESTA app (paleta, framework elegido, decisiones de UX, sección que añadió). Máximo 3 ítems.
- "userPreferences" = patrones generales que se aplicarán a TODAS sus apps futuras (idioma, vibe de diseño, librerías favoritas, accesibilidad). Máximo 2 ítems. Sé MUY conservador — solo si está claramente expresado.
- Cada ítem máximo 120 caracteres, en castellano, en imperativo o nombre concreto. Sin emojis.
- NO inventes preferencias. Si la petición es trivial ("haz el botón más grande"), no aporta nada cross-app — devuelve userPreferences vacío.
- NO repitas datos obvios del prompt sin transformar.
- NUNCA incluyas secretos, claves API, datos personales, ni nombres reales de usuarios.

Responde SOLO con el JSON, sin texto adicional, sin markdown.`;

  const userMessage = `Petición que el usuario acaba de hacer:
"""
${cleanPrompt}
"""

Resumen de lo que el agente acaba de cambiar:
"""
${input.appDescription.slice(0, 500)}
"""

Extrae lo que merezca recordarse.`;

  try {
    const response = await createClaudeMessageWithFallback("memory", EXTRACTOR_MODEL, {
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = (response.content?.[0] as any)?.text ?? "";
    const parsed = parseExtractorOutput(text);
    if (!parsed) {
      logger.debug({ appId: input.appId }, "Memory extractor returned no usable JSON");
      return;
    }

    const appBullets = sanitizeBullets(parsed.appNotes, 3);
    const userBullets = sanitizeBullets(parsed.userPreferences, 2);

    if (appBullets.length > 0) {
      await appendAppNotes(String(input.appId), appBullets.join("\n"));
    }
    if (userBullets.length > 0) {
      await appendUserPreferences(input.userId, userBullets.join("\n"));
    }

    logger.info(
      {
        appId: input.appId,
        userId: input.userId,
        appBullets: appBullets.length,
        userBullets: userBullets.length,
      },
      "Memory extractor completed",
    );
  } catch (err) {
    logger.warn({ err, appId: input.appId }, "Memory extractor call failed (non-fatal)");
  }
}

interface ExtractorOutput {
  appNotes: string[];
  userPreferences: string[];
}

function parseExtractorOutput(raw: string): ExtractorOutput | null {
  // Try direct JSON.parse first; fall back to extracting the first {...}.
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      return {
        appNotes: Array.isArray(obj.appNotes) ? obj.appNotes : [],
        userPreferences: Array.isArray(obj.userPreferences) ? obj.userPreferences : [],
      };
    }
  } catch {
    /* fall through */
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    return {
      appNotes: Array.isArray(obj.appNotes) ? obj.appNotes : [],
      userPreferences: Array.isArray(obj.userPreferences) ? obj.userPreferences : [],
    };
  } catch {
    return null;
  }
}

const SECRET_LIKE = /(sk-[A-Za-z0-9_-]{16,}|gh[ps]_[A-Za-z0-9]{20,}|password|api[_-]?key|secret|token)/i;

function sanitizeBullets(raw: unknown[], maxCount: number): string[] {
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > 160) continue; // refuse oversize
    if (SECRET_LIKE.test(trimmed)) continue;
    out.push(trimmed.slice(0, 120));
    if (out.length >= maxCount) break;
  }
  return out;
}
