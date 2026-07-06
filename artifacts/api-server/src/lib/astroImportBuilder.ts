import { Sandbox } from "e2b";
import { isE2BEnabled } from "./e2bValidator";
import { logger } from "./logger";

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
    const exitCodeMatch = /exit code (\d+)/i.exec(err?.message || "");
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
    sandbox = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });
    logger.info({ sandboxId: sandbox.sandboxId, fileCount: Object.keys(files).length }, "E2B: sandbox creado para build de proyecto Astro importado");

    const writeEntries = Object.entries(files).map(([path, data]) => ({
      path: `${APP_DIR}/${path}`,
      data,
    }));
    await sandbox.files.write(writeEntries);

    const install = await runCommandCapturingOutput(
      sandbox,
      `cd ${APP_DIR} && npm install --no-audit --no-fund --loglevel=error`,
      INSTALL_TIMEOUT_MS,
    );
    if (install.exitCode !== 0) {
      logger.warn({ sandboxId: sandbox.sandboxId, exitCode: install.exitCode, stderr: install.stderr.slice(0, 2000) }, "Astro import: npm install falló");
      return {
        ok: false,
        installLog: install.stdout + "\n" + install.stderr,
        reason: `No se pudieron instalar las dependencias del proyecto (código de salida ${install.exitCode}). Revisa el log de instalación para más detalle.`,
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
        installLog: install.stdout,
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
        installLog: install.stdout,
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
    return { ok: true, files: outFiles, installLog: install.stdout, buildLog: build.stdout };
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
