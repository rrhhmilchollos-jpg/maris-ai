/**
 * marisCrewAI.ts — Patrones CrewAI implementados nativamente en Maris AI
 *
 * Implementa los 3 pilares de CrewAI sobre la arquitectura existente:
 *
 * 1. AGENTS con rol, objetivo, backstory y herramientas específicas
 * 2. TASKS con descripción, agente asignado, contexto y output esperado
 * 3. CREW que coordina agentes, gestiona delegación y memoria compartida
 *
 * CREW DE GENERACIÓN:
 * ┌─────────────────────────────────────────────────┐
 * │  CREW: MarisGenerationCrew                      │
 * │                                                 │
 * │  Agentes:                                       │
 * │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
 * │  │Researcher│  │Architect │  │ Frontend Dev  │  │
 * │  │          │  │          │  │              │  │
 * │  │Goal:     │  │Goal:     │  │Goal:         │  │
 * │  │contexto  │  │estructura│  │código real   │  │
 * │  │del sector│  │optima    │  │funcional     │  │
 * │  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
 * │       │             │               │           │
 * │  ┌────▼─────┐  ┌────▼─────┐  ┌──────▼───────┐  │
 * │  │ Designer │  │ Backend  │  │  QA Auditor  │  │
 * │  │          │  │Engineer  │  │              │  │
 * │  │Memoria   │  │          │  │Tool calling  │  │
 * │  │compartida│  │Delegación│  │validate+patch│  │
 * │  └──────────┘  └──────────┘  └──────────────┘  │
 * │                                                 │
 * │  Memoria compartida (CrewMemory):               │
 * │  - Contexto del proyecto                        │
 * │  - Decisiones del arquitecto                    │
 * │  - Errores conocidos del usuario                │
 * │  - Preferencias aprendidas                      │
 * └─────────────────────────────────────────────────┘
 */

import { createZocoToolCallWithFallback } from "./shared-agents";
import { logger } from "./logger";
import { getToolsForRole, executeTool, type ToolContext } from "./agentTools";

// ─── Tipos base al estilo CrewAI ──────────────────────────────────────────────

export interface CrewAgent {
  id: string;
  role: string;
  goal: string;
  backstory: string;
  model: string;
  tools: string[];       // nombres de herramientas disponibles
  maxIterations: number;
  allowDelegation: boolean;
  verbose: boolean;
}

export interface CrewTask {
  id: string;
  description: string;
  expectedOutput: string;
  agent: string;         // id del agente asignado
  context?: string[];    // ids de tareas cuyo output se pasa como contexto
  async?: boolean;
}

export interface CrewMemory {
  shortTerm: Map<string, string>;   // clave → valor, se borra al terminar
  longTerm: Map<string, string>;    // persiste entre sesiones (en AgentMemory)
  shared: Map<string, string>;      // compartida entre todos los agentes del crew
}

export interface CrewResult {
  taskId: string;
  agentId: string;
  output: string;
  toolsUsed: string[];
  iterations: number;
  delegatedTo?: string;
}

// ─── Definición de los agentes de Maris AI ───────────────────────────────────

export const MARIS_AGENTS: Record<string, CrewAgent> = {
  researcher: {
    id: "researcher",
    role: "Investigador de Producto",
    goal: "Recopilar contexto real del sector, competencia y mejores prácticas para informar al equipo",
    backstory: "Eres un investigador experto en productos digitales. Combinas búsqueda web en tiempo real con conocimiento profundo del mercado español. No inventas — solo reportas lo que encuentras.",
    model: "zoco-flash",
    tools: ["web_search"],
    maxIterations: 4,
    allowDelegation: false,
    verbose: true,
  },
  architect: {
    id: "architect",
    role: "Arquitecto de Software Senior",
    goal: "Diseñar la estructura técnica perfecta que el equipo implementará — ni demasiado grande ni demasiado pequeña",
    backstory: "Llevas 10 años diseñando arquitecturas de apps React + Node. Sabes que un plan de 6 páginas bien hecho supera a uno de 20 a medias. Preguntas si algo no está claro.",
    model: "zoco-plus",
    tools: ["ask_clarification"],
    maxIterations: 3,
    allowDelegation: true,
    verbose: true,
  },
  designer: {
    id: "designer",
    role: "Diseñador UI/UX Senior",
    goal: "Crear un sistema visual coherente que haga la app memorable y profesional",
    backstory: "Combinas Tailwind, psicología del color y tendencias actuales de diseño para crear interfaces que los usuarios aman usar. Adaptas el estilo al sector del cliente.",
    model: "zoco-flash",
    tools: [],
    maxIterations: 2,
    allowDelegation: false,
    verbose: false,
  },
  frontend_engineer: {
    id: "frontend_engineer",
    role: "Frontend Engineer Senior",
    goal: "Implementar el código React/TypeScript más limpio y funcional posible siguiendo exactamente el plan del arquitecto",
    backstory: "Eres obsesivo con la calidad del código. Usas TypeScript estricto, componentes pequeños y reutilizables, y siempre piensas en mobile-first. Jamás dejas TODOs.",
    model: "zoco-plus",
    tools: ["read_file", "write_file", "patch_file", "validate_code"],
    maxIterations: 6,
    allowDelegation: true,
    verbose: true,
  },
  backend_engineer: {
    id: "backend_engineer",
    role: "Backend Engineer Senior",
    goal: "Implementar APIs Express/Node robustas con MongoDB que soporten todas las funcionalidades del frontend",
    backstory: "Experto en Node.js, Express, MongoDB y diseño de APIs REST. Siempre validas inputs, manejas errores y documentas los endpoints.",
    model: "zoco-plus",
    tools: ["read_file", "write_file", "search_npm"],
    maxIterations: 5,
    allowDelegation: false,
    verbose: true,
  },
  qa_auditor: {
    id: "qa_auditor",
    role: "QA Auditor y Patcher",
    goal: "Detectar y corregir errores antes de que el usuario los vea — TypeScript, imports, hooks, renders",
    backstory: "Eres el último filtro de calidad. Lees el código generado, ejecutas validaciones y aplicas parches quirúrgicos para los problemas encontrados. Tu lema: 'No sale nada roto.'",
    model: "zoco-plus",
    tools: ["read_file", "patch_file", "validate_code"],
    maxIterations: 4,
    allowDelegation: false,
    verbose: true,
  },
  pm_agent: {
    id: "pm_agent",
    role: "Product Manager y Coordinador",
    goal: "Asegurar que el resultado final cumple exactamente lo que pidió el usuario y coordinar al equipo cuando hay conflictos",
    backstory: "Eres el puente entre el usuario y el equipo técnico. Lees el prompt original y verificas que el resultado lo cumple. Cuando algo no encaja, delegas la corrección al agente correcto.",
    model: "zoco-flash",
    tools: [],
    maxIterations: 2,
    allowDelegation: true,
    verbose: true,
  },
};

// ─── Memoria compartida del Crew ──────────────────────────────────────────────

export class MarisCrewMemory implements CrewMemory {
  shortTerm = new Map<string, string>();
  longTerm  = new Map<string, string>();
  shared    = new Map<string, string>();

  set(key: string, value: string, scope: "short" | "long" | "shared" = "shared") {
    if (scope === "long")   this.longTerm.set(key, value);
    else if (scope === "short") this.shortTerm.set(key, value);
    else this.shared.set(key, value);
  }

  get(key: string): string | undefined {
    return this.shared.get(key) ?? this.shortTerm.get(key) ?? this.longTerm.get(key);
  }

  getContext(): string {
    const entries: string[] = [];
    for (const [k, v] of this.shared) entries.push(`${k}: ${v.slice(0, 200)}`);
    return entries.length > 0 ? `\n\nCONTEXTO COMPARTIDO DEL EQUIPO:\n${entries.join("\n")}` : "";
  }

  // Cargar memoria de largo plazo desde AgentMemory de MongoDB
  async loadLongTerm(userId: string): Promise<void> {
    try {
      const { connectDB } = await import("./db");
      const { AgentMemory } = await import("@workspace/db/schema");
      await connectDB();
      const mem = await AgentMemory.findOne({ userId }).lean() as any;
      if (!mem) return;
      if (mem.negativeFeedback?.length > 0) {
        const patterns = mem.negativeFeedback.slice(-5).map((f: any) => f.message).join("; ");
        this.longTerm.set("user_negative_patterns", patterns);
        this.shared.set("avoid_patterns", `El usuario ha expresado insatisfacción con: ${patterns}`);
      }
      if (mem.positiveFeedback?.length > 0) {
        const patterns = mem.positiveFeedback.slice(-5).map((f: any) => f.message).join("; ");
        this.longTerm.set("user_positive_patterns", patterns);
        this.shared.set("reinforce_patterns", `Al usuario le ha gustado: ${patterns}`);
      }
    } catch { /* silencioso */ }
  }
}

// ─── Ejecutor de agente individual ───────────────────────────────────────────

async function runAgent(
  agent: CrewAgent,
  task: CrewTask,
  memory: MarisCrewMemory,
  taskOutputs: Map<string, string>,
  ctx: ToolContext,
): Promise<CrewResult> {

  // Construir contexto de tareas previas
  const contextBlocks = (task.context || [])
    .map(id => taskOutputs.get(id))
    .filter(Boolean)
    .join("\n\n---\n\n");

  // OPTIMIZACIÓN: Separar el system prompt en dos bloques:
  //   Bloque 1 (ESTÁTICO): rol + objetivo + backstory + reglas fijas → CACHEADO (90% descuento)
  //   Bloque 2 (DINÁMICO): memoria del agente (varía por sesión) → no cacheado
  const systemStaticPart = `Eres ${agent.role} del equipo de Maris AI.

OBJETIVO: ${agent.goal}

QUIÉN ERES: ${agent.backstory}

REGLAS:
- Responde SOLO con el output pedido, sin explicaciones meta
- Si allowDelegation=true y algo está fuera de tu expertise, di "DELEGAR a [rol]: [razón]"
- Sé conciso pero completo
- Todo en español salvo nombres de código`;

  const memoryContext = memory.getContext();
  const systemBlocks: any[] = [
    {
      type: "text",
      text: systemStaticPart,
      cache_control: { type: "ephemeral" }, // ← 90% descuento en tokens de entrada
    },
  ];
  // Solo añadir el bloque dinámico si hay memoria (evita bloques vacíos)
  if (memoryContext && memoryContext.trim().length > 0) {
    systemBlocks.push({ type: "text", text: memoryContext });
  }

  const userMessage = `TAREA: ${task.description}

OUTPUT ESPERADO: ${task.expectedOutput}${contextBlocks ? `\n\nCONTEXTO DE TAREAS ANTERIORES:\n${contextBlocks}` : ""}`;

  const tools = getToolsForRole(agent.id.replace("_engineer", "").replace("_auditor", ""));
  const messages: any[] = [{ role: "user", content: userMessage }];
  const toolsUsed: string[] = [];
  let iterations = 0;
  let currentBundle = ctx.bundle;

  while (iterations < agent.maxIterations) {
    iterations++;

    const response = await createZocoToolCallWithFallback("crew", agent.model, {
      max_tokens: 2048,
      system: systemBlocks, // ← Ahora usa los bloques cacheados
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? { type: "auto" } : undefined,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b: any) => b.type === "text");
      const output = (textBlock as any)?.text ?? "";

      // Detectar delegación
      const delegateMatch = output.match(/DELEGAR a ([^:]+): (.+)/);
      if (delegateMatch && agent.allowDelegation) {
        return {
          taskId: task.id,
          agentId: agent.id,
          output,
          toolsUsed,
          iterations,
          delegatedTo: delegateMatch[1].trim(),
        };
      }

      return { taskId: task.id, agentId: agent.id, output, toolsUsed, iterations };
    }

    if (response.stop_reason === "tool_use") {
      const toolResults: any[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const tb = block as any;
        toolsUsed.push(tb.name);
        const execCtx = { ...ctx, bundle: currentBundle };
        const { result, bundleUpdated } = await executeTool(tb.name, tb.input, execCtx);
        if (bundleUpdated) { currentBundle = bundleUpdated; ctx.bundle = bundleUpdated; }
        toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: result });
      }
      messages.push({ role: "user", content: toolResults });
    }
  }

  const lastText = [...messages].reverse()
    .find(m => m.role === "assistant")?.content
    ?.find?.((b: any) => b.type === "text")?.text ?? "";
  return { taskId: task.id, agentId: agent.id, output: lastText, toolsUsed, iterations };
}

// ─── Crew — orquestador principal ────────────────────────────────────────────

export class MarisGenerationCrew {
  private memory: MarisCrewMemory;
  private results = new Map<string, string>();
  private log: (agent: string, msg: string) => Promise<void>;

  constructor(log: (agent: string, msg: string) => Promise<void>) {
    this.memory = new MarisCrewMemory();
    this.log = log;
  }

  async prepare(userId: string, prompt: string, appTitle?: string) {
    await this.memory.loadLongTerm(userId);
    this.memory.set("original_prompt", prompt.slice(0, 500));
    if (appTitle) this.memory.set("app_title", appTitle);
  }

  async runTask(task: CrewTask, ctx: ToolContext = {}): Promise<string> {
    const agent = MARIS_AGENTS[task.agent];
    if (!agent) throw new Error(`Agente desconocido: ${task.agent}`);

    if (agent.verbose) {
      await this.log(task.agent, `🤖 ${agent.role} → ${task.description.slice(0, 80)}…`);
    }

    const result = await runAgent(agent, task, this.memory, this.results, ctx);
    this.results.set(task.id, result.output);

    // Si delegó → ejecutar con el agente delegado
    if (result.delegatedTo) {
      const delegateAgent = Object.values(MARIS_AGENTS).find(a =>
        a.role.toLowerCase().includes(result.delegatedTo!.toLowerCase())
      );
      if (delegateAgent) {
        await this.log(task.agent, `🔀 Delegando a ${delegateAgent.role}…`);
        const delegateResult = await runAgent(
          delegateAgent, { ...task, agent: delegateAgent.id },
          this.memory, this.results, ctx
        );
        this.results.set(task.id, delegateResult.output);
        return delegateResult.output;
      }
    }

    // Guardar en memoria compartida si es relevante
    if (task.id === "research") this.memory.set("research_context", result.output, "short");
    if (task.id === "architecture") this.memory.set("architecture_plan", result.output.slice(0, 500), "shared");

    return result.output;
  }

  getMemory(): MarisCrewMemory { return this.memory; }
  getResults(): Map<string, string> { return this.results; }
}

// ─── Crew de soporte al cliente ───────────────────────────────────────────────

export class MarisSuportCrew {
  private memory: MarisCrewMemory;

  constructor() { this.memory = new MarisCrewMemory(); }

  async handleTicket(opts: {
    userId: string;
    userEmail: string;
    subject: string;
    message: string;
    appContext?: string;
  }): Promise<{ resolved: boolean; reply: string; action?: string }> {

    await this.memory.loadLongTerm(opts.userId);
    this.memory.set("ticket_subject", opts.subject);
    this.memory.set("ticket_message", opts.message);
    if (opts.appContext) this.memory.set("user_apps", opts.appContext);

    // PM agent analiza y decide
    const pmTask: CrewTask = {
      id: "triage",
      description: `Analiza este ticket de soporte y decide: ¿se puede resolver automáticamente o necesita humano?
Usuario: ${opts.userEmail}
Asunto: ${opts.subject}
Mensaje: ${opts.message}${opts.appContext ? `\nApps del usuario: ${opts.appContext}` : ""}`,
      expectedOutput: `JSON: {"canResolve": bool, "confidence": 0-100, "reply": "respuesta si canResolve", "action": "none|escalate" // Los reembolsos NUNCA son automáticos — siempre escalar al admin, "reason": "por qué"}`,
      agent: "pm_agent",
    };

    const result = await runAgent(
      MARIS_AGENTS.pm_agent, pmTask,
      this.memory, new Map(), {}
    );

    try {
      const j = result.output.indexOf("{");
      const l = result.output.lastIndexOf("}");
      if (j !== -1) {
        const parsed = JSON.parse(result.output.slice(j, l + 1));
        if (parsed.canResolve && parsed.confidence >= 70) {
          return { resolved: true, reply: parsed.reply, action: parsed.action };
        }
      }
    } catch { /* escalar */ }

    return { resolved: false, reply: "Ticket escalado al equipo humano" };
  }
}

// ─── Export de utilidad ───────────────────────────────────────────────────────

export { MARIS_AGENTS as agents };
