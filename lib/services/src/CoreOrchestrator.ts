import fs from 'fs-extra';
import path from 'path';
import { anthropic } from "@workspace/integrations-anthropic-ai";

// ─── System Prompts Estáticos (CACHEADOS) ─────────────────────────────────────
// Extraídos fuera de la clase para que sean constantes de módulo.
// Anthropic cachea bloques estáticos durante 5 min → 90% descuento en tokens de entrada.
const PLANNER_SYSTEM_STATIC = `Eres el Diseñador de Arquitectura de Maris AI. Tu trabajo es recibir la idea de una app completa y dividir su construcción en exactamente 4 hitos secuenciales mapeados a la estructura de nuestro monorepo.

STACK TECNOLÓGICO OBLIGATORIO (no negociable):
- Base de datos: MongoDB con Mongoose (packages/db)
- Backend: Node.js + Express + TypeScript (apps/api)
- Frontend: React + TypeScript + Tailwind CSS + Wouter (apps/web)
- Validación: Zod en frontend y backend

REGLAS DE PLANIFICACIÓN:
- Siempre 4 hitos exactos en este orden: DB → API → UI → Integración
- Los nombres de archivo deben ser rutas relativas dentro del workspace
- Las descripciones deben ser específicas y accionables
- Nunca inventes tecnologías fuera del stack definido

Devuelve ÚNICAMENTE un objeto JSON con este formato exacto:
{
  "milestones": [
    { "id": 1, "name": "Base de datos", "targetWorkspace": "packages/db", "description": "Explicación del esquema", "filePath": "src/schema.ts" },
    { "id": 2, "name": "Rutas API Backend", "targetWorkspace": "apps/api", "description": "Explicación de endpoints", "filePath": "src/routes/app.ts" },
    { "id": 3, "name": "Componentes de Interfaz", "targetWorkspace": "apps/web", "description": "Explicación del frontend UI", "filePath": "src/pages/index.tsx" },
    { "id": 4, "name": "Integración y Estilos", "targetWorkspace": "apps/web", "description": "Estilos globales y layout", "filePath": "src/App.tsx" }
  ]
}`;

const CODE_AGENT_STATIC = `Eres el Agente de Código Experto de Maris AI.

STACK OBLIGATORIO:
- Frontend: React 18 + TypeScript + Tailwind CSS + Wouter v3 + lucide-react
- Backend: Node.js 20 + Express 5 + TypeScript
- Validación: Zod. Sin TODOs, sin stubs. Código real y funcional.

REGLAS DE GENERACIÓN:
- Genera EXCLUSIVAMENTE el código fuente del archivo solicitado. Sin explicaciones.
- Código válido TypeScript. Sin trailing commas antes de }]).
- Todos los textos de UI en español (es-ES). Mobile-first: 375px+.
- NUNCA generes texto conversacional. Solo el código del archivo.`;

interface Milestone {
  id: number;
  name: string;
  targetWorkspace: 'apps/api' | 'apps/web' | 'packages/db' | 'packages/shared';
  description: string;
  filePath: string;
}

interface GeneratedMilestone extends Milestone {
  code: string;
}

export class CoreOrchestrator {
  private projectRoot: string;
  private architectureSummary: string = "";

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Limpia el texto de respuesta del LLM eliminando bloques de código Markdown
   * para asegurar que JSON.parse no falle.
   */
  private cleanJsonResponse(text: string): string {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      return jsonMatch[1].trim();
    }
    return text.trim();
  }

  /**
   * FASE 1: PLANIFICACIÓN con Prompt Caching
   *
   * OPTIMIZACIÓN: El system prompt del planificador es estático y largo.
   * Con cache_control: { type: "ephemeral" }, las llamadas repetidas cuestan
   * un 90% menos en tokens de entrada (Anthropic Prompt Caching).
   * El prefilling con '{"milestones":[' fuerza al modelo a devolver JSON directamente.
   */
  async planMonorepoProject(userPrompt: string): Promise<Milestone[]> {
    console.log("🤖 [Maris AI] Analizando arquitectura del monorepo...");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1000,
      // OPTIMIZACIÓN: cache_control en el system prompt estático → 90% descuento
      system: [
        {
          type: "text",
          text: PLANNER_SYSTEM_STATIC,
          cache_control: { type: "ephemeral" },
        },
      ] as any,
      messages: [
        { role: "user", content: userPrompt },
        // OPTIMIZACIÓN: Prefilling → el modelo continúa desde aquí sin texto conversacional
        { role: "assistant", content: '{"milestones":[' },
      ],
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text : ']}'
    // Reconstruimos el JSON completo (el prefill ya añadió el inicio)
    const fullJson = '{"milestones":[' + rawText;
    const cleanedJson = this.cleanJsonResponse(fullJson);

    try {
      const result = JSON.parse(cleanedJson);
      return result.milestones;
    } catch (error) {
      console.error("❌ Error parseando JSON de la planificación (intentando sin prefill):", error);
      // Fallback: llamada sin prefilling si el JSON está malformado
      const fallback = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1000,
        system: [
          { type: "text", text: PLANNER_SYSTEM_STATIC, cache_control: { type: "ephemeral" } },
        ] as any,
        messages: [{ role: "user", content: userPrompt }],
      });
      const fallbackText = fallback.content[0].type === 'text' ? fallback.content[0].text : '{}';
      const result = JSON.parse(this.cleanJsonResponse(fallbackText));
      return result.milestones;
    }
  }

  /**
   * FASE 2: CONSTRUCCIÓN HÍBRIDA (Rápida + Live Preview)
   * Ejecuta agentes en paralelo pero actualiza el contexto para la previsualización.
   */
  async buildProjectIncremental(userPrompt: string, wsNotificationCallback: Function) {
    const milestones = await this.planMonorepoProject(userPrompt);

    wsNotificationCallback({ 
      status: "🚀 Arquitectura aprobada. Iniciando construcción paralela...", 
      progress: 10 
    });

    // Ejecución paralela con control de timeout y reintentos para evitar fallos sistémicos
    const generationPromises = milestones.map(async (milestone) => {
      let attempts = 0;
      const MAX_ATTEMPTS = 3;
      let generatedCode = "";

      while (attempts < MAX_ATTEMPTS) {
        try {
          const agentResponse = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 4000,
            // OPTIMIZACIÓN: system en dos bloques:
            //   Bloque 1 (ESTÁTICO, CACHEADO): reglas que nunca cambian → 90% descuento
            //   Bloque 2 (DINÁMICO): estado del proyecto → no se cachea (varía)
            system: [
              {
                type: "text",
                text: CODE_AGENT_STATIC,
                cache_control: { type: "ephemeral" },
              },
              {
                type: "text",
                text: `ESTADO ACTUAL DEL PROYECTO:\n${this.architectureSummary || 'Iniciando proyecto desde cero.'}`,
              },
            ] as any,
            messages: [{ role: "user", content: `Genera el archivo ${milestone.filePath} para el workspace ${milestone.targetWorkspace}.\n\nObjetivo: ${milestone.description}\n\nDevuelve SOLO el código del archivo, sin explicaciones.` }]
          });

          generatedCode = agentResponse.content[0].type === 'text' ? agentResponse.content[0].text : '';
          if (generatedCode) break;
        } catch (error) {
          attempts++;
          console.error(`⚠️ Error en hito ${milestone.id} (intento ${attempts}):`, error);
          if (attempts === MAX_ATTEMPTS) throw new Error(`Fallo crítico tras ${MAX_ATTEMPTS} intentos en hito ${milestone.id}`);
          await new Promise(resolve => setTimeout(resolve, 2000 * attempts)); // Backoff exponencial
        }
      }



      // Guardamos en el sistema de archivos
      await this.writeCodeToWorkspace(milestone.targetWorkspace, milestone.filePath, generatedCode);

      // ACTUALIZACIÓN CRÍTICA: Mantiene viva la Live Preview
      this.architectureSummary += `\n- Hito ${milestone.id} listo: Creado código en ${milestone.targetWorkspace}/${milestone.filePath}.`;

      // Notificación al frontend con los parámetros que activan la preview
      wsNotificationCallback({ 
        status: `🔨 ${milestone.name} integrado en ${milestone.targetWorkspace}.`, 
        progress: (milestone.id / milestones.length) * 100,
        step: milestone.id,
        previewAvailable: true // Esto le dice a la UI que refresque la App Preview
      });

      return { ...milestone, code: generatedCode } as GeneratedMilestone;
    });

    // Esperamos a que todos los agentes terminen sus tareas
    const generatedMilestones = await Promise.all(generationPromises);

    wsNotificationCallback({ 
      status: "🚀 ¡Proyecto completo generado e integrado en el Monorepo!", 
      progress: 100, 
      step: 100 
    });

    const toBundle = (items: GeneratedMilestone[]) => items
      .sort((a, b) => a.id - b.id)
      .map((item) => `// === FILE: ${item.filePath} ===\n${item.code.trim()}\n`)
      .join("\n");

    return {
      frontendCode: toBundle(generatedMilestones.filter((item) => item.targetWorkspace === 'apps/web')),
      backendCode: toBundle(generatedMilestones.filter((item) => item.targetWorkspace !== 'apps/web')),
      milestones: generatedMilestones,
    };
  }

  private async writeCodeToWorkspace(workspace: string, filePath: string, code: string) {
    const absolutePath = path.join(this.projectRoot, workspace, filePath);
    await fs.ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, code, 'utf-8');
    console.log(`💾 Guardado con éxito en: ${absolutePath}`);
  }
}
