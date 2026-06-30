/**
 * critical-fixes.test.ts
 *
 * GUARDIÁN de los fixes críticos del 29 de junio de 2026 — a petición
 * EXPLÍCITA del usuario tras una sesión completa de investigación y
 * reparación real del ciclo de generación/edición/Testing Visual de
 * Maris AI (motivo: una app de clínica dental real terminaba con pantalla
 * negra/404 y el sistema decía "completado con éxito" sin haberlo
 * verificado de verdad).
 *
 * QUÉ HACE ESTE ARCHIVO: lee el código fuente real de los módulos
 * afectados y comprueba que cada fix sigue presente, buscando patrones
 * textuales concretos y verificables — NO opiniones, NO "spirit of the
 * fix", hechos objetivos que solo pueden ser ciertos si el código de hoy
 * sigue ahí. Si alguno de estos checks falla, es una señal real y fuerte
 * de que una edición futura (sin querer) deshizo una protección real
 * contra un bug que YA OCURRIÓ EN PRODUCCIÓN con un cliente real.
 *
 * QUÉ NO HACE: no impide que el código se edite. Si en el futuro decides
 * deliberadamente cambiar uno de estos comportamientos, edita también el
 * check correspondiente aquí — este archivo está pensado para detectar
 * ediciones ACCIDENTALES de otras partes del código que rompan esto sin
 * que nadie se dé cuenta, no para bloquear cambios intencionados.
 *
 * Ejecutar: pnpm --filter @workspace/api-server run test:critical-fixes
 * (ya incluido en `pnpm run test`, que se ejecuta como parte de `pnpm run
 * build` — ver prebuild en package.json — así que un build roto en este
 * sentido falla ANTES de llegar a producción, no después.)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(__dirname, "..");
const SERVICES_SRC = join(__dirname, "../../../../lib/services/src");
const APPFORGE_SRC = join(__dirname, "../../../appforge/src");

let failed = 0;
function check(label: string, cond: boolean, hint?: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
    if (hint) console.error(`    → ${hint}`);
  }
}

function readSrc(relativeToApiSrc: string): string {
  return readFileSync(join(API_SRC, relativeToApiSrc), "utf-8");
}

function readServicesSrc(relativeToServicesSrc: string): string {
  return readFileSync(join(SERVICES_SRC, relativeToServicesSrc), "utf-8");
}

function readAppforgeSrc(relativeToAppforgeSrc: string): string {
  return readFileSync(join(APPFORGE_SRC, relativeToAppforgeSrc), "utf-8");
}

console.log("=== Guardián de fixes críticos (29 jun 2026) ===\n");

// ───────────────────────────────────────────────────────────────────────────
// FIX 1 (be7e130): reglas de wouter en EDIT_CODE_AGENT_STATIC — sin esto, el
// CoreOrchestrator en modo edición genera código con patrones de
// react-router-dom que no existen en wouter, rompiendo el build entero.
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readServicesSrc("CoreOrchestrator.ts");
  check(
    "FIX 1: EDIT_CODE_AGENT_STATIC menciona la regla de ORDEN DEL ROUTER",
    /ORDEN DEL ROUTER/.test(src),
    "El prompt de edición por hitos debe seguir exigiendo que el catch-all 404 vaya al FINAL del <Switch> — sin esto vuelve el bug de pantalla en blanco/404 que afectó a la app de clínica dental real.",
  );
  check(
    "FIX 1: EDIT_CODE_AGENT_STATIC prohíbe useNavigate/useHistory de wouter",
    /useNavigate.*NO TIENE|NO TIENE.*useNavigate|wouter NO TIENE/.test(src),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 2 (be7e130): el endpoint de Testing Visual es asíncrono (VisualTestJob),
// no síncrono — sin esto, Railway corta la conexión a los 5 minutos y se
// pierde el trabajo del ciclo de autofix aunque el servidor sí lo completara.
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readSrc("routes/deployment.ts");
  check(
    "FIX 2: POST /visual-test crea un VisualTestJob y responde 202 (asíncrono)",
    /VisualTestJob.*\.create/.test(src) && /res\.status\(202\)/.test(src),
    "Si el endpoint vuelve a ser síncrono, las generaciones complejas (varios ciclos de CoreOrchestrator) pueden perderse cuando Railway corta la conexión a los 5 minutos.",
  );
  check(
    "FIX 2: existe el endpoint GET de polling /visual-test/:jobId",
    /\/apps\/:appId\/visual-test\/:jobId/.test(src),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 3 (b493b7c): comparación de score antes/después de cada parche, con
// reversión automática si empeora — sin esto, el Autofix puede terminar en
// un estado VISUALMENTE PEOR que el inicial sin que nadie lo note.
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readSrc("lib/visualTester.ts");
  const regressionMentions = (src.match(/REGRESSED the visual score/g) || []).length;
  check(
    "FIX 3: hay detección de regresión de score en AMBOS caminos (runVisualTester y applyVisualFixesAndSave)",
    regressionMentions >= 2,
    `Se esperaban al menos 2 menciones de 'REGRESSED the visual score' (una por cada ciclo de autofix), se encontraron ${regressionMentions}. Sin esta comparación, un parche puede arreglar lo pedido y a la vez empeorar otra cosa sin que el sistema lo note ni revierta.`,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 4 (19d2074): el evaluador visual se ESPERA (await) antes de marcar el
// job como succeeded — sin esto, el cliente ve "completado con éxito" con
// la app todavía rota, mientras la reparación real ocurre en segundo plano
// DESPUÉS de que el cliente ya está mirando la pantalla negra.
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readSrc("routes/apps.ts");
  check(
    "FIX 4: runAutoEvaluator se llama con `await` (bloqueante) antes del succeeded",
    /visualEvalResult\s*=\s*await runAutoEvaluator/.test(src),
    "Si vuelve a ser '.catch()' sin await (fire-and-forget), el job se marca succeeded ANTES de que la verificación visual real termine — exactamente el bug que afectó a la app de clínica dental real.",
  );
  // Verificación negativa: confirma que NO existe el patrón roto antiguo
  // (runAutoEvaluator(...).catch(...) sin que el resultado se asigne/espere).
  const brokenPattern = /runAutoEvaluator\(\{[\s\S]{0,800}?\}\)\.catch\(/;
  check(
    "FIX 4: NO ha vuelto el patrón fire-and-forget antiguo (runAutoEvaluator(...).catch(...) sin await)",
    !brokenPattern.test(src),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 5 (6b0cf85): errores reales de runtime (AppRuntimeError) inyectados
// como contexto verificado en ediciones — sin esto, el agente vuelve a
// adivinar la causa del bug solo a partir de la descripción en texto del
// cliente, ignorando los errores JavaScript reales ya capturados.
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readSrc("routes/apps.ts");
  check(
    "FIX 5: se consulta AppRuntimeError y se inyecta como contexto en ediciones",
    /runtimeErrorContextBlock/.test(src) && /AppRuntimeError/.test(src),
  );
  check(
    "FIX 5: el contexto de errores reales se incluye en enrichedJobPrompt",
    /enrichedJobPrompt\s*=\s*job\.prompt[\s\S]{0,200}runtimeErrorContextBlock/.test(src),
    "Si runtimeErrorContextBlock deja de concatenarse en enrichedJobPrompt, la lectura de errores reales se vuelve inútil — se consulta pero nunca llega al modelo.",
  );

  // El schema NO debe volver a estar duplicado con campos distintos — ver
  // el commit 6b0cf85 para el contexto completo de por qué esto importa.
  const repairSrc = readSrc("lib/autoRepairAgent.ts");
  check(
    "FIX 5b: autoRepairAgent.ts ya NO duplica su propia definición de AppRuntimeError",
    !/const AppRuntimeErrorSchema = new Schema/.test(repairSrc),
    "AppRuntimeError debe vivir SOLO en lib/db/schema/index.ts. Si vuelve a duplicarse aquí con campos distintos, el modelo que 'gane' el registro en mongoose.models depende del orden de carga del proceso — riesgo real de inconsistencia silenciosa.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 6 (52d4621): patchBundleMultiFile conectado en tester.ts como respaldo
// cuando el patcher simple (16K tokens, una sola respuesta) falla — sin
// esto, cualquier reparación que toque varios archivos a la vez se rinde
// inmediatamente con "El reparador no pudo generar una solución".
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readSrc("lib/tester.ts");
  check(
    "FIX 6: tester.ts importa y usa patchBundleMultiFile como respaldo",
    /import\s*\{[^}]*patchBundleMultiFile[^}]*\}/.test(src) && /await patchBundleMultiFile\(/.test(src),
    "Sin este respaldo, reparaciones que afectan a varios archivos a la vez (caso real: 6 errores en distintos componentes) fallan en silencio en el primer intento, sin segunda oportunidad.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 7 (8b4b71b): progreso REAL del CoreOrchestrator conectado (no un
// callback vacío) — sin esto, el panel de Testing Visual se queda
// congelado en el mismo mensaje durante varios minutos mientras el
// CoreOrchestrator SÍ trabaja de fondo, indistinguible de estar colgado.
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readSrc("lib/visualTester.ts");
  check(
    "FIX 7: applyVisualFixes acepta onProgress y lo conecta a editProjectIncremental (no '() => {}' vacío)",
    /onProgress\?:\s*\(note:\s*string\)\s*=>\s*void/.test(src) &&
      /editProjectIncremental\(\s*structuralPrompt,\s*bundle,\s*opts\.backendCode \|\| "",\s*\(update: any\) => \{/.test(src),
    "Si editProjectIncremental vuelve a recibir un callback vacío, el progreso real (archivo por archivo) deja de reportarse y el panel parece atascado aunque esté trabajando.",
  );
  check(
    "FIX 7: runVisualTester propaga su propio report() hacia applyVisualFixes",
    /onProgress:\s*\(note\)\s*=>\s*\{\s*void report\(/.test(src),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 8 (9e67eba): validaciones estructurales de router en validate.ts —
// detectan catch-all 404 mal posicionado, ruta raíz ausente, y export/import
// mismatch ANTES del evaluador visual. Sin esto, apps con routing roto
// pasan testing + QA sin issues y solo se detectan en la evaluación visual
// (un ciclo completo extra de 25 segundos + llamada a Claude Vision).
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readSrc("lib/validate.ts");
  check(
    "FIX 8a: validate.ts tiene detectCatchAllBeforeRoutes",
    /function detectCatchAllBeforeRoutes/.test(src) && /detectCatchAllBeforeRoutes\(vfs\)/.test(src),
    "Sin esta validación, una <Route path='*'> o <Route component={NotFound}> colocada ANTES de las rutas reales en <Switch> pasa testing sin errores y causa 404 en todas las páginas — exactamente el bug de la app de clínica dental.",
  );
  check(
    "FIX 8b: validate.ts tiene detectMissingRootRoute",
    /function detectMissingRootRoute/.test(src) && /detectMissingRootRoute\(vfs\)/.test(src),
    "Sin esta validación, una app sin <Route path='/'> muestra blank page en la URL base sin que el testing lo detecte.",
  );
  check(
    "FIX 8c: validate.ts tiene detectExportImportMismatch",
    /function detectExportImportMismatch/.test(src) && /detectExportImportMismatch\(vfs\)/.test(src),
    "Sin esta validación, un import default que apunta a un archivo sin export default produce un componente undefined que no renderiza nada — sin error de build.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 9: Prevención de archivos vacíos + soporte de <Routes> en validaciones
// El CoreOrchestrator ya no lanza error fatal si un hito falla 3 veces —
// usa el contenido original (modify_file) o un placeholder mínimo (create_file).
// Las validaciones de routing ahora cubren tanto <Switch> (wouter) como
// <Routes> (react-router-dom v6), que es el router que usan muchas apps.
// ───────────────────────────────────────────────────────────────────────────
{
  const orchestratorSrc = readServicesSrc("CoreOrchestrator.ts");
  check(
    "FIX 9a: CoreOrchestrator generateEditMilestone tiene fallback (no lanza error fatal)",
    /usando fallback tras/.test(orchestratorSrc) && /Conservando contenido original/.test(orchestratorSrc),
    "Sin este fallback, un solo hito que falle 3 veces mata toda la edición y deja archivos vacíos o la app incompleta.",
  );
  check(
    "FIX 9b: CoreOrchestrator generateMilestone (creación) tiene fallback con placeholder",
    /usando placeholder tras.*intentos fallidos/.test(orchestratorSrc),
    "Sin placeholder, un hito de creación que falle produce un archivo vacío que rompe el build.",
  );
  check(
    "FIX 9c: parseBundleToMap filtra archivos vacíos/insignificantes",
    /contenido vacío\/insignificante/.test(orchestratorSrc),
    "Sin este filtro, archivos con contenido vacío (parse mal formado) se propagan al bundle final.",
  );

  const validateSrc = readSrc("lib/validate.ts");
  check(
    "FIX 9d: detectCatchAllBeforeRoutes soporta <Routes> (react-router-dom v6)",
    /hasRoutes/.test(validateSrc) && /<Routes/.test(validateSrc),
    "Sin soporte de <Routes>, apps que usan react-router-dom v6 no se validan y el catch-all mal posicionado pasa desapercibido.",
  );
  check(
    "FIX 9e: detectMissingRootRoute soporta <Routes> y prop 'index'",
    /\bindex\b/.test(validateSrc) && /<Routes/.test(validateSrc),
    "react-router-dom v6 usa <Route index> como ruta raíz — sin detectarla, se reporta un falso positivo.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 11: reglas de wouter en CODE_AGENT_STATIC (construcción NUEVA por
// hitos) — distinto del FIX 1, que protege EDIT_CODE_AGENT_STATIC (modo
// EDICIÓN). ENCONTRADO investigando por qué un proyecto NUEVO (no una
// edición) seguía generando 404 persistente a pesar de que el camino de
// edición ya tenía estas reglas desde hoy mismo: CODE_AGENT_STATIC (el
// prompt que genera CADA archivo individual en buildProjectIncremental,
// usado en CUALQUIER generación nueva que active el sistema de hitos)
// nunca tuvo estas reglas — solo el de edición las tenía. El modelo podía
// generar perfectamente el primer archivo con el router bien ordenado,
// pero al generar un componente de navegación o un archivo posterior sin
// estas reglas, introducir el mismo patrón roto sin que nada lo evitara.
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readServicesSrc("CoreOrchestrator.ts");
  // Extracción robusta: desde el inicio de CODE_AGENT_STATIC hasta el
  // siguiente límite conocido del archivo (interface Milestone) — más
  // fiable que intentar parsear backticks escapados dentro del propio
  // template literal con una regex (probado real: una regex con [^\`]
  // se corta en el primer backtick ESCAPADO real del contenido, dando
  // un bloque incompleto y falsos negativos).
  const startIdx = src.indexOf("const CODE_AGENT_STATIC = `");
  const endIdx = src.indexOf("interface Milestone");
  const codeAgentBlock = startIdx !== -1 && endIdx !== -1 ? src.slice(startIdx, endIdx) : "";
  check(
    "FIX 11: CODE_AGENT_STATIC (construcción nueva) se encontró y delimitó correctamente",
    codeAgentBlock.length > 0,
    "No se pudo extraer el contenido de CODE_AGENT_STATIC — revisa si su declaración o el límite siguiente (interface Milestone) cambiaron de forma, y actualiza este check.",
  );
  check(
    "FIX 11: CODE_AGENT_STATIC (construcción nueva) menciona ROUTER ORDER",
    /ROUTER ORDER/.test(codeAgentBlock),
    "Sin esta regla en el prompt de CONSTRUCCIÓN NUEVA (no edición), proyectos nuevos generados por hitos pueden seguir produciendo 404 persistente porque el modelo nunca recibió la instrucción de poner el catch-all al final del <Switch>.",
  );
  check(
    "FIX 11: CODE_AGENT_STATIC (construcción nueva) prohíbe useNavigate/useHistory de wouter",
    /wouter has NO/.test(codeAgentBlock),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 12: el PM Agent REPARA de verdad los blockers que detecta, en vez de
// solo registrarlos en el log y entregar la app igual. ENCONTRADO a
// petición del usuario investigando "qué agente le falta al sistema":
// de los 6 agentes documentados en emergentAgentPipeline.ts (Architect,
// Designer, Developer, Integration, PM, Patcher), solo PM Agent se
// invocaba alguna vez en el pipeline real — y solo UNA VEZ, sin reparar
// nada con lo que encontraba. runInvisibleRepairLoop (Patcher Agent +
// re-validación en bucle, hasta 3 ciclos) existía completo y nunca se
// llamaba desde ningún punto real. Además, el propio Patcher Agent dentro
// de ese bucle tenía el mismo problema de truncamiento ya corregido hoy
// en tester.ts (enviaba solo 12000 chars de entrada y pedía el bundle
// COMPLETO en una sola respuesta de 8192 tokens) — sustituido por
// patchBundleMultiFile al conectarlo.
// ───────────────────────────────────────────────────────────────────────────
{
  const appsSrc = readSrc("routes/apps.ts");
  check(
    "FIX 12: apps.ts usa runInvisibleRepairLoop (bucle real) en vez de una sola llamada a runPMAgent",
    /runInvisibleRepairLoop/.test(appsSrc),
    "Sin esto, el PM Agent vuelve a detectar blockers y solo registrarlos en el log sin repararlos — la app se entrega al cliente con problemas conocidos sin corregir.",
  );
  const pipelineSrc = readSrc("lib/emergentAgentPipeline.ts");
  check(
    "FIX 12: runInvisibleRepairLoop usa patchBundleMultiFile (no el patcher de una sola pasada limitado a 12000 chars)",
    /patchBundleMultiFile/.test(pipelineSrc),
    "Sin esto, el Patcher Agent vuelve a ver solo una fracción del bundle y a intentar devolver el proyecto completo en una única respuesta — riesgo real de truncamiento en proyectos con varios archivos.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 13: editProjectIncremental clasifica correctamente archivos NUEVOS de
// backend (rutas, servicios, prisma) en vez de asumir frontend solo porque
// la ruta empieza con "src/". ENCONTRADO con un log real de producción
// (edición de 22 hitos en una app de clínica dental): el evaluador visual
// veía 404 puro en TODAS las resoluciones mientras Testing Agent y QA
// decían "todo bien" — confirmado con código real ejecutado que archivos
// backend nuevos como "src/routes/auth.ts" se clasificaban como FRONTEND,
// contaminando ese bundle de forma silenciosa (cada archivo individual
// sigue compilando bien, solo está en el bundle equivocado — ningún
// validador de sintaxis puede detectar esto).
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readServicesSrc("CoreOrchestrator.ts");
  check(
    "FIX 13: editProjectIncremental detecta rutas inequívocas de backend (looksLikeBackendPath) antes de asumir frontend por defecto",
    /looksLikeBackendPath/.test(src),
    "Sin esto, archivos backend NUEVOS (src/routes/*.ts, src/services/*.ts, prisma/*) cuya ruta empiece con 'src/' se clasifican como frontend, contaminando ese bundle de forma silenciosa — 404 persistente sin que ningún validador de sintaxis lo detecte.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 14: la detección de App.tsx (en tester.ts para enlaces rotos, y en
// apps.ts para hasRecognizableAppComponent) usa la RUTA exacta del archivo,
// no si su CONTENIDO menciona el texto "App.tsx" en cualquier lugar.
// ENCONTRADO simulando una generación real para un cliente (salón de
// apuestas, plataforma completa, tier ultra): replicado con código real
// ejecutado que un comentario normal en OTRO archivo ("se usa dentro de
// App.tsx") hace que el detector tome ESE archivo como si fuera el router
// real — sin rutas reales que extraer, TODOS los enlaces internos
// legítimos se marcan como "rotos" sin estarlo. Esto coincide exactamente
// con el patrón real reportado por el usuario: "404 en todos los
// archivos" mientras Testing Agent/QA dicen "todo bien".
// ───────────────────────────────────────────────────────────────────────────
{
  const testerSrc = readSrc("lib/tester.ts");
  check(
    "FIX 14a: tester.ts busca App.tsx por RUTA declarada exacta, no por contenido (.includes)",
    /const appFile = files\.find\(f => \{[\s\S]{0,200}declaredPath/.test(testerSrc),
    "Sin esto, un comentario en cualquier otro archivo que mencione 'App.tsx' puede hacer que el detector de enlaces rotos analice el archivo equivocado, marcando TODOS los enlaces reales como rotos.",
  );
  const appsSrc = readSrc("routes/apps.ts");
  check(
    "FIX 14b: apps.ts (hasRecognizableAppComponent) busca App.tsx por RUTA declarada exacta, no por contenido",
    /const exactAppFile = frontendFiles\.find\(\(f\) => \{[\s\S]{0,200}declaredPath/.test(appsSrc),
    "Mismo bug que en tester.ts, distinto punto de uso: decide si runTestingAgent se ejecuta siquiera sobre el componente raíz real.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 15: la regla de transacciones atómicas (crítica para dinero/saldo/
// inventario) ya no depende de que el planificador haya usado la palabra
// exacta "transaccional" en la descripción del hito — el generador de
// código la evalúa por sí mismo en base al TIPO de operación (saldo,
// inventario, escrituras relacionadas), tanto en construcción nueva
// (CODE_AGENT_STATIC) como en edición (EDIT_CODE_AGENT_STATIC, que antes
// no tenía esta regla en absoluto).
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readServicesSrc("CoreOrchestrator.ts");
  check(
    "FIX 15a: la regla de transacciones ya no depende de que el hito 'mencione' la palabra transaccional",
    !/Si el hito menciona operaciones multi-tabla o transaccionales/.test(src),
    "El patrón frágil original solo activaba la regla si el planificador usaba ciertas palabras — un hito de 'Apuestas y boleto' o 'Depósitos' implica dinero real igual que uno que lo dijera explícitamente.",
  );
  check(
    "FIX 15b: CODE_AGENT_STATIC (construcción nueva) exige evaluar SALDO/INVENTARIO por sí mismo",
    /EVALÚALA TÚ MISMO/.test(src) && /SALDO\/BALANCE\/CRÉDITO/.test(src),
  );
  const editBlockMatch = src.match(/const EDIT_CODE_AGENT_STATIC = `([\s\S]*?)REGLAS CRÍTICAS DE LA PLATAFORMA/);
  check(
    "FIX 15c: EDIT_CODE_AGENT_STATIC (edición) también exige evaluar transacciones por sí mismo",
    !!editBlockMatch && /TRANSACCIONES ATÓMICAS/.test(editBlockMatch[1]),
    "El camino de EDICIÓN no tenía ninguna regla de transacciones — un cliente editando para añadir un módulo de pagos/apuestas no recibía ninguna protección contra inconsistencias de saldo.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 16: el Patcher Agent multi-archivo (patchBundleMultiFile) ya no pide
// el contenido de cada archivo envuelto en JSON (riesgo real de
// truncamiento total con archivos grandes) ni recorta el resumen de
// errores a un tamaño insuficiente para proyectos con muchos blockers.
// ENCONTRADO con el propio panel de diagnóstico (jobDiagnosis.ts, FIX
// anterior) en un caso real de producción: PM Agent detectó 23-24
// blockers, pero el plan final solo contenía 1 archivo, y ESE archivo
// tampoco se generó — "0/1 archivo(s) completados" en bucle.
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readSrc("lib/shared-agents.ts");
  check(
    "FIX 16a: generateSingleFileContent pide texto plano, no JSON envuelto ({\"content\":...})",
    !/Output STRICT JSON only: \{"content"/.test(src) && /Output EXCLUSIVELY the raw file content/.test(src),
    "Pedir el contenido de un archivo grande envuelto en JSON añade overhead de escapado real — si el modelo se queda sin tokens a mitad, la respuesta se corta con una comilla sin cerrar y extractJsonObject devuelve null SIN recuperar nada, indistinguible de cualquier otro fallo.",
  );
  check(
    "FIX 16b: planMultiFileRepair ya no recorta errorSummary a 2000 chars (insuficiente para proyectos con muchos blockers)",
    !/errorSummary\.slice\(0, 2000\)/.test(src),
    "Con 23+ archivos bloqueantes listados en el errorSummary, 2000 caracteres corta la lista a mitad — el planificador solo ve una fracción de los archivos que de verdad necesitan arreglo.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 17: planMultiFileRepair usa un formato de etiquetas tipo XML
// (<file><path>...</path>...</file>) en vez de JSON para el plan de
// reparación. ENCONTRADO en producción (mismo caso real de 23-24
// blockers): con un plan de 25-30 archivos, un corte de tokens a mitad de
// la lista en JSON invalida el array ENTERO — extractJsonObject exige un
// '{'...'}' balanceado de principio a fin, así que ni los archivos
// listados ANTES del corte se recuperan. Con bloques <file> independientes,
// un corte a mitad del archivo N nunca invalida los N-1 anteriores que sí
// cerraron completos.
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readSrc("lib/shared-agents.ts");
  check(
    "FIX 17a: existe extractResilientFilePlan que recupera bloques <file> cerrados aunque la respuesta se corte",
    /export function extractResilientFilePlan/.test(src),
    "Sin esta función, un plan de reparación grande sigue dependiendo de extractJsonObject, que pierde el plan ENTERO si se corta a mitad — incluso los archivos listados antes del corte.",
  );
  check(
    "FIX 17b: planMultiFileRepair usa extractResilientFilePlan, no extractJsonObject, para el plan",
    /const plan = extractResilientFilePlan\(raw\)/.test(src),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 18: generateSingleFileContent (Patcher Agent de un solo archivo)
// también exige el orden correcto del catch-all en <Switch> — mismo bug
// real investigado hoy (404 en todas las rutas, compila perfecto, ningún
// linter lo detecta) pero en un PUNTO DISTINTO del sistema: si este
// Patcher reescribe App.tsx para reparar cualquier otro problema, sin
// esta regla podía mover o recrear el catch-all en la posición
// incorrecta sin que nada se lo advirtiera.
// ───────────────────────────────────────────────────────────────────────────
{
  const src = readSrc("lib/shared-agents.ts");
  check(
    "FIX 18: generateSingleFileContent exige que el catch-all sea SIEMPRE el último hijo de <Switch>",
    /CRITICAL ROUTING RULE — CATCH-ALL ORDER/.test(src),
    "Sin esta regla, el Patcher Agent de un solo archivo puede reescribir App.tsx (para reparar cualquier otro problema) y mover el catch-all a una posición incorrecta — la app compila perfecto pero muestra 404 en todas las rutas.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 19: Gating Question Block (estilo Emergent.sh) conectado a la
// infraestructura de pausa/reanudación que YA EXISTÍA completa en
// producción (GenerationJob.awaitingApproval / checkpointData /
// approvedFacets, y el endpoint POST /jobs/:id/approve) pero que NINGÚN
// punto real de generateApp disparaba jamás. Antes de lanzar un proyecto
// NUEVO y ULTRA-COMPLEJO directo a la generación por hitos, se pregunta
// una vez por los 3 puntos ciegos que más rompen proyectos reales
// (base de datos, roles/auth, integraciones de pago) — y, al reanudar,
// las respuestas reales del cliente se inyectan como contexto del
// sistema, no se vuelven a adivinar.
// ───────────────────────────────────────────────────────────────────────────
{
  const appsSrc = readSrc("routes/apps.ts");
  check(
    "FIX 19a: existe generateGatingQuestions, que analiza el prompt y genera hasta 3 preguntas críticas",
    /async function generateGatingQuestions/.test(appsSrc),
  );
  check(
    "FIX 19b: generateApp dispara la pausa real (phase: \"awaiting_technical_clarification\") para proyectos nuevos ultra-complejos",
    /if \(!previous && isUltraComplex && jobId\)/.test(appsSrc) && /phase: "awaiting_technical_clarification"/.test(appsSrc),
    "Sin esto, la infraestructura de pausa (awaitingApproval/checkpointData/approvedFacets) sigue completa en la base de datos pero sin ningún punto real que la dispare — exactamente como estaba antes de este fix.",
  );
  check(
    "FIX 19c: las respuestas reales del cliente se inyectan como contexto al reanudar, no se vuelven a adivinar",
    /DETALLES TÉCNICOS CONFIRMADOS POR EL USUARIO/.test(appsSrc),
  );
  const jobsSrc = readSrc("routes/jobs.ts");
  check(
    "FIX 19d: POST /jobs/:id/approve acepta y guarda las respuestas reales (answers), no solo el nombre de la faceta",
    /const \{ facet, answers \} = req\.body/.test(jobsSrc),
    "Sin esto, el sistema sabe QUE el cliente respondió pero no QUÉ respondió — la pausa no tendría ningún efecto real sobre la generación posterior.",
  );
  const appDetailSrc = readAppforgeSrc("pages/app-detail.tsx");
  check(
    "FIX 19e: el frontend muestra un formulario real con las preguntas (GatingQuestionsForm), no solo el botón genérico 'Aprobar y continuar'",
    /function GatingQuestionsForm/.test(appDetailSrc) && /isAwaitingTechnicalClarification/.test(appDetailSrc),
    "Sin este formulario, el botón genérico ya existente para OTRA faceta distinta ('structure') aprobaría la pausa de clarificación técnica con un solo clic, sin que el cliente viera ni respondiera ninguna de las 3 preguntas — rompiendo el propósito completo del Gating Question Block.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 20: Degradación inteligente para usuarios gratuitos (hasEverPaid=false)
// en proyectos ultra-complejos — limita hitos, ciclos de reparación PM Agent
// y rondas del evaluador visual, sin afectar a usuarios que han pagado.
// MOTIVACIÓN: cálculo real con datos de código confirmó que un proyecto
// ultra (24 hitos) cuesta 3.24-5.64€ en tokens a Anthropic, y el 100%
// de ese coste lo asume el dueño de la plataforma cuando el usuario es
// gratuito (nunca ha comprado créditos reales) y no convierte a pago.
// ───────────────────────────────────────────────────────────────────────────
{
  const servicesSrc = readServicesSrc("CoreOrchestrator.ts");
  check(
    "FIX 20a: CoreOrchestratorOptions tiene maxMilestonesOverride para limitar hitos de usuarios gratuitos",
    /maxMilestonesOverride\?: number/.test(servicesSrc),
  );
  check(
    "FIX 20b: CoreOrchestrator aplica maxMilestonesOverride priorizando las capas más críticas",
    /layerPriority.*data.*backend-core.*frontend-core/.test(servicesSrc),
  );
  const appsSrc = readSrc("routes/apps.ts");
  check(
    "FIX 20c: apps.ts pasa maxMilestonesOverride al CoreOrchestrator para usuarios gratuitos",
    /isDegradedFreeTier.*FREE_USER_MAX_MILESTONES|maxMilestonesOverride: isDegradedFreeTier/.test(appsSrc),
  );
  check(
    "FIX 20e: el límite de 7 hitos es ABSOLUTO para usuarios gratuitos — NO depende de isUltraComplex",
    /^\s*const isDegradedFreeTier = !hasEverPaid;/m.test(appsSrc) && !/^\s*const isDegradedFreeTier = !hasEverPaid && isUltraComplex/m.test(appsSrc),
    "BUG REAL confirmado en producción con el Job 6a43569d: si isDegradedFreeTier dependía de isUltraComplex, un prompt corto que el router NO clasificaba como ultra-complejo (ej. \"app para grabar libros\") podía entrar igualmente al CoreOrchestrator (la condición de activación usa isUltraComplex con un OR, no un AND) sin ningún límite de hitos — el Arquitecto generó un plan de 23 archivos para un usuario gratuito, 46 llamadas a Sonnet en 2 minutos, la mayoría fallando por saturación de contexto, entregando una app con importaciones fantasma y pantalla en blanco.",
  );
  const pipelineSrc = readSrc("lib/emergentAgentPipeline.ts");
  check(
    "FIX 20d: runInvisibleRepairLoop acepta maxCycles para limitar reparaciones gratuitas",
    /maxCycles\?: number/.test(pipelineSrc),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 21: Orquestación híbrida de modelos — Haiku para cambios cosméticos
// El clasificador de intenciones ya existía (classifyChatIntent) pero no
// tomaba ninguna decisión de modelo. Ahora devuelve isPurelyVisual:true
// cuando el cambio es EXCLUSIVAMENTE CSS/cosmético, y el job de edición usa
// claude-haiku-4-5 en ese caso (¼ del precio de Sonnet). Haiku falla en
// generación de código complejo (confirmado en producción con el comentario
// "haiku generaba código incompleto" en selectAgentModelPlan), pero resuelve
// ediciones de pocas líneas CSS/Tailwind perfectamente — es el único caso
// donde se activa. Todos los fallbacks devuelven isPurelyVisual: false para
// garantizar que en caso de duda siempre se usa Sonnet.
// ───────────────────────────────────────────────────────────────────────────
{
  const classifierSrc = readSrc("lib/intentClassifier.ts");
  check(
    "FIX 21a: ClassifiedIntent tiene el campo isPurelyVisual: boolean",
    /isPurelyVisual: boolean/.test(classifierSrc),
  );
  check(
    "FIX 21b: parseClassifierJson lee isPurelyVisual del JSON del modelo y solo lo activa para intent=edit",
    /intent === "edit" && parsed\?\.isPurelyVisual === true/.test(classifierSrc),
  );
  const appsSrc = readSrc("routes/apps.ts");
  check(
    "FIX 21c: el job de edición usa claude-haiku-4-5 cuando isPurelyVisual es true",
    /classified\.isPurelyVisual.*claude-haiku-4-5/.test(appsSrc),
    "Sin esto, todos los cambios cosméticos siguen usando Sonnet al precio completo aunque Haiku los resuelva igual de bien.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 22: Directiva de "Fachada Interactiva" inyectada en el prompt del
// Agente Arquitecto para usuarios gratuitos. Antes: el arquitecto diseñaba
// siempre un plan de 20+ hitos (modelos, controllers, servicios, middleware)
// que luego se truncaba mecánicamente a 7, generando dependencias rotas y
// una app incompleta sin impacto visual. Ahora: cuando maxMilestonesOverride
// está activo (usuario gratuito con proyecto ultra-complejo), el prompt del
// arquitecto recibe instrucciones específicas para diseñar desde el principio
// una estructura minimalista orientada a impacto visual inmediato: backend
// Express de un solo archivo, mockData.ts con datos simulados realistas,
// imágenes reales de Unsplash, Tailwind intensivo. El usuario gratuito ve
// una app atractiva y funcional en segundos; si quiere la arquitectura
// completa, pasa a plan de pago.
// ───────────────────────────────────────────────────────────────────────────
{
  const servicesSrc = readServicesSrc("CoreOrchestrator.ts");
  check(
    "FIX 22a: el Agente Arquitecto recibe la directiva de Fachada Interactiva cuando maxMilestonesOverride está activo",
    /FREE_TIER_ARCHITECT_DIRECTIVE/.test(servicesSrc) && /Fachada Interactiva/.test(servicesSrc),
  );
  check(
    "FIX 22b: la directiva prohíbe URLs de imágenes inventadas y exige Unsplash con palabras clave reales",
    /unsplash\.com.*w=800/.test(servicesSrc) || /images\.unsplash\.com/.test(servicesSrc),
    "Sin URLs de Unsplash reales, la app del usuario gratuito mostrará imágenes rotas — exactamente lo contrario del 'impacto visual inmediato' que busca la estrategia de conversión.",
  );
  check(
    "FIX 22c: el prompt del arquitecto gratuito prohíbe el backend separado en múltiples archivos",
    /UN SOLO archivo.*apps\/api\/src\/index\.ts|backend.*UN SOLO archivo/.test(servicesSrc),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 23: Testing Agent bajo demanda — "Revisión profunda de errores" (30
// créditos), disparada SOLO por el cliente desde un botón en su app ya
// generada. Distinto del Testing Agent automático (runTestingAgent), que
// ya corría siempre gratis dentro del flujo normal de generación/edición.
// ───────────────────────────────────────────────────────────────────────────
{
  const appsSrc = readSrc("routes/apps.ts");
  check(
    "FIX 23a: existe el endpoint POST /apps/:id/deep-test con coste fijo de 30 créditos",
    /DEEP_TEST_COST = 30/.test(appsSrc) && /\/apps\/:id\/deep-test/.test(appsSrc),
  );
  check(
    "FIX 23b: runJobById bifurca a la rama deep_test sin pasar por generateApp",
    /jobKind === "deep_test"/.test(appsSrc),
    "Sin esta bifurcación, el job de revisión profunda entraría al pipeline completo de generación, cobrando 30 créditos pero ejecutando algo distinto a lo prometido.",
  );
  const appforgeSrc = readAppforgeSrc("pages/app-detail.tsx");
  check(
    "FIX 23c: el frontend tiene el botón real conectado a useDeepTestApp",
    /useDeepTestApp/.test(appforgeSrc) && /handleDeepTest/.test(appforgeSrc),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 24: endpoint de deploy (que el botón del cliente ya llamaba pero no
// existía — 404) y dominios personalizados (DNS reales de Vercel, ya
// existentes en vercelDeploy.ts pero sin ningún endpoint HTTP) conectados,
// con control de pago real: solo usuarios con hasEverPaid=true pueden
// conectar un dominio. El acceso es histórico (no depende del plan actual),
// por decisión explícita del usuario.
// ───────────────────────────────────────────────────────────────────────────
{
  const appsSrc = readSrc("routes/apps.ts");
  check(
    "FIX 24a: existe el endpoint POST /apps/:id/deploy (el botón Deploy app del cliente llamaba a una ruta que no existía)",
    /router\.post\("\/apps\/:id\/deploy", requireAuth/.test(appsSrc),
  );
  check(
    "FIX 24b: POST /apps/:id/domain exige hasEverPaid=true (402 si no) antes de conectar un dominio personalizado",
    /if \(!dbUser\?\.hasEverPaid && !isAdmin\)/.test(appsSrc) && /status\(402\)/.test(appsSrc),
    "Sin este control, cualquier usuario gratuito podría conectar un dominio personalizado gratis, perdiendo el incentivo real de pago.",
  );
  check(
    "FIX 24c: existen GET y DELETE /apps/:id/domain conectados a las funciones reales de Vercel",
    /router\.get\("\/apps\/:id\/domain"/.test(appsSrc) && /router\.delete\("\/apps\/:id\/domain"/.test(appsSrc),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 25: cobro de deploy ESCALONADO por app (decisión explícita del
// usuario, 30 jun 2026): el primer deploy cobrado de cada app cuesta 5
// créditos (accesible con el regalo de bienvenida — cualquier usuario
// nuevo puede publicar su primera app), y a partir del segundo deploy de
// la MISMA app el coste sube automáticamente a 50 créditos — detectado
// solo por el sistema vía lastPaidDeployAt, sin que el cliente tenga que
// hacer nada. Con ventana de gracia de 5 minutos para re-deploys gratuitos.
// ───────────────────────────────────────────────────────────────────────────
{
  const appsSrc = readSrc("routes/apps.ts");
  check(
    "FIX 25a: existen las dos constantes de coste escalonado (5 el primer deploy, 50 a partir del segundo)",
    /const DEPLOY_COST_FIRST = 5;/.test(appsSrc) && /const DEPLOY_COST_SUBSEQUENT = 50;/.test(appsSrc),
    "Sin el escalonado, o se cobran 50 créditos desde el primer deploy (un usuario nuevo con el pack de bienvenida de 45 créditos no podría publicar su primera app nunca), o se cobran solo 5 créditos siempre (el negocio pierde el incentivo de conversión en deploys posteriores).",
  );
  check(
    "FIX 25a-bis: el endpoint detecta el primer deploy de cada app vía lastPaidDeployAt, no un contador global del usuario",
    /isFirstPaidDeploy = !lastPaidDeployAt/.test(appsSrc),
    "El precio escalonado es POR APP, no por usuario — un mismo usuario puede tener varias apps, y cada una tiene su propio 'primer deploy' a 5 créditos.",
  );
  check(
    "FIX 25b: existe la ventana de gracia de 5 minutos para re-deploys gratuitos",
    /DEPLOY_GRACE_WINDOW_MS = 5 \* 60 \* 1000/.test(appsSrc) && /withinGraceWindow/.test(appsSrc),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 26: stepper de deploy REAL en vivo (estilo Emergent.sh), 6 fases
// escritas en MongoDB en cada punto verídico de deployAppToVercel — sin
// temporizadores inventados. Conectado al DeployModal YA EXISTENTE (1043
// líneas, UI completa con proveedores de dominio) en vez de crear un
// componente nuevo en paralelo — ENCONTRADO durante la implementación: ese
// componente ya existía pero estaba mayormente desconectado del backend
// real (6 de sus 8 endpoints esperados no existían).
// ───────────────────────────────────────────────────────────────────────────
{
  const vercelDeploySrc = readSrc("lib/vercelDeploy.ts");
  check(
    "FIX 26a: deployAppToVercel escribe deployPhase en vivo en cada fase real del proceso",
    /deployPhase: "health_check"/.test(vercelDeploySrc) && /deployPhase: "done"/.test(vercelDeploySrc),
  );
  const appsSrc = readSrc("routes/apps.ts");
  check(
    "FIX 26b: POST /apps/:id/deploy es asíncrono (202 + lanza en segundo plano) y existe GET /apps/:id/deploy-status para el polling real",
    /status\(202\)\.json\(\{ status: "started"/.test(appsSrc) && /router\.get\("\/apps\/:id\/deploy-status"/.test(appsSrc),
  );
  const deployModalSrc = readAppforgeSrc("components/deploy-modal.tsx");
  check(
    "FIX 26c: DeployModal (componente ya existente) tiene la pantalla del stepper conectada al polling real de deploy-status",
    /DEPLOY_STEPS/.test(deployModalSrc) && /deploy-status/.test(deployModalSrc),
    "Sin esto, DeployModal seguiría esperando la URL directamente en la respuesta del POST, que ahora es asíncrono (202) — el deploy parecería fallar silenciosamente.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 27: las 4 piezas que DeployModal (componente ya existente) llamaba
// desde hace tiempo pero que NUNCA EXISTIERON en el backend — devolvían
// 404 silencioso. code-review (revisión de calidad con IA, informativa, no
// repara nada), DELETE /apps/:id/deploy (apagar el deployment real en
// Vercel), y los 3 endpoints custom-domain (alias finos sobre las mismas
// funciones reales de /apps/:id/domain, sin duplicar lógica de negocio).
// Watermark NO está en este fix porque ya estaba completo y funcional
// desde antes — confirmado durante la investigación, no requería cambios.
// ───────────────────────────────────────────────────────────────────────────
{
  const appsSrc = readSrc("routes/apps.ts");
  check(
    "FIX 27a: existe POST /apps/:id/code-review, la pieza informativa que faltaba de DeployModal",
    /router\.post\("\/apps\/:id\/code-review"/.test(appsSrc) && /const CODE_REVIEW_COST = 10;/.test(appsSrc),
  );
  check(
    "FIX 27b: existe DELETE /apps/:id/deploy (apagar el deployment real en Vercel, no solo limpiar MongoDB)",
    /router\.delete\("\/apps\/:id\/deploy"/.test(appsSrc) && /shutDownVercelDeployment/.test(appsSrc),
  );
  check(
    "FIX 27c: existen los 3 endpoints custom-domain como alias de las mismas funciones reales de /apps/:id/domain",
    /router\.post\("\/apps\/:id\/custom-domain"/.test(appsSrc)
      && /router\.get\("\/apps\/:id\/custom-domain"/.test(appsSrc)
      && /router\.delete\("\/apps\/:id\/custom-domain"/.test(appsSrc),
  );
  const vercelDeploySrc = readSrc("lib/vercelDeploy.ts");
  check(
    "FIX 27d: existe shutDownVercelDeployment, que elimina el proyecto real en Vercel (no solo un campo en MongoDB)",
    /export async function shutDownVercelDeployment/.test(vercelDeploySrc),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// FIX 28: variables de entorno del cliente (API keys, secrets) cifradas de
// verdad (AES-256-GCM) y sincronizadas con Vercel en la fase real
// syncing_env. ENCONTRADO durante la implementación: la sección
// "Variables de entorno" de DeployModal mostraba un MOCKUP HARDCODEADO
// FALSO (3 líneas de texto fijo, sin ningún formulario real) — confirmado
// leyendo el código antes de tocar nada.
// ───────────────────────────────────────────────────────────────────────────
{
  const cryptoSrc = readSrc("lib/secretsCrypto.ts");
  check(
    "FIX 28a: existe el módulo de cifrado real (AES-256-GCM) para las variables de entorno del cliente",
    /aes-256-gcm/.test(cryptoSrc) && /export function encryptSecret/.test(cryptoSrc) && /export function decryptSecret/.test(cryptoSrc),
  );
  const vercelDeploySrc2 = readSrc("lib/vercelDeploy.ts");
  check(
    "FIX 28b: deployAppToVercel sincroniza de verdad las variables descifradas con la API de Vercel en la fase syncing_env",
    /decryptEnvVarsForDeploy/.test(vercelDeploySrc2) && /\/v10\/projects\/\$\{projectId\}\/env/.test(vercelDeploySrc2),
    "Sin esto, syncing_env era solo un marcador de progreso visual sin ninguna llamada real — las claves que el cliente guardara nunca llegarían a la app desplegada.",
  );
  const appsSrc2 = readSrc("routes/apps.ts");
  check(
    "FIX 28c: existen GET y PUT /apps/:id/env para que el cliente vea y guarde sus variables reales",
    /router\.get\("\/apps\/:id\/env"/.test(appsSrc2) && /router\.put\("\/apps\/:id\/env"/.test(appsSrc2),
  );
  const deployModalSrc2 = readAppforgeSrc("components/deploy-modal.tsx");
  check(
    "FIX 28d: DeployModal tiene el formulario real de variables de entorno, no el mockup hardcodeado",
    /loadEnvVars/.test(deployModalSrc2) && /handleSaveEnvVars/.test(deployModalSrc2) && !/VITE_CLERK_PUBLISHABLE_KEY.*••••••••••••/.test(deployModalSrc2),
    "Sin esto, el cliente vería siempre el mismo texto fijo falso ('VITE_CLERK_PUBLISHABLE_KEY = ••••••••••••') sin ningún campo real para introducir sus propias claves.",
  );
}

if (failed > 0) {
  console.error(`\n${failed} check(s) fallaron — uno o más fixes críticos del 29 jun 2026 parecen haberse revertido.`);
  console.error("Revisa el historial de commits de hoy (be7e130 en adelante) antes de continuar.");
  process.exit(1);
}
console.log("\nTodos los fixes críticos siguen en su sitio.");
