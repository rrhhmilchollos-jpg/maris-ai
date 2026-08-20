import fs from 'fs-extra';
import path from 'path';
import { anthropic as zocoia } from "@workspace/integrations-anthropic-ai";
const isUltraComplex = true;
const projectTier = "ultra";
// ─────────────────────────────────────────────────────────────────────────────
// CoreOrchestrator v2 — "Task Splitting" real para proyectos ultra-complejos
// (ERPs, ecosistemas multi-módulo, sistemas de nivel empresarial).
//
// Diferencias clave frente a v1 (ver historial de git para la versión anterior):
// - Número de hitos DINÁMICO según la complejidad real del proyecto, no fijo en 4.
//   Un ERP necesita modelar cada módulo de negocio por separado (facturación,
//   inventario, clientes, reporting...), no comprimirlo en un solo archivo.
// - zoco-plus en planificación y generación de código, no Haiku — la
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
- TRANSACCIONES ATÓMICAS — REGLA CRÍTICA, EVALÚALA TÚ MISMO EN CADA ENDPOINT, no esperes a que la descripción del hito use la palabra "transacción": cualquier operación que (a) modifique un SALDO/BALANCE/CRÉDITO de dinero real, (b) descuente o reserve INVENTARIO/STOCK compartido entre usuarios, (c) escriba en 2+ tablas/colecciones relacionadas donde una mitad sin la otra deja datos inconsistentes (ej. crear un pago Y actualizar el saldo del usuario; crear una apuesta Y descontar el saldo Y reservar la cuota), DEBE envolverse en una transacción real (\`prisma.$transaction([...])\` o una sesión de Mongoose con \`startTransaction()\`/\`commitTransaction()\`/\`abortTransaction()\`) — NUNCA dos escrituras sueltas seguidas sin esa garantía, aunque la descripción del hito no use la palabra "transaccional" explícitamente. ENCONTRADO en producción: depender de que el planificador mencionara la palabra correcta era frágil — un hito de "Apuestas y boleto" o "Depósitos y retiros" implica dinero real igual que uno que dijera literalmente "operación transaccional", y debe tratarse con el mismo rigor sin que nadie lo tenga que pedir con esas palabras exactas.
- Usa exactamente los nombres de campos, modelos y rutas que aparecen en el CONTEXTO DE HITOS ANTERIORES que se te proporciona — la coherencia entre archivos es la diferencia entre un sistema que funciona y uno que no.
- Validación con Zod en cada endpoint que reciba datos.
- Todos los textos de UI y mensajes de error en español (es-ES).
- Sigue el QUALITY BAR adicional si se proporciona en el mensaje de usuario (reglas específicas de seguridad, paginación, auditoría, etc.).

REGLAS CRÍTICAS DE LA PLATAFORMA (frontend con wouter) — incumplirlas produce un build que compila pero se ve roto (pantalla en blanco, 404 persistente, navegación que no funciona) sin que ningún validador de sintaxis lo detecte. ENCONTRADO en producción: estas reglas faltaban en este prompt concreto, distinto del usado en generación de una sola pasada, y eso causó exactamente este tipo de fallo en proyectos reales generados por hitos.

WOUTER v3 — \`<Link>\` ITSELF renders as the anchor tag. NEVER nest \`<a>\` (or \`<button>\`) inside \`<Link>\` — produces invalid \`<a><a>…</a></a>\` markup that crashes at runtime. Pass \`className\`/\`onClick\`/\`aria-label\` DIRECTLY to \`<Link>\`:
- WRONG: \`<Link href="/x"><a className="btn">Ir</a></Link>\`
- RIGHT: \`<Link href="/x" className="btn">Ir</Link>\`
The same applies to \`<Route>\` — render children directly, never wrap in \`<a>\`.
PROGRAMMATIC NAVIGATION — wouter has NO \`useNavigate\` or \`useHistory\` (those are react-router-dom). Importing either from "wouter" crashes the ENTIRE app at load with "module does not provide an export named...", before any component renders. Use \`const [, setLocation] = useLocation();\` then \`setLocation("/path")\`.
IMPORTS DE WOUTER — wouter NO tiene exportación por defecto. NUNCA escribas \`import Link from "wouter"\`, \`import Router from "wouter"\` ni ningún otro import por defecto. Importa TODOS los símbolos usados con llaves en una sola línea, por ejemplo: \`import { Link, Route, Switch, useLocation } from "wouter";\`. Si renderizas \`<Link>\`, \`<Route>\` o \`<Switch>\`, esos símbolos deben estar importados explícitamente desde "wouter" en ese archivo.
FRONTERA FRONTEND — los archivos de \`apps/web\` no pueden importar Prisma, Mongoose, \`fs\`, \`path\`, módulos de servidor ni secretos. La UI usa estado local o llamadas HTTP tipadas a \`apps/api\`.
ROUTER ORDER — REGLA CRÍTICA (produce página en blanco/404 si se incumple): en el \`<Switch>\`, el catch-all que renderiza NotFound/404 DEBE ser SIEMPRE el ÚLTIMO elemento. Si lo colocas antes de las rutas reales, wouter lo evalúa primero y TODAS las rutas muestran 404:
  \`<Switch>
    <Route path="/" component={Home} />
    <Route path="/seccion-1" component={Seccion1} />
    {/* ÚLTIMO SIEMPRE — nunca antes de las rutas reales */}
    <Route component={NotFound} />
  </Switch>\`
EXPORTS & IMPORTS — cada \`import { X }\` debe coincidir con un \`export { X }\`/\`export function X\`/\`export const X\` real en el archivo destino. Cada \`import X from\` debe coincidir con un \`export default\`. Mezclar ambos da \`undefined\` y React no renderiza nada.`;

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

// ─────────────────────────────────────────────────────────────────────────────
// MODO EDICIÓN POR HITOS — extensión para proyectos YA EXISTENTES (importados
// de otra IA, o cualquier proyecto previo de Maris AI), con el mismo rigor que
// buildProjectIncremental pero sin partir de cero: cada hito puede ser
// "modify_file" (toca un archivo real ya existente, recibiendo su contenido
// COMPLETO actual como contexto obligatorio para no perder nada) o
// "create_file" (archivo nuevo necesario para el cambio pedido, igual que un
// hito normal de construcción). A petición explícita del usuario tras varios
// incidentes reales con proyectos importados (ej. "club de swingers en
// Valencia") que se quedaban atascados en el límite de tokens del pipeline de
// edición de una sola pasada (singleEditPass) — la causa raíz era que ESE
// pipeline nunca trocea el trabajo, mientras que la construcción nueva sí lo
// hace desde el principio vía CoreOrchestrator. Esta extensión da a las
// ediciones el mismo troceo real por hitos pequeños que ya tiene la
// construcción nueva, eliminando el cuello de botella de fondo.
// ─────────────────────────────────────────────────────────────────────────────

interface EditMilestone {
  id: number;
  action: "modify_file" | "create_file";
  /** Ruta EXACTA tal como aparece en el bundle actual (// === FILE: <path> ===). */
  filePath: string;
  /** Qué cambiar en este archivo concreto — instrucción específica, no el prompt genérico del usuario. */
  description: string;
  dependsOn: number[];
}

interface GeneratedEditMilestone extends EditMilestone {
  code: string;
}

const EDIT_PLANNER_SYSTEM_STATIC = `Eres el Arquitecto de Sistemas Senior de Maris AI. Recibes una petición de MODIFICACIÓN sobre un proyecto que YA EXISTE (no es un proyecto nuevo) y la divides en hitos de edición reales y manejables.

PRINCIPIO RECTOR: NUNCA pierdas código existente. Cada hito debe describir el cambio CONCRETO que hay que hacer en UN archivo, no reescribir el proyecto entero. Si un archivo no necesita tocarse para cumplir la petición del usuario, NO generes un hito para él — solo incluye los archivos que de verdad hay que crear o modificar.

Recibirás la lista de archivos que YA EXISTEN en el proyecto (solo sus rutas, sin contenido — el contenido se te dará después, archivo por archivo, cuando se genere ese hito concreto). Con esa lista y la petición del usuario, decide:
- "modify_file": el cambio afecta a un archivo de la lista que YA EXISTE. Usa la ruta EXACTA tal como aparece en la lista.
- "create_file": el cambio necesita un archivo que NO está en la lista (ej. un componente nuevo, una ruta backend nueva).

NÚMERO DE HITOS: tantos como archivos distintos haya que tocar o crear — ni más ni menos. Una corrección de un bug visual puede ser 1-3 hitos; una funcionalidad nueva mediana puede ser 4-10. No fragmentes en exceso (no dividas un mismo archivo en varios hitos) ni comprimas en exceso (no metas cambios de archivos no relacionados en un mismo hito).

DIAGNÓSTICO CRÍTICO — BUG 404 / PANTALLA EN BLANCO (el caso más frecuente en reparaciones):
Cuando el problema es "la app muestra 404 en la ruta /" o "pantalla en blanco", la causa raíz es SIEMPRE una de estas tres, en este orden de probabilidad:
1. CATCH-ALL 404 ANTES DE LA RUTA RAÍZ: el router tiene una ruta catch-all o 404 (<Route path="*"> o <Route component={NotFound}>) colocada ANTES de <Route path="/"> — el router la evalúa primero y nunca llega a la ruta real. FIX: mover el catch-all al ÚLTIMO lugar de la lista de rutas.
2. COMPONENTE RAÍZ VACÍO O CON ERROR: App.tsx o el componente raíz de la ruta "/" está vacío, retorna null, o tiene un error de compilación que impide que React lo monte. FIX: reconstruir el componente con contenido real visible.
3. IMPORT ROTO: el componente que debería renderizarse en "/" importa algo que no existe (ruta incorrecta, nombre de archivo con distinta capitalización). FIX: corregir el import.
PARA BUG 404: SIEMPRE incluye src/App.tsx (o el archivo de router que exista) como primer hito modify_file con la descripción técnica exacta del fix.

Cada hito debe especificar "dependsOn": [ids de otros hitos de ESTA MISMA edición cuyo resultado necesita ver como contexto antes de generarse] — por ejemplo, si un hito de frontend depende de un endpoint nuevo creado en otro hito de backend en esta misma edición.

Devuelve ÚNICAMENTE un objeto JSON con este formato exacto:
{
  "milestones": [
    { "id": 1, "action": "modify_file", "filePath": "src/App.tsx", "description": "La ruta raíz '/' muestra 404 porque el catch-all <Route path='*' component={NotFound}/> está colocado ANTES de las rutas reales. Mover el catch-all al final de la lista de rutas. Verificar que <Route path='/' component={Dashboard}/> (o el componente principal) esté presente y sea el primero.", "dependsOn": [] },
    { "id": 2, "action": "modify_file", "filePath": "src/pages/HomePage.tsx", "description": "El componente de la ruta raíz estaba vacío — rellenarlo con el contenido real del dashboard de la clínica dental: métricas, pacientes del día, citas próximas.", "dependsOn": [1] }
  ]
}`;

const EDIT_CODE_AGENT_STATIC = `Eres el Ingeniero de Software Senior de Maris AI, especializado en EDITAR código existente sin perder nada que no se haya pedido cambiar.

REGLAS DE GENERACIÓN:
- Genera EXCLUSIVAMENTE el código fuente COMPLETO y final del archivo solicitado (el archivo entero, ya con el cambio aplicado) — sin explicaciones, sin markdown, sin backticks.
- Si el hito es "modify_file", se te da el CONTENIDO ACTUAL completo del archivo. Tu trabajo es devolver ese mismo archivo con el cambio pedido aplicado, conservando TODO lo que no esté relacionado con el cambio — imports, componentes, lógica, comentarios. NUNCA borres funcionalidad existente que no se pidió tocar.
- Si el hito es "create_file", el archivo es nuevo: escríbelo completo y coherente con las convenciones del resto del proyecto (mismo estilo de imports, mismas librerías ya usadas).
- Código TypeScript/JavaScript real, completo y funcional. CERO TODOs, CERO stubs, CERO placeholders tipo "// implementar después".
- TRANSACCIONES ATÓMICAS — REGLA CRÍTICA, EVALÚALA TÚ MISMO EN CADA ENDPOINT que toques o crees, no esperes a que la descripción del hito use la palabra "transacción": cualquier operación que (a) modifique un SALDO/BALANCE/CRÉDITO de dinero real, (b) descuente o reserve INVENTARIO/STOCK compartido entre usuarios, (c) escriba en 2+ tablas/colecciones relacionadas donde una mitad sin la otra deja datos inconsistentes, DEBE envolverse en una transacción real (\`prisma.$transaction([...])\` o una sesión de Mongoose con \`startTransaction()\`/\`commitTransaction()\`/\`abortTransaction()\`) — NUNCA dos escrituras sueltas seguidas sin esa garantía.
- Usa exactamente los nombres de componentes, funciones y rutas que aparecen en el CONTEXTO DE HITOS ANTERIORES o en el ARCHIVO ACTUAL que se te proporciona — la coherencia con el resto del proyecto es crítica.

REGLAS CRÍTICAS DE LA PLATAFORMA — incumplirlas produce un build roto que será descartado y deja al cliente sin el arreglo (mismas reglas que usa el generador de proyectos nuevos, OBLIGATORIAS también aquí):

WOUTER v3 (router de la app) — \`<Link>\` ITSELF renders as the anchor tag. NUNCA anidar \`<a>\` (ni \`<button>\`) dentro de \`<Link>\` — produce \`<a><a>…</a></a>\` inválido que rompe en runtime. Pasa \`className\`/\`onClick\`/\`aria-label\` DIRECTAMENTE a \`<Link>\`:
- MAL: \`<Link href="/x"><a className="btn">Ir</a></Link>\`
- BIEN: \`<Link href="/x" className="btn">Ir</Link>\`
Lo mismo aplica a \`<Route>\` — renderiza los hijos directamente, sin envolver en \`<a>\`.
NAVEGACIÓN PROGRAMÁTICA — wouter NO TIENE \`useNavigate\` ni \`useHistory\` (son de react-router-dom). Importarlos desde "wouter" rompe TODA la app al cargar con "module does not provide an export named...", antes de que cualquier componente renderice. Usa: \`const [, setLocation] = useLocation();\` y luego \`setLocation("/path")\`.
PARÁMETROS DE RUTA — wouter NO TIENE \`useParams\` (es de react-router-dom). Usa: \`const [match, params] = useRoute("/path/:id");\` y luego \`params.id\`.
ORDEN DEL ROUTER — REGLA CRÍTICA (produce página en blanco/404 si se incumple): en el \`<Switch>\`, el catch-all que renderiza NotFound/404 DEBE ser SIEMPRE el ÚLTIMO elemento. Si lo colocas antes de las rutas reales, wouter lo evalúa primero y TODAS las rutas muestran 404:
  \`<Switch>
    <Route path="/" component={Home} />
    <Route path="/seccion-1" component={Seccion1} />
    {/* ÚLTIMO SIEMPRE — nunca antes de las rutas reales */}
    <Route component={NotFound} />
  </Switch>\`
EXPORTS & IMPORTS — cada \`import { X }\` debe coincidir con un \`export { X }\`/\`export function X\`/\`export const X\` real en el archivo destino. Cada \`import X from\` debe coincidir con un \`export default\`. Mezclar ambos da \`undefined\` y React no renderiza nada.`;

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
  /**
   * Si se especifica, el planificador NO puede generar más hitos que este
   * número. Usado para degradar proyectos ultra-complejos a un subconjunto
   * manejable cuando el usuario no ha pagado nunca (hasEverPaid=false) —
   * estrategia de conversión: genera el núcleo funcional de la app con un
   * coste de tokens mucho menor, y la interfaz le ofrece "expandir a la
   * arquitectura completa" a cambio de activar su primer plan de pago.
   * undefined = sin límite (comportamiento por defecto para usuarios de pago).
   */
  maxMilestonesOverride?: number;
  /**
   * Callback llamado cuando un hito agota todos sus intentos y cae al placeholder.
   * Se usa para enviar alertas al admin (WhatsApp + email) con los datos del fallo.
   * Si no se pasa, el fallo se registra solo en consola/logs.
   */
  onMilestoneStuck?: (opts: {
    milestoneName: string;
    layer: string;
    attempts: number;
    lastError: string;
  }) => void | Promise<void>;
  /**
   * Función de validación esbuild para comprobar el bundle de frontend al
   * terminar cada capa frontend. Si no se pasa, la validación por capa se
   * omite silenciosamente (comportamiento backward-compatible). Se pasa
   * desde apps.ts para reutilizar el mismo validador que el resto del pipeline.
   * 'issues' trae el archivo como campo estructurado (issue.file, formato
   * "appforge-vfs:src/...", tal cual lo reporta esbuild) en vez de un string
   * libre — evita tener que extraerlo con una regex frágil sobre un mensaje
   * con formato no garantizado.
   */
  validateFrontendBundle?: (bundle: string) => Promise<{ ok: boolean; issues: Array<{ file: string; message: string }> }>;
}

const LAYER_ORDER = ["data", "backend-core", "backend-module", "integration", "frontend-core", "frontend-module", "docs"];

export class CoreOrchestrator {
  private projectRoot: string;
  private generatedByMilestoneId: Map<number, GeneratedMilestone> = new Map();
  private activeProjectIntent = "";
  private options: CoreOrchestratorOptions;

  constructor(projectRoot: string, options: CoreOrchestratorOptions = {}) {
    this.projectRoot = projectRoot;
    this.options = {
      model: options.model ?? "zoco-plus",
      concurrencyPerLayer: options.concurrencyPerLayer ?? 8,
      backendQualityPrompt: options.backendQualityPrompt ?? "",
      maxMilestonesOverride: options.maxMilestonesOverride,
      onMilestoneStuck: options.onMilestoneStuck,
      validateFrontendBundle: options.validateFrontendBundle,
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
   * Plan mínimo y determinista para los modos compactos. El modelo puede
   * devolver una respuesta vacía, texto libre o JSON truncado bajo carga; en
   * ese caso una app nueva no debe fallar antes de generar su primer archivo.
   */
  private buildCompactFallbackPlan(userPrompt: string): { database: "mongodb"; platform: "web" | "mobile-native"; architecture: "monolith"; milestones: Milestone[] } {
    const nativeAppRequested = /\b(app nativa|ios|android|react native|app store|google play)\b/i.test(userPrompt);
    return {
      database: "mongodb",
      platform: nativeAppRequested ? "mobile-native" : "web",
      architecture: "monolith",
      milestones: [
        { id: 1, layer: "data", name: "Datos de dominio", targetWorkspace: "apps/web", description: "Crea datos de ejemplo realistas, tipos y estado inicial para el producto solicitado. No dependas de servicios externos.", filePath: "src/mockData.ts", dependsOn: [] },
        { id: 2, layer: "backend-core", name: "Núcleo del servidor", targetWorkspace: "apps/api", description: "Crea un servidor monolítico mínimo con validación y rutas esenciales para el flujo principal.", filePath: "src/index.ts", dependsOn: [] },
        { id: 3, layer: "frontend-core", name: "Aplicación principal", targetWorkspace: "apps/web", description: "Crea src/App.tsx con export default function App(), navegación y estructura visual principal. Debe ser una aplicación funcional y responsive.", filePath: "src/App.tsx", dependsOn: [1] },
        { id: 4, layer: "frontend-module", name: "Experiencia de entrada", targetWorkspace: "apps/web", description: "Crea la pantalla principal y el primer flujo de valor del encargo con datos realistas y llamadas al estado local.", filePath: "src/pages/Home.tsx", dependsOn: [1, 3] },
        { id: 5, layer: "frontend-module", name: "Panel operativo", targetWorkspace: "apps/web", description: "Crea una segunda experiencia operativa, listado o detalle coherente con el producto solicitado.", filePath: "src/pages/Dashboard.tsx", dependsOn: [1, 3, 4] },
        { id: 6, layer: "docs", name: "Documentación de arranque", targetWorkspace: "apps/api", description: "Documenta los endpoints esenciales y cómo ejecutar el monolito generado.", filePath: "README.md", dependsOn: [2, 3] },
      ],
    };
  }

  /**
   * FASE 1: PLANIFICACIÓN — divide el proyecto en hitos reales, en número
   * dinámico según la complejidad, agrupados por capas con dependencias.
   */
  async planMonorepoProject(userPrompt: string): Promise<{ database: "mongodb" | "postgresql"; platform: "web" | "mobile-native"; architecture: "monolith" | "microservices"; milestones: Milestone[] }> {// ENCONTRADO en producción (cliente real atascado, error confirmado en
    // el log exacto de Coolify con stack trace completo): "Streaming is
    // required for operations that may take longer than 10 minutes" — un
    // rechazo duro del SDK de anthropic as zocoia en TypeScript (no del backend) para
    // llamadas NO-streaming cuando max_tokens es alto, porque ese tipo de
    // llamada puede tardar más de los 10 minutos que soporta una conexión
    // HTTP normal sin streaming. Subir max_tokens (necesario para evitar el
    // truncamiento del JSON, corregido en un fix anterior) hizo este error
    // más probable, no menos. FIX: .stream({...}).finalMessage() — devuelve
    // exactamente el mismo objeto Message completo que .create(), con la
    // única diferencia de que usa Server-Sent Events por debajo (mantiene
    // la conexión viva con eventos en vez de esperar en silencio), evitando
    // el límite de 10 minutos sin cambiar nada del resto de esta función.

    // PLAN GRATUITO — FACHADA INTERACTIVA (maxMilestonesOverride activo):
    // En vez de dejar que el arquitecto diseñe un plan de 20+ hitos y luego
    // truncarlo mecánicamente (lo que genera dependencias rotas y estructura
    // incompleta), inyectamos las instrucciones directamente en el prompt
    // para que el arquitecto piense desde el principio en términos de impacto
    // visual máximo con recursos mínimos — la estrategia real que usa Emergent.sh.
    // El usuario gratuito ve una app atractiva, funcional e impactante en
    // segundos. Si quiere la arquitectura completa con backend real, BD y
    // todos los módulos, pasa a plan de pago.
    const FREE_TIER_ARCHITECT_DIRECTIVE = this.options.maxMilestonesOverride
      ? `\n\n[DIRECTIVA PLAN GRATUITO — MÁXIMO ${this.options.maxMilestonesOverride} HITOS — LEE ESTO PRIMERO]\nEste proyecto se genera para un usuario del plan gratuito. Tu objetivo es IMPACTO VISUAL INMEDIATO con el mínimo de archivos posible. Sigue estas reglas estrictamente:

ARQUITECTURA OBLIGATORIA — "Fachada Interactiva" (Mocked Full-Stack):
- SIEMPRE "monolith" (nunca microservicios en plan gratuito).
- SIEMPRE "mongodb" como base de datos (más simple de simular).
- El backend completo en UN SOLO archivo: apps/api/src/index.ts (servidor Express mínimo, <50 líneas, solo levanta el puerto y tiene 2-3 rutas GET que devuelven JSON estático). Sin modelos, sin controladores, sin servicios separados.
- El frontend en 4-5 archivos máximo: main.tsx (punto de entrada), App.tsx (router con wouter, catch-all AL FINAL), mockData.ts (datos simulados), y 1-2 páginas visuales (Home.tsx, Dashboard.tsx o la equivalente al dominio pedido).

REGLAS DE IMPACTO VISUAL (obligatorias en todos los hitos de frontend):
- mockData.ts: arrays de objetos con datos realistas del dominio (usuarios, productos, reservas, etc.) + funciones con setTimeout para simular latencia de red. CERO llamadas reales a la BD — todo el estado vive en memoria mientras el usuario navega.
- Imágenes REALES: usa SIEMPRE URLs de Unsplash con palabras clave del dominio (formato: https://images.unsplash.com/photo-XXXXXXXX?w=800&q=80). NUNCA placeholder.it, NUNCA URLs inventadas, NUNCA "imagen de ejemplo". Una fotografía real cambia completamente la percepción de calidad del usuario.
- Tailwind CSS intensivo: botones con hover, tarjetas con sombra, gradientes, iconos SVG inline o de lucide-react. La app debe parecer un producto real de startup desde el primer segundo.
- Navegación fluida: el router de App.tsx debe permitir ir de la pantalla principal al dashboard/panel interior sin recargas.

ESTRUCTURA DE HITOS RECOMENDADA (máximo ${this.options.maxMilestonesOverride}):
1. mockData.ts — datos simulados del dominio (layer: "data", targetWorkspace: "apps/web")
2. server/index.ts — backend Express mínimo con 2-3 rutas GET estáticas (layer: "backend-core", targetWorkspace: "apps/api")
3. App.tsx — router principal con wouter, layout base, catch-all AL FINAL (layer: "frontend-core", targetWorkspace: "apps/web")
4. Home.tsx — pantalla principal con hero visual, imágenes Unsplash, botones atractivos (layer: "frontend-module", targetWorkspace: "apps/web")
5. Dashboard.tsx o la página interior equivalente — panel con datos del mockData, tablas/tarjetas interactivas (layer: "frontend-module", targetWorkspace: "apps/web")
Puedes añadir 1-2 hitos más si el dominio lo requiere (ej. una página de detalle o un formulario de contacto), pero NUNCA superes el límite de ${this.options.maxMilestonesOverride} hitos totales.

PROHIBICIONES ABSOLUTAS en plan gratuito:
- NO generes hitos de modelos de BD separados (schemas Mongoose/Prisma).
- NO generes middleware, auth, servicios, controladores como archivos separados.
- NO uses URLs de imágenes inventadas o placeholder.
- NO coloques el catch-all de wouter antes de las rutas reales (produce 404 en toda la app).
[FIN DIRECTIVA PLAN GRATUITO]\n`
      : "";

    const enrichedPrompt = FREE_TIER_ARCHITECT_DIRECTIVE + userPrompt;

    // Los planes compactos (inicio rápido / máximo 8 hitos) no necesitan la
    // reserva de 24K tokens ni una espera de dos minutos propia de arquitecturas
    // distribuidas. Mantener límites adaptativos evita bloqueos innecesarios.
    const compactPlan = (this.options.maxMilestonesOverride ?? Number.POSITIVE_INFINITY) <= 8;
    const planTimeoutMs = compactPlan ? 45_000 : 120_000;
    const planMaxTokens = compactPlan ? 6_000 : 24_000;
    const planAbortController = new AbortController();
    const planTimeoutId = setTimeout(() => {
      planAbortController.abort();
      console.warn(`⏰ Timeout ${planTimeoutMs / 1000}s en planMonorepoProject — abortando planificación`);
    }, planTimeoutMs);
    let planResponse: any;
    try {planResponse = await zocoia.messages.stream({
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
      // de anthropic as zocoia que zoco-plus soporta hasta 64.000 tokens de
      // salida en la API síncrona; 24.000 da margen real de sobra para
      // listar decenas de hitos con sus dependencias sin acercarse al
      // límite absoluto del modelo (evitando coste/latencia innecesarios
      // de pedir el máximo posible cuando no hace falta).
      max_tokens: planMaxTokens,
      system: [{ type: "text", text: PLANNER_SYSTEM_STATIC, cache_control: { type: "ephemeral" } }] as any,
      messages: [{ role: "user", content: enrichedPrompt }],
    }, { signal: planAbortController.signal as any }).finalMessage();
    } catch (error) {
      if (!compactPlan) throw error;
      // Si el proveedor se congestiona, un proyecto estándar no debe quedarse
      // bloqueado. Generamos un plan monolítico determinista y dejamos que los
      // agentes de código apliquen el encargo original en cada hito.
      console.warn("⚡ Planificador compacto agotado; usando plan determinista de respaldo.");
      return this.buildCompactFallbackPlan(userPrompt);
    } finally {
      clearTimeout(planTimeoutId);
    }
    const response = planResponse;

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const cleanedJson = this.cleanJsonResponse(rawText);

    try {
      const result = JSON.parse(cleanedJson);
      let milestones: Milestone[] = (result.milestones || []).map((m: any) => ({
        ...m,
        targetWorkspace: typeof m.targetWorkspace === "string" ? m.targetWorkspace : "apps/api",
        dependsOn: Array.isArray(m.dependsOn) ? m.dependsOn : [],
      }));
      if (milestones.length === 0) {
        if (compactPlan) {
          console.warn("⚡ El planificador compacto devolvió JSON sin hitos; usando plan determinista de respaldo.");
          return this.buildCompactFallbackPlan(userPrompt);
        }
        throw new Error("La respuesta del planificador no contiene hitos.");
      }
      // DEGRADACIÓN PARA USUARIOS GRATUITOS: si maxMilestonesOverride está
      // activo (viene de apps.ts cuando hasEverPaid=false en un proyecto
      // ultra-complejo), truncar la lista de hitos al máximo permitido.
      // Se conservan los hitos de las capas más críticas primero (data →
      // backend-core → frontend-core) según LAYER_ORDER, priorizando lo
      // que da una app visible y funcional con el mínimo de tokens.
      if (this.options.maxMilestonesOverride && milestones.length > this.options.maxMilestonesOverride) {
        const layerPriority = ["data", "backend-core", "frontend-core", "backend-module", "frontend-module", "integration", "docs"];
        milestones = milestones
          .slice()
          .sort((a, b) => (layerPriority.indexOf(a.layer) - layerPriority.indexOf(b.layer)))
          .slice(0, this.options.maxMilestonesOverride);
        console.warn(`[maxMilestonesOverride] Plan de ${result.milestones.length} hitos reducido a ${milestones.length} para usuario gratuito.`);
      }
      return {
        database: result.database === "postgresql" ? "postgresql" : "mongodb",
        platform: result.platform === "mobile-native" ? "mobile-native" : "web",
        architecture: result.architecture === "microservices" ? "microservices" : "monolith",
        milestones,
      };
    } catch (error) {
      // ENCONTRADO en producción (causa raíz real ya corregida en
      // apps.ts — un prompt de EDICIÓN, con un reporte largo pegado,
      // se enrutó por error a este planificador de PROYECTOS NUEVOS,
      // que respondió con texto conversacional, 'Analizando...', en
      // vez de JSON puro): como red de seguridad adicional para
      // cualquier otro caso futuro donde el modelo antepusiera texto
      // explicativo a pesar de la instrucción de "ÚNICAMENTE JSON",
      // se intenta una segunda extracción — buscar el primer bloque
      // {...} balanceado dentro del texto completo — antes de
      // rendirse. Esto no sustituye el fix de la causa raíz, es una
      // capa extra de tolerancia para no perder el job entero si el
      // JSON real sí está presente, solo rodeado de texto.
      const extracted = this.extractFirstJsonObject(rawText);
      if (extracted) {
        try {
          const result = JSON.parse(extracted);
          let milestones: Milestone[] = (result.milestones || []).map((m: any) => ({
            ...m,
            targetWorkspace: typeof m.targetWorkspace === "string" ? m.targetWorkspace : "apps/api",
            dependsOn: Array.isArray(m.dependsOn) ? m.dependsOn : [],
          }));
          if (this.options.maxMilestonesOverride && milestones.length > this.options.maxMilestonesOverride) {
            const layerPriority = ["data", "backend-core", "frontend-core", "backend-module", "frontend-module", "integration", "docs"];
            milestones = milestones
              .slice()
              .sort((a, b) => (layerPriority.indexOf(a.layer) - layerPriority.indexOf(b.layer)))
              .slice(0, this.options.maxMilestonesOverride);
            console.warn(`[maxMilestonesOverride fallback] Plan reducido a ${milestones.length} hitos para usuario gratuito.`);
          }
          console.warn("⚠️ El planificador devolvió texto junto al JSON — se recuperó el objeto JSON embebido correctamente.");
          return {
            database: result.database === "postgresql" ? "postgresql" : "mongodb",
            platform: result.platform === "mobile-native" ? "mobile-native" : "web",
            architecture: result.architecture === "microservices" ? "microservices" : "monolith",
            milestones,
          };
        } catch {
          // El bloque extraído tampoco era JSON válido — cae al error final de abajo.
        }
      }
      if (compactPlan) {
        console.warn("⚡ El planificador compacto devolvió JSON inválido; usando plan determinista de respaldo.");
        return this.buildCompactFallbackPlan(userPrompt);
      }
      console.error("❌ Error parseando JSON de la planificación de hitos:", error);
      throw new Error("No se pudo generar el plan de hitos — respuesta del planificador inválida.");
    }
  }

  /**
   * Busca el primer objeto JSON balanceado ({...}) dentro de un texto que
   * puede contener contenido conversacional antes o después — red de
   * seguridad para cuando el modelo no sigue al pie de la letra la
   * instrucción de "devuelve ÚNICAMENTE JSON". Cuenta llaves respetando
   * strings entre comillas (para no confundir una "}" dentro de un string
   * con el cierre real del objeto).
   */
  private extractFirstJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === "\\") {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
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

  private deterministicDeliveryModule(milestone: Milestone): string | null {
    const intent = this.activeProjectIntent.toLowerCase();
    if (!/delivery|reparto|comida a domicilio|uber eats|ubereats|glovo|pedido de comida|rider/.test(intent)) return null;
    const file = milestone.filePath.replace(/^\.\//, "");
    if (/^src\/index\.(t|j)s$/i.test(file) && milestone.targetWorkspace !== "apps/web") {
      return `import { createServer } from "node:http";\nconst restaurants = [{ id: "verde", name: "Verde y Punto", category: "Saludable", eta: "25-35 min", rating: 4.7 }, { id: "fuego", name: "Fuego de Barrio", category: "Hamburguesas", eta: "30-40 min", rating: 4.6 }, { id: "nori", name: "Nori Local", category: "Asiática", eta: "20-30 min", rating: 4.8 }];\nfunction json(res:any,status:number,body:unknown){res.writeHead(status,{\"content-type\":\"application/json; charset=utf-8\",\"access-control-allow-origin\":\"*\"});res.end(JSON.stringify(body));}\nexport const server=createServer((req,res)=>{const url=new URL(req.url||\"/\",\"http://localhost\");if(req.method===\"GET\"&&url.pathname===\"/api/health\")return json(res,200,{status:\"ok\"});if(req.method===\"GET\"&&url.pathname===\"/api/restaurants\")return json(res,200,{data:restaurants,demo:true});if(req.method===\"POST\"&&url.pathname===\"/api/orders\")return json(res,201,{id:\"demo-\"+Date.now(),status:\"received\",demo:true});return json(res,404,{error:\"Ruta no encontrada\"});});\nif(process.env.NODE_ENV!==\"test\")server.listen(Number(process.env.PORT||3001));\n`;
    }
    if (/(^|\/)mockData\.(t|j)s$/i.test(file)) {
      return `export type Restaurant={id:string;name:string;category:string;rating:number;eta:string;fee:number;image:string;menu:{id:string;name:string;price:number;description:string}[]};\nexport const restaurants:Restaurant[]=[{id:\"verde\",name:\"Verde y Punto\",category:\"Saludable\",rating:4.7,eta:\"25-35 min\",fee:1.49,image:\"https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1000&q=80\",menu:[{id:\"bowl\",name:\"Bowl mediterráneo\",price:11.9,description:\"Verduras, cereal y salsa de yogur\"},{id:\"ensalada\",name:\"Ensalada crujiente\",price:9.5,description:\"Hojas frescas, aguacate y semillas\"}]},{id:\"fuego\",name:\"Fuego de Barrio\",category:\"Hamburguesas\",rating:4.6,eta:\"30-40 min\",fee:1.99,image:\"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1000&q=80\",menu:[{id:\"clasica\",name:\"Hamburguesa de la casa\",price:12.5,description:\"Carne, queso, lechuga y salsa propia\"},{id:\"patatas\",name:\"Patatas especiadas\",price:3.9,description:\"Ración para compartir\"}]},{id:\"nori\",name:\"Nori Local\",category:\"Asiática\",rating:4.8,eta:\"20-30 min\",fee:1.29,image:\"https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?auto=format&fit=crop&w=1000&q=80\",menu:[{id:\"poke\",name:\"Poke de salmón\",price:13.9,description:\"Arroz, salmón, edamame y mango\"},{id:\"gyoza\",name:\"Gyozas vegetales\",price:5.5,description:\"Seis unidades con salsa cítrica\"}]}];\nexport const deliveryDemoNotice=\"Restaurantes, precios, disponibilidad, reparto y pagos son datos de demostración. No se procesa ningún cobro.\";\n`;
    }
    if (/^src\/App\.(t|j)sx$/i.test(file)) {
      return `import { useMemo, useState } from \"react\";\nimport { deliveryDemoNotice, restaurants, type Restaurant } from \"./mockData\";\ntype CartItem={restaurant:string;name:string;price:number};\nexport default function App(){const [category,setCategory]=useState(\"Todas\");const [cart,setCart]=useState<CartItem[]>([]);const [view,setView]=useState<\"home\"|\"cart\"|\"tracking\">(\"home\");const [order,setOrder]=useState(false);const filtered=useMemo(()=>restaurants.filter((r)=>category===\"Todas\"||r.category===category),[category]);const total=cart.reduce((sum,item)=>sum+item.price,0);const add=(restaurant:Restaurant,item:Restaurant[\"menu\"][number])=>setCart((current)=>[...current,{restaurant:restaurant.name,name:item.name,price:item.price}]);const placeOrder=()=>{if(cart.length){setOrder(true);setView(\"tracking\");}};return <main className=\"min-h-screen bg-slate-50 text-slate-900\"><header className=\"sticky top-0 z-20 border-b bg-white\"><div className=\"mx-auto flex max-w-7xl items-center justify-between px-5 py-4\"><button onClick={()=>setView(\"home\")} className=\"text-xl font-black\">cerca<span className=\"text-blue-600\">.food</span></button><div className=\"flex gap-3 text-sm font-bold\"><button onClick={()=>setView(\"home\")}>Explorar</button><button onClick={()=>setView(\"cart\")}>Carrito ({cart.length})</button></div></div></header>{view===\"home\"&&<div className=\"mx-auto max-w-7xl px-5 py-8\"><section className=\"rounded-3xl bg-slate-950 p-8 text-white\"><p className=\"text-sm font-bold text-blue-600\">DELIVERY LOCAL · DEMO</p><h1 className=\"mt-2 text-4xl font-black\">Tu comida favorita, cerca de ti.</h1><div className=\"mt-6 flex gap-3 rounded-2xl bg-white p-3 text-slate-900\"><input className=\"flex-1 rounded-xl border p-3\" placeholder=\"Introduce tu zona\"/><button className=\"rounded-xl bg-blue-600 px-5 font-bold text-white\">Buscar</button></div></section><div className=\"mt-6 flex flex-wrap gap-2\">{[\"Todas\",...Array.from(new Set(restaurants.map((r)=>r.category)))].map((item)=><button key={item} onClick={()=>setCategory(item)} className=\"rounded-full border bg-white px-4 py-2 text-sm font-bold\">{item}</button>)}</div><section className=\"mt-6 grid gap-5 md:grid-cols-2\">{filtered.map((restaurant)=><article key={restaurant.id} className=\"overflow-hidden rounded-2xl bg-white shadow-sm\"><img src={restaurant.image} alt=\"\" className=\"h-40 w-full object-cover\"/><div className=\"p-5\"><div className=\"flex justify-between\"><div><p className=\"text-sm text-slate-500\">{restaurant.category} · {restaurant.eta} DEMO</p><h2 className=\"text-xl font-black\">{restaurant.name}</h2></div><b className=\"text-emerald-700\">{restaurant.rating} ★</b></div><div className=\"mt-4 grid gap-2\">{restaurant.menu.map((item)=><div key={item.id} className=\"flex items-center justify-between rounded-xl border p-3\"><div><b>{item.name}</b><p className=\"text-sm text-slate-500\">{item.description}</p></div><button onClick={()=>add(restaurant,item)} className=\"rounded-lg bg-slate-950 px-3 py-2 text-sm font-bold text-white\">{item.price.toFixed(2)} € +</button></div>)}</div></div></article>)}</section></div>}{view===\"cart\"&&<section className=\"mx-auto max-w-4xl px-5 py-10\"><h1 className=\"text-3xl font-black\">Tu pedido</h1>{cart.length===0?<p className=\"mt-4 text-slate-600\">Tu carrito está vacío. Explora restaurantes para añadir productos.</p>:<><div className=\"mt-5 grid gap-3\">{cart.map((item,index)=><div key={index} className=\"flex justify-between rounded-xl bg-white p-4 shadow-sm\"><span>{item.name}<small className=\"block text-slate-500\">{item.restaurant}</small></span><b>{item.price.toFixed(2)} €</b></div>)}</div><div className=\"mt-6 rounded-2xl bg-slate-950 p-5 text-white\"><div className=\"flex justify-between text-xl font-black\"><span>Total demo</span><span>{total.toFixed(2)} €</span></div><p className=\"mt-2 text-sm text-slate-500\">No se solicita ni procesa ningún dato de pago.</p><button onClick={placeOrder} className=\"mt-4 w-full rounded-xl bg-blue-600 py-3 font-bold\">Confirmar solicitud</button></div></>}</section>}{view===\"tracking\"&&<section className=\"mx-auto max-w-4xl px-5 py-10\"><div className=\"rounded-3xl bg-white p-7 shadow-sm\"><p className=\"text-sm font-bold text-blue-600\">PEDIDO DEMO</p><h1 className=\"mt-2 text-3xl font-black\">{order?\"Solicitud confirmada\":\"Seguimiento\"}</h1><p className=\"mt-3 text-slate-600\">Tu pedido está en estado simulado: recibido → preparando → en reparto → entregado.</p><div className=\"mt-6 grid gap-3 md:grid-cols-4\">{[\"Recibido\",\"Preparando\",\"En reparto\",\"Entregado\"].map((status,index)=><div key={status} className={\"rounded-xl p-4 font-bold \"+(index===0?\"bg-emerald-50 text-emerald-700\":\"bg-slate-100 text-slate-500\")}>{status}</div>)}</div><button onClick={()=>setView(\"home\")} className=\"mt-8 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white\">Seguir explorando</button></div></section>}<footer className=\"mx-auto max-w-7xl px-5 py-8 text-xs text-slate-500\">{deliveryDemoNotice}</footer></main>}\n`;
    }
    if (/^src\/pages\/.*\.(t|j)sx$/i.test(file)) return `export default function DeliverySection(){return <section className=\"min-h-screen p-6\"><h1 className=\"text-2xl font-bold\">Operación de delivery</h1><p className=\"mt-3 text-slate-600\">Vista demo preparada para personalizar restaurantes, pedidos y reparto.</p></section>}\n`;
    return null;
  }

  private deterministicAccommodationModule(milestone: Milestone): string | null {
    const intent = this.activeProjectIntent.toLowerCase();
    if (!/booking|alojamiento|hotel|hostal|apartamento tur[ií]stico|reserva de habitaci[oó]n/.test(intent)) return null;
    const file = milestone.filePath.replace(/^\.\//, "");
    if (/^src\/index\.(t|j)s$/i.test(file) && milestone.targetWorkspace !== "apps/web") {
      return `import { createServer } from "node:http";\n\nconst listings = [\n  { id: "costa-luz", name: "Casa Brisa del Mar", city: "Cádiz", pricePerNight: 142, rating: 9.2 },\n  { id: "retiro-sierra", name: "Retiro de la Sierra", city: "Granada", pricePerNight: 118, rating: 9.0 },\n  { id: "gran-via", name: "Hotel Central Gran Vía", city: "Madrid", pricePerNight: 176, rating: 8.8 },\n];\n\nfunction json(res: any, status: number, body: unknown) {\n  res.writeHead(status, { \"content-type\": \"application/json; charset=utf-8\", \"access-control-allow-origin\": \"*\" });\n  res.end(JSON.stringify(body));\n}\n\nexport const server = createServer((req, res) => {\n  const url = new URL(req.url || \"/\", \"http://localhost\");\n  if (req.method === \"OPTIONS\") return json(res, 204, {});\n  if (req.method === \"GET\" && url.pathname === \"/api/health\") return json(res, 200, { status: \"ok\" });\n  if (req.method === \"GET\" && url.pathname === \"/api/accommodations\") return json(res, 200, { data: listings, demo: true });\n  if (req.method === \"POST\" && url.pathname === \"/api/reservations\") return json(res, 201, { id: \"demo-\" + Date.now(), status: \"pending\", demo: true });\n  return json(res, 404, { error: \"Ruta no encontrada\" });\n});\n\nif (process.env.NODE_ENV !== \"test\") server.listen(Number(process.env.PORT || 3001));\n`;
    }
    if (/^src\/App\.(t|j)sx$/i.test(file)) {
      return `import { useMemo, useState } from \"react\";\nimport { accommodations, bookingDemoNotice, type Accommodation } from \"./mockData\";\n\ntype View = \"search\" | \"trips\" | \"host\";
type HostDraft = { type: string; name: string; city: string; address: string; guests: string; bedrooms: string; description: string; amenities: string[]; photos: string[]; nightlyRate: string; bookingMode: string; houseRules: string };
const HOST_STEPS = [\"Tipo\", \"Ubicación\", \"Detalles\", \"Fotos\", \"Tarifa\", \"Revisión\"];
function HostOnboarding({ onClose }: { onClose: () => void }) { const [step, setStep] = useState(0); const [submitted, setSubmitted] = useState(false); const [draft, setDraft] = useState<HostDraft>({ type: \"Apartamento\", name: \"\", city: \"\", address: \"\", guests: \"2\", bedrooms: \"1\", description: \"\", amenities: [], photos: [], nightlyRate: \"120\", bookingMode: \"request\", houseRules: \"\" }); const set = (field: keyof HostDraft, value: any) => setDraft((current) => ({ ...current, [field]: value })); const valid = () => step === 0 ? Boolean(draft.type) : step === 1 ? Boolean(draft.city && draft.address) : step === 2 ? Boolean(draft.name && Number(draft.guests) > 0) : step === 3 ? Boolean(draft.description) : step === 4 ? Number(draft.nightlyRate) > 0 : true; if (submitted) return <div className=\"mx-auto max-w-4xl px-5 py-10\"><div className=\"rounded-3xl bg-white p-8 shadow-xl\"><p className=\"text-sm font-bold text-blue-600\">ALTA DE ANFITRIÓN · DEMO</p><h1 className=\"mt-2 text-3xl font-black\">Tu alojamiento está pendiente de revisión.</h1><p className=\"mt-3 text-slate-600\">La ficha de {draft.name} se ha guardado como demostración. No se activan publicación, verificaciones, cobros, protección, impuestos ni liquidaciones sin proveedores autorizados.</p><div className=\"mt-6 rounded-2xl bg-emerald-50 p-5 text-emerald-900\"><b>Estado: revisión pendiente</b><p className=\"mt-1 text-sm\">Podrás editar disponibilidad, tarifa, fotos y normas antes de publicar.</p></div><button onClick={onClose} className=\"mt-7 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white\">Volver al marketplace</button></div></div>; return <div className=\"mx-auto max-w-4xl px-5 py-8\"><div className=\"flex items-center justify-between\"><div><p className=\"text-sm font-bold text-blue-600\">CENTRO DE ANFITRIONES</p><h1 className=\"mt-1 text-3xl font-black\">Publica tu alojamiento paso a paso.</h1></div><button onClick={onClose} className=\"rounded-xl border px-4 py-2 font-bold\">Cerrar</button></div><p className=\"mt-3 text-slate-600\">Flujo de demostración; los servicios financieros y de verificación requieren integraciones autorizadas.</p><div className=\"mt-6 grid gap-2 md:grid-cols-6\">{HOST_STEPS.map((label, index) => <button key={label} onClick={() => index <= step && setStep(index)} className={\"rounded-xl p-3 text-left text-xs font-bold \" + (index === step ? \"bg-slate-950 text-white\" : index < step ? \"bg-emerald-50 text-emerald-700\" : \"bg-slate-100 text-slate-500\")}>{index + 1}. {label}</button>)}</div><section className=\"mt-6 rounded-3xl bg-white p-6 shadow-sm\"><h2 className=\"text-xl font-black\">{HOST_STEPS[step]}</h2>{step === 0 && <div className=\"mt-5 grid gap-3 md:grid-cols-2\">{[\"Apartamento\", \"Casa\", \"Hotel boutique\", \"Hostal\", \"Villa\", \"Habitación privada\"].map((type) => <button key={type} onClick={() => set(\"type\", type)} className={\"rounded-2xl border p-5 text-left font-bold \" + (draft.type === type ? \"border-blue-600 bg-blue-50 text-blue-700\" : \"\")}>{type}</button>)}</div>}{step === 1 && <div className=\"mt-5 grid gap-4 md:grid-cols-2\"><label className=\"text-sm font-bold\">Ciudad<input value={draft.city} onChange={(e) => set(\"city\", e.target.value)} placeholder=\"Madrid\" className=\"mt-2 w-full rounded-xl border p-3 font-normal\" /></label><label className=\"text-sm font-bold\">Dirección<input value={draft.address} onChange={(e) => set(\"address\", e.target.value)} placeholder=\"Calle y número\" className=\"mt-2 w-full rounded-xl border p-3 font-normal\" /></label></div>}{step === 2 && <div className=\"mt-5 grid gap-4 md:grid-cols-3\"><label className=\"md:col-span-3 text-sm font-bold\">Nombre del alojamiento<input value={draft.name} onChange={(e) => set(\"name\", e.target.value)} placeholder=\"Casa junto al parque\" className=\"mt-2 w-full rounded-xl border p-3 font-normal\" /></label><label className=\"text-sm font-bold\">Huéspedes<select value={draft.guests} onChange={(e) => set(\"guests\", e.target.value)} className=\"mt-2 w-full rounded-xl border p-3 font-normal\">{[1,2,3,4,5,6,8,10].map((n) => <option key={n}>{n}</option>)}</select></label><label className=\"text-sm font-bold\">Dormitorios<select value={draft.bedrooms} onChange={(e) => set(\"bedrooms\", e.target.value)} className=\"mt-2 w-full rounded-xl border p-3 font-normal\">{[1,2,3,4,5].map((n) => <option key={n}>{n}</option>)}</select></label><div><p className=\"text-sm font-bold\">Servicios</p><div className=\"mt-2 flex flex-wrap gap-2\">{[\"Wi‑Fi\", \"Cocina\", \"Aire acondicionado\", \"Ascensor\", \"Terraza\", \"Aparcamiento\"].map((item) => <button key={item} onClick={() => set(\"amenities\", draft.amenities.includes(item) ? draft.amenities.filter((value) => value !== item) : [...draft.amenities, item])} className={\"rounded-full border px-3 py-2 text-sm \" + (draft.amenities.includes(item) ? \"bg-slate-950 text-white\" : \"\")}>{item}</button>)}</div></div></div>}{step === 3 && <div className=\"mt-5\"><label className=\"text-sm font-bold\">Descripción<textarea value={draft.description} onChange={(e) => set(\"description\", e.target.value)} placeholder=\"Qué hace especial a tu alojamiento\" className=\"mt-2 min-h-32 w-full rounded-xl border p-3 font-normal\" /></label><label className=\"mt-4 block text-sm font-bold\">Fotos<input type=\"file\" accept=\"image/*\" multiple onChange={(e) => set(\"photos\", Array.from(e.target.files || []).map((file) => file.name))} className=\"mt-2 block w-full rounded-xl border p-3 font-normal\" /></label><p className=\"mt-3 text-sm text-slate-500\">{draft.photos.length ? draft.photos.length + \" foto(s) preparada(s) para revisión demo.\" : \"Selecciona fotos para preparar la ficha; la carga real requiere almacenamiento seguro.\"}</p></div>}{step === 4 && <div className=\"mt-5 grid gap-4 md:grid-cols-2\"><label className=\"text-sm font-bold\">Tarifa por noche (€)<input type=\"number\" min=\"1\" value={draft.nightlyRate} onChange={(e) => set(\"nightlyRate\", e.target.value)} className=\"mt-2 w-full rounded-xl border p-3 font-normal\" /></label><label className=\"text-sm font-bold\">Reserva<select value={draft.bookingMode} onChange={(e) => set(\"bookingMode\", e.target.value)} className=\"mt-2 w-full rounded-xl border p-3 font-normal\"><option value=\"request\">Solicitud previa</option><option value=\"instant\">Confirmación automática (demo)</option></select></label><p className=\"md:col-span-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-900\">Calendario, impuestos, reglas de estancia e iCal quedan preparados como módulos de operación. No hay cobros ni pagos reales.</p></div>}{step === 5 && <div className=\"mt-5\"><label className=\"text-sm font-bold\">Normas de la casa<textarea value={draft.houseRules} onChange={(e) => set(\"houseRules\", e.target.value)} placeholder=\"Horario de entrada, mascotas, no fumar\" className=\"mt-2 min-h-28 w-full rounded-xl border p-3 font-normal\" /></label><div className=\"mt-4 rounded-2xl bg-slate-50 p-5 text-sm text-slate-600\"><b className=\"text-slate-900\">Resumen de publicación</b><p className=\"mt-2\">{draft.name || \"Nombre pendiente\"} · {draft.city || \"Ciudad pendiente\"} · {draft.nightlyRate} € por noche (demo)</p></div></div>}<div className=\"mt-8 flex justify-between\"><button disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))} className=\"rounded-xl border px-5 py-3 font-bold disabled:opacity-40\">Anterior</button><button disabled={!valid()} onClick={() => step === HOST_STEPS.length - 1 ? setSubmitted(true) : setStep((current) => current + 1)} className=\"rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-40\">{step === HOST_STEPS.length - 1 ? \"Enviar a revisión\" : \"Continuar\"}</button></div></section></div>; }
type HomeProps = { items: Accommodation[]; saved: Accommodation[]; onToggleSaved: (item: Accommodation) => void; onReserve: (item: Accommodation) => void };\nfunction Home({ items, saved, onToggleSaved, onReserve }: HomeProps) { const [destination, setDestination] = useState(\"\"); const [guests, setGuests] = useState(2); const [maxPrice, setMaxPrice] = useState(220); const results = useMemo(() => items.filter((x) => (x.city + x.name).toLowerCase().includes(destination.toLowerCase()) && x.guests >= guests && x.pricePerNight <= maxPrice), [items, destination, guests, maxPrice]); return <div className=\"mx-auto max-w-7xl px-5 py-8\"><section className=\"rounded-3xl bg-slate-950 p-8 text-white\"><p className=\"text-sm font-bold text-blue-200\">ALOJAMIENTOS CON MARCA PROPIA</p><h1 className=\"mt-2 text-4xl font-black\">Encuentra tu próxima estancia.</h1><div className=\"mt-6 grid gap-3 rounded-2xl bg-white p-3 text-slate-900 md:grid-cols-4\"><input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder=\"Destino\" className=\"rounded-xl border p-3\" /><input type=\"date\" className=\"rounded-xl border p-3\" /><select value={guests} onChange={(e) => setGuests(Number(e.target.value))} className=\"rounded-xl border p-3\"><option value={1}>1 huésped</option><option value={2}>2 huéspedes</option><option value={4}>4 huéspedes</option></select><button className=\"rounded-xl bg-blue-600 font-bold text-white\">Buscar</button></div></section><section className=\"mt-8 grid gap-6 lg:grid-cols-[220px_1fr]\"><aside className=\"rounded-2xl bg-white p-5 shadow-sm\"><b>Filtros</b><label className=\"mt-4 block text-sm\">Hasta {maxPrice} €<input className=\"mt-2 w-full\" type=\"range\" min=\"100\" max=\"240\" value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} /></label></aside><div className=\"grid gap-5 md:grid-cols-2\">{results.map((item) => <article key={item.id} className=\"overflow-hidden rounded-2xl bg-white shadow-sm\"><img src={item.image} alt=\"\" className=\"h-44 w-full object-cover\" /><div className=\"p-5\"><div className=\"flex justify-between\"><div><p className=\"text-sm text-slate-500\">{item.city}</p><h2 className=\"font-bold\">{item.name}</h2></div><button onClick={() => onToggleSaved(item)}>{saved.some((x) => x.id === item.id) ? \"♥\" : \"♡\"}</button></div><p className=\"mt-2 text-sm text-slate-600\">{item.description}</p><div className=\"mt-4 flex items-center justify-between\"><span className=\"font-bold text-emerald-700\">{item.rating} / 10</span><span><b>{item.pricePerNight} €</b> / noche</span></div><button onClick={() => onReserve(item)} className=\"mt-4 w-full rounded-xl bg-slate-950 py-2 font-bold text-white\">Solicitar reserva demo</button></div></article>)}</div></section></div>; }\nfunction Dashboard({ saved, confirmation, onExplore }: { saved: Accommodation[]; confirmation: string | null; onExplore: () => void }) { return <div className=\"mx-auto max-w-4xl px-5 py-10\"><div className=\"rounded-3xl bg-white p-7 shadow-sm\"><p className=\"text-sm font-bold text-blue-600\">ÁREA DE CLIENTE</p><h1 className=\"mt-2 text-3xl font-black\">Tus viajes y favoritos</h1>{confirmation ? <div className=\"mt-6 rounded-2xl bg-emerald-50 p-5\"><b>Solicitud registrada</b><p>Solicitud para {confirmation}. No se ha realizado ningún cobro.</p></div> : <p className=\"mt-3 text-slate-600\">Aún no tienes solicitudes.</p>}<div className=\"mt-6 grid gap-3 sm:grid-cols-2\">{saved.map((item) => <div key={item.id} className=\"rounded-xl border p-4\"><b>{item.name}</b><p className=\"text-sm text-slate-500\">{item.city} · desde {item.pricePerNight} €</p></div>)}</div><button onClick={onExplore} className=\"mt-8 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white\">Explorar alojamientos</button></div></div>; }\nexport default function App() {\n  const [view, setView] = useState<View>(\"search\");\n  const [saved, setSaved] = useState<Accommodation[]>([]);\n  const [confirmation, setConfirmation] = useState<string | null>(null);\n  const toggleSaved = (item: Accommodation) => setSaved((current) => current.some((x) => x.id === item.id) ? current.filter((x) => x.id !== item.id) : [...current, item]);\n  const reserve = (item: Accommodation) => { setConfirmation(item.name); setView(\"trips\"); };\n  return <main className=\"min-h-screen bg-slate-50 text-slate-900\">\n    <header className=\"sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur\"><div className=\"mx-auto flex max-w-7xl items-center justify-between px-5 py-4\"><button className=\"text-xl font-black tracking-tight\" onClick={() => setView(\"search\")}>staywise<span className=\"text-blue-600\">.</span></button><nav className=\"flex items-center gap-3 text-sm font-semibold\"><button className={view === \"search\" ? \"text-blue-700\" : \"text-slate-600\"} onClick={() => setView(\"search\")}>Explorar</button><button className={view === \"trips\" ? \"text-blue-700\" : \"text-slate-600\"} onClick={() => setView(\"trips\")}>Mis reservas</button><button className={view === \"host\" ? \"text-blue-700\" : \"text-slate-600\"} onClick={() => setView(\"host\")}>Anuncia tu alojamiento</button><span className=\"rounded-full bg-slate-100 px-3 py-1\">ES</span></nav></div></header>\n    {view === \"search\" ? <Home items={accommodations} saved={saved} onToggleSaved={toggleSaved} onReserve={reserve} /> : view === \"trips\" ? <Dashboard saved={saved} confirmation={confirmation} onExplore={() => setView(\"search\")} /> : <HostOnboarding onClose={() => setView(\"search\")} />}\n    <footer className=\"mx-auto max-w-7xl px-5 py-8 text-xs text-slate-500\">{bookingDemoNotice}</footer>\n  </main>;\n}\n`;
    }
    if (/^src\/pages\/Home\.(t|j)sx$/i.test(file)) {
      return `import { useMemo, useState } from \"react\";\nimport type { Accommodation } from \"../mockData\";\n\ntype Props = { items: Accommodation[]; saved: Accommodation[]; onToggleSaved: (item: Accommodation) => void; onReserve: (item: Accommodation) => void };\nexport default function Home({ items, saved, onToggleSaved, onReserve }: Props) {\n  const [destination, setDestination] = useState(\"\"); const [guests, setGuests] = useState(2); const [maxPrice, setMaxPrice] = useState(220); const [selected, setSelected] = useState<Accommodation | null>(null);\n  const results = useMemo(() => items.filter((x) => (x.city + x.country + x.name).toLowerCase().includes(destination.toLowerCase()) && x.pricePerNight <= maxPrice && x.guests >= guests), [destination, guests, maxPrice, items]);\n  return <div className=\"mx-auto max-w-7xl px-5 py-8\"><section className=\"rounded-3xl bg-gradient-to-br from-slate-950 via-slate-800 to-blue-950 p-7 text-white shadow-xl sm:p-10\"><p className=\"mb-2 text-sm font-bold uppercase tracking-[.18em] text-blue-200\">Escapadas que encajan contigo</p><h1 className=\"max-w-2xl text-4xl font-black tracking-tight sm:text-5xl\">Encuentra un lugar extraordinario para quedarte.</h1><div className=\"mt-7 grid gap-3 rounded-2xl bg-white p-3 text-slate-900 md:grid-cols-4\"><label className=\"rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium\">Destino<input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder=\"Cádiz, Madrid…\" className=\"mt-1 block w-full outline-none\" /></label><label className=\"rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium\">Entrada<input type=\"date\" className=\"mt-1 block w-full outline-none\" /></label><label className=\"rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium\">Huéspedes<select value={guests} onChange={(e) => setGuests(Number(e.target.value))} className=\"mt-1 block w-full bg-transparent outline-none\"><option value={1}>1 huésped</option><option value={2}>2 huéspedes</option><option value={4}>4 huéspedes</option></select></label><button className=\"rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700\">Buscar estancia</button></div></section><section className=\"mt-8 grid gap-8 lg:grid-cols-[260px_1fr]\"><aside className=\"rounded-2xl border border-slate-200 bg-white p-5 shadow-sm\"><h2 className=\"font-bold\">Filtros</h2><label className=\"mt-5 block text-sm font-medium\">Hasta {maxPrice} € / noche<input type=\"range\" min=\"100\" max=\"240\" value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} className=\"mt-3 w-full\" /></label><p className=\"mt-6 text-sm text-slate-500\">{results.length} alojamientos disponibles en esta demostración.</p></aside><div><div className=\"mb-4 flex items-end justify-between\"><div><h2 className=\"text-2xl font-black\">Alojamientos recomendados</h2><p className=\"text-sm text-slate-500\">Precios y disponibilidad de demostración.</p></div></div><div className=\"grid gap-5 md:grid-cols-2\">{results.map((item) => <article key={item.id} className=\"overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg\"><img src={item.image} alt=\"\" className=\"h-48 w-full object-cover\" /><div className=\"p-5\"><div className=\"flex justify-between gap-4\"><div><p className=\"text-sm text-slate-500\">{item.city}, {item.country}</p><h3 className=\"font-bold\">{item.name}</h3></div><button aria-label=\"Guardar favorito\" onClick={() => onToggleSaved(item)}>{saved.some((x) => x.id === item.id) ? \"♥\" : \"♡\"}</button></div><p className=\"mt-3 text-sm text-slate-600\">{item.description}</p><div className=\"mt-4 flex items-center justify-between\"><span className=\"rounded-lg bg-emerald-50 px-2 py-1 text-sm font-bold text-emerald-700\">{item.rating} · {item.reviewCount} opiniones</span><span><b>{item.pricePerNight} €</b><small className=\"text-slate-500\"> / noche</small></span></div><div className=\"mt-4 flex gap-2\"><button onClick={() => setSelected(item)} className=\"flex-1 rounded-xl border border-slate-300 py-2 text-sm font-bold\">Ver detalle</button><button onClick={() => onReserve(item)} className=\"flex-1 rounded-xl bg-slate-950 py-2 text-sm font-bold text-white\">Reservar</button></div></div></article>)}</div></div></section>{selected && <div className=\"fixed inset-0 z-30 grid place-items-center bg-slate-950/50 p-5\"><div className=\"max-w-lg rounded-2xl bg-white p-6 shadow-2xl\"><button className=\"float-right\" onClick={() => setSelected(null)}>×</button><h2 className=\"text-2xl font-black\">{selected.name}</h2><p className=\"mt-3 text-slate-600\">{selected.description}</p><div className=\"mt-4 flex flex-wrap gap-2\">{selected.amenities.map((x) => <span key={x} className=\"rounded-full bg-slate-100 px-3 py-1 text-sm\">{x}</span>)}</div><button onClick={() => { onReserve(selected); setSelected(null); }} className=\"mt-6 w-full rounded-xl bg-blue-600 py-3 font-bold text-white\">Solicitar reserva demo</button></div></div>}</div>;\n}\n`;
    }
    if (/^src\/pages\/Favorites\.(t|j)sx$/i.test(file)) {
      return `export default function Favorites() { return <section className=\"mx-auto max-w-4xl p-6\"><h1 className=\"text-2xl font-bold\">Favoritos</h1><p className=\"mt-2 text-slate-600\">Guarda alojamientos desde el buscador para compararlos aquí.</p></section>; }\n`;
    }
    if (/^src\/pages\/Messaging\.(t|j)sx$/i.test(file)) {
      return `import { useState } from \"react\";\nexport default function Messaging() { const [message, setMessage] = useState(\"\"); const [sent, setSent] = useState(false); return <section className=\"mx-auto max-w-4xl p-6\"><h1 className=\"text-2xl font-bold\">Mensajes</h1><p className=\"mt-2 text-slate-600\">Consulta ficticia para el alojamiento seleccionado.</p><textarea value={message} onChange={(e) => setMessage(e.target.value)} className=\"mt-4 w-full rounded-xl border p-3\" placeholder=\"Escribe tu consulta\" /><button onClick={() => setSent(Boolean(message.trim()))} className=\"mt-3 rounded-xl bg-slate-950 px-4 py-2 font-bold text-white\">Enviar consulta</button>{sent && <p className=\"mt-3 text-emerald-700\">Consulta registrada en esta demostración.</p>}</section>; }\n`;
    }
    if (/^src\/pages\/Dashboard\.(t|j)sx$/i.test(file)) {
      return `import type { Accommodation } from \"../mockData\";\nexport default function Dashboard({ saved, confirmation, onExplore }: { saved: Accommodation[]; confirmation: string | null; onExplore: () => void }) { return <div className=\"mx-auto max-w-4xl px-5 py-10\"><div className=\"rounded-3xl bg-white p-7 shadow-sm ring-1 ring-slate-200\"><p className=\"text-sm font-bold uppercase tracking-[.16em] text-blue-600\">Área de cliente</p><h1 className=\"mt-2 text-3xl font-black\">Tus viajes y favoritos</h1>{confirmation ? <div className=\"mt-6 rounded-2xl bg-emerald-50 p-5 text-emerald-900\"><b>Solicitud registrada</b><p className=\"mt-1\">Hemos guardado tu solicitud para {confirmation}. Es una reserva de demostración: no se ha realizado ningún cobro.</p></div> : <p className=\"mt-3 text-slate-600\">Aún no tienes solicitudes confirmadas.</p>}<h2 className=\"mt-8 font-bold\">Favoritos ({saved.length})</h2><div className=\"mt-3 grid gap-3 sm:grid-cols-2\">{saved.map((item) => <div key={item.id} className=\"rounded-xl border border-slate-200 p-4\"><b>{item.name}</b><p className=\"text-sm text-slate-500\">{item.city} · desde {item.pricePerNight} €</p></div>)}{saved.length === 0 && <p className=\"text-sm text-slate-500\">Guarda tus alojamientos preferidos para compararlos aquí.</p>}</div><button onClick={onExplore} className=\"mt-8 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white\">Seguir explorando</button></div></div>; }\n`;
    }
    return null;
  }

  private deterministicDomainSeed(milestone: Milestone): string | null {
    if (!/(^|\/)mockData\.(t|j)s$/i.test(milestone.filePath)) return null;
    const intent = this.activeProjectIntent.toLowerCase();
    // Ruta rápida y completa para el blueprint de alojamientos: evita que el
    // primer hito de datos quede esperando una inferencia lenta y ofrece al
    // resto de agentes entidades reales sobre las que construir el producto.
    if (/booking|alojamiento|hotel|hostal|apartamento tur[ií]stico|reserva de habitaci[oó]n/.test(intent)) {
      return `export type Accommodation = {\n  id: string; name: string; city: string; country: string; image: string; rating: number; reviewCount: number; pricePerNight: number; currency: \"EUR\"; guests: number; bedrooms: number; amenities: string[]; tags: string[]; description: string;\n};\n\nexport const accommodations: Accommodation[] = [\n  { id: \"costa-luz\", name: \"Casa Brisa del Mar\", city: \"Cádiz\", country: \"España\", image: \"https://images.unsplash.com/photo-1601918774946-25832a4be0d6?auto=format&fit=crop&w=1200&q=80\", rating: 9.2, reviewCount: 184, pricePerNight: 142, currency: \"EUR\", guests: 4, bedrooms: 2, amenities: [\"Wi‑Fi\", \"Cocina\", \"Terraza\", \"Aire acondicionado\"], tags: [\"Frente al mar\", \"Cancelación flexible\"], description: \"Apartamento luminoso a pocos pasos de la playa, con terraza privada y cocina equipada.\" },\n  { id: \"retiro-sierra\", name: \"Retiro de la Sierra\", city: \"Granada\", country: \"España\", image: \"https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&w=1200&q=80\", rating: 9.0, reviewCount: 96, pricePerNight: 118, currency: \"EUR\", guests: 3, bedrooms: 1, amenities: [\"Desayuno\", \"Vistas a la montaña\", \"Aparcamiento\"], tags: [\"Escapada rural\"], description: \"Alojamiento tranquilo con vistas abiertas, ideal para descubrir la sierra y el casco histórico.\" },\n  { id: \"gran-via\", name: \"Hotel Central Gran Vía\", city: \"Madrid\", country: \"España\", image: \"https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80\", rating: 8.8, reviewCount: 521, pricePerNight: 176, currency: \"EUR\", guests: 2, bedrooms: 1, amenities: [\"Recepción 24 h\", \"Gimnasio\", \"Wi‑Fi\"], tags: [\"Centro\", \"Viaje de trabajo\"], description: \"Hotel urbano con habitaciones confortables y acceso sencillo a los principales puntos de interés.\" },\n  { id: \"azul-mediterraneo\", name: \"Azul Mediterráneo Suites\", city: \"Valencia\", country: \"España\", image: \"https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=80\", rating: 9.4, reviewCount: 239, pricePerNight: 164, currency: \"EUR\", guests: 5, bedrooms: 2, amenities: [\"Piscina\", \"Cocina\", \"Ascensor\", \"Wi‑Fi\"], tags: [\"Familias\", \"Piscina\"], description: \"Suites amplias y funcionales cerca de la ciudad y la costa, con servicios pensados para familias.\" },\n];\n\nexport const bookingDemoNotice = \"Los precios, disponibilidad y reservas de esta demostración son datos ficticios hasta conectar un proveedor autorizado.\";\n`;
    }
    return null;
  }

  private async generateMilestone(milestone: Milestone, database: "mongodb" | "postgresql", platform: "web" | "mobile-native" = "web"): Promise<GeneratedMilestone> {
    const deterministicDelivery = this.deterministicDeliveryModule(milestone);
    if (deterministicDelivery) return { ...milestone, code: deterministicDelivery };
    const deterministicAccommodation = this.deterministicAccommodationModule(milestone);
    if (deterministicAccommodation) return { ...milestone, code: deterministicAccommodation };
    const deterministicSeed = this.deterministicDomainSeed(milestone);
    if (deterministicSeed) return { ...milestone, code: deterministicSeed };
    // La documentación de arranque no debe consumir una inferencia larga ni bloquear
    // una aplicación que ya tiene sus módulos de producto construidos.
    if (/^(README|readme)\.md$/i.test(milestone.filePath)) {
      const product = this.activeProjectIntent.slice(0, 600).replace(/\s+/g, " ").trim() || "Aplicación generada con Maris AI";
      return {
        ...milestone,
        code: `# Proyecto generado con Maris AI\n\n## Objetivo\n${product}\n\n## Arranque\n1. Revisa las variables de entorno de las integraciones necesarias.\n2. Ejecuta el workspace web y el API según la estructura generada.\n3. Valida los flujos principales antes de publicar.\n\n## Seguridad\nNo actives credenciales, cobros ni servicios externos sin una configuración autorizada.\n`,
      };
    }
    // El modo compacto prioriza una primera versión visible: un intento breve y
    // el fallback existente son preferibles a tres esperas de 90 segundos.
    const compactMilestone = (this.options.maxMilestonesOverride ?? Number.POSITIVE_INFINITY) <= 8;
    const usesOwnMarisModel = Boolean(process.env.MARIS_LLM_URL);
    // El motor propio trabaja en CPU y no se comparte con Zoco. Damos un margen
    // realista a la primera inferencia y un segundo intento local; los latidos
    // mantienen la tarea viva y nunca se escribe código parcial.
    const MAX_ATTEMPTS = compactMilestone ? (usesOwnMarisModel ? 2 : 1) : 3;
    const milestoneTimeoutMs = usesOwnMarisModel ? 180_000 : (compactMilestone ? 90_000 : 120_000);
    const milestoneMaxTokens = compactMilestone ? 4_000 : 16_000;
    let lastError: unknown;

    const dependencyContext = this.buildDependencyContext(milestone);
    const qualityBlock = this.options.backendQualityPrompt && milestone.targetWorkspace !== "apps/web"
      ? `\n\nQUALITY BAR OBLIGATORIO (mismas reglas que el resto de la plataforma):\n${this.options.backendQualityPrompt.slice(0, 6000)}`
      : "";
    const platformBlock = platform === "mobile-native" && milestone.targetWorkspace === "apps/web"
      ? `\n\nIMPORTANTE: este proyecto es una APP MÓVIL NATIVA, no web. Para este hito (capa ${milestone.layer}) usa React Native + Expo + TypeScript + React Navigation. NO uses Tailwind CSS, NO uses elementos HTML (div/span/button) — usa View/Text/Pressable de react-native con StyleSheet.create. NO generes vercel.json.`
      : "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {try {
        // El timeout es adaptativo: el modo compacto cae al fallback después
        // de una espera corta, mientras que las arquitecturas avanzadas conservan
        // la tolerancia necesaria para archivos grandes.
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
          abortController.abort();
          console.warn(`⏰ Timeout ${milestoneTimeoutMs / 1000}s en hito ${milestone.id} (${milestone.name}) — abortando y reintentando`);
        }, milestoneTimeoutMs);
        let response: any;
        try {
          const streamPromise = zocoia.messages.stream({
            model: this.options.model!,
            max_tokens: milestoneMaxTokens,
            system: [
              { type: "text", text: CODE_AGENT_STATIC, cache_control: { type: "ephemeral" } },
              { type: "text", text: `Base de datos del proyecto: ${database}.${qualityBlock}${platformBlock}` },
            ] as any,
            messages: [{
              role: "user",
              content: `Genera el archivo ${milestone.filePath} para el workspace ${milestone.targetWorkspace}.\n\nPRODUCTO QUE DEBES ENTREGAR (mantén este dominio, nombres y flujos en TODOS los archivos):\n${this.activeProjectIntent.slice(0, 5000)}\n\nObjetivo del hito: ${milestone.description}\n\n${dependencyContext}\n\nREGLAS OBLIGATORIAS DE ENTREGA:\n- No generes placeholders, pantallas de construcción ni componentes vacíos.\n- No uses example.com, api.example.com, URLs ficticias ni fetch a servicios externos; usa estado y datos locales realistas hasta que exista una integración configurada.\n- Todo hook React usado directamente (useEffect, useState, useMemo, etc.) debe importarse de react en ese archivo.\n- Conserva el modelo de negocio, términos y entidades del producto solicitado; nunca lo sustituyas por una tienda o lista genérica.\n\nDevuelve SOLO el código del archivo, sin explicaciones ni markdown.`,
            }],
          }, { signal: abortController.signal as any }).finalMessage();
          // Algunos clientes de streaming ignoran AbortSignal mientras esperan
          // la primera respuesta. Race obliga a liberar el hito incluso en ese
          // caso, antes de que el watchdog global pueda reiniciar todo el job.
          let hardTimeoutId: NodeJS.Timeout | undefined;
          const hardTimeout = new Promise<never>((_, reject) => {
            hardTimeoutId = setTimeout(() => reject(new Error(`Timeout duro de ${milestoneTimeoutMs / 1000}s en hito ${milestone.id} (${milestone.name})`)), milestoneTimeoutMs + 1_000);
          });
          try {
            response = await Promise.race([streamPromise, hardTimeout]);
          } finally {
            if (hardTimeoutId) clearTimeout(hardTimeoutId);
          }
        } finally {
          clearTimeout(timeoutId);
        }
        let code = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
        // Limpiar fences de markdown que el modelo a veces añade
        code = code.replace(/^```(?:tsx?|jsx?|typescript|javascript)?\n?/, "").replace(/\n?```$/, "").trim();
        // Validación de contenido mínimo
        const isReactFile = /\.(t|j)sx$/.test(milestone.filePath);
        const minLen = isReactFile ? 50 : 20;
        if (code && code.length >= minLen) return { ...milestone, code };
        if (code && code.length > 0 && code.length < minLen) {
          console.warn(`⚠️ Hito ${milestone.id} (${milestone.name}): respuesta demasiado corta (${code.length} chars) — reintentando...`);
        }
        throw new Error("Respuesta vacía o demasiado corta del modelo");
      } catch (error) {
        lastError = error;
        console.error(`⚠️ Hito ${milestone.id} (${milestone.name}) — intento ${attempt}/${MAX_ATTEMPTS}:`, error);
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    // Un hito incompleto NO puede transformarse en un placeholder silencioso.
    // Hacerlo permitía que el proyecto siguiera hasta "completado" con una
    // pantalla "Módulo en construcción" o con imports que no se podían resolver.
    // Se aborta antes de escribir el archivo: el flujo superior conserva la versión
    // anterior y puede activar una recuperación explícita y trazable.
    const failureMessage = `No se pudo generar de forma válida el hito ${milestone.id} (${milestone.name}) tras ${MAX_ATTEMPTS} intento(s): ${String(lastError instanceof Error ? lastError.message : lastError).slice(0, 500)}`;
    console.error(`⛔ ${failureMessage}`);
    if (this.options.onMilestoneStuck) {
      try {
        await this.options.onMilestoneStuck({
          milestoneName: milestone.name,
          layer: milestone.layer,
          attempts: MAX_ATTEMPTS,
          lastError: failureMessage,
        });
      } catch { /* las alertas no cambian el resultado de generación */ }
    }
    throw new Error(failureMessage);
  }

  /**
   * FASE 2: CONSTRUCCIÓN POR CAPAS — cada capa se genera en paralelo
   * internamente (con límite de concurrencia), pero las capas se ejecutan
   * SECUENCIALMENTE para que cada una pueda usar el contexto real de la
   * anterior. Esto es lo que evita la incoherencia entre archivos que tenía
   * la versión anterior (paralelismo total sin dependencias).
   */
  async buildProjectIncremental(userPrompt: string, wsNotificationCallback: Function) {
    this.activeProjectIntent = userPrompt;
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
        const results = await Promise.all(batch.map(async (m) => {
          const currentProgress = 8 + Math.round((completed / total) * 90);
          const emitHeartbeat = () => {
            try {
              const output = wsNotificationCallback({
                status: `🧠 Generando ${m.name} (${m.filePath})…`,
                progress: currentProgress,
                step: m.id,
              });
              if (output && typeof output.catch === "function") void output.catch(() => undefined);
            } catch { /* el latido nunca debe interrumpir el hito */ }
          };
          // Se comunica el inicio una sola vez. El heartbeat silencioso del
          // trabajo se mantiene en runJobById cada 30 s; repetir este mismo
          // texto cada 15 s solo inundaba la línea de tiempo del cliente sin
          // aportar avance real.
          emitHeartbeat();
          return await this.generateMilestone(m, database, platform);
        }));
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

      // ── VALIDACIÓN ESBUILD POR CAPA FRONTEND ────────────────────────────────
      // Al terminar cualquier capa de frontend (FRONTEND_CORE o FRONTEND_MODULES),
      // compilamos el bundle acumulado con esbuild. Si hay errores de sintaxis
      // o imports rotos en esta capa, los detectamos AHORA (cuando el contexto
      // está fresco) y regeneramos solo los hitos problemáticos antes de
      // continuar con la siguiente capa. Esto evita que errores tempranos se
      // propaguen y contaminen las capas siguientes, que es exactamente lo
      // que causaba los 0/24 archivos fallidos al final.
      const isFrontendLayer = layerMilestones.some(
        (m) => m.targetWorkspace === "apps/web"
      );
      if (isFrontendLayer && layerMilestones.length > 0 && this.options.validateFrontendBundle) {
        const frontendSoFar = Array.from(this.generatedByMilestoneId.values())
          .filter((item) => item.targetWorkspace === "apps/web")
          .sort((a, b) => a.id - b.id)
          .map((item) => `// === FILE: ${item.filePath} ===\n${item.code.trim()}\n`)
          .join("\n");

        // Las primeras capas pueden contener únicamente datos, tipos o servicios
        // de frontend. Es normal que todavía no exista App/main; esbuild no debe
        // tratar esa fase preparatoria como un error de producto. Desde que se
        // genera una entrada React, toda validación pasa a ser obligatoria.
        const hasFrontendEntry = Array.from(this.generatedByMilestoneId.values())
          .some((item) => item.targetWorkspace === "apps/web" && /(^|\/)(App|main|index)\.(tsx|jsx)$/.test(item.filePath));
        if (frontendSoFar.length > 200 && hasFrontendEntry) {
          try {
            wsNotificationCallback({
              status: `🔍 Verificando compilación de capa frontend (${layerMilestones.length} hito(s))...`,
              progress: 8 + Math.round((completed / total) * 90),
            });

            const validation = await this.options.validateFrontendBundle(frontendSoFar);
            if (!validation.ok && validation.issues.length > 0) {
              // Identificar qué archivos tienen errores
              const failingFiles = validation.issues
                .map((issue) => {
                  // validateBundle puede devolver `src/App.tsx` directamente o
                  // una ruta prefijada por esbuild (`appforge-vfs:src/App.tsx`).
                  // Ambos formatos representan un hito recuperable; asumir solo
                  // el segundo convertía errores triviales de imports en fallos
                  // no recuperables de toda la generación.
                  const rawFile = String(issue.file || "").replace(/^.*appforge-vfs:/, "").replace(/^\/+/, "");
                  const match = /(?:(?:apps\/web\/)?src\/[A-Za-z0-9_./-]+\.(?:tsx?|jsx?))/.exec(rawFile);
                  return match?.[0].replace(/^apps\/web\//, "");
                })
                .filter(Boolean) as string[];

              const uniqueFailingFiles = [...new Set(failingFiles)];
              // Solo regenerar si son pocos archivos (<=5). Los errores sin ruta
              // resoluble o con demasiados archivos son estructurales: continuar
              // dejaría una app incompleta y queda prohibido.
              if (uniqueFailingFiles.length === 0 || uniqueFailingFiles.length > 5) {
                throw new Error(`Validación frontend no recuperable: ${validation.issues.slice(0, 3).map((issue) => issue.message).join(" | ")}`);
              }
              if (uniqueFailingFiles.length <= 5) {
                wsNotificationCallback({
                  status: `⚠️ ${uniqueFailingFiles.length} archivo(s) con errores — regenerando solo los afectados...`,
                  progress: 8 + Math.round((completed / total) * 90),
                });

                for (const filePath of uniqueFailingFiles) {
                  const affectedMilestone = layerMilestones.find(
                    (m) => m.filePath === filePath || m.filePath.endsWith(`/${filePath}`)
                  );
                  if (!affectedMilestone) {
                    throw new Error(`El archivo inválido ${filePath} no corresponde a un hito recuperable.`);
                  }
                  if (affectedMilestone) {
                    const errorContext = validation.issues
                      .filter((i) => i.file.includes(filePath))
                      .map((i) => i.message)
                      .join("\n")
                      .slice(0, 500);
                    const fixedMilestone = await this.generateMilestone(
                      {
                        ...affectedMilestone,
                        description: `${affectedMilestone.description}\n\nFIX REQUERIDO — este archivo falló la compilación con este error: ${errorContext}`,
                      },
                      database,
                      platform
                    );
                    this.generatedByMilestoneId.set(fixedMilestone.id, fixedMilestone);
                    await this.writeCodeToWorkspace(fixedMilestone.targetWorkspace, fixedMilestone.filePath, fixedMilestone.code);
                    wsNotificationCallback({
                      status: `✅ ${fixedMilestone.filePath} regenerado y corregido.`,
                      progress: 8 + Math.round((completed / total) * 90),
                    });
                  }
                }
                const revalidatedFrontend = Array.from(this.generatedByMilestoneId.values())
                  .filter((item) => item.targetWorkspace === "apps/web")
                  .sort((a, b) => a.id - b.id)
                  .map((item) => `// === FILE: ${item.filePath} ===\n${item.code.trim()}\n`)
                  .join("\n");
                const revalidation = await this.options.validateFrontendBundle(revalidatedFrontend);
                if (!revalidation.ok) {
                  throw new Error(`La regeneración no dejó el frontend compilable: ${revalidation.issues.slice(0, 3).map((issue) => issue.message).join(" | ")}`);
                }
                wsNotificationCallback({
                  status: "✅ Frontend regenerado y compilado correctamente.",
                  progress: 8 + Math.round((completed / total) * 90),
                });
              }
            } else if (validation.ok) {
              wsNotificationCallback({
                status: `✅ Capa frontend compilada correctamente.`,
                progress: 8 + Math.round((completed / total) * 90),
              });
            }
          } catch (validationError) {
            // Nunca se entrega ni se sigue construyendo sobre un frontend que no
            // puede compilarse. El job falla de forma segura sin sobrescribir una
            // aplicación existente.
            throw validationError;
          }
        }
      }
    } // fin for (const layerMilestones of layers)

    const allGenerated = Array.from(this.generatedByMilestoneId.values());
    const generatedFrontend = allGenerated.filter((item) => item.targetWorkspace === "apps/web");
    const generatedFrontendBundle = generatedFrontend
      .sort((a, b) => a.id - b.id)
      .map((item) => `// === FILE: ${item.filePath} ===\n${item.code.trim()}\n`)
      .join("\n");
    const hasGeneratedEntry = generatedFrontend.some((item) => /(^|\/)(App|main|index)\.(tsx|jsx)$/.test(item.filePath));
    if (generatedFrontendBundle.length < 200 || !hasGeneratedEntry) {
      throw new Error("El orquestador no completó una entrada React válida; no se anunciará ni entregará un proyecto parcial.");
    }
    wsNotificationCallback({ status: "🚀 ¡Proyecto completo generado e integrado!", progress: 100, step: total });
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

  // ───────────────────────────────────────────────────────────────────────────
  // MODO EDICIÓN POR HITOS — métodos equivalentes a planMonorepoProject /
  // generateMilestone / buildProjectIncremental, pero operando sobre un
  // bundle ya existente en vez de generar desde cero. Ver el comentario de
  // cabecera de EditMilestone más arriba para el porqué de esta extensión.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Parsea un bundle "// === FILE: <path> ===" en un mapa { ruta → contenido }.
   * Implementación AUTOCONTENIDA y deliberadamente independiente de la
   * equivalente en artifacts/api-server/src/lib/fileToolsAgent.ts: este
   * paquete (@workspace/services) no depende del api-server en su
   * package.json (y el api-server SÍ depende de @workspace/services), así
   * que importar desde allí crearía una dependencia circular real entre
   * paquetes del monorepo. Misma lógica exacta, sin esa dependencia.
   */
  private parseBundleToMap(bundle: string): Map<string, string> {
    const files = new Map<string, string>();
    const parts = bundle.split(/\/\/ === FILE: /);
    for (const part of parts) {
      if (!part.trim()) continue;
      const nl = part.indexOf("\n");
      if (nl === -1) continue;
      const rawPath = part.slice(0, nl).trim().replace(/ ===$/, "").trim();
      if (!rawPath) continue;
      const content = part.slice(nl + 1);
      // Filtrar archivos con contenido vacío o insignificante (< 10 chars)
      // que podrían haberse generado por un parse mal formado.
      if (content.trim().length < 10 && /\.(t|j)sx?$/.test(rawPath)) {
        console.warn(`⚠️ parseBundleToMap: archivo "${rawPath}" tiene contenido vacío/insignificante (${content.trim().length} chars) — ignorado.`);
        continue;
      }
      files.set(rawPath, content);
    }
    return files;
  }

  private mapToBundle(files: Map<string, string>): string {
    const parts: string[] = [];
    for (const [filePath, content] of files.entries()) {
      parts.push(`// === FILE: ${filePath} ===\n${content}`);
    }
    return parts.join("\n\n");
  }

  /**
   * FASE 1 (modo edición): planifica los hitos de MODIFICACIÓN necesarios
   * para cumplir la petición del usuario sobre un proyecto que YA EXISTE.
   * Solo se le pasan las RUTAS de los archivos actuales (no su contenido
   * completo — eso inflaría el prompt del planificador sin necesidad; cada
   * hito recibe el contenido real del archivo concreto que le toca, no de
   * todos), igual de barato en tokens que planMonorepoProject.
   */
  private buildDeterministicEditPlan(
    userPrompt: string,
    existingFilePaths: { frontend: string[]; backend: string[] },
  ): { milestones: EditMilestone[] } {
    // Si el planificador IA se agota, no pasamos todo el proyecto a una
    // reescritura monolítica. Elegimos una superficie existente y segura: el
    // componente raíz recibe el cambio y el resto del bundle queda intacto.
    const frontendCandidates = [...existingFilePaths.frontend].sort((a, b) => {
      const score = (p: string) => /(^|\/)App\.(t|j)sx?$/.test(p) ? 0 : /(^|\/)main\.(t|j)sx?$/.test(p) ? 1 : 2;
      return score(a) - score(b) || a.localeCompare(b);
    });
    const target = frontendCandidates.find((p) => /\.(t|j)sx?$/.test(p));
    if (!target) {
      throw new Error("No hay archivo frontend existente y recuperable para aplicar una edición segura.");
    }
    console.warn(`⚡ Planificador de edición determinista: aplicando el cambio sobre ${target} sin crear archivos temporales.`);
    return {
      milestones: [{
        id: 1,
        action: "modify_file",
        filePath: target,
        description: `Aplica esta petición de forma localizada, conservando todo lo no relacionado y sin crear placeholders: ${userPrompt.slice(0, 4000)}`,
        dependsOn: [],
      }],
    };
  }

  async planProjectEdit(
    userPrompt: string,
    existingFilePaths: { frontend: string[]; backend: string[] },
  ): Promise<{ milestones: EditMilestone[] }> {
    if (/booking|alojamiento|anfitri[oó]n|tour|actividad|traslado|viaje|travel|vuelo|autob[uú]s|coche/i.test(userPrompt)) {
      return this.buildDeterministicEditPlan(userPrompt, existingFilePaths);
    }
    const fileList = [
      ...existingFilePaths.frontend.map((p) => `- ${p} (frontend)`),
      ...existingFilePaths.backend.map((p) => `- ${p} (backend)`),
    ].join("\n");

    const complexEdit = existingFilePaths.frontend.length + existingFilePaths.backend.length > 80
      || /\b(reescribe todo|reescribir toda|migraci[oó]n completa|refactor(?:izaci[oó]n)? completa|microservicios?|todo el proyecto)\b/i.test(userPrompt);
    const editMaxTokens = complexEdit ? 24_000 : 6_000;
    const editTimeoutMs = complexEdit ? 120_000 : 45_000;
    const editAbortController = new AbortController();
    const editTimeoutId = setTimeout(() => {
      editAbortController.abort();
      console.warn(`⏰ Timeout ${editTimeoutMs / 1000}s en planProjectEdit — abortando planificación`);
    }, editTimeoutMs);
    let response: any;
    try {
      response = await zocoia.messages.stream({
        model: this.options.model!,
        max_tokens: editMaxTokens,
        system: [{ type: "text", text: EDIT_PLANNER_SYSTEM_STATIC, cache_control: { type: "ephemeral" } }] as any,
        messages: [{
          role: "user",
          content: `ARCHIVOS QUE YA EXISTEN EN EL PROYECTO:\n${fileList || "(proyecto sin archivos detectados — trata todo como create_file)"}\n\nPETICIÓN DEL USUARIO:\n${userPrompt}\n\n${complexEdit ? "" : "[MARIS EDIT FAST] Máximo 5 archivos/hitos. Modifica solo lo necesario; no propongas una reconstrucción completa."}`,
        }],
      }, { signal: editAbortController.signal as any }).finalMessage();
    } catch (error) {
      console.warn("⚠️ planProjectEdit no respondió a tiempo; usando plan determinista de edición segura.", error);
      return this.buildDeterministicEditPlan(userPrompt, existingFilePaths);
    } finally {
      clearTimeout(editTimeoutId);
    }

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const cleanedJson = this.cleanJsonResponse(rawText);

    try {
      const result = JSON.parse(cleanedJson);
      const milestones: EditMilestone[] = (result.milestones || []).map((m: any) => ({
        id: m.id,
        action: m.action === "create_file" ? "create_file" : "modify_file",
        filePath: String(m.filePath || "").trim(),
        description: String(m.description || ""),
        dependsOn: Array.isArray(m.dependsOn) ? m.dependsOn : [],
      })).filter((m: EditMilestone) => m.filePath);
      return { milestones: complexEdit ? milestones : milestones.slice(0, 5) };
    } catch (error) {
      // Misma red de seguridad que planMonorepoProject: si el modelo añadió
      // texto conversacional alrededor del JSON, lo recuperamos buscando el
      // primer objeto balanceado en vez de fallar directamente.
      const extracted = this.extractFirstJsonObject(rawText);
      if (extracted) {
        try {
          const result = JSON.parse(extracted);
          const milestones: EditMilestone[] = (result.milestones || []).map((m: any) => ({
            id: m.id,
            action: m.action === "create_file" ? "create_file" : "modify_file",
            filePath: String(m.filePath || "").trim(),
            description: String(m.description || ""),
            dependsOn: Array.isArray(m.dependsOn) ? m.dependsOn : [],
          })).filter((m: EditMilestone) => m.filePath);
          console.warn("⚠️ El planificador de edición devolvió texto junto al JSON — se recuperó el objeto JSON embebido correctamente.");
          return { milestones: complexEdit ? milestones : milestones.slice(0, 5) };
        } catch {
          /* el bloque extraído tampoco era JSON válido — cae al error final de abajo */
        }
      }
      console.error("❌ Error parseando JSON del plan de edición; usando plan determinista seguro:", error);
      return this.buildDeterministicEditPlan(userPrompt, existingFilePaths);
    }
  }

  /** Construye el bloque de contexto para un hito de edición: el archivo
   *  ACTUAL completo (si modify_file y existe) + los hitos de ESTA edición
   *  en los que depende (si ya se generaron). */
  private buildEditContext(
    milestone: EditMilestone,
    currentFiles: Map<string, string>,
    generatedByMilestoneId: Map<number, GeneratedEditMilestone>,
  ): string {
    const blocks: string[] = [];
    if (milestone.action === "modify_file") {
      const currentContent = currentFiles.get(milestone.filePath);
      blocks.push(
        currentContent
          ? `ARCHIVO ACTUAL (${milestone.filePath}) — modifícalo, NO lo reescribas desde cero, conserva todo lo que no esté relacionado con el cambio pedido:\n${currentContent.trim()}`
          : `AVISO: el planificador marcó este hito como "modify_file" pero el archivo "${milestone.filePath}" no se encontró en el bundle actual — trátalo como un archivo nuevo coherente con el resto del proyecto.`
      );
    }
    const depBlocks = milestone.dependsOn
      .map((id) => generatedByMilestoneId.get(id))
      .filter((m): m is GeneratedEditMilestone => Boolean(m))
      .map((m) => `// === ARCHIVO YA EDITADO/CREADO EN ESTA MISMA EDICIÓN: ${m.filePath} ===\n${m.code.trim()}`);
    if (depBlocks.length) blocks.push(`CONTEXTO DE OTROS HITOS DE ESTA EDICIÓN:\n\n${depBlocks.join("\n\n")}`);
    return blocks.join("\n\n") || "No hay contexto adicional relevante para este hito.";
  }

  private deterministicTravelMarketplaceEdit(milestone: EditMilestone): string | null {
    const scope = `${milestone.description} ${milestone.filePath}`.toLowerCase();
    if (!/^src\/App\.(t|j)sx$/i.test(milestone.filePath) || !/booking|alojamiento|anfitri[oó]n|tour|actividad|traslado|viaje|travel|vuelo|autob[uú]s|coche/.test(scope)) return null;
    return `import { useMemo, useState } from "react";

type Product = { id: string; type: string; title: string; place: string; price: number; unit: string; rating: number; detail: string; image: string; badge: string };
type Draft = { providerType: string; name: string; location: string; description: string; photos: string[]; price: string; availability: string; rules: string };
const TYPES = ["Alojamientos", "Vuelos", "Tours", "Actividades", "Traslados", "Coche", "Autobús"];
const PRODUCTS: Product[] = [
  { id: "stay-madrid", type: "Alojamientos", title: "Casa del Retiro", place: "Madrid", price: 136, unit: "noche", rating: 4.8, detail: "Apartamento de dos habitaciones con cocina y terraza.", image: "https://images.unsplash.com/photo-1601918774946-25832a4be0d6?auto=format&fit=crop&w=1200&q=80", badge: "Cancelación demo" },
  { id: "stay-valencia", type: "Alojamientos", title: "Mirador Mediterráneo", place: "Valencia", price: 148, unit: "noche", rating: 4.7, detail: "Estancia luminosa cerca de la costa.", image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=80", badge: "Disponible demo" },
  { id: "flight-mad-par", type: "Vuelos", title: "Madrid → París", place: "Salida Madrid", price: 89, unit: "por viajero", rating: 4.6, detail: "Horario y tarifa de demostración; la emisión requiere proveedor aéreo autorizado.", image: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80", badge: "Tarifa demo" },
  { id: "tour-alpujarra", type: "Tours", title: "Ruta de pueblos blancos", place: "Granada", price: 54, unit: "por persona", rating: 4.9, detail: "Excursión de día completo con guía local.", image: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&q=80", badge: "Salida confirmable" },
  { id: "activity-kayak", type: "Actividades", title: "Kayak al atardecer", place: "Cádiz", price: 32, unit: "por persona", rating: 4.8, detail: "Actividad costera para grupos pequeños.", image: "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1200&q=80", badge: "Cupo demo" },
  { id: "transfer-airport", type: "Traslados", title: "Traslado aeropuerto → centro", place: "Barcelona", price: 39, unit: "por vehículo", rating: 4.7, detail: "Servicio punto a punto; disponibilidad ilustrativa.", image: "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1200&q=80", badge: "Recogida demo" },
  { id: "car-electric", type: "Coche", title: "Compacto eléctrico", place: "Málaga", price: 42, unit: "por día", rating: 4.5, detail: "Coche de alquiler con kilometraje y depósito de demostración.", image: "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1200&q=80", badge: "Flota demo" },
  { id: "bus-coast", type: "Autobús", title: "Costa → ciudad", place: "Valencia", price: 14, unit: "por viajero", rating: 4.4, detail: "Ruta interurbana de demostración.", image: "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1200&q=80", badge: "Asiento demo" }
];
const PROVIDER_STEPS = ["Cuenta", "Producto", "Datos", "Fotos", "Tarifa", "Revisión"];
function ProviderOnboarding({ onClose }: { onClose: () => void }) { const [step, setStep] = useState(0); const [done, setDone] = useState(false); const [draft, setDraft] = useState<Draft>({ providerType: "Alojamiento", name: "", location: "", description: "", photos: [], price: "120", availability: "Solicitud previa", rules: "" }); const set = (key: keyof Draft, value: any) => setDraft((current) => ({ ...current, [key]: value })); const valid = () => step === 0 ? true : step === 1 ? Boolean(draft.providerType) : step === 2 ? Boolean(draft.name && draft.location && draft.description) : step === 3 ? draft.photos.length > 0 : step === 4 ? Number(draft.price) > 0 : true; if (done) return <section className="mx-auto max-w-4xl px-5 py-10"><div className="rounded-3xl bg-white p-8 shadow-xl"><p className="text-sm font-bold text-blue-600">PROVEEDOR · DEMO</p><h1 className="mt-2 text-3xl font-black">Tu ficha está lista para revisión.</h1><p className="mt-3 text-slate-600">{draft.name} se ha guardado como {draft.providerType.toLowerCase()} de demostración. No se publica ni se activan inventario real, cobro, emisión, pagos, verificaciones o liquidaciones hasta conectar proveedores y contratos autorizados.</p><div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-emerald-900"><b>Estado: pendiente de revisión</b><p className="mt-1 text-sm">Puedes seguir completando contenido, disponibilidad y condiciones desde el panel de proveedor.</p></div><button onClick={onClose} className="mt-7 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">Volver al marketplace</button></div></section>; return <section className="mx-auto max-w-4xl px-5 py-8"><div className="flex items-center justify-between"><div><p className="text-sm font-bold text-blue-600">CENTRO DE PROVEEDORES</p><h1 className="mt-1 text-3xl font-black">Publica tu oferta de viaje paso a paso.</h1></div><button onClick={onClose} className="rounded-xl border px-4 py-2 font-bold">Cerrar</button></div><p className="mt-3 text-slate-600">Alta guiada de demostración para anfitriones, operadores de tours, actividades, traslados, coche y autobús.</p><div className="mt-6 grid gap-2 md:grid-cols-6">{PROVIDER_STEPS.map((label, index) => <button key={label} onClick={() => index <= step && setStep(index)} className={"rounded-xl p-3 text-left text-xs font-bold " + (index === step ? "bg-slate-950 text-white" : index < step ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{index + 1}. {label}</button>)}</div><div className="mt-6 rounded-3xl bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{PROVIDER_STEPS[step]}</h2>{step === 0 && <div className="mt-5 rounded-2xl bg-slate-50 p-5 text-slate-600"><b className="text-slate-900">Perfil de proveedor</b><p className="mt-2 text-sm">La identificación, titularidad, fiscalidad, seguros y datos de liquidación se incorporan solo cuando exista un proceso de verificación y un proveedor autorizado.</p></div>}{step === 1 && <div className="mt-5 grid gap-3 md:grid-cols-2">{["Alojamiento", "Tour", "Actividad", "Traslado", "Coche", "Autobús"].map((type) => <button key={type} onClick={() => set("providerType", type)} className={"rounded-2xl border p-5 text-left font-bold " + (draft.providerType === type ? "border-blue-600 bg-blue-50 text-blue-700" : "")}>{type}<small className="mt-1 block font-normal text-slate-500">Catálogo configurable</small></button>)}</div>}{step === 2 && <div className="mt-5 grid gap-4"><label className="text-sm font-bold">Nombre de la oferta<input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Experiencia junto al mar" className="mt-2 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">Destino o zona<input value={draft.location} onChange={(e) => set("location", e.target.value)} placeholder="Málaga" className="mt-2 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">Descripción<textarea value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="Describe tu oferta" className="mt-2 min-h-28 w-full rounded-xl border p-3 font-normal" /></label></div>}{step === 3 && <div className="mt-5"><label className="text-sm font-bold">Fotos<input type="file" accept="image/*" multiple onChange={(e) => set("photos", Array.from(e.target.files || []).map((file) => file.name))} className="mt-2 block w-full rounded-xl border p-3 font-normal" /></label><p className="mt-3 text-sm text-slate-500">{draft.photos.length ? draft.photos.length + " archivo(s) preparados para revisión demo." : "Selecciona imágenes. El almacenamiento real requiere controles de contenido y protección de datos."}</p></div>}{step === 4 && <div className="mt-5 grid gap-4 md:grid-cols-2"><label className="text-sm font-bold">Precio desde (€)<input type="number" min="1" value={draft.price} onChange={(e) => set("price", e.target.value)} className="mt-2 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">Disponibilidad<select value={draft.availability} onChange={(e) => set("availability", e.target.value)} className="mt-2 w-full rounded-xl border p-3 font-normal"><option>Solicitud previa</option><option>Confirmación automática (demo)</option></select></label></div>}{step === 5 && <div className="mt-5"><label className="text-sm font-bold">Normas y condiciones<textarea value={draft.rules} onChange={(e) => set("rules", e.target.value)} placeholder="Cancelación, requisitos, horario y condiciones" className="mt-2 min-h-28 w-full rounded-xl border p-3 font-normal" /></label><div className="mt-4 rounded-2xl bg-slate-50 p-5 text-sm text-slate-600"><b className="text-slate-900">Resumen</b><p className="mt-2">{draft.providerType} · {draft.name || "Nombre pendiente"} · {draft.location || "Destino pendiente"} · desde {draft.price} € (demo)</p></div></div>}<div className="mt-8 flex justify-between"><button disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))} className="rounded-xl border px-5 py-3 font-bold disabled:opacity-40">Anterior</button><button disabled={!valid()} onClick={() => step === PROVIDER_STEPS.length - 1 ? setDone(true) : setStep((current) => current + 1)} className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-40">{step === PROVIDER_STEPS.length - 1 ? "Enviar a revisión" : "Continuar"}</button></div></div></section>; }
export default function App(){ const [type,setType]=useState("Alojamientos"); const [place,setPlace]=useState(""); const [travellers,setTravellers]=useState("2 viajeros"); const [screen,setScreen]=useState<"search"|"itinerary"|"provider">("search"); const [saved,setSaved]=useState<Product[]>([]); const [request,setRequest]=useState<Product | null>(null); const results=useMemo(()=>PRODUCTS.filter((item)=>item.type===type && (item.place+item.title).toLowerCase().includes(place.toLowerCase())),[type,place]); const save=(item:Product)=>setSaved((current)=>current.some((x)=>x.id===item.id)?current.filter((x)=>x.id!==item.id):[...current,item]); if(screen==="provider") return <main className="min-h-screen bg-slate-50 text-slate-900"><ProviderOnboarding onClose={()=>setScreen("search")} /></main>; return <main className="min-h-screen bg-slate-50 text-slate-900"><header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4"><button onClick={()=>setScreen("search")} className="text-xl font-black">viaja<span className="text-blue-600">.local</span></button><nav className="flex items-center gap-3 text-sm font-bold"><button onClick={()=>setScreen("search")}>Explorar</button><button onClick={()=>setScreen("itinerary")}>Mi itinerario ({saved.length})</button><button onClick={()=>setScreen("provider")}>Publica tu oferta</button></nav></div></header>{screen==="search"?<><section className="bg-slate-950 text-white"><div className="mx-auto max-w-7xl px-5 py-10"><p className="text-sm font-bold text-blue-300">MERCADO TURÍSTICO MULTIPRODUCTO · DEMO</p><h1 className="mt-2 max-w-3xl text-4xl font-black">Diseña tu próximo viaje desde un solo lugar.</h1><div className="mt-7 flex flex-wrap gap-2">{TYPES.map((item)=><button key={item} onClick={()=>setType(item)} className={"rounded-full px-4 py-2 text-sm font-bold " + (type===item?"bg-white text-slate-950":"bg-white/10 text-white")}>{item}</button>)}</div><div className="mt-5 grid gap-3 rounded-2xl bg-white p-3 text-slate-900 md:grid-cols-4"><input value={place} onChange={(e)=>setPlace(e.target.value)} placeholder="¿A dónde quieres ir?" className="rounded-xl border p-3"/><input type="date" className="rounded-xl border p-3"/><select value={travellers} onChange={(e)=>setTravellers(e.target.value)} className="rounded-xl border p-3"><option>1 viajero</option><option>2 viajeros</option><option>Familia</option></select><button className="rounded-xl bg-blue-600 p-3 font-bold text-white">Buscar</button></div></div></section><section className="mx-auto max-w-7xl px-5 py-8"><div className="flex items-end justify-between"><div><h2 className="text-3xl font-black">{type} disponibles</h2><p className="mt-1 text-sm text-slate-500">Precios, cupos, horarios, cancelaciones y condiciones son datos de demostración.</p></div><button onClick={()=>setScreen("provider")} className="rounded-xl border px-4 py-2 text-sm font-bold">Soy proveedor</button></div><div className="mt-6 grid gap-5 md:grid-cols-2">{results.map((item)=><article key={item.id} className="overflow-hidden rounded-2xl bg-white shadow-sm"><img src={item.image} alt="" className="h-48 w-full object-cover"/><div className="p-5"><div className="flex justify-between gap-4"><div><p className="text-sm text-slate-500">{item.place} · {item.badge}</p><h3 className="text-xl font-black">{item.title}</h3></div><button onClick={()=>save(item)} className="text-xl">{saved.some((x)=>x.id===item.id)?"♥":"♡"}</button></div><p className="mt-3 text-sm text-slate-600">{item.detail}</p><div className="mt-4 flex items-center justify-between"><span className="rounded-lg bg-emerald-50 px-2 py-1 text-sm font-bold text-emerald-700">{item.rating} ★</span><span><b>{item.price} €</b><small className="text-slate-500"> / {item.unit}</small></span></div><button onClick={()=>{setRequest(item);setScreen("itinerary")}} className="mt-5 w-full rounded-xl bg-slate-950 py-3 font-bold text-white">Añadir al itinerario</button></div></article>)}{results.length===0&&<div className="rounded-2xl border bg-white p-8 text-slate-600">No hay resultados para esta búsqueda de demostración. Prueba otro destino o producto.</div>}</div></section></>:<section className="mx-auto max-w-4xl px-5 py-10"><div className="rounded-3xl bg-white p-7 shadow-sm"><p className="text-sm font-bold text-blue-600">ITINERARIO · DEMO</p><h1 className="mt-2 text-3xl font-black">Tu selección de viaje</h1>{request?<div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-emerald-900"><b>Solicitud preparada: {request.title}</b><p className="mt-1 text-sm">No se ha realizado cobro, emisión ni confirmación real. El siguiente paso sería conectar inventario, pagos y condiciones de proveedores autorizados.</p></div>:<p className="mt-4 text-slate-600">Guarda productos para organizar tu itinerario.</p>}<div className="mt-6 grid gap-3">{saved.map((item)=><div key={item.id} className="flex items-center justify-between rounded-xl border p-4"><span><b>{item.title}</b><small className="block text-slate-500">{item.type} · {item.place}</small></span><b>{item.price} €</b></div>)}</div><button onClick={()=>setScreen("search")} className="mt-8 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">Seguir explorando</button></div></section>}<footer className="mx-auto max-w-7xl px-5 py-8 text-xs text-slate-500">Este marketplace es una demostración de Maris AI: no ofrece inventario, reservas, pagos, emisiones ni liquidaciones reales hasta completar las integraciones autorizadas.</footer></main>; }
`;
  }

  private async generateEditMilestone(
    milestone: EditMilestone,
    currentFiles: Map<string, string>,
    generatedByMilestoneId: Map<number, GeneratedEditMilestone>,
  ): Promise<GeneratedEditMilestone> {
    const deterministicTravel = this.deterministicTravelMarketplaceEdit(milestone);
    if (deterministicTravel) return { ...milestone, code: deterministicTravel };
    const compactEdit = (this.options.maxMilestonesOverride ?? Number.POSITIVE_INFINITY) <= 8;
    const MAX_ATTEMPTS = compactEdit ? 1 : 3;
    const milestoneTimeoutMs = compactEdit ? 90_000 : 120_000;
    let lastError: unknown;
    const editContext = this.buildEditContext(milestone, currentFiles, generatedByMilestoneId);
    const qualityBlock = this.options.backendQualityPrompt && !milestone.filePath.startsWith("src/") && !milestone.filePath.includes("apps/web")
      ? `\n\nQUALITY BAR OBLIGATORIO (mismas reglas que el resto de la plataforma):\n${this.options.backendQualityPrompt.slice(0, 6000)}`
      : "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // El SDK puede ignorar el AbortSignal mientras espera su primer chunk.
        // Race garantiza que una edición no deje el job en silencio hasta que
        // el watchdog global lo reinicie desde cero.
        const abortController = new AbortController();
        const abortId = setTimeout(() => abortController.abort(), milestoneTimeoutMs);
        let response: any;
        try {
          const streamPromise = zocoia.messages.stream({
            model: this.options.model!,
            max_tokens: 16000,
            system: [
              { type: "text", text: EDIT_CODE_AGENT_STATIC, cache_control: { type: "ephemeral" } },
              { type: "text", text: qualityBlock || "Sin reglas de calidad adicionales para este archivo." },
            ] as any,
            messages: [{
              role: "user",
              content: `Acción: ${milestone.action === "create_file" ? "CREAR archivo nuevo" : "MODIFICAR archivo existente"}.\nArchivo: ${milestone.filePath}\n\nCambio a aplicar: ${milestone.description}\n\n${editContext}\n\nDevuelve SOLO el código COMPLETO y final del archivo, sin explicaciones ni markdown.`,
            }],
          }, { signal: abortController.signal as any }).finalMessage();
          let hardTimeoutId: NodeJS.Timeout | undefined;
          const hardTimeout = new Promise<never>((_, reject) => {
            hardTimeoutId = setTimeout(() => reject(new Error(`Timeout duro de ${milestoneTimeoutMs / 1000}s en hito de edición ${milestone.id} (${milestone.filePath})`)), milestoneTimeoutMs + 1_000);
          });
          try {
            response = await Promise.race([streamPromise, hardTimeout]);
          } finally {
            if (hardTimeoutId) clearTimeout(hardTimeoutId);
          }
        } finally {
          clearTimeout(abortId);
        }
        let code = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
        // Limpiar fences de markdown que el modelo a veces añade a pesar de la instrucción
        code = code.replace(/^```(?:tsx?|jsx?|typescript|javascript)?\n?/, "").replace(/\n?```$/, "").trim();
        // Validación de contenido mínimo: un archivo React válido tiene al menos
        // ~50 chars. Si es más corto, el modelo devolvió solo un comentario o texto parcial.
        const isReactFile = /\.(t|j)sx$/.test(milestone.filePath);
        const minLength = isReactFile ? 50 : 20;
        if (code && code.length >= minLength) return { ...milestone, code };
        if (code && code.length > 0 && code.length < minLength) {
          console.warn(`⚠️ Hito ${milestone.id} (${milestone.filePath}): respuesta demasiado corta (${code.length} chars) — reintentando...`);
        }
        throw new Error("Respuesta vacía o demasiado corta del modelo");
      } catch (error) {
        lastError = error;
        console.error(`⚠️ Hito de edición ${milestone.id} (${milestone.filePath}) — intento ${attempt}/${MAX_ATTEMPTS}:`, error);
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    // Regla de entrega: una edición nunca puede inventar un archivo temporal.
    // Para un archivo existente conservamos el original, que es la única
    // degradación segura. Para un archivo nuevo abortamos el orquestador: el
    // flujo superior conserva la revisión actual y puede intentar el respaldo
    // completo en memoria, pero ningún placeholder llega a persistirse.
    console.warn(`⚠️ Hito de edición ${milestone.id} (${milestone.filePath}) agotó ${MAX_ATTEMPTS} intento(s).`);
    if (milestone.action === "modify_file") {
      const originalContent = currentFiles.get(milestone.filePath);
      if (originalContent && originalContent.trim().length > 0) {
        console.warn(`  → Conservando contenido original de ${milestone.filePath} (${originalContent.length} chars).`);
        return { ...milestone, code: originalContent };
      }
    }
    throw new Error(`No se pudo generar de forma completa el archivo nuevo ${milestone.filePath}; se aborta la edición para preservar la versión anterior.`);
  }

  /**
   * FASE 2 (modo edición): aplica los hitos planificados por planProjectEdit
   * sobre el bundle actual, archivo por archivo, sin reescribir nada que no
   * esté en el plan. Devuelve el bundle de frontend y backend actualizados,
   * con el MISMO formato (// === FILE: ...) que el resto del sistema espera,
   * para que sea compatible con runTestingAgent y con el resto del pipeline
   * de validación/guardado sin ningún cambio en esas partes.
   *
   * No hay capas secuenciales por dependencia de arquitectura como en
   * buildProjectIncremental (data → backend → frontend) porque una edición
   * no construye un sistema desde cero — sí se respeta dependsOn entre
   * hitos de la MISMA edición, ejecutando en orden topológico simple por
   * lotes (igual que el agrupado por capas, pero con una sola "capa" lógica
   * cuyo orden lo da dependsOn en vez de un layer fijo).
   */
  async editProjectIncremental(
    userPrompt: string,
    previousFrontendCode: string,
    previousBackendCode: string,
    wsNotificationCallback: Function,
  ): Promise<{ frontendCode: string; backendCode: string; milestones: GeneratedEditMilestone[] }> {
    const frontendFiles = this.parseBundleToMap(previousFrontendCode || "");
    const backendFiles = this.parseBundleToMap(previousBackendCode || "");
    const allCurrentFiles = new Map<string, string>([...frontendFiles, ...backendFiles]);

    const { milestones } = await this.planProjectEdit(userPrompt, {
      frontend: Array.from(frontendFiles.keys()),
      backend: Array.from(backendFiles.keys()),
    });

    if (!milestones.length) {
      throw new Error("El planificador de edición no devolvió ningún hito — no se pudo determinar qué archivos modificar.");
    }

    wsNotificationCallback({
      status: `🚀 Plan de edición aprobado: ${milestones.length} archivo(s) a ${milestones.filter((m) => m.action === "modify_file").length > 0 ? "modificar/crear" : "crear"}. Iniciando edición por hitos...`,
      progress: 8,
    });

    const generatedByMilestoneId = new Map<number, GeneratedEditMilestone>();
    const concurrency = this.options.concurrencyPerLayer!;
    const remaining = [...milestones];
    const done = new Set<number>();
    let completed = 0;
    const total = milestones.length;

    // Orden topológico simple por lotes: en cada vuelta, procesa todos los
    // hitos cuyas dependencias ya están resueltas (o no tienen ninguna),
    // hasta concurrency a la vez — mismo patrón de ejecución por lotes que
    // buildProjectIncremental usa por capa, aplicado aquí por dependencia
    // real en vez de por capa fija (una edición no tiene capas de
    // arquitectura, solo el orden que el propio plan declaró).
    let safetyCounter = 0;
    while (remaining.length > 0 && safetyCounter < total + 1) {
      safetyCounter++;
      const ready = remaining.filter((m) => m.dependsOn.every((id) => done.has(id)));
      // Si ningún hito restante tiene sus dependencias listas (plan con
      // referencias circulares o a IDs inexistentes), procesa el resto
      // igualmente para no bloquear la edición — mejor entregar algo que
      // quedarse colgado por un plan mal formado.
      const batchSource = ready.length > 0 ? ready : remaining;
      const batch = batchSource.slice(0, concurrency);

      const results = await Promise.all(batch.map(async (m) => {
        const currentProgress = 8 + Math.round((completed / total) * 90);
        const emitHeartbeat = () => {
          try {
            const output = wsNotificationCallback({
              status: `🧠 Editando ${m.filePath}…`,
              progress: currentProgress,
              step: m.id,
            });
            if (output && typeof output.catch === "function") void output.catch(() => undefined);
          } catch { /* el latido no debe impedir la edición */ }
        };
        // Un único evento de inicio; el heartbeat de la cola sigue vivo de
        // forma silenciosa y no vuelve a registrar el mismo archivo cada 15 s.
        emitHeartbeat();
        return await this.generateEditMilestone(m, allCurrentFiles, generatedByMilestoneId);
      }));
      for (const generated of results) {
        generatedByMilestoneId.set(generated.id, generated);
        // El archivo recién editado/creado pasa a estar disponible como
        // contexto "actual" también para hitos siguientes que dependan de
        // su ruta sin haberlo declarado explícitamente como dependsOn.
        allCurrentFiles.set(generated.filePath, generated.code);
        done.add(generated.id);
        completed++;
        wsNotificationCallback({
          status: `🔨 ${generated.filePath} ${generated.action === "create_file" ? "creado" : "actualizado"}.`,
          progress: 8 + Math.round((completed / total) * 90),
          step: generated.id,
          previewAvailable: true,
        });
        const idx = remaining.findIndex((m) => m.id === generated.id);
        if (idx !== -1) remaining.splice(idx, 1);
      }
    }

    wsNotificationCallback({ status: "🚀 ¡Edición completa aplicada e integrada!", progress: 100, step: total });

    // Reconstruye los bundles finales: cada archivo tocado/creado se aplica
    // sobre su mapa de origen (frontend o backend) según dónde estaba antes,
    // o según convención de ruta si es nuevo (apps/web o src/ del lado
    // frontend se asume frontend; el resto, backend) — el resto de archivos
    // NO tocados se conserva exactamente igual que estaba.
    const allGenerated = Array.from(generatedByMilestoneId.values());
    for (const generated of allGenerated) {
      // ENCONTRADO en producción con un caso real (app de clínica dental,
      // edición con 22 hitos): archivos backend NUEVOS como
      // "src/routes/auth.ts", "src/lib/auth.ts" o
      // "src/services/notifications.ts" se clasificaban como FRONTEND —
      // confirmado con código real ejecutado replicando exactamente esta
      // situación. La condición anterior, para archivos NUEVOS (no
      // presentes ya en frontendFiles ni backendFiles), solo comprobaba
      // si la ruta empezaba con "src/" — pero TANTO el frontend como el
      // backend de un proyecto Maris AI usan su propio "src/" interno
      // (src/App.tsx del lado web, src/index.ts o src/routes/*.ts del
      // lado servidor), así que ese patrón por sí solo no distingue nada
      // real. Archivos de servidor terminaban mezclados dentro del bundle
      // de frontendCode, corrompiendo su estructura de forma silenciosa
      // (cada archivo individual sigue compilando bien, solo está en el
      // bundle equivocado) — esto explica por qué el Testing Agent y QA
      // decían "todo bien" mientras Claude Vision veía un 404 puro: el
      // 404 no viene de un error de sintaxis, viene de que el frontend
      // real entregado al navegador no es el que se generó.
      // FIX: para archivos NUEVOS, primero se comprueban patrones de ruta
      // INEQUÍVOCAMENTE de backend (rutas de servidor, servicios, prisma,
      // middlewares, lib/auth del lado servidor) antes de asumir frontend
      // por defecto — el patrón de frontend ya no basta por sí solo.
      const looksLikeBackendPath = /^(src\/routes\/|src\/services\/|src\/middlewares?\/|src\/controllers\/|src\/models\/|prisma\/|apps\/api\/|server\/|api\/)/.test(generated.filePath)
        || /^src\/(index|server|app)\.(ts|js)$/.test(generated.filePath)
        || /^src\/lib\/(auth|db|database|prisma)\.(ts|js)$/.test(generated.filePath);
      const isFrontendFile = frontendFiles.has(generated.filePath)
        || (!backendFiles.has(generated.filePath) && !looksLikeBackendPath && /^(src\/|apps\/web\/|public\/|index\.html)/.test(generated.filePath));
      if (isFrontendFile) {
        frontendFiles.set(generated.filePath, generated.code);
      } else {
        backendFiles.set(generated.filePath, generated.code);
      }
    }

    return {
      frontendCode: this.mapToBundle(frontendFiles),
      backendCode: this.mapToBundle(backendFiles),
      milestones: allGenerated,
    };
  }
}
