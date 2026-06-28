import fs from 'fs-extra';
import path from 'path';
import { anthropic } from "@workspace/integrations-anthropic-ai";

// ─────────────────────────────────────────────────────────────────────────────
// CoreOrchestrator v2 — "Task Splitting" real para proyectos ultra-complejos
// (ERPs, ecosistemas multi-módulo, sistemas de nivel empresarial).
//
// Diferencias clave frente a v1 (ver historial de git para la versión anterior):
// - Número de hitos DINÁMICO según la complejidad real del proyecto, no fijo en 4.
//   Un ERP necesita modelar cada módulo de negocio por separado (facturación,
//   inventario, clientes, reporting...), no comprimirlo en un solo archivo.
// - claude-sonnet-4-6 en planificación y generación de código, no Haiku — la
//   complejidad real de un sistema empresarial necesita el modelo capaz, no el
//   más rápido.
// - Contexto ACUMULATIVO real: cada hito recibe el código completo (no solo un
//   resumen en texto) de los hitos relevantes ya generados, para mantener
//   coherencia real entre archivos (mismos nombres de campos, mismos tipos).
// - Ejecución SECUENCIAL por capas (DB → Backend → Frontend → Integración),
//   no en paralelo ciego — el backend necesita conocer el esquema de datos ya
//   decidido, no adivinarlo en paralelo.
// - Reusa systemPromptOverrides inyectados desde apps.ts (los mismos prompts de
//   calidad — Zod, JWT, rate limiting, transacciones Prisma, OpenAPI — que ya
//   usa el pipeline estándar), para que un proyecto ultra-complejo no reciba
//   código de menor calidad que uno simple, solo más volumen.
// ─────────────────────────────────────────────────────────────────────────────

const PLANNER_SYSTEM_STATIC = `Eres el Arquitecto de Sistemas Senior de Maris AI. Recibes la idea de un proyecto de ALTA COMPLEJIDAD (sistema empresarial, ERP, ecosistema multi-módulo) y lo divides en hitos de construcción reales y manejables.

PRINCIPIO RECTOR: cada hito debe ser un archivo o conjunto de archivos coherente que un ingeniero senior real escribiría como una unidad — ni demasiado pequeño (no fragmentes en exceso) ni demasiado grande (no comprimas un módulo entero de negocio en un solo archivo).

DECISIÓN DE ARQUITECTURA — TÚ decides "monolith" vs "microservices" analizando el prompt del usuario (este planificador NO recibe ninguna decisión previa de otro agente — decide aquí, con el mismo criterio estricto que usa el resto de la plataforma para mantener coherencia):
Elige "microservices" SOLO cuando se cumplan AMBAS condiciones:
1. El proyecto es genuinamente complejo: varios dominios de negocio claramente independientes (ej: un ERP con facturación + inventario + RRHH + CRM, una plataforma con módulos que escalarían y se desplegarían por separado en una empresa real).
2. El usuario lo pide explícitamente o describe necesidades que solo tienen sentido con servicios independientes (ej: "que cada módulo escale por separado", "arquitectura de microservicios", "cada equipo debe poder desplegar su parte sin afectar al resto").
En CUALQUIER otro caso usa "monolith" (la opción por defecto, casi siempre la correcta): un monolito bien estructurado es más simple de mantener, depurar y desplegar que microservicios prematuros. Ante la duda, "monolith".

ARQUITECTURA — MONOLITO (caso por defecto, casi siempre correcto):
ESTRUCTURA POR CAPAS — genera los hitos agrupados en estas capas, EN ESTE ORDEN (cada capa depende de la anterior):
1. DATA LAYER — esquema de datos completo (todos los modelos/tablas con sus relaciones). Normalmente 1-2 hitos. targetWorkspace: "apps/api".
2. BACKEND CORE — autenticación, middleware, configuración base (helmet, cors, rate limit, logger, errors). 1 hito. targetWorkspace: "apps/api".
3. BACKEND MODULES — un hito POR CADA módulo de negocio real (ej: en un ERP: facturación, inventario, clientes, RRHH, contabilidad serían hitos separados). Esto es lo que hace que un proyecto complejo se modele bien: no comprimas 5 módulos de negocio en 1 archivo. targetWorkspace: "apps/api".
4. INTEGRATIONS — un hito por integración externa relevante si las hay (pagos, email, webhooks). targetWorkspace: "apps/api".
5. FRONTEND CORE — layout, routing, componentes compartidos (Navbar, Sidebar, auth guard). 1-2 hitos. targetWorkspace: "apps/web". OBLIGATORIO: uno de estos hitos debe generar el archivo "App.tsx" (exactamente ese nombre, en la raíz de src/) con la firma EXACTA "export default function App()" como componente raíz que monta el router y el layout — el sistema de testing automático busca específicamente este archivo y este patrón para validar el frontend generado; un nombre o firma distintos (Main, Root, Layout, etc.) hace que esa validación se omita aunque el código sea funcionalmente correcto.
6. FRONTEND MODULES — un hito por cada área funcional del frontend que corresponda a un módulo de backend (dashboard, listados, formularios de cada módulo). targetWorkspace: "apps/web".
7. DOCS — openapi.yaml documentando TODOS los endpoints reales generados en los hitos de backend. targetWorkspace: "apps/api".

ARQUITECTURA — MICROSERVICIOS (solo si decidiste "microservices" arriba):
Cada dominio de negocio independiente se convierte en su PROPIO servicio, NO en módulos dentro de un único "apps/api":
1. Por cada servicio identificado (ej: billing, inventory, customers): un hito DATA LAYER propio con targetWorkspace "services/<nombre-servicio>" y su propio esquema — los servicios NO comparten base de datos entre ellos (principio fundamental de microservicios reales).
2. Por cada servicio: un hito BACKEND CORE propio (su propio index.ts, su propio middleware, su propio package.json) — cada servicio es una app Express independiente y desplegable por separado, con targetWorkspace "services/<nombre-servicio>" y serviceName "<nombre-servicio>".
3. Por cada servicio: hito(s) BACKEND MODULE con la lógica de ese dominio — targetWorkspace "services/<nombre-servicio>".
4. Si un servicio necesita datos de otro (ej: facturación necesita el precio de inventory), el hito debe especificarlo en su description como "llama a la API HTTP de inventory en process.env.INVENTORY_SERVICE_URL" — NUNCA importar código directamente entre servicios ni compartir su base de datos.
5. Un hito adicional "packages/shared" con tipos/contratos TypeScript compartidos (ej: la forma de los eventos o payloads entre servicios) — esto SÍ se comparte, el código de negocio NO.
6. FRONTEND: igual que en monolito, pero las llamadas API del frontend deben distribuirse entre los distintos servicios según corresponda (ej: el frontend llama a billing-service para facturas, a inventory-service para stock) — documentar esto en la description del hito de cliente API del frontend.
7. Un hito final "docs" describiendo en un README.md la topología de servicios (qué servicio expone qué API, en qué puerto/URL se espera cada uno en desarrollo).
8. Un hito adicional "docs" (targetWorkspace "." — convención para la raíz del proyecto, fuera de apps/services/packages, filePath "docker-compose.yml") con un docker-compose real: un servicio Docker por cada microservicio generado (build desde su propio Dockerfile en services/<nombre>, puerto mapeado, variables de entorno con las URLs de los OTROS servicios inyectadas vía environment), MÁS un contenedor de base de datos por cada base de datos distinta que usen los servicios (postgres:16 / mongo:7 según corresponda, con su propio volumen para persistencia). Esto es lo que de verdad distingue "carpetas separadas" de "microservicios que el usuario puede levantar y probar juntos con un solo comando" (docker compose up). Genera también, por cada servicio, su Dockerfile mínimo (node:20-alpine, copy, npm install, npm run build, CMD) como un hito propio con targetWorkspace "services/<nombre-servicio>" y filePath "Dockerfile".

NÚMERO DE HITOS: no hay un número fijo. Un proyecto "ultra-complejo" real necesita entre 8 y 20 hitos en monolito, o más en microservicios (cada servicio repite su propia mini-estructura data+core+module). NO comprimas para reducir el número — eso es exactamente el error que produce sistemas incompletos.

Cada hito debe especificar "dependsOn": [ids de hitos que debe ver como contexto antes de generarse]. Por ejemplo, un módulo de backend depende del hito de la capa DATA de SU MISMO servicio (nunca de la capa DATA de otro servicio, en microservicios — esa dependencia debe ser por HTTP en runtime, no por contexto de generación).

STACK TECNOLÓGICO:
- Si el proyecto tiene transacciones multi-tabla críticas (pagos+stock, facturación, contabilidad): PostgreSQL + Prisma. En microservicios, esta decisión es POR SERVICIO — un servicio puede usar Postgres y otro Mongo, según lo que ese dominio concreto necesite.
- En el resto de casos: MongoDB + Mongoose.
- Backend: Node.js + Express + TypeScript + Zod.
- Frontend WEB (caso por defecto): React + TypeScript + Tailwind CSS.
- Frontend MÓVIL NATIVO ("platform":"mobile-native"): SOLO si el usuario pide explícitamente App Store/Google Play/app nativa/iOS/Android nativo. En ese caso usa React Native + Expo + TypeScript + React Navigation en vez de React+Tailwind para todos los hitos de capa frontend-core/frontend-module — sin Tailwind (no aplica igual en RN), sin vercel.json. Por defecto y ante la duda usa "web".

Devuelve ÚNICAMENTE un objeto JSON con este formato exacto:
{
  "database": "mongodb" | "postgresql",
  "platform": "web" | "mobile-native",
  "architecture": "monolith" | "microservices",
  "milestones": [
    { "id": 1, "layer": "data", "name": "Esquema de datos — Facturación", "targetWorkspace": "apps/api", "description": "Modelos Invoice, InvoiceLine, Customer con relaciones...", "filePath": "src/models/billing.ts", "dependsOn": [] },
    { "id": 2, "layer": "backend-core", "name": "Configuración base del servidor", "targetWorkspace": "apps/api", "description": "...", "filePath": "src/index.ts", "dependsOn": [1] },
    { "id": 3, "layer": "backend-module", "name": "Módulo de Facturación — API", "targetWorkspace": "apps/api", "description": "Endpoints CRUD + lógica de negocio de facturación, usando prisma.$transaction para emitir facturas y descontar stock atómicamente...", "filePath": "src/routes/billing.ts", "dependsOn": [1, 2] }
  ]
}
Ejemplo de un hito en arquitectura microservicios: { "id": 5, "layer": "backend-core", "name": "Inventory Service — núcleo", "targetWorkspace": "services/inventory", "serviceName": "inventory", "description": "Servidor Express independiente para el dominio de inventario, su propio package.json y .env.example con su propio puerto/DATABASE_URL", "filePath": "src/index.ts", "dependsOn": [4] }`;

const CODE_AGENT_STATIC = `Eres el Ingeniero de Software Senior de Maris AI, especializado en sistemas empresariales complejos.

REGLAS DE GENERACIÓN:
- Genera EXCLUSIVAMENTE el código fuente del archivo solicitado. Sin explicaciones, sin markdown, sin backticks.
- Código TypeScript real, completo y funcional. CERO TODOs, CERO stubs, CERO placeholders tipo "// implementar después".
- Si el hito menciona operaciones multi-tabla o transaccionales, usa transacciones reales (prisma.$transaction o sesiones de Mongoose según corresponda) — esto es CRÍTICO en sistemas empresariales: una operación parcialmente aplicada corrompe los datos.
- Usa exactamente los nombres de campos, modelos y rutas que aparecen en el CONTEXTO DE HITOS ANTERIORES que se te proporciona — la coherencia entre archivos es la diferencia entre un sistema que funciona y uno que no.
- Validación con Zod en cada endpoint que reciba datos.
- Todos los textos de UI y mensajes de error en español (es-ES).
- Sigue el QUALITY BAR adicional si se proporciona en el mensaje de usuario (reglas específicas de seguridad, paginación, auditoría, etc.).`;

interface Milestone {
  id: number;
  layer: string;
  name: string;
  // Antes era un enum fijo de 4 valores (solo monolito). Ahora string libre
  // con convención: "apps/web" (frontend), "apps/api" (backend monolito),
  // "services/<nombre>" (un microservicio independiente, con su propia base
  // de datos y API — solo cuando plan.architecture === "microservices"),
  // "packages/shared" (código compartido entre servicios, ej. tipos comunes).
  targetWorkspace: string;
  /** Si pertenece a un microservicio, su nombre corto (ej. "billing", "inventory").
   *  Indiferente/undefined en arquitectura monolito. */
  serviceName?: string;
  description: string;
  filePath: string;
  dependsOn: number[];
}

interface GeneratedMilestone extends Milestone {
  code: string;
}

export interface CoreOrchestratorOptions {
  /** Prompt de calidad adicional (las reglas de BACKEND_SYSTEM_PROMPT / BACKEND_SYSTEM_PROMPT_POSTGRES
   *  de apps.ts) para que los hitos de backend usen el mismo quality bar que el pipeline estándar. */
  backendQualityPrompt?: string;
  /** Modelo a usar — por defecto el más capaz disponible para proyectos complejos. */
  model?: string;
  /**
   * Máximo de hitos a generar en paralelo dentro de la misma capa (las
   * capas en sí son secuenciales, por las dependencias reales entre ellas
   * — ej. no se puede generar el frontend antes de que termine el backend
   * que consume). Subido de 4 a 8 (por defecto) a petición explícita del
   * usuario tras un incidente real con un cliente: con 22 hitos repartidos
   * en 7 capas (~3 por capa de media), muchas capas ya cabían en un solo
   * lote con concurrencia 4, pero las capas con más hitos (ej. todos los
   * módulos de backend de un dominio complejo) se beneficiaban de más
   * paralelismo real. El límite global de jobs simultáneos en toda la
   * plataforma (JOB_CONCURRENCY, hasta 25) es independiente de este valor
   * — esta concurrencia es DENTRO de un único job, así que subirla no
   * compite contra ese límite ni dispara más jobs en paralelo de los que
   * ya había, solo acelera el trabajo interno de uno que ya estaba activo.
   */
  concurrencyPerLayer?: number;
}

const LAYER_ORDER = ["data", "backend-core", "backend-module", "integration", "frontend-core", "frontend-module", "docs"];

export class CoreOrchestrator {
  private projectRoot: string;
  private generatedByMilestoneId: Map<number, GeneratedMilestone> = new Map();
  private options: CoreOrchestratorOptions;

  constructor(projectRoot: string, options: CoreOrchestratorOptions = {}) {
    this.projectRoot = projectRoot;
    this.options = {
      model: options.model ?? "claude-sonnet-4-6",
      concurrencyPerLayer: options.concurrencyPerLayer ?? 8,
      backendQualityPrompt: options.backendQualityPrompt ?? "",
    };
  }

  private cleanJsonResponse(text: string): string {
    // ENCONTRADO en producción (job 6a41707651a370bb964b513d y varios más,
    // mismo error repetido 5 veces consecutivas hasta agotar reintentos):
    // la regex original solo reconocía un bloque ```json ... ``` CERRADO.
    // Cuando la respuesta del planificador se trunca por max_tokens antes
    // de llegar al ``` de cierre (proyectos muy complejos, como
    // "FootballValue" con scraping+ML+múltiples módulos de apuestas), la
    // regex no encontraba coincidencia y el código caía a `text.trim()`,
    // devolviendo el texto CON el prefijo ```json todavía pegado —
    // JSON.parse fallaba con "Unexpected token '`'" de forma determinista
    // en cada uno de los 5 reintentos automáticos, porque la causa (el
    // texto truncado) era la misma cada vez. Ahora se quita el prefijo
    // ```json (o ```) exista o no el cierre, y se quita un ``` de cierre
    // solo si está presente.
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "");
    cleaned = cleaned.replace(/\s*```\s*$/, "");
    return cleaned.trim();
  }

  /**
   * FASE 1: PLANIFICACIÓN — divide el proyecto en hitos reales, en número
   * dinámico según la complejidad, agrupados por capas con dependencias.
   */
  async planMonorepoProject(userPrompt: string): Promise<{ database: "mongodb" | "postgresql"; platform: "web" | "mobile-native"; architecture: "monolith" | "microservices"; milestones: Milestone[] }> {
    // ENCONTRADO en producción (cliente real atascado, error confirmado en
    // el log exacto de Railway con stack trace completo): "Streaming is
    // required for operations that may take longer than 10 minutes" — un
    // rechazo duro del SDK de Anthropic en TypeScript (no del backend) para
    // llamadas NO-streaming cuando max_tokens es alto, porque ese tipo de
    // llamada puede tardar más de los 10 minutos que soporta una conexión
    // HTTP normal sin streaming. Subir max_tokens (necesario para evitar el
    // truncamiento del JSON, corregido en un fix anterior) hizo este error
    // más probable, no menos. FIX: .stream({...}).finalMessage() — devuelve
    // exactamente el mismo objeto Message completo que .create(), con la
    // única diferencia de que usa Server-Sent Events por debajo (mantiene
    // la conexión viva con eventos en vez de esperar en silencio), evitando
    // el límite de 10 minutos sin cambiar nada del resto de esta función.
    const response = await anthropic.messages.stream({
      model: this.options.model!,
      // ENCONTRADO en producción: 4000 tokens (luego subido a 8000) seguían
      // resultando insuficientes para planificar proyectos verdaderamente
      // "ultra complejos" (score >= 10 — ej. un tipster deportivo con
      // scraping + ML + múltiples módulos de apuestas + frontend, score 14
      // confirmado en logs reales) — la respuesta se truncaba a mitad del
      // JSON antes de cerrar el bloque ```json, causando el bug de parseo
      // ya corregido en cleanJsonResponse (que ahora además maneja el caso
      // de truncamiento aunque vuelva a ocurrir). A petición explícita del
      // usuario tras un incidente real con un cliente, se sube a un valor
      // con mucho más margen — confirmado contra la documentación oficial
      // de Anthropic que claude-sonnet-4-6 soporta hasta 64.000 tokens de
      // salida en la API síncrona; 24.000 da margen real de sobra para
      // listar decenas de hitos con sus dependencias sin acercarse al
      // límite absoluto del modelo (evitando coste/latencia innecesarios
      // de pedir el máximo posible cuando no hace falta).
      max_tokens: 24000,
      system: [{ type: "text", text: PLANNER_SYSTEM_STATIC, cache_control: { type: "ephemeral" } }] as any,
      messages: [{ role: "user", content: userPrompt }],
    }).finalMessage();

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const cleanedJson = this.cleanJsonResponse(rawText);

    try {
      const result = JSON.parse(cleanedJson);
      const milestones: Milestone[] = (result.milestones || []).map((m: any) => ({
        ...m,
        targetWorkspace: typeof m.targetWorkspace === "string" ? m.targetWorkspace : "apps/api",
        dependsOn: Array.isArray(m.dependsOn) ? m.dependsOn : [],
      }));
      return {
        database: result.database === "postgresql" ? "postgresql" : "mongodb",
        platform: result.platform === "mobile-native" ? "mobile-native" : "web",
        architecture: result.architecture === "microservices" ? "microservices" : "monolith",
        milestones,
      };
    } catch (error) {
      console.error("❌ Error parseando JSON de la planificación de hitos:", error);
      throw new Error("No se pudo generar el plan de hitos — respuesta del planificador inválida.");
    }
  }

  /** Construye el bloque de contexto con el código real de los hitos en los que depende uno nuevo. */
  private buildDependencyContext(milestone: Milestone): string {
    if (!milestone.dependsOn.length) return "Este es uno de los primeros hitos del proyecto — no hay contexto previo relevante.";
    const blocks = milestone.dependsOn
      .map((id) => this.generatedByMilestoneId.get(id))
      .filter((m): m is GeneratedMilestone => Boolean(m))
      .map((m) => `// === ARCHIVO YA GENERADO: ${m.filePath} (hito "${m.name}") ===\n${m.code.trim()}`);
    if (!blocks.length) return "Hitos de dependencia aún no disponibles — usa nombres y convenciones razonables.";
    return `CONTEXTO DE HITOS ANTERIORES (usa los mismos nombres de campos, modelos y rutas que aquí aparecen):\n\n${blocks.join("\n\n")}`;
  }

  private async generateMilestone(milestone: Milestone, database: "mongodb" | "postgresql", platform: "web" | "mobile-native" = "web"): Promise<GeneratedMilestone> {
    const MAX_ATTEMPTS = 3;
    let lastError: unknown;

    const dependencyContext = this.buildDependencyContext(milestone);
    const qualityBlock = this.options.backendQualityPrompt && milestone.targetWorkspace !== "apps/web"
      ? `\n\nQUALITY BAR OBLIGATORIO (mismas reglas que el resto de la plataforma):\n${this.options.backendQualityPrompt.slice(0, 6000)}`
      : "";
    const platformBlock = platform === "mobile-native" && milestone.targetWorkspace === "apps/web"
      ? `\n\nIMPORTANTE: este proyecto es una APP MÓVIL NATIVA, no web. Para este hito (capa ${milestone.layer}) usa React Native + Expo + TypeScript + React Navigation. NO uses Tailwind CSS, NO uses elementos HTML (div/span/button) — usa View/Text/Pressable de react-native con StyleSheet.create. NO generes vercel.json.`
      : "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // Mismo motivo que en planMonorepoProject (ver el comentario
        // detallado de arriba): .stream().finalMessage() en vez de
        // .create() evita el rechazo "Streaming is required..." del SDK
        // para llamadas largas, sin cambiar el objeto Message devuelto.
        const response = await anthropic.messages.stream({
          model: this.options.model!,
          max_tokens: 8192,
          system: [
            { type: "text", text: CODE_AGENT_STATIC, cache_control: { type: "ephemeral" } },
            { type: "text", text: `Base de datos del proyecto: ${database}.${qualityBlock}${platformBlock}` },
          ] as any,
          messages: [{
            role: "user",
            content: `Genera el archivo ${milestone.filePath} para el workspace ${milestone.targetWorkspace}.\n\nObjetivo del hito: ${milestone.description}\n\n${dependencyContext}\n\nDevuelve SOLO el código del archivo, sin explicaciones ni markdown.`,
          }],
        }).finalMessage();
        const code = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
        if (code) return { ...milestone, code };
        throw new Error("Respuesta vacía del modelo");
      } catch (error) {
        lastError = error;
        console.error(`⚠️ Hito ${milestone.id} (${milestone.name}) — intento ${attempt}/${MAX_ATTEMPTS}:`, error);
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    throw new Error(`Fallo crítico tras ${MAX_ATTEMPTS} intentos en hito ${milestone.id} (${milestone.name}): ${lastError}`);
  }

  /**
   * FASE 2: CONSTRUCCIÓN POR CAPAS — cada capa se genera en paralelo
   * internamente (con límite de concurrencia), pero las capas se ejecutan
   * SECUENCIALMENTE para que cada una pueda usar el contexto real de la
   * anterior. Esto es lo que evita la incoherencia entre archivos que tenía
   * la versión anterior (paralelismo total sin dependencias).
   */
  async buildProjectIncremental(userPrompt: string, wsNotificationCallback: Function) {
    const { database, platform, architecture, milestones } = await this.planMonorepoProject(userPrompt);

    const serviceNames = Array.from(new Set(milestones.map((m) => m.serviceName).filter(Boolean))) as string[];
    const archLabel = architecture === "microservices"
      ? `microservicios (${serviceNames.length || "?"} servicio(s): ${serviceNames.join(", ") || "sin nombre"})`
      : "monolito";
    wsNotificationCallback({
      status: `🚀 Plan de ${milestones.length} hito(s) aprobado (base de datos: ${database}, plataforma: ${platform === "mobile-native" ? "app nativa (Expo/React Native)" : "web"}, arquitectura: ${archLabel}). Iniciando construcción por capas...`,
      progress: 8,
    });

    const layers = LAYER_ORDER
      .map((layer) => milestones.filter((m) => m.layer === layer))
      .filter((group) => group.length > 0);
    // Cualquier hito con una capa no reconocida se añade al final para no perderlo.
    const knownIds = new Set(layers.flat().map((m) => m.id));
    const orphan = milestones.filter((m) => !knownIds.has(m.id));
    if (orphan.length) layers.push(orphan);

    let completed = 0;
    const total = milestones.length || 1;

    for (const layerMilestones of layers) {
      const concurrency = this.options.concurrencyPerLayer!;
      for (let i = 0; i < layerMilestones.length; i += concurrency) {
        const batch = layerMilestones.slice(i, i + concurrency);
        const results = await Promise.all(batch.map((m) => this.generateMilestone(m, database, platform)));
        for (const generated of results) {
          this.generatedByMilestoneId.set(generated.id, generated);
          await this.writeCodeToWorkspace(generated.targetWorkspace, generated.filePath, generated.code);
          completed++;
          wsNotificationCallback({
            status: `🔨 ${generated.name} integrado en ${generated.targetWorkspace}${generated.serviceName ? ` (servicio: ${generated.serviceName})` : ""}.`,
            progress: 8 + Math.round((completed / total) * 90),
            step: generated.id,
            previewAvailable: true,
          });
        }
      }
    }

    wsNotificationCallback({ status: "🚀 ¡Proyecto completo generado e integrado!", progress: 100, step: total });

    const allGenerated = Array.from(this.generatedByMilestoneId.values());
    const toBundle = (items: GeneratedMilestone[]) => items
      .sort((a, b) => a.id - b.id)
      .map((item) => `// === FILE: ${item.filePath} ===\n${item.code.trim()}\n`)
      .join("\n");

    // En microservicios: un bundle de código SEPARADO por cada servicio (no
    // todo mezclado en un único backendCode) — refleja la realidad de que
    // cada servicio se despliega y mantiene de forma independiente. En
    // monolito: comportamiento idéntico al original (un único backendCode).
    const serviceBundles: Record<string, string> = {};
    if (architecture === "microservices") {
      for (const svc of serviceNames) {
        serviceBundles[svc] = toBundle(allGenerated.filter((item) => item.serviceName === svc));
      }
    }
    // ENCONTRADO: el hito de docker-compose.yml (targetWorkspace ".", sin
    // serviceName propio porque describe TODOS los servicios juntos) caía
    // en este mismo filtro "todo lo que no es apps/web" junto con el resto
    // del backend — terminaba mezclado dentro de backendCode con el mismo
    // formato "// === FILE: ..." que cualquier archivo backend normal, sin
    // ninguna distinción que permitiera presentárselo al usuario como el
    // archivo que de verdad distingue "carpetas de código separadas" de
    // "microservicios reales que se levantan con un solo comando" (el propio
    // prompt de arriba lo describe así, pero el código nunca lo trataba de
    // forma especial). Se extraen aquí explícitamente los archivos de
    // infraestructura a nivel raíz del proyecto (targetWorkspace ".") en su
    // propio campo, separados del resto del backend.
    const rootInfraFiles = allGenerated.filter((item) => item.targetWorkspace === ".");
    const rootInfraBundle = rootInfraFiles.length > 0 ? toBundle(rootInfraFiles) : "";
    const hasDockerCompose = rootInfraFiles.some((item) => item.filePath.toLowerCase().includes("docker-compose"));

    const nonWebBackend = architecture === "microservices"
      ? toBundle(allGenerated.filter((item) => item.targetWorkspace !== 'apps/web' && item.targetWorkspace !== '.' && !item.serviceName))
      : toBundle(allGenerated.filter((item) => item.targetWorkspace !== 'apps/web' && item.targetWorkspace !== '.'));

    return {
      database,
      platform,
      architecture,
      frontendCode: toBundle(allGenerated.filter((item) => item.targetWorkspace === 'apps/web')),
      backendCode: nonWebBackend,
      serviceBundles, // {} en monolito; { "billing": "...", "inventory": "..." } en microservicios
      rootInfraBundle, // "" si no hay archivos a nivel raíz; si no, docker-compose.yml + README de topología, listos para presentar como archivos propios del proyecto (no enterrados dentro de backendCode)
      hasDockerCompose,
      milestones: allGenerated,
    };
  }

  private async writeCodeToWorkspace(workspace: string, filePath: string, code: string) {
    const absolutePath = path.join(this.projectRoot, workspace, filePath);
    await fs.ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, code, 'utf-8');
    console.log(`💾 Guardado con éxito en: ${absolutePath}`);
  }
}
