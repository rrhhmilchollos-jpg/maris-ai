/**
 * jobDiagnosis.ts — Diagnóstico real de generaciones/ediciones rotas, para
 * el panel de admin.
 *
 * CONTEXTO: a petición explícita del usuario, tras pasar varias sesiones
 * de hoy investigando manualmente (leyendo logs en bruto, pegándolos uno
 * por uno) por qué un proyecto concreto terminó roto — esto automatiza esa
 * misma investigación: lee los JobLog reales ya guardados (los mismos que
 * ya se ven en "Logs en vivo"), y produce un resumen directo al grano:
 * qué agente falló, en qué archivo (si el mensaje lo menciona), y qué tipo
 * de problema es, sin tener que leer decenas de líneas de log en bruto
 * cada vez.
 *
 * IMPORTANTE: esto NO inventa ningún diagnóstico nuevo — solo agrega y
 * presenta mejor datos que el sistema YA guarda hoy (JobLog.level
 * "warn"/"error", más el errorMessage final del propio GenerationJob).
 */

export interface DiagnosisFinding {
  /** Ruta del archivo mencionado en el mensaje, si se pudo extraer. */
  file?: string;
  /** Agente que reportó el problema (coder, qa, testing, validator, evaluator, system...). */
  agent: string;
  /** Nivel real del log original. */
  level: "warn" | "error";
  /** Mensaje completo, sin recortar — para no perder contexto real. */
  message: string;
  /** Categoría inferida del tipo de problema, basada en patrones ya
   *  confirmados reales durante la investigación de hoy — ayuda a agrupar
   *  visualmente sin tener que leer cada mensaje uno por uno. */
  category:
    | "router_404"
    | "archivo_vacio_o_incompleto"
    | "limite_de_tokens"
    | "clasificacion_frontend_backend"
    | "regresion_visual"
    | "build_roto"
    | "transaccion_atomica"
    | "otro";
  createdAt: string;
}

export interface JobDiagnosisResult {
  jobId: string;
  /** true si el job terminó con status "failed" o tiene errorMessage. */
  hasFailed: boolean;
  finalErrorMessage?: string;
  /** Hallazgos reales extraídos de los logs, más recientes primero. */
  findings: DiagnosisFinding[];
  /** Resumen en una frase de la causa más probable, basado en el hallazgo
   *  de más alta prioridad encontrado — nunca un diagnóstico inventado,
   *  siempre citando el mensaje real que lo sustenta. */
  topSuspect: DiagnosisFinding | null;
}

/** Extrae una ruta de archivo plausible de un mensaje de log real, si la hay.
 *  Cubre los formatos ya confirmados reales durante la investigación de
 *  hoy: "src/App.tsx actualizado.", "el archivo X.tsx", rutas sueltas con
 *  extensión de código reconocible. */
function extractFilePath(message: string): string | undefined {
  const match = message.match(/([a-zA-Z0-9_\-./]+\.(tsx?|jsx?|prisma|py|json|css))\b/);
  return match ? match[1] : undefined;
}

/** Clasifica un mensaje de log en una categoría conocida, basándose en los
 *  patrones reales de cada bug investigado y corregido hoy — NUNCA marca
 *  "otro" sin antes comprobar todos los patrones conocidos. */
function categorize(message: string): DiagnosisFinding["category"] {
  const m = message.toLowerCase();
  if (/404|p[aá]gina no encontrada|catch-?all|ruta (ra[ií]z|principal)/.test(m)) return "router_404";
  if (/archivo.*vac[ií]o|contenido vac[ií]o|insignificante|placeholder/.test(m)) return "archivo_vacio_o_incompleto";
  if (/m[aá]x_tokens|demasiado grande para una sola pasada|l[ií]mite de tokens|truncad[oa]/.test(m)) return "limite_de_tokens";
  if (/clasificad[oa] como frontend|backendpath|workspace equivocado/.test(m)) return "clasificacion_frontend_backend";
  if (/regresion|regress|empeor[oó]|puntuaci[oó]n.*baj[oó]/.test(m)) return "regresion_visual";
  if (/esbuild|unterminated|syntax error|build fall[oó]|no pudo compilar/.test(m)) return "build_roto";
  if (/transacci[oó]n|saldo|balance|\$transaction/.test(m)) return "transaccion_atomica";
  return "otro";
}

/** Prioridad de severidad para decidir el "top suspect" — los problemas
 *  estructurales que dejan la app completamente rota (404, build roto,
 *  límite de tokens sin completar) priman sobre regresiones parciales. */
const CATEGORY_PRIORITY: Record<DiagnosisFinding["category"], number> = {
  router_404: 5,
  build_roto: 5,
  limite_de_tokens: 4,
  archivo_vacio_o_incompleto: 4,
  clasificacion_frontend_backend: 3,
  transaccion_atomica: 2,
  regresion_visual: 2,
  otro: 1,
};

export function diagnoseFromLogs(
  jobId: string,
  logs: Array<{ agent: string; level: string; message: string; createdAt: string | Date }>,
  job: { status?: string; errorMessage?: string },
): JobDiagnosisResult {
  const findings: DiagnosisFinding[] = logs
    .filter((l) => l.level === "warn" || l.level === "error")
    .map((l) => ({
      file: extractFilePath(l.message),
      agent: l.agent,
      level: l.level as "warn" | "error",
      message: l.message,
      category: categorize(l.message),
      createdAt: typeof l.createdAt === "string" ? l.createdAt : l.createdAt.toISOString(),
    }))
    .reverse(); // más recientes primero — lo más probable es que la causa esté cerca del final

  const topSuspect = findings.length
    ? findings.reduce((best, f) => {
        const fScore = CATEGORY_PRIORITY[f.category] + (f.level === "error" ? 0.5 : 0);
        const bestScore = CATEGORY_PRIORITY[best.category] + (best.level === "error" ? 0.5 : 0);
        return fScore > bestScore ? f : best;
      })
    : null;

  return {
    jobId,
    hasFailed: job.status === "failed" || !!job.errorMessage,
    finalErrorMessage: job.errorMessage,
    findings,
    topSuspect,
  };
}
