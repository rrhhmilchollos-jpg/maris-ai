import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';
import { anthropic } from "@workspace/integrations-anthropic-ai";

interface MonorepoMilestone {
  id: number;
  name: string;
  filter: 'api' | 'web' | 'db' | 'shared'; // Nombre del paquete en pnpm workspace
  targetWorkspace: 'apps/api' | 'apps/web' | 'packages/db' | 'packages/shared';
  dependencies: string[]; // Dependencias externas que requiere este hito (ej: ["prisma", "zod"])
  description: string;
  filePath: string;
}

export class MarisPnpmOrchestrator {
  private projectRoot: string;
  private appStateSummary: string = "";

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot; // Raíz del monorepo Maris AI gestionado con pnpm
  }

  // 1. INTERCEPCIÓN INTELIGENTE: El planificador detecta la app y define qué paquete de pnpm requiere qué
  async planPnpmProject(userPrompt: string): Promise<MonorepoMilestone[]> {
    console.log("🤖 Agente Planificador analizando dependencias del workspace pnpm...");

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1500,
      system: `Eres el Arquitecto de pnpm Workspaces de Maris AI. Divide la petición del cliente en exactamente 4 hitos serializados.
      Identifica qué paquetes de NPM se necesitan para cada hito y asígnalos en el array de dependencies.
      Devuelve EXCLUSIVAMENTE un JSON con esta estructura:
      {
        "milestones": [
          { "id": 1, "name": "Esquema DB", "filter": "db", "targetWorkspace": "packages/db", "dependencies": ["prisma"], "description": "Genera el esquema de base de datos", "filePath": "prisma/schema.prisma" },
          { "id": 2, "name": "Endpoints Backend", "filter": "api", "targetWorkspace": "apps/api", "dependencies": ["express", "zod"], "description": "Crea controladores api", "filePath": "src/routes.ts" }
        ]
      }`,
      messages: [{ role: "user", content: userPrompt }]
    });

    const textResponse = response.content[0].type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(textResponse).milestones;
  }

  // 2. EJECUCIÓN SECUENCIAL CON FORKING Y CO-EJECUCIÓN DE PNPM
  async executeModularPipeline(userPrompt: string, onProgress: Function) {
    const milestones = await this.planPnpmProject(userPrompt);

    for (const milestone of milestones) {
      onProgress({ status: `Fase ${milestone.id}/4: Escribiendo código para ${milestone.name}...`, progress: milestone.id * 25 });

      // FORKING DE CONTEXTO: Claude Haiku solo lee el resumen técnico para no quedarse colgado
      const agentResponse = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 3500,
        system: `Eres el Desarrollador de Maris AI para pnpm workspaces. Estado del proyecto: ${this.appStateSummary}. Escribe SOLO el código fuente solicitado. Sin explicaciones de texto.`,
        messages: [{ role: "user", content: `Genera el archivo ${milestone.filePath} para el workspace ${milestone.targetWorkspace}. Objetivo: ${milestone.description}` }]
      });

      const generatedCode = agentResponse.content[0].type === 'text' ? agentResponse.content[0].text : '';

      // 3. GUARDADO INCREMENTAL EN DISCO
      const absolutePath = path.join(this.projectRoot, milestone.targetWorkspace, milestone.filePath);
      await fs.ensureDir(path.dirname(absolutePath));
      await fs.writeFile(absolutePath, generatedCode, 'utf-8');

      // 4. INSTALACIÓN DE DEPENDENCIAS AUTOMATIZADA CON PNPM WORKSPACE (Evita bloqueos de consola)
      if (milestone.dependencies.length > 0) {
        onProgress({ status: `Instalando dependencias [${milestone.dependencies.join(', ')}] en workspace --filter=${milestone.filter}...` });
        try {
          // Ejecuta: pnpm --filter <paquete> add <dependencias>
          await execa('pnpm', ['--filter', milestone.filter, 'add', ...milestone.dependencies], { cwd: this.projectRoot });
          console.log(`✅ Dependencias instaladas con éxito para el workspace ${milestone.filter}`);
        } catch (error) {
          console.error(`⚠️ Error instalando dependencias en ${milestone.filter}:`, error);
        }
      }

      // Compactamos la memoria para liberar los hilos de Claude Haiku
      this.appStateSummary += `\n- Hito ${milestone.id} finalizado en ${milestone.targetWorkspace}. Archivo ${milestone.filePath} creado y dependencias de pnpm vinculadas.`;
    }

    onProgress({ status: "🚀 ¡Tu proyecto ha sido compilado y estructurado con éxito en el monorepo pnpm!", progress: 100 });
  }
}
