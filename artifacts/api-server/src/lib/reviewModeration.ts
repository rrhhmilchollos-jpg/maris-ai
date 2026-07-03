// ─── Moderación de reseñas ───────────────────────────────────────────────
// Filtro básico de palabras prohibidas para reseñas públicas (insultos,
// contenido no apto, spam evidente). No es un sistema de IA — es una
// lista + normalización de texto, pensada para "flagear" para revisión
// manual, NUNCA para publicar/rechazar en automático sin que un humano
// lo vea. Esto evita dos cosas: (1) que una reseña ofensiva se publique
// directa en marisai.es, y (2) falsos positivos que rechacen reseñas
// legítimas sin que nadie las revise.
//
// IMPORTANTE: esta lista es deliberadamente conservadora (términos claros
// de insulto/spam). Palabras "límite" o dependientes de contexto se dejan
// pasar a moderación manual normal en vez de bloquearlas aquí.

const BANNED_TERMS: string[] = [
  // Insultos comunes en español
  "gilipollas", "imbecil", "idiota", "estupido", "estupida", "subnormal",
  "cabron", "cabrona", "hijoputa", "hijo de puta", "puta", "puto",
  "mierda", "joder", "capullo", "gilipoll", "maricon", "zorra",
  "tarado", "retrasado", "retrasada", "pendejo", "pendeja", "cojones",
  // Insultos en inglés (por si hay reseñas en inglés)
  "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dickhead",
  "idiot", "stupid", "moron", "scam", "fraud",
  // Términos de spam / phishing evidente
  "viagra", "casino online", "prestamo urgente", "gana dinero rapido",
  "haz clic aqui", "click aqui gratis",
  // Discurso de odio / discriminatorio (bloqueo estricto)
  "nazi", "puta raza", "vete a tu pais",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita acentos: "estúpido" -> "estupido"
}

export interface ModerationResult {
  flagged: boolean;
  matchedTerms: string[];
}

/**
 * Revisa un texto de reseña contra la lista de términos prohibidos.
 * Devuelve qué términos ha encontrado, para que el admin pueda revisar
 * rápido en el panel sin tener que releer toda la reseña.
 */
export function moderateReviewText(text: string): ModerationResult {
  const normalized = normalize(text);
  const matchedTerms = BANNED_TERMS.filter((term) => normalized.includes(normalize(term)));
  return {
    flagged: matchedTerms.length > 0,
    matchedTerms,
  };
}
