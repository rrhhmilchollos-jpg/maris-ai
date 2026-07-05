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

    const install = await sandbox.commands.run(
      `cd ${APP_DIR} && npm install --no-audit --no-fund --loglevel=error`,
      { timeoutMs: INSTALL_TIMEOUT_MS },
    );
    if (install.exitCode !== 0) {
      logger.warn({ sandboxId: sandbox.sandboxId, stderr: install.stderr.slice(0, 2000) }, "Astro import: npm install falló");
      return {
        ok: false,
        installLog: install.stdout + "\n" + install.stderr,
        reason: "No se pudieron instalar las dependencias del proyecto. Revisa el log de instalación para más detalle.",
      };
    }

    // Se usa el binario de Astro directamente (no el script "build" del
    // package.json, que en un export de Wix es "wix build" — requiere su
    // propia autenticación en la nube de Wix, imposible desde aquí).
    const build = await sandbox.commands.run(
      `cd ${APP_DIR} && npx astro build`,
      { timeoutMs: BUILD_TIMEOUT_MS },
    );
    if (build.exitCode !== 0) {
      logger.warn({ sandboxId: sandbox.sandboxId, stderr: build.stderr.slice(0, 2000) }, "Astro import: astro build falló");
      return {
        ok: false,
        installLog: install.stdout,
        buildLog: build.stdout + "\n" + build.stderr,
        reason: "El proyecto no compiló con Astro. Si usa integraciones propias de Wix (@wix/astro) que requieren su servicio de build en la nube, es posible que este proyecto en concreto no se pueda compilar fuera de Wix.",
      };
    }

    // Leer el resultado compilado (dist/) — HTML/CSS/JS estándar, ya sin
    // ninguna dependencia de la sintaxis .astro.
    const listResult = await sandbox.commands.run(`find ${APP_DIR}/dist -type f`, { timeoutMs: 15_000 });
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
    logger.error({ err }, "buildAstroProjectInE2B: error inesperado");
    return { ok: false, reason: `Error inesperado compilando el proyecto: ${err?.message || String(err)}` };
  } finally {
    if (sandbox) {
      try {
        await sandbox.kill();
      } catch { /* nunca bloquear por un fallo al cerrar el sandbox */ }
    }
  }
}
