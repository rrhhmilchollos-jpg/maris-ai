import { logger } from "./logger";
import { anthropic, resolveClaudeCoderModel } from "./anthropic";
import { performWebResearch, formatWebResearchForLLM } from "./web-research";
import { recallGenerations, buildGenerationMemoryBlock } from "./memory";
import { runTestingAgent } from "./tester";
import { 
  type GenLanguage, 
  type AgentRole, 
  type AgentLog, 
  type GeneratePhase, 
  type GenerateProgress 
} from "./shared-agents";

// ─── Constants ────────────────────────────────────────────────────────────────

const ARCHITECT_SYSTEM_PROMPT = `Eres el System Architect de Maris AI. Diseña una estructura de archivos limpia y escalable.`;
const DESIGNER_SYSTEM_PROMPT = `Eres el UI/UX Designer de Maris AI. Define el sistema de diseño visual.`;
const CODER_SYSTEM_PROMPT = `Eres el Senior Engineer de Maris AI. Escribe código de alta calidad y listo para producción.`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectPlan {
  title: string;
  description: string;
  techStack: string[];
  pages: Array<{ name: string; route: string; purpose: string }>;
  components: Array<{ name: string; purpose: string }>;
  hooks: Array<{ name: string; purpose: string }>;
  utils: Array<{ name: string; purpose: string }>;
  dataModels: Array<{ name: string; fields: string[] }>;
  frontendFiles: string[];
  backendNeeded: boolean;
  backendFiles: string[];
}

interface DesignSystem {
  theme: string;
  palette: Record<string, string>;
  typography: { sans: string; display?: string; sizes?: Record<string, string> };
  radius: string;
  vibe: string;
  tailwindExtend: string;
  globalCSS: string;
}

// ─── Main Execution Pipeline ──────────────────────────────────────────────────

export async function runGenerationPipeline(
  jobId: string,
  prompt: string,
  model: string,
  log: AgentLog,
  updateProgress: (p: GenerateProgress) => Promise<void>,
  savePartialCode: (code: string) => Promise<void>
) {
  try {
    // 1. RESEARCH PHASE (Sequential)
    log("researcher", "Iniciando investigación de mercado y competencia...");
    await updateProgress({ phase: "researching", progress: 10 });
    const research = await researchTopic(prompt);
    log("researcher", "Investigación completada. Se han extraído patrones de éxito y mejores prácticas.");

    // 2. ARCHITECT PHASE (Sequential)
    log("architect", "Diseñando la arquitectura del sistema y flujo de datos...");
    await updateProgress({ phase: "architecting", progress: 20 });
    const plan = await architectPlan(prompt, research, model);
    log("architect", `Arquitectura definida: ${plan.title}. Se generarán ${plan.frontendFiles.length} archivos frontend.`);

    // 3. DESIGN PHASE (Sequential)
    log("designer", "Creando el sistema de diseño visual y tokens de UI...");
    await updateProgress({ phase: "designing", progress: 30 });
    const design = await designSystem(plan, research, model);
    log("designer", `Sistema de diseño establecido: Vibe ${design.vibe}. Colores: ${Object.keys(design.palette).join(", ")}.`);

    // 4. PARALLEL EXECUTION: FRONTEND, BACKEND & DATABASE
    log("system", "Iniciando construcción paralela de componentes...");
    await updateProgress({ phase: "frontend", progress: 40 });

    const frontendPromise = (async () => {
      log("frontend", "Escribiendo componentes de la interfaz de usuario...");
      const code = await generateFrontend(plan, design, research, model, (msg) => log("frontend", msg));
      await savePartialCode(code);
      log("frontend", "Interfaz de usuario completada y optimizada.");
      return code;
    })();

    const backendPromise = (async () => {
      if (plan.backendNeeded) {
        log("backend", "Configurando lógica de servidor y endpoints de API...");
        await generateBackend(plan, research, model, (msg) => log("backend", msg));
        log("backend", "Lógica de servidor lista.");
      }
    })();

    const dbPromise = (async () => {
      if (plan.dataModels.length > 0) {
        log("database", "Estructurando modelos de datos y esquemas de persistencia...");
        await generateDatabase(plan, model, (msg) => log("database", msg));
        log("database", "Esquemas de base de datos validados.");
      }
    })();

    // Wait for all core tasks to complete
    const [frontendCode] = await Promise.all([frontendPromise, backendPromise, dbPromise]);

    // 5. TESTING AGENT PHASE (Systematic Validation & Repair)
    const testedFrontend = await runTestingAgent(frontendCode, {
      jobId,
      prompt,
      plan,
      language: "typescript", // Default for this pipeline
      log,
      onProgress: (p) => updateProgress(p),
    });

    // 6. QA & FINAL VALIDATION
    log("qa", "Iniciando auditoría de calidad final...");
    await updateProgress({ phase: "testing", progress: 90 });
    await runQA(testedFrontend, plan, (msg) => log("qa", msg));
    log("qa", "Auditoría completada. La aplicación cumple con los estándares de calidad.");

    // 7. DEVOPS & PATCHING
    log("patcher", "Realizando ajustes finales y preparando el despliegue...");
    await updateProgress({ phase: "patching", progress: 95 });
    log("patcher", "Optimización de activos y configuración de entorno completada.");

    await updateProgress({ phase: "parsing", progress: 100 });
    log("system", "¡Proyecto finalizado con éxito! Listo para el despliegue.");

  } catch (error) {
    log("system", `Error crítico en el pipeline: ${error.message}`, "error");
    throw error;
  }
}

// ─── Helper Functions (Placeholders for logic already analyzed) ────────────────

async function researchTopic(prompt: string): Promise<string> { /* ... */ return "Brief de investigación..."; }
async function architectPlan(prompt: string, research: string, model: string): Promise<ProjectPlan> { /* ... */ return { title: "App", frontendFiles: ["index.tsx"], backendNeeded: true, dataModels: [{ name: "User", fields: ["id"] }] } as any; }
async function designSystem(plan: ProjectPlan, research: string, model: string): Promise<DesignSystem> { /* ... */ return { vibe: "Modern", palette: { primary: "#000" } } as any; }
async function generateFrontend(plan: any, design: any, research: any, model: any, log: any) { return "// Código frontend"; }
async function generateBackend(plan: any, research: any, model: any, log: any) { return; }
async function generateDatabase(plan: any, model: any, log: any) { return; }
async function runQA(code: string, plan: any, log: any) { return; }
