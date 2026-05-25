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

  async planMonorepoProject(userPrompt: string): Promise<Milestone[]> {
    console.log("🤖 Agente Planificador analizando arquitectura del monorepo...");

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
    const result = JSON.parse(textResponse);
    return result.milestones;
  }

  async buildProjectIncremental(userPrompt: string, wsNotificationCallback: Function) {
    const milestones = await this.planMonorepoProject(userPrompt);

    for (const milestone of milestones) {
      wsNotificationCallback({ 
        status: `🔨 Construyendo ${milestone.name} en ${milestone.targetWorkspace}...`, 
        progress: (milestone.id / milestones.length) * 100,
        step: milestone.id 
      });

      console.log(`🔨 Procesando Hito ${milestone.id}: ${milestone.name} en -> ${milestone.targetWorkspace}`);

      const agentResponse = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4000,
        system: `Eres el Agente de Código Experto en Monorepos de Maris AI. 
        Estado actual global de la aplicación construida hasta ahora: ${this.architectureSummary}.
        Debes generar EXCLUSIVAMENTE el código fuente limpio para el archivo indicado. No des explicaciones, solo código estructurado listo para producción.`,
        messages: [{ role: "user", content: `Escribe el código para el hito: ${milestone.description}. Debe guardarse en el workspace: ${milestone.targetWorkspace}/${milestone.filePath}` }]
      });

      const generatedCode = agentResponse.content[0].type === 'text' ? agentResponse.content[0].text : '';

      await this.writeCodeToWorkspace(milestone.targetWorkspace, milestone.filePath, generatedCode);

      this.architectureSummary += `\n- Hito ${milestone.id} listo: Creado código en ${milestone.targetWorkspace}/${milestone.filePath} con funcionalidades de ${milestone.name}.`;
    }

    wsNotificationCallback({ status: "🚀 ¡Proyecto completo generado e integrado en el Monorepo!", progress: 100, step: 100 });
  }

  private async writeCodeToWorkspace(workspace: string, filePath: string, code: string) {
    const absolutePath = path.join(this.projectRoot, workspace, filePath);
    await fs.ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, code, 'utf-8');
    console.log(`💾 Guardado con éxito en: ${absolutePath}`);
  }
}
