import fs from 'fs-extra';
import path from 'path';
import { anthropic } from "@workspace/integrations-anthropic-ai";

interface Milestone {
  id: number;
  name: string;
  targetWorkspace: 'apps/api' | 'apps/web' | 'packages/db' | 'packages/shared';
  description: string;
  filePath: string;
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
   * FASE 1: PLANIFICACIÓN
   * Genera el plan que permite a la UI mostrar los pasos antes de construir.
   */
  async planMonorepoProject(userPrompt: string): Promise<Milestone[]> {
    console.log("🤖 [Maris AI] Analizando arquitectura del monorepo...");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1000,
      system: `Eres el Diseñador de Arquitectura de Maris AI. Tu trabajo es recibir la idea de una app completa y dividir su construcción en exactamente 4 hitos secuenciales mapeados a la estructura de nuestro monorepo.
      Devuelve ÚNICAMENTE un objeto JSON con este formato exacto:
      {
        "milestones": [
          { "id": 1, "name": "Base de datos", "targetWorkspace": "packages/db", "description": "Explicación del esquema", "filePath": "src/schema.ts" },
          { "id": 2, "name": "Rutas API Backend", "targetWorkspace": "apps/api", "description": "Explicación de endpoints", "filePath": "src/routes/app.ts" },
          { "id": 3, "name": "Componentes de Interfaz", "targetWorkspace": "apps/web", "description": "Explicación del frontend UI", "filePath": "src/pages/index.tsx" },
          { "id": 4, "name": "Integración y Estilos", "targetWorkspace": "apps/web", "description": "Estilos globales y layout", "filePath": "src/App.tsx" }
        ]
      }`,
      messages: [{ role: "user", content: userPrompt }]
    });

    const textResponse = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const cleanedJson = this.cleanJsonResponse(textResponse);
    
    try {
      const result = JSON.parse(cleanedJson);
      return result.milestones;
    } catch (error) {
      console.error("❌ Error parseando JSON de la planificación:", error);
      throw error;
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

    // Ejecución paralela para máxima velocidad (estilo emergent.sh)
    const generationPromises = milestones.map(async (milestone) => {
      
      const agentResponse = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4000,
        system: `Eres el Agente de Código Experto de Maris AI. 
        Estado actual global: ${this.architectureSummary || 'Iniciando proyecto'}.
        Genera EXCLUSIVAMENTE el código fuente para ${milestone.filePath}. Sin explicaciones.`,
        messages: [{ role: "user", content: `Escribe el código para el hito: ${milestone.description}.` }]
      });

      const generatedCode = agentResponse.content[0].type === 'text' ? agentResponse.content[0].text : '';

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

      return { id: milestone.id, success: true };
    });

    // Esperamos a que todos los agentes terminen sus tareas
    await Promise.all(generationPromises);

    wsNotificationCallback({ 
      status: "🚀 ¡Proyecto completo generado e integrado en el Monorepo!", 
      progress: 100, 
      step: 100 
    });
  }

  private async writeCodeToWorkspace(workspace: string, filePath: string, code: string) {
    const absolutePath = path.join(this.projectRoot, workspace, filePath);
    await fs.ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, code, 'utf-8');
    console.log(`💾 Guardado con éxito en: ${absolutePath}`);
  }
}
