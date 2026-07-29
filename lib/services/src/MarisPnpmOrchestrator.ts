import fs from 'fs-extra';
import path from 'path';
import { Zoco IA } from "@workspace/integrations-Zoco IA-ai";

// ─── System Prompts ──────────────────────────────────────────────────────────

const PNPM_PLANNER_SYSTEM = `Eres el Arquitecto de pnpm Workspaces de Maris AI. Divide la petición del usuario en hitos de desarrollo ordenados por capas.

STACK OBLIGATORIO:
- packages/db: Prisma + PostgreSQL
- apps/api: Node.js + Express + TypeScript + Zod
- apps/web: React + TypeScript + Tailwind CSS + Wouter

Identifica qué paquetes de NPM se necesitan para cada hito y asígnalos en el array de dependencies.

Devuelve EXCLUSIVAMENTE un JSON con esta estructura:
{
  "milestones": [
    { "id": 1, "name": "Esquema DB", "filter": "db", "targetWorkspace": "packages/db", "dependencies": ["prisma", "@prisma/client"], "description": "Schema Prisma con todos los modelos", "filePath": "prisma/schema.prisma" },
    { "id": 2, "name": "Endpoints Backend", "filter": "api", "targetWorkspace": "apps/api", "dependencies": ["express", "zod"], "description": "Servidor Express con rutas REST", "filePath": "src/index.ts" }
  ]
}`;

const PNPM_CODE_AGENT_SYSTEM = `Eres el Desarrollador Senior de Maris AI para pnpm workspaces.

REGLAS CRÍTICAS:
- Escribe SOLO el código fuente solicitado. Sin explicaciones de texto.
- Código TypeScript válido, sin TODOs, sin stubs, sin placeholders.
- Sigue el stack del workspace asignado.
- Todos los textos de UI en español (es-ES).
- Para apps/web: usa Wouter para el router. El catch-all NotFound SIEMPRE al final del Switch.
- Código completo y funcional — no truncar, no resumir.`;

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface MonorepoMilestone {
  id: number;
  name: string;
  filter: 'api' | 'web' | 'db' | 'shared';
  targetWorkspace: 'apps/api' | 'apps/web' | 'packages/db' | 'packages/shared';
  dependencies: string[];
  description: string;
  filePath: string;
}

// ─── Clase Principal ─────────────────────────────────────────────────────────

export class MarisPnpmOrchestrator {
  private projectRoot: string;
  private appStateSummary: string = "";
  // Colecta todos los archivos de apps/web para construir el frontendCode bundle
  private webFiles: Record<string, string> = {};

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async planPnpmProject(userPrompt: string): Promise<MonorepoMilestone[]> {
    console.log("🤖 Planificador pnpm analizando dependencias...");

    const response = await Zoco IA.messages.create({
      model: "zoco-plus",
      max_tokens: 4000,
      system: [{ type: "text", text: PNPM_PLANNER_SYSTEM, cache_control: { type: "ephemeral" } }] as any,
      messages: [
        { role: "user", content: userPrompt },
        { role: "assistant", content: '{"milestones":[' },
      ],
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text : ']}';
    const fullJson = '{"milestones":[' + rawText;

    try {
      return JSON.parse(fullJson).milestones;
    } catch {
      const fb = await Zoco IA.messages.create({
        model: "zoco-plus",
        max_tokens: 4000,
        system: [{ type: "text", text: PNPM_PLANNER_SYSTEM, cache_control: { type: "ephemeral" } }] as any,
        messages: [{ role: "user", content: userPrompt }],
      });
      const t = fb.content[0].type === 'text' ? fb.content[0].text : '{}';
      return JSON.parse(t).milestones;
    }
  }

  async executeModularPipeline(userPrompt: string, onProgress: Function) {
    const milestones = await this.planPnpmProject(userPrompt);
    this.webFiles = {};

    for (const milestone of milestones) {
      onProgress({
        status: `Fase ${milestone.id}/${milestones.length}: ${milestone.name}…`,
        progress: Math.round((milestone.id / milestones.length) * 90),
      });

      const agentResponse = await Zoco IA.messages.create({
        model: "zoco-plus",
        max_tokens: 16000, // suficiente para App.tsx completo con router y todos los módulos
        system: [
          { type: "text", text: PNPM_CODE_AGENT_SYSTEM, cache_control: { type: "ephemeral" } },
          { type: "text", text: `Estado del proyecto:\n${this.appStateSummary || 'Iniciando.'}` },
        ] as any,
        messages: [{
          role: "user",
          content: `Genera el archivo ${milestone.filePath} para el workspace ${milestone.targetWorkspace}.\n\nDescripción del hito: ${milestone.description}\n\nPrompt original del usuario: ${userPrompt.slice(0, 2000)}`,
        }],
      });

      const generatedCode = agentResponse.content[0].type === 'text'
        ? agentResponse.content[0].text
        : '';

      // Guardar en disco
      const absolutePath = path.join(this.projectRoot, milestone.targetWorkspace, milestone.filePath);
      await fs.ensureDir(path.dirname(absolutePath));
      await fs.writeFile(absolutePath, generatedCode, 'utf-8');

      // CRÍTICO: si es un archivo de apps/web, acumularlo en el bundle de frontend
      // El evaluador necesita el bundle en formato "// === FILE: <path> ===" para
      // poder analizar y reparar el código. Sin esto, el evaluador recibe string
      // vacío y entra en bucle infinito intentando reparar algo que no ve.
      if (milestone.targetWorkspace === 'apps/web') {
        this.webFiles[milestone.filePath] = generatedCode;
      }

      this.appStateSummary += `\n- Hito ${milestone.id} (${milestone.name}) completado en ${milestone.targetWorkspace}: ${milestone.filePath}`;
    }

    onProgress({ status: "🚀 ¡Proyecto generado!", progress: 100 });
  }

  /**
   * Devuelve el frontendCode bundle en el formato estándar de Maris AI:
   * "// === FILE: <ruta> ===\n<contenido>\n"
   * Esto permite que el evaluador, el testing agent y el visual tester
   * analicen y reparen el código correctamente.
   */
  buildFrontendBundle(): string {
    if (Object.keys(this.webFiles).length === 0) return "";
    return Object.entries(this.webFiles)
      .map(([filePath, code]) => `// === FILE: ${filePath} ===\n${code}`)
      .join("\n\n");
  }
}
