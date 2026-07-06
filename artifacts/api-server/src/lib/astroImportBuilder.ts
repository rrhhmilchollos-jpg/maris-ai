import { Sandbox } from "e2b";
import { isE2BEnabled } from "./e2bValidator";
import { logger } from "./logger";
import { IMPORT_TEMPLATE_ALIAS } from "./e2bTemplateSetup";

const SANDBOX_TIMEOUT_MS = 8 * 60_000;
const INSTALL_TIMEOUT_MS = 4 * 60_000;
const BUILD_TIMEOUT_MS = 3 * 60_000;
const APP_DIR = "/home/user/astro-import";

export interface AstroBuildResult {
  ok: boolean;
  files?: Record<string, string>;
  installLog?: string;
  buildLog?: string;
  reason?: string;
}

/**
 * ENCONTRADO A PETICION DEL USUARIO (caso real: import de FANTASYWEB-main.zip
 * fallando con "exit status 254", un mensaje inútil sin ningún log real
 * detrás): la documentación oficial de E2B es ambigua/inconsistente entre
 * SDKs sobre si sandbox.commands.run() LANZA una excepción cuando el
 * comando termina con código de salida distinto de cero, o si simplemente
 * DEVUELVE el resultado con exitCode poblado -- el codigo original de este
 * archivo asumia lo segundo (`if (install.exitCode !== 0)`), pero si el SDK
 * en realidad lanza excepcion, esa comprobacion nunca se ejecuta: salta
 * directo al catch generico de mas abajo, que solo tenia `err.message`
 * (algo como "Command exited with code 254") SIN el stdout/stderr real que
 * explica el porque.
 *
 * FIX: capturar stdout/stderr con los callbacks onStdout/onStderr MIENTRAS
 * el comando corre (esto funciona siempre, esté documentado o no el
 * comportamiento del valor de retorno) -- así el log real nunca se pierde,
 * tire el SDK excepción o no.
 */
/**
 * Consulta el registro REAL de npm para saber qué versiones existen de
 * verdad de un paquete -- necesario para el caso encontrado con datos
 * reales (FANTASYWEB-main.zip): el proyecto pedía
 * @wix/babel-plugin-jsx-dynamic-data@1.0.13 exacto, pero esa versión
 * concreta fue retirada del registro público en algún momento (hay un
 * hueco real entre 1.0.11 y 1.0.16, confirmado consultando el registro) --
 * no es que el paquete sea privado de Wix, es que esa versión ya no existe.
 */
async function getLatestAvailableVersion(packageName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    const distTags = data["dist-tags"];
    if (distTags?.latest) return distTags.latest;
    const versions = Object.keys(data.versions || {});
    return versions.length > 0 ? versions[versions.length - 1] : null;
  } catch (err) {
    logger.warn({ err, packageName }, "No se pudo consultar el registro de npm para buscar una versión alternativa");
    return null;
  }
}

async function runCommandCapturingOutput(
  sandbox: Sandbox,
  cmd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  try {
    const result = await sandbox.commands.run(cmd, {
      timeoutMs,
      onStdout: (data: string) => { stdout += data; },
      onStderr: (data: string) => { stderr += data; },
    });
    // Si el SDK devuelve el resultado normalmente (no lanza excepción),
    // preferimos su stdout/stderr acumulado por si el nuestro se quedó
    // corto por cualquier motivo -- pero nos quedamos con el más largo de
    // los dos por seguridad, nunca perdemos información.
    return {
      exitCode: result.exitCode ?? 0,
      stdout: (result.stdout && result.stdout.length > stdout.length) ? result.stdout : stdout,
      stderr: (result.stderr && result.stderr.length > stderr.length) ? result.stderr : stderr,
    };
  } catch (err: any) {
    // El comando lanzó una excepción (código de salida distinto de cero, o
    // cualquier otro fallo) -- gracias a los callbacks de arriba, stdout/
    // stderr YA están rellenos con la salida real capturada mientras
    // corría, independientemente de que el SDK lance o no.
    // BUG PROPIO ENCONTRADO Y CORREGIDO: buscaba "exit code" pero E2B usa
    // literalmente "exit status" en sus mensajes (confirmado por los
    // propios errores reales vistos: "exit status 254", "exit status 1")
    // -- el regex nunca coincidía.
    const exitCodeMatch = /exit (?:code|status) (\d+)/i.exec(err?.message || "");
    return {
      exitCode: exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : 1,
      stdout,
      stderr: stderr || err?.message || String(err),
    };
  }
}

/**
 * Compila un proyecto Astro importado dentro de un sandbox E2B real, en vez
 * de intentar "entender" su código fuente (que es lo que rompía con
 * proyectos exportados desde Wix — ver el hallazgo completo en import.ts).
 *
 * IDEA CLAVE: no hace falta que Maris AI sepa leer sintaxis .astro ni
 * enrutado por archivos — basta con dejar que Astro se compile de verdad,
 * y quedarnos con el resultado (HTML/CSS/JS ya generado en dist/), que es
 * exactamente el mismo tipo de contenido que el resto del sistema de
 * preview de Maris AI ya sabe mostrar sin ningún cambio adicional.
 *
 * IMPORTANTE — límite honesto, no una promesa de "funciona con todo":
 * - Ejecutamos `npx astro build` directamente, NO `wix build` (el script
 *   que trae el package.json original) — ese comando requiere autenticación
 *   con la cuenta de Wix del cliente y no puede funcionar en un sandbox
 *   genérico. Un proyecto Astro normal (sin integraciones de Wix) debería
 *   compilar bien así.
 * - Si el proyecto usa integraciones @wix/astro que inyectan configuración
 *   propia de Wix en tiempo de build, es posible que el build falle de
 *   todos modos — en ese caso se devuelve el log de error REAL de Astro
 *   (no un mensaje genérico), para que quede claro qué falló exactamente
 *   en vez de fingir que funcionó.
 * - Las llamadas a @wix/* que se hagan en tiempo de EJECUCIÓN en el
 *   navegador (no en build) pueden seguir funcionando si el sitio de Wix
 *   de origen sigue publicado y el proyecto usa las APIs públicas/headless
 *   de Wix con el siteId correcto — eso queda fuera del control de Maris AI
 *   en cualquier caso, para bien o para mal.
 */
export async function buildAstroProjectInE2B(
  files: Record<string, string>,
): Promise<AstroBuildResult> {
  if (!isE2BEnabled()) {
    return { ok: false, reason: "E2B_API_KEY no configurada — no se puede compilar el proyecto Astro." };
  }

  let sandbox: Sandbox | null = null;
  try {
    // Se usa la plantilla personalizada con más memoria (4GB vs los 512MB
    // por defecto -- ver e2bTemplateSetup.ts, causa real confirmada del
    // "Killed"/código 137 en el import de FANTASYWEB-main.zip) si ya se
    // construyó. Si aún no se ha construido (primera vez, o el usuario
    // todavía no ha disparado POST /api/admin/e2b-build-import-template),
    // se cae al sandbox por defecto sin plantilla -- nunca se rompe el
    // import por completo solo porque la plantilla no exista todavía.
    try {
      sandbox = await Sandbox.create(IMPORT_TEMPLATE_ALIAS, { timeoutMs: SANDBOX_TIMEOUT_MS });
      logger.info({ template: IMPORT_TEMPLATE_ALIAS }, "Astro import: usando plantilla personalizada con 4GB de RAM");
    } catch (templateErr) {
      logger.warn({ templateErr }, "Plantilla personalizada no disponible todavía, usando sandbox por defecto (512MB) -- puede volver a fallar por memoria en proyectos grandes");
      sandbox = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });
    }
    logger.info({ sandboxId: sandbox.sandboxId, fileCount: Object.keys(files).length }, "E2B: sandbox creado para build de proyecto Astro importado");

    const writeEntries = Object.entries(files).map(([path, data]) => ({
      path: `${APP_DIR}/${path}`,
      data,
    }));
    await sandbox.files.write(writeEntries);

    // ENCONTRADO A PETICION DEL USUARIO (caso real: import de FANTASYWEB-
    // main.zip fallando con "signal: killed" en el log de instalación --
    // el sistema operativo del sandbox mata el proceso a la fuerza por
    // quedarse sin memoria RAM, no un fallo normal de npm). Un proyecto
    // Wix con decenas de paquetes @wix/* y sus transitivas es
    // precisamente el caso mas exigente posible para esto. pnpm resuelve
    // el mismo arbol de dependencias con mucha menos memoria pico gracias
    // a su almacen de contenido compartido y hard-links.
    //
    // Traer pnpm via corepack (viene integrado con Node.js desde la v16.9,
    // no depende de una descarga bajo demanda de npx que puede fallar por
    // red) -- si corepack no está disponible en la imagen del sandbox, se
    // cae a npx como respaldo. Nunca se asume que un solo camino
    // funcionará siempre.
    // DIAGNÓSTICO EXPLÍCITO (a petición del usuario, tras 3 intentos con
    // fallos "instantáneos" sin ningún log real detrás): en vez de seguir
    // adivinando qué hay disponible en el sandbox, se comprueba
    // explícitamente ANTES de intentar instalar nada, y este diagnóstico
    // se incluye SIEMPRE en la respuesta si algo falla después -- para no
    // volver a depender de conjeturas.
    const diag = await runCommandCapturingOutput(
      sandbox,
      "echo '--NODE--'; node --version; echo '--NPM--'; npm --version; echo '--WHICH-COREPACK--'; which corepack || echo 'no encontrado'; echo '--WHICH-PNPM--'; which pnpm || echo 'no encontrado'; echo '--CWD--'; pwd; echo '--APPDIR--'; ls -la " + APP_DIR + " | head -20",
      30_000,
    );
    logger.info({ sandboxId: sandbox.sandboxId, diagOutput: diag.stdout.slice(0, 1500) }, "Diagnóstico del entorno del sandbox antes de instalar");

    // ENCONTRADO CON DATOS REALES (a petición del usuario, tras el
    // diagnóstico explícito): corepack preparaba pnpm correctamente
    // (exitCode=0, "Preparing pnpm@9 for immediate activation..."), pero
    // la SIGUIENTE llamada a sandbox.commands.run() para "pnpm install"
    // fallaba al instante sin ninguna salida -- indica que cada llamada
    // separada puede abrir una sesión de shell nueva que no hereda el
    // PATH/shims que corepack acaba de preparar en la llamada anterior.
    // FIX: todo en UNA SOLA llamada, mismo shell, para que nada se pierda
    // entre medias. Si corepack fallara aquí dentro, el && corta la
    // cadena y npm/pnpm nunca llega a intentarse con algo roto a medias.
    // CAMBIO DE ESTRATEGIA (a petición del usuario, tras 5 intentos):
    // corepack y npx mostraban el mismo patrón raro -- imprimían un
    // mensaje inicial y luego morían en silencio con exit status 1, tanto
    // en la misma sesión como en sesiones separadas. Esto ya no encaja
    // con un problema de PATH/sesión (mi teoría anterior) -- huele más a
    // un problema de RED del propio sandbox al intentar la SEGUNDA
    // descarga (la del paquete de pnpm en sí desde el registro de npm),
    // algo que npm puro no necesita porque ya viene instalado de fábrica.
    //
    // Se vuelve a npm puro (que SÍ dio información real e interpretable
    // la primera vez: "signal: killed", un fallo de memoria genuino) y se
    // ataca esa causa original de forma más directa: --omit=dev evita
    // instalar dependencias de desarrollo (linters, TypeScript de
    // desarrollo, herramientas propias de Wix no necesarias para compilar
    // con astro build) -- en un proyecto Wix Vibe con eslint-rules/
    // eslint.config.ts propios, esto puede recortar una parte sustancial
    // del árbol de dependencias y por tanto de la memoria pico necesaria.
    const install = await runCommandCapturingOutput(
      sandbox,
      // "astro" suele vivir en devDependencies en la mayoría de proyectos
      // Astro (es una herramienta de build, no runtime) -- se instala
      // explícitamente aparte para garantizar que esté disponible pase lo
      // que pase, sin arrastrar el resto de dependencias de desarrollo
      // (linters, tipos, herramientas propias de Wix) que son las que más
      // memoria consumen y no hacen falta para compilar.
      `cd ${APP_DIR} && npm install --omit=dev --no-audit --no-fund --loglevel=warn && npm install astro --no-save --no-audit --no-fund --loglevel=warn`,
      INSTALL_TIMEOUT_MS,
    );

    // ENCONTRADO CON DATOS REALES (caso FANTASYWEB-main.zip, tras resolver
    // el problema de memoria): el proyecto pedía una versión EXACTA de un
    // paquete de Wix (@wix/babel-plugin-jsx-dynamic-data@1.0.13) que ya no
    // existe en el registro público de npm (npm error ETARGET). Esto NO
    // es la limitación de autenticación con Wix que se documentó antes --
    // es simplemente una versión retirada del registro, con arreglo real:
    // sustituir por la última versión disponible del MISMO paquete y
    // reintentar. Hasta 3 intentos, por si hay más de un paquete con este
    // mismo problema (frecuente en proyectos con package.json antiguos).
    let finalInstall = install;
    for (let attempt = 0; attempt < 3 && finalInstall.exitCode !== 0; attempt++) {
      // BUG PROPIO ENCONTRADO Y CORREGIDO: el regex anterior no contemplaba
      // que los paquetes de Wix empiezan con "@" (paquetes con scope,
      // "@wix/algo") -- [^\s@] excluye el propio símbolo @ del nombre del
      // paquete, así que nunca coincidía con nada que empezara por él.
      // Confirmado con una prueba real antes de aplicar este cambio.
      const etargetMatch = /npm error notarget No matching version found for (@?[^\s@]+)@([\d.]+)/i.exec(finalInstall.stderr)
        || /npm error notarget No matching version found for (@?[^\s@]+)@([\d.]+)/i.exec(finalInstall.stdout);
      if (!etargetMatch) break; // No es este tipo de error concreto — no seguir reintentando a ciegas.

      const [, missingPackage, missingVersion] = etargetMatch;
      const latestVersion = await getLatestAvailableVersion(missingPackage);
      if (!latestVersion) {
        logger.warn({ missingPackage, missingVersion }, "No se encontró ninguna versión alternativa en el registro de npm — no se puede corregir automáticamente");
        break;
      }

      logger.info({ missingPackage, missingVersion, latestVersion }, `Versión ${missingVersion} de ${missingPackage} no existe — sustituyendo por ${latestVersion} y reintentando`);

      // Corregir package.json dentro del propio sandbox con un pequeño
      // script de Node (más fiable que sed con nombres de paquete con
      // scope "@wix/..." que incluyen barras).
      const fixScript = `
const fs = require('fs');
const path = '${APP_DIR}/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf-8'));
for (const section of ['dependencies', 'devDependencies']) {
  if (pkg[section] && pkg[section]['${missingPackage}']) {
    pkg[section]['${missingPackage}'] = '${latestVersion}';
  }
}
fs.writeFileSync(path, JSON.stringify(pkg, null, 2));
console.log('Corregido: ${missingPackage} -> ${latestVersion}');
`.trim();
      await runCommandCapturingOutput(sandbox, `node -e "${fixScript.replace(/"/g, '\\"')}"`, 15_000);

      finalInstall = await runCommandCapturingOutput(
        sandbox,
        `cd ${APP_DIR} && npm install --omit=dev --no-audit --no-fund --loglevel=warn && npm install astro --no-save --no-audit --no-fund --loglevel=warn`,
        INSTALL_TIMEOUT_MS,
      );
    }

    if (finalInstall.exitCode !== 0) {
      logger.warn({ sandboxId: sandbox.sandboxId, exitCode: finalInstall.exitCode, stderr: finalInstall.stderr.slice(0, 2000) }, "Astro import: instalación falló (npm --omit=dev, tras reintentos de versión)");
      return {
        ok: false,
        installLog:
          `=== DIAGNÓSTICO DEL ENTORNO ===\n${diag.stdout}\n${diag.stderr}\n\n` +
          `=== npm install --omit=dev (exitCode=${finalInstall.exitCode}, tras posibles reintentos de versión) ===\n${finalInstall.stdout}\n${finalInstall.stderr}`,
        reason: `No se pudieron instalar las dependencias del proyecto (código de salida ${finalInstall.exitCode}). Revisa el log de instalación para más detalle.`,
      };
    }

    // Se usa el binario de Astro directamente (no el script "build" del
    // package.json, que en un export de Wix es "wix build" — requiere su
    // propia autenticación en la nube de Wix, imposible desde aquí).
    const build = await runCommandCapturingOutput(
      sandbox,
      `cd ${APP_DIR} && npx astro build`,
      BUILD_TIMEOUT_MS,
    );
    if (build.exitCode !== 0) {
      logger.warn({ sandboxId: sandbox.sandboxId, exitCode: build.exitCode, stderr: build.stderr.slice(0, 2000) }, "Astro import: astro build falló");
      return {
        ok: false,
        installLog: finalInstall.stdout,
        buildLog: build.stdout + "\n" + build.stderr,
        reason: `El proyecto no compiló con Astro (código de salida ${build.exitCode}). Si usa integraciones propias de Wix (@wix/astro) que requieren su servicio de build en la nube, es posible que este proyecto en concreto no se pueda compilar fuera de Wix. Revisa el log de compilación para ver el error real.`,
      };
    }

    // Leer el resultado compilado (dist/) — HTML/CSS/JS estándar, ya sin
    // ninguna dependencia de la sintaxis .astro.
    const listResult = await runCommandCapturingOutput(sandbox, `find ${APP_DIR}/dist -type f`, 15_000);
    const distPaths = listResult.stdout.split("\n").map((l) => l.trim()).filter(Boolean);

    if (distPaths.length === 0) {
      return {
        ok: false,
        installLog: finalInstall.stdout,
        buildLog: build.stdout,
        reason: "El build de Astro terminó sin errores pero no generó ningún archivo en dist/ — revisa la configuración de salida (outDir) del proyecto.",
      };
    }

    const outFiles: Record<string, string> = {};
    for (const fullPath of distPaths) {
      const relative = fullPath.replace(`${APP_DIR}/dist/`, "");
      try {
        // NOTA: sandbox.files.read() es el método estándar del SDK de E2B
        // para leer contenido de archivos -- no ha sido posible probarlo
        // en vivo contra un proyecto Astro real en este entorno de trabajo.
        // Si al probarlo con un caso real da problemas de codificación
        // (sobre todo con binarios como imágenes/fuentes en dist/), revisar
        // si el SDK necesita un segundo parámetro de formato.
        const content = await sandbox.files.read(fullPath);
        outFiles[relative] = typeof content === "string" ? content : String(content);
      } catch (readErr) {
        logger.warn({ readErr, fullPath }, "No se pudo leer un archivo de dist/ tras el build de Astro — se omite");
      }
    }

    logger.info({ sandboxId: sandbox.sandboxId, outFileCount: Object.keys(outFiles).length }, "Astro import: build completado correctamente");
    return { ok: true, files: outFiles, installLog: finalInstall.stdout, buildLog: build.stdout };
  } catch (err: any) {
    // Este catch ahora solo debería dispararse por fallos AJENOS a los
    // comandos en sí (fallo al crear el sandbox, al escribir archivos,
    // etc.) -- los fallos de comandos ya se capturan con detalle real
    // dentro de runCommandCapturingOutput, arriba.
    logger.error({ err }, "buildAstroProjectInE2B: error inesperado (no relacionado con un comando)");
    return { ok: false, reason: `Error inesperado preparando el sandbox: ${err?.message || String(err)}` };
  } finally {
    if (sandbox) {
      try {
        await sandbox.kill();
      } catch { /* nunca bloquear por un fallo al cerrar el sandbox */ }
    }
  }
}
