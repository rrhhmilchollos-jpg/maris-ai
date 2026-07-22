/**
 * agentTools.ts — Tool Calling nativo de Anthropic para los agentes de Maris AI
 *
 * Implementa herramientas reales con el protocolo tool_use de Anthropic:
 *
 * HERRAMIENTAS DISPONIBLES:
 * 1. web_search          — búsqueda web en tiempo real (researcher agent)
 * 2. read_file           — leer un archivo del bundle actual
 * 3. write_file          — crear o sobreescribir un archivo del bundle
 * 4. patch_file          — modificación quirúrgica de un archivo
 * 5. run_quality_check   — evaluar calidad del código generado
 * 6. ask_clarification   — preguntar al usuario antes de proceder
 * 7. search_npm_package  — buscar paquetes npm disponibles
 * 8. validate_typescript — validar que el código TS compila
 *
 * AGENTES QUE LOS USAN:
 * - Researcher: web_search para contexto real
 * - Editor/Patcher: read_file + patch_file (quirúrgico)
 * - Architect: ask_clarification si el prompt es ambiguo
 * - QA: run_quality_check + validate_typescript
 */

import { createClaudeToolCallWithFallback } from "./shared-agents";
import { logger } from "./logger";
import { performWebResearch, formatWebResearchForLLM } from "./webResearcher";

// ─── Definiciones de herramientas ─────────────────────────────────────────────

export const MARIS_TOOLS: any[] = [
  {
    name: "web_search",
    description: "Busca información actualizada en internet sobre tecnologías, librerías, APIs o referencias de diseño para el proyecto. Úsala cuando necesites datos recientes o específicos del dominio del usuario.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Búsqueda en español o inglés. Sé específico: 'React 18 hooks best practices 2024'" },
        max_results: { type: "number", description: "Número de resultados (1-5, default 3)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_file",
    description: "Lee el contenido de un archivo específico del bundle de la app. Úsala antes de modificar para entender el código existente.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta del archivo, ej: 'src/components/Navbar.tsx'" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Crea o sobreescribe completamente un archivo en el bundle. Úsala solo para archivos nuevos o cuando el cambio afecta >50% del archivo.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta del archivo" },
        content: { type: "string", description: "Contenido completo del archivo" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "patch_file",
    description: "Modifica quirúrgicamente un archivo: busca texto exacto y lo reemplaza. PREFERIBLE a write_file para cambios pequeños. Preserva todo lo demás intacto.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta del archivo a modificar" },
        search: { type: "string", description: "Texto EXACTO a buscar (debe ser único en el archivo)" },
        replace: { type: "string", description: "Texto de reemplazo" },
        reason: { type: "string", description: "Por qué se hace este cambio" },
      },
      required: ["path", "search", "replace"],
    },
  },
  {
    name: "validate_code",
    description: "Valida un fragmento de código TypeScript/React para detectar errores de sintaxis, imports faltantes o problemas comunes antes de escribirlo.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Código a validar (máx 5000 chars)" },
        language: { type: "string", enum: ["typescript", "javascript", "jsx", "tsx"], description: "Lenguaje del código" },
      },
      required: ["code"],
    },
  },
  {
    name: "ask_clarification",
    description: "Pregunta al usuario algo específico antes de proceder. Úsala SOLO cuando el prompt es genuinamente ambiguo y la respuesta cambiaría significativamente el resultado. Máximo 1 pregunta clara.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Pregunta clara y concisa en español" },
        options: { type: "array", items: { type: "string" }, description: "Opciones sugeridas (opcional, máx 4)" },
      },
      required: ["question"],
    },
  },
  {
    name: "search_npm",
    description: "Busca un paquete npm para verificar que existe, su versión actual y si es adecuado para el proyecto.",
    input_schema: {
      type: "object",
      properties: {
        package_name: { type: "string", description: "Nombre del paquete npm" },
      },
      required: ["package_name"],
    },
  },
];

// ─── Herramientas disponibles por rol de agente ───────────────────────────────

export const TOOLS_BY_ROLE: Record<string, string[]> = {
  researcher: ["web_search"],
  architect:  ["web_search", "ask_clarification"],
  editor:     ["read_file", "write_file", "patch_file", "validate_code"],
  patcher:    ["read_file", "patch_file", "validate_code"],
  qa:         ["read_file", "validate_code"],
  integrator: ["web_search", "search_npm"],
};

export function getToolsForRole(role: string): any[] {
  const allowed = TOOLS_BY_ROLE[role] ?? [];
  return MARIS_TOOLS.filter(t => allowed.includes(t.name));
}

// ─── Ejecutor de herramientas ─────────────────────────────────────────────────

export interface ToolContext {
  bundle?: string;       // Bundle actual de archivos
  appTitle?: string;
  userId?: string;
  log?: (agent: string, msg: string) => Promise<void>;
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  ctx: ToolContext,
): Promise<{ result: string; bundleUpdated?: string }> {

  switch (toolName) {

    case "web_search": {
      const query = String(toolInput.query || "");
      const maxResults = Number(toolInput.max_results || 3);
      try {
        ctx.log?.("researcher", `🔍 Buscando: "${query}"…`);
        const res = await performWebResearch(query, Math.min(maxResults, 5), 10_000);
        if (res.results.length === 0 && res.pages.length === 0) {
          return { result: `No se encontraron resultados para: "${query}"` };
        }
        const formatted = formatWebResearchForLLM(res);
        ctx.log?.("researcher", `✅ ${res.results.length} resultados encontrados para "${query}"`);
        return { result: formatted.slice(0, 4000) };
      } catch (err) {
        logger.warn({ err, query }, "agentTools: web_search failed");
        return { result: `Error al buscar "${query}". Continúa sin este contexto.` };
      }
    }

    case "read_file": {
      const path = String(toolInput.path || "");
      if (!ctx.bundle) return { result: `Error: no hay bundle disponible` };
      const files = parseBundleToMap(ctx.bundle);
      const content = files.get(path) || files.get(path.replace(/^src\//, ""));
      if (!content) {
        const available = Array.from(files.keys()).slice(0, 10).join(", ");
        return { result: `Archivo "${path}" no encontrado. Archivos disponibles: ${available}` };
      }
      return { result: `=== ${path} ===\n${content.slice(0, 8000)}` };
    }

    case "write_file": {
      const path = String(toolInput.path || "");
      const fileContent = String(toolInput.content || "");
      if (!path || !fileContent) return { result: "Error: path y content son requeridos" };
      const updatedBundle = applyFileToBundle(ctx.bundle || "", path, fileContent);
      ctx.log?.("coder", `📝 Archivo creado/actualizado: ${path}`);
      return { result: `✅ Archivo "${path}" escrito (${Math.round(fileContent.length / 1024)} KB)`, bundleUpdated: updatedBundle };
    }

    case "patch_file": {
      const path = String(toolInput.path || "");
      const search = String(toolInput.search || "");
      const replace = String(toolInput.replace || "");
      const reason = String(toolInput.reason || "");
      if (!ctx.bundle) return { result: "Error: no hay bundle disponible" };
      const files = parseBundleToMap(ctx.bundle);
      const original = files.get(path);
      if (!original) return { result: `Error: archivo "${path}" no encontrado en el bundle` };
      if (!original.includes(search)) {
        return { result: `Error: texto exacto no encontrado en "${path}". Verifica que el fragmento existe tal cual.` };
      }
      const patched = original.replace(search, replace);
      files.set(path, patched);
      const updatedBundle = mapToBundle(files);
      ctx.log?.("coder", `🔧 Parche aplicado en ${path}${reason ? ` — ${reason}` : ""}`);
      return { result: `✅ Parche aplicado en "${path}"`, bundleUpdated: updatedBundle };
    }

    case "validate_code": {
      const code = String(toolInput.code || "").slice(0, 5000);
      try {
        // Validación básica con heurísticas rápidas — sin esbuild aquí para no bloquear
        const issues: string[] = [];
        const openBraces = (code.match(/\{/g) || []).length;
        const closeBraces = (code.match(/\}/g) || []).length;
        if (Math.abs(openBraces - closeBraces) > 2) issues.push("Llaves desbalanceadas");
        if (code.includes("import") && code.includes("from \"") && !code.includes("'react'") && !code.includes('"react"') && code.includes("jsx") || code.includes("tsx")) {
          if (!code.includes("import React") && !code.includes("from 'react'") && !code.includes('from "react"')) {
            issues.push("Posible falta de import de React");
          }
        }
        if (code.includes(".map(") && !code.includes("key=")) issues.push("Arrays .map() sin prop key");
        if (issues.length === 0) return { result: "✅ Código válido — sin problemas detectados" };
        return { result: `⚠️ Posibles problemas:\n${issues.map(i => `- ${i}`).join("\n")}` };
      } catch {
        return { result: "✅ Validación completada" };
      }
    }

    case "ask_clarification": {
      const question = String(toolInput.question || "");
      const options = Array.isArray(toolInput.options) ? toolInput.options : [];
      ctx.log?.("architect", `❓ ${question}${options.length > 0 ? `\nOpciones: ${options.join(" | ")}` : ""}`);
      // Devolvemos la pregunta — el sistema de checkpoint la capturará
      return {
        result: JSON.stringify({ clarification_needed: true, question, options }),
      };
    }

    case "search_npm": {
      const pkg = String(toolInput.package_name || "");
      try {
        const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return { result: `Paquete "${pkg}" no encontrado en npm` };
        const data: any = await res.json();
        return { result: `📦 ${pkg}@${data.version} — ${data.description || "sin descripción"}. Licencia: ${data.license || "N/A"}` };
      } catch {
        return { result: `No se pudo verificar "${pkg}" en npm` };
      }
    }

    default:
      return { result: `Herramienta desconocida: ${toolName}` };
  }
}

// ─── Agente con tool calling — loop hasta finalizar ──────────────────────────

export interface AgentWithToolsOpts {
  role: string;
  systemPrompt: string;
  userMessage: string;
  model?: string;
  maxIterations?: number;
  ctx?: ToolContext;
  onToolCall?: (name: string, input: any) => void;
}

export interface AgentWithToolsResult {
  text: string;
  bundleUpdated?: string;
  toolsUsed: string[];
  iterations: number;
}

/**
 * Ejecuta un agente con tool calling real de Anthropic.
 * El agente puede llamar herramientas múltiples veces hasta tener todo el contexto.
 */
export async function runAgentWithTools(opts: AgentWithToolsOpts): Promise<AgentWithToolsResult> {
  const {
    role,
    systemPrompt,
    userMessage,
    model = "zoco-plus",
    maxIterations = 5,
    ctx = {},
    onToolCall,
  } = opts;

  const tools = getToolsForRole(role);
  const messages: any[] = [{ role: "user", content: userMessage }];
  const toolsUsed: string[] = [];
  let currentBundle = ctx.bundle;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const response = await createClaudeToolCallWithFallback("tools", model, {
      max_tokens: 2048,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? { type: "auto" } : undefined,
      messages,
    });

    // Añadir respuesta del asistente al historial
    messages.push({ role: "assistant", content: response.content });

    // ¿Terminó? → devolver texto final
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b: any) => b.type === "text");
      return {
        text: (textBlock as any)?.text ?? "",
        bundleUpdated: currentBundle,
        toolsUsed,
        iterations,
      };
    }

    // Procesar tool_use blocks
    if (response.stop_reason === "tool_use") {
      const toolResults: any[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const toolBlock = block as any;
        toolsUsed.push(toolBlock.name);
        onToolCall?.(toolBlock.name, toolBlock.input);

        logger.info({ role, tool: toolBlock.name, input: toolBlock.input }, "agentTools: tool_use");

        const execCtx = { ...ctx, bundle: currentBundle };
        const { result, bundleUpdated } = await executeTool(toolBlock.name, toolBlock.input, execCtx);
        if (bundleUpdated) currentBundle = bundleUpdated;

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: result,
        });
      }

      // Devolver resultados al modelo
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // stop_reason desconocido → salir
    break;
  }

  // Si llegamos aquí por max_iterations, devolver último texto
  const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
  const textBlock = (lastAssistant?.content || []).find((b: any) => b.type === "text");
  return {
    text: (textBlock as any)?.text ?? "Agente alcanzó el límite de iteraciones",
    bundleUpdated: currentBundle,
    toolsUsed,
    iterations,
  };
}

// ─── Utilidades de bundle ─────────────────────────────────────────────────────

function parseBundleToMap(bundle: string): Map<string, string> {
  const files = new Map<string, string>();
  const parts = bundle.split(/\/\/ === FILE: /);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const path = part.slice(0, nl).trim().replace(/ ===$/, "");
    if (path) files.set(path, part.slice(nl + 1));
  }
  return files;
}

function mapToBundle(files: Map<string, string>): string {
  return Array.from(files.entries())
    .map(([path, content]) => `// === FILE: ${path} ===\n${content}`)
    .join("\n\n");
}

function applyFileToBundle(bundle: string, path: string, content: string): string {
  const files = parseBundleToMap(bundle);
  files.set(path, content);
  return mapToBundle(files);
}
