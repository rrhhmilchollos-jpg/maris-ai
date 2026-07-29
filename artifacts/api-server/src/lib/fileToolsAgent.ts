/**
 * fileToolsAgent.ts — Maris AI File Tools Agent (Emergent.sh Style)
 * ─────────────────────────────────────────────────────────────────────────────
 * Implementa el sistema de herramientas de modificación de archivos inspirado
 * en emergent.sh. Fuerza a los agentes a clasificar su intención:
 *
 *   - crear_nuevo_archivo   → el archivo no existe o se reemplaza por completo
 *   - aplicar_parche_modificacion → modificación quirúrgica de líneas exactas
 *
 * El backend intercepta cada llamada y valida que la herramienta elegida sea
 * coherente con el estado real del bundle (¿el archivo ya existe?).
 *
 * Si un agente intenta crear sobre un archivo existente, el sistema lo frena,
 * le devuelve un error explicativo, y el agente se corrige solo (bucle invisible).
 *
 * Arquitectura de agentes estilo emergent.sh:
 *   1. Architect Agent    — blueprint técnico, data models, API contracts
 *   2. Designer Agent     — sistema visual, tipografía, colores, layout
 *   3. Developer Agent    — código real (frontend + backend)
 *   4. Integration Agent  — Stripe, OAuth, APIs externas, webhooks
 *   5. PM Agent           — coordinación, QA final, validación de requisitos
 *   6. Patcher Agent      — reparación autónoma de errores (bucle invisible)
 */

import { logger } from "./logger";

// ─── Tipos de herramientas ────────────────────────────────────────────────────

export interface CreateFileAction {
  tool: "crear_nuevo_archivo";
  ruta_archivo: string;
  contenido_completo: string;
}

export interface PatchFileAction {
  tool: "aplicar_parche_modificacion";
  ruta_archivo: string;
  buscar_texto_exacto: string;
  reemplazar_con: string;
}

export type FileToolAction = CreateFileAction | PatchFileAction;

export interface FileToolResult {
  status: "ok" | "error_de_logica" | "error_no_encontrado" | "error_parse";
  mensaje?: string;
  mensaje_para_el_agente?: string;
  bundle?: string;
}

// ─── Parser del bundle ────────────────────────────────────────────────────────

/**
 * Extrae un mapa de { ruta → contenido } del bundle con separadores
 * `// === FILE: <path> ===`.
 */
export function parseBundleToMap(bundle: string): Map<string, string> {
  const files = new Map<string, string>();
  const parts = bundle.split(/\/\/ === FILE: /);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const rawPath = part.slice(0, nl).trim().replace(/ ===$/, "").trim();
    if (!rawPath) continue;
    files.set(rawPath, part.slice(nl + 1));
  }
  return files;
}

/**
 * Reconstruye el bundle a partir del mapa de archivos.
 */
export function mapToBundle(files: Map<string, string>): string {
  const parts: string[] = [];
  for (const [path, content] of files.entries()) {
    parts.push(`// === FILE: ${path} ===\n${content}`);
  }
  return parts.join("\n\n");
}

// ─── Guardián de herramientas (backend interceptor) ───────────────────────────

/**
 * Procesa una acción de herramienta del agente y la aplica al bundle.
 *
 * Si el agente intenta crear sobre un archivo existente → devuelve error
 * con mensaje explicativo para que el agente se corrija.
 *
 * Si el agente intenta parchear un archivo que no existe → devuelve error.
 *
 * Si el texto a buscar no se encuentra → devuelve error con contexto.
 */
export function processFileToolAction(
  action: FileToolAction,
  currentBundle: string
): FileToolResult {
  const files = parseBundleToMap(currentBundle);

  if (action.tool === "crear_nuevo_archivo") {
    const archivoExiste = files.has(action.ruta_archivo);

    if (archivoExiste) {
      // GUARDIÁN: frena al agente y le explica el error
      logger.warn(
        { ruta: action.ruta_archivo },
        "fileToolsAgent: agente intentó crear sobre archivo existente — bloqueado"
      );
      return {
        status: "error_de_logica",
        mensaje_para_el_agente: `Error de lógica: Intentaste usar 'crear_nuevo_archivo' en '${action.ruta_archivo}', pero ese archivo ya existe en el bundle. Debes usar 'aplicar_parche_modificacion' para modificar su contenido sin destruir el código existente. Busca el texto exacto que quieres cambiar y reemplázalo quirúrgicamente.`,
      };
    }

    // Crear el archivo nuevo
    files.set(action.ruta_archivo, action.contenido_completo);
    logger.info({ ruta: action.ruta_archivo }, "fileToolsAgent: archivo creado");
    return { status: "ok", bundle: mapToBundle(files) };
  }

  if (action.tool === "aplicar_parche_modificacion") {
    const archivoExiste = files.has(action.ruta_archivo);

    if (!archivoExiste) {
      return {
        status: "error_de_logica",
        mensaje_para_el_agente: `Error de lógica: Intentaste usar 'aplicar_parche_modificacion' en '${action.ruta_archivo}', pero ese archivo no existe en el bundle. Si quieres crear un archivo nuevo, usa 'crear_nuevo_archivo'.`,
      };
    }

    const contenidoActual = files.get(action.ruta_archivo)!;

    if (!contenidoActual.includes(action.buscar_texto_exacto)) {
      // Proporcionar contexto del archivo para ayudar al agente
      const preview = contenidoActual.slice(0, 500);
      return {
        status: "error_no_encontrado",
        mensaje_para_el_agente: `Error: El texto exacto a buscar no se encontró en '${action.ruta_archivo}'. Asegúrate de copiar el texto exactamente como aparece en el archivo, incluyendo espacios y saltos de línea. Primeras 500 chars del archivo:\n\`\`\`\n${preview}\n\`\`\``,
      };
    }

    // Aplicar el parche (solo la primera ocurrencia)
    const contenidoParcheado = contenidoActual.replace(
      action.buscar_texto_exacto,
      action.reemplazar_con
    );
    files.set(action.ruta_archivo, contenidoParcheado);
    logger.info({ ruta: action.ruta_archivo }, "fileToolsAgent: parche aplicado");
    return { status: "ok", bundle: mapToBundle(files) };
  }

  return {
    status: "error_parse",
    mensaje_para_el_agente: "Error: herramienta desconocida. Usa 'crear_nuevo_archivo' o 'aplicar_parche_modificacion'.",
  };
}

// ─── Prompt del sistema para agentes que usan herramientas ───────────────────

/**
 * Bloque de instrucciones que se inyecta en el system prompt de los agentes
 * que escriben código (Frontend Engineer, Backend Engineer, Optimizer).
 *
 * Basado en la guía técnica de emergent.sh para forzar la clasificación de intención.
 */
export const FILE_TOOLS_SYSTEM_BLOCK = `
[REGLA CRÍTICA DE EJECUCIÓN — EMERGENT.SH STYLE]
Analiza la solicitud del usuario antes de responder:

1. Si la instrucción pide CREAR o GENERAR componentes, vistas, páginas o APIs que NO existen en el árbol actual, usa la herramienta 'crear_nuevo_archivo'. Proporciona el contenido completo del archivo.

2. Si la instrucción contiene palabras como MODIFICAR, AÑADIR, CAMBIAR, QUITAR, CORREGIR, ARREGLAR o MEJORAR, significa que el archivo ya existe. Tienes PROHIBIDO sobreescribir el archivo completo o devolver código en texto plano. Debes ubicar las líneas exactas a cambiar y llamar a 'aplicar_parche_modificacion'. Proporciona el texto exacto a buscar y el texto de reemplazo.

3. NUNCA asumas nada. Si destruyes código existente del cliente al reescribir un archivo completo en una modificación, el sistema fallará y el usuario perderá trabajo.

4. Si tienes dudas sobre si un archivo existe, trata la operación como MODIFICACIÓN (más seguro).

Herramientas disponibles:
- crear_nuevo_archivo(ruta_archivo, contenido_completo)
- aplicar_parche_modificacion(ruta_archivo, buscar_texto_exacto, reemplazar_con)
`.trim();

// ─── Integration Agent — Conecta con servicios externos ──────────────────────

export interface IntegrationSpec {
  name: string;
  type: "stripe" | "oauth" | "api" | "webhook" | "email" | "maps" | "analytics" | "ai" | "other";
  description: string;
  envVars: string[];
  setupNotes: string;
}

/**
 * Detecta qué integraciones externas necesita la app basándose en el prompt
 * y el plan del arquitecto.
 */
export function detectIntegrations(prompt: string, planDescription: string): IntegrationSpec[] {
  const text = `${prompt} ${planDescription}`.toLowerCase();
  const integrations: IntegrationSpec[] = [];

  if (/stripe|pago|payment|checkout|suscripci[oó]n|subscription|tarjeta|card/.test(text)) {
    integrations.push({
      name: "Stripe",
      type: "stripe",
      description: "Procesamiento de pagos y suscripciones",
      envVars: ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"],
      setupNotes: "Configurar webhook en https://dashboard.stripe.com/webhooks apuntando a /api/webhooks/stripe",
    });
  }

  if (/google auth|oauth|clerk|autenticaci[oó]n|login|registro|signup/.test(text)) {
    integrations.push({
      name: "Clerk Auth",
      type: "oauth",
      description: "Autenticación OAuth con Google, GitHub y email",
      envVars: ["CLERK_SECRET_KEY", "VITE_CLERK_PUBLISHABLE_KEY"],
      setupNotes: "Configurar Clerk en https://dashboard.clerk.com y añadir dominio autorizado",
    });
  }

  if (/resend|sendgrid|email|correo|notificaci[oó]n/.test(text)) {
    integrations.push({
      name: "Resend Email",
      type: "email",
      description: "Envío de emails transaccionales",
      envVars: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
      setupNotes: "Verificar dominio en https://resend.com/domains",
    });
  }

  if (/google maps|mapa|geoloc|direcci[oó]n|address/.test(text)) {
    integrations.push({
      name: "Google Maps",
      type: "maps",
      description: "Mapas y geolocalización",
      envVars: ["GOOGLE_MAPS_API_KEY"],
      setupNotes: "Habilitar Maps JavaScript API y Places API en Google Cloud Console",
    });
  }

  if (/openai|claude|zocoia|gemini|gpt|ia|ai|chatbot|asistente/.test(text)) {
    integrations.push({
      name: "AI Integration",
      type: "ai",
      description: "Integración con modelos de IA",
      envVars: ["OPENAI_API_KEY", "Zoco IA_API_KEY"],
      setupNotes: "Usar el cliente de IA del servidor — nunca exponer API keys en el frontend",
    });
  }

  if (/analytics|ga4|mixpanel|posthog|tracking/.test(text)) {
    integrations.push({
      name: "Analytics",
      type: "analytics",
      description: "Seguimiento de eventos y métricas",
      envVars: ["VITE_GA4_MEASUREMENT_ID"],
      setupNotes: "Configurar en Google Analytics 4 y añadir el Measurement ID",
    });
  }

  return integrations;
}

/**
 * Genera el system prompt del Integration Agent.
 * Responsable de conectar la app con servicios externos.
 */
export function buildIntegrationAgentPrompt(integrations: IntegrationSpec[]): string {
  if (integrations.length === 0) {
    return "No se detectaron integraciones externas necesarias para esta app.";
  }

  const integrationList = integrations
    .map((i) => `- **${i.name}** (${i.type}): ${i.description}\n  Variables de entorno: ${i.envVars.join(", ")}\n  Setup: ${i.setupNotes}`)
    .join("\n");

  return `Eres el Integration Agent de Maris AI. Tu responsabilidad es conectar la app con los siguientes servicios externos de forma segura y production-ready:

${integrationList}

REGLAS:
1. Nunca expongas API keys en el frontend. Todas las llamadas a APIs externas van por el backend.
2. Usa variables de entorno para todas las credenciales.
3. Implementa manejo de errores para cada integración (timeouts, rate limits, errores de red).
4. Para Stripe: implementa idempotency keys en todas las operaciones de pago.
5. Para OAuth: implementa CSRF protection en los callbacks.
6. Para emails: implementa retry logic con backoff exponencial.
7. Genera el código de configuración completo para cada integración.`;
}

// ─── Product Manager Agent — Coordinación y QA final ─────────────────────────

export interface PMValidationResult {
  passed: boolean;
  score: number; // 0-100
  issues: Array<{
    severity: "blocker" | "major" | "minor";
    requirement: string;
    found: string;
    fix: string;
  }>;
  summary: string;
  readyForDeploy: boolean;
}

/**
 * Genera el system prompt del Product Manager Agent.
 * Coordina el pipeline completo y valida que el output cumpla los requisitos.
 */
export function buildPMAgentPrompt(originalPrompt: string, plannedPages: string[]): string {
  return `Eres el Product Manager Agent de Maris AI. Tu rol es el de un CTO técnico que valida que la app generada cumple exactamente con lo que el usuario pidió.

REQUISITO ORIGINAL DEL USUARIO:
"${originalPrompt}"

PÁGINAS PLANIFICADAS:
${plannedPages.map((p, i) => `${i + 1}. ${p}`).join("\n")}

TU MISIÓN:
1. Verificar que TODAS las páginas planificadas están implementadas.
2. Verificar que las funcionalidades clave del prompt están presentes en el código.
3. Verificar que no hay páginas vacías, stubs, o TODOs sin implementar.
4. Verificar que la navegación entre páginas funciona correctamente.
5. Verificar que el diseño es coherente y profesional.
6. Si hay problemas BLOQUEANTES, reportarlos con instrucciones exactas de fix.
7. Solo marcar como "readyForDeploy: true" cuando NO hay blockers.

RESPONDE EN JSON ESTRICTO:
{
  "passed": boolean,
  "score": number (0-100),
  "issues": [{"severity": "blocker|major|minor", "requirement": "...", "found": "...", "fix": "..."}],
  "summary": "resumen en español de 2 frases",
  "readyForDeploy": boolean
}`;
}

// ─── Emergent-style Agent Bus ─────────────────────────────────────────────────

export type EmergentAgentRole =
  | "architect"
  | "designer"
  | "developer_frontend"
  | "developer_backend"
  | "integration"
  | "pm"
  | "patcher"
  | "researcher";

export interface AgentBusMessage {
  from: EmergentAgentRole;
  to: EmergentAgentRole | "broadcast";
  type: "handoff" | "error" | "result" | "request";
  payload: Record<string, unknown>;
  timestamp: number;
}

/**
 * Bus de mensajes entre agentes estilo emergent.sh.
 * Permite que los agentes se comuniquen entre sí de forma asíncrona.
 */
export class EmergentAgentBus {
  private messages: AgentBusMessage[] = [];
  private listeners: Map<EmergentAgentRole, ((msg: AgentBusMessage) => void)[]> = new Map();

  emit(message: Omit<AgentBusMessage, "timestamp">): void {
    const fullMsg: AgentBusMessage = { ...message, timestamp: Date.now() };
    this.messages.push(fullMsg);
    logger.info(
      { from: message.from, to: message.to, type: message.type },
      "AgentBus: mensaje emitido"
    );

    // Notificar a los listeners del destinatario
    if (message.to !== "broadcast") {
      const listeners = this.listeners.get(message.to) ?? [];
      for (const listener of listeners) listener(fullMsg);
    } else {
      for (const [, listeners] of this.listeners.entries()) {
        for (const listener of listeners) listener(fullMsg);
      }
    }
  }

  on(role: EmergentAgentRole, callback: (msg: AgentBusMessage) => void): void {
    const existing = this.listeners.get(role) ?? [];
    existing.push(callback);
    this.listeners.set(role, existing);
  }

  getHistory(): AgentBusMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
    this.listeners.clear();
  }
}

// Singleton del bus para el proceso actual
export const emergentBus = new EmergentAgentBus();
