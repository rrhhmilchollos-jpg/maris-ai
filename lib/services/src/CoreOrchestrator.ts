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

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Limpieza ultra-rápida de JSON para evitar errores de sintaxis
   */
  private cleanJsonResponse(text: string): string {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    return jsonMatch && jsonMatch[1] ? jsonMatch[1].trim() : text.trim();
  }

  /**
   * PLANIFICACIÓN RELÁMPAGO: Define la estructura en un solo paso
   */
  async planMonorepoProject(userPrompt: string): Promise<Milestone[]> {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 800,
      system: `Eres el Arquitecto de Maris AI. Tu meta es la VELOCIDAD. 
      Divide la app en 4 hitos independientes para ejecución PARALELA.
      Devuelve SOLO JSON: {"milestones": [{id, name, targetWorkspace, description, filePath}]}`,
      messages: [{ role: "user", content: userPrompt }]
    });

    const textResponse = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const result = JSON.parse(this.cleanJsonResponse(textResponse));
    return result.milestones;
  }

  /**
   * MODO EMERGENT: Ejecución Concurrente Masiva
   * En lugar de esperar uno por uno, todos los agentes trabajan a la vez.
   */
  async buildProjectIncremental(userPrompt: string, wsNotificationCallback: Function) {
    const startTime = Date.now();
    
    // 1. Planificación rápida
    wsNotificationCallback({ status: "🧠 Planificando arquitectura instantánea...", progress: 5 });
    const milestones = await this.planMonorepoProject(userPrompt);
    
    wsNotificationCallback({ 
      status: "⚡ ¡Arquitectura lista! Desplegando enjambre de agentes en paralelo...", 
      progress: 20 
    });

    // 2. EJECUCIÓN PARALELA (Promise.all)
    // Lanzamos todas las peticiones a la IA simultáneamente
    const generationTasks = milestones.map(async (milestone) => {
      const agentStartTime = Date.now();
      
      const agentResponse = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4000,
        system: `Eres un Agente de Código de Maris AI. VELOCIDAD MÁXIMA. 
        Genera EXCLUSIVAMENTE el código para ${milestone.filePath}. Sin explicaciones.`,
        messages: [{ role: "user", content: `Prompt: ${userPrompt}\nTarea: ${milestone.description}` }]
      });

      const generatedCode = agentResponse.content[0].type === 'text' ? agentResponse.content[0].text : '';
      
      // Escritura asíncrona en disco
      await this.writeCodeToWorkspace(milestone.targetWorkspace, milestone.filePath, generatedCode);
      
      const duration = ((Date.now() - agentStartTime) / 1000).toFixed(1);
      wsNotificationCallback({ 
        status: `✅ ${milestone.filePath} listo (${duration}s)`, 
        progress: 20 + (milestone.id * 20) 
      });

      return { file: milestone.filePath, duration };
    });

    // Esperamos a que el enjambre termine (el tiempo total será el del archivo más lento)
    await Promise.all(generationTasks);
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    wsNotificationCallback({ 
      status: `🚀 ¡Misión cumplida! App generada en paralelo en ${totalTime} segundos.`, 
      progress: 100 
    });
  }

  private async writeCodeToWorkspace(workspace: string, filePath: string, code: string) {
    const absolutePath = path.join(this.projectRoot, workspace, filePath);
    await fs.ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, code, 'utf-8');
  }
}
