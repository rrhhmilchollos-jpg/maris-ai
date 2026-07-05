import { Sandbox } from "e2b";
import { isE2BEnabled } from "./e2bValidator";
import { logger } from "./logger";

// Decisiones de producto tomadas por defecto (a falta de que el usuario las
// ajuste) — documentadas aquí explícitamente porque son las que más
// impactan en coste:
//
// - SANDBOX_LIFETIME_MS: cuánto tiempo máximo vive un sandbox con servidor
//   corriendo antes de que E2B lo apague solo, pase lo que pase. 30 minutos
//   es un punto de partida razonable: suficiente para que un cliente revise
//   el preview de una app importada con calma, sin dejar sandboxes
//   (=coste) corriendo indefinidamente si alguien abre el preview y se
//   olvida de la pestaña.
// - No hay renovación automática por actividad en esta primera versión —
//   si el cliente sigue usando el preview pasados los 30 minutos, hay que
//   volver a generarlo (ver regenerateLiveServerIfExpired más abajo). Añadir
//   "extender si hay actividad" es una mejora futura razonable, no algo
//   crítico para la primera versión funcional.
const SANDBOX_LIFETIME_MS = 30 * 60_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const BUILD_TIMEOUT_MS = 4 * 60_000;
const SERVER_READY_TIMEOUT_MS = 45_000;
const SERVER_READY_POLL_MS = 1_500;
const APP_DIR = "/home/user/ssr-preview";
const SERVER_PORT = 3000;

export interface SSRServerResult {
  ok: boolean;
  liveUrl?: string;
  sandboxId?: string;
  expiresAt?: Date;
  installLog?: string;
  buildLog?: string;
  reason?: string;
}

/**
 * Extiende la vida de un sandbox SSR ya existente (heartbeat) — se llama
 * periódicamente mientras el cliente tiene el preview abierto, para que no
 * se apague a los 30 minutos si sigue mirándolo. Usa el método ESTÁTICO
 * Sandbox.setTimeout(sandboxId, ms), que no necesita reconectar (levantar)
 * el sandbox entero solo para tocar su timeout.
 *
 * Límite real de E2B (no de Maris AI): 1 hora máx. en el plan Hobby, 24h
 * en el plan Pro -- si la cuenta de E2B configurada es Hobby, extender más
 * allá de 1 hora total de vida fallará aunque el código esté bien.
 */
export async function extendSSRSandbox(
  sandboxId: string,
  additionalMs: number = SANDBOX_LIFETIME_MS,
): Promise<{ ok: boolean; newExpiresAt?: Date; reason?: string }> {
  if (!isE2BEnabled()) {
    return { ok: false, reason: "E2B_API_KEY no configurada." };
  }
  try {
    await Sandbox.setTimeout(sandboxId, additionalMs);
    return { ok: true, newExpiresAt: new Date(Date.now() + additionalMs) };
  } catch (err: any) {
    // Motivo más probable: el sandbox ya murió (timeout anterior alcanzado)
    // y no se puede "revivir" solo extendiendo su timeout -- hace falta
    // un reinicio completo (ver restartSSRServer más abajo / el endpoint
    // /apps/:id/ssr-preview/restart).
    logger.warn({ err, sandboxId }, "extendSSRSandbox: no se pudo extender (probablemente ya murió)");
    return { ok: false, reason: "El sandbox ya no está vivo — hace falta reiniciarlo, no solo extenderlo." };
  }
}

/**
 * Arranca un servidor Next.js (u otro framework SSR) DE VERDAD dentro de un
 * sandbox E2B, y deja el sandbox vivo con el servidor corriendo en segundo
 * plano — a diferencia de astroImportBuilder.ts (que compila y se queda solo
 * con los archivos estáticos resultantes), aquí no hay "resultado estático"
 * posible: Next.js con App Router necesita un proceso Node.js activo
 * respondiendo a cada petición (Server Components, Server Actions, rutas
 * API dinámicas).
 *
 * El preview de Maris AI para este tipo de proyecto no es un bundle
 * guardado en MongoDB — es una URL en vivo (`sandbox.getHost(3000)`) que
 * solo funciona mientras el sandbox siga encendido. Ver
 * GeneratedApp.renderMode === "ssr-live" en el schema.
 */
export async function startSSRServerInE2B(
  files: Record<string, string>,
): Promise<SSRServerResult> {
  if (!isE2BEnabled()) {
    return { ok: false, reason: "E2B_API_KEY no configurada — no se puede arrancar un servidor en vivo." };
  }

  let sandbox: Sandbox | null = null;
  try {
    sandbox = await Sandbox.create({ timeoutMs: SANDBOX_LIFETIME_MS });
    logger.info({ sandboxId: sandbox.sandboxId, fileCount: Object.keys(files).length }, "E2B: sandbox creado para servidor SSR en vivo");

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
      logger.warn({ sandboxId: sandbox.sandboxId, stderr: install.stderr.slice(0, 2000) }, "SSR import: npm install falló");
      await sandbox.kill().catch(() => {});
      return {
        ok: false,
        installLog: install.stdout + "\n" + install.stderr,
        reason: "No se pudieron instalar las dependencias del proyecto.",
      };
    }

    const build = await sandbox.commands.run(
      `cd ${APP_DIR} && npm run build`,
      { timeoutMs: BUILD_TIMEOUT_MS },
    );
    if (build.exitCode !== 0) {
      logger.warn({ sandboxId: sandbox.sandboxId, stderr: build.stderr.slice(0, 2000) }, "SSR import: build falló");
      await sandbox.kill().catch(() => {});
      return {
        ok: false,
        installLog: install.stdout,
        buildLog: build.stdout + "\n" + build.stderr,
        reason: "El proyecto no compiló. Revisa el log de build para más detalle.",
      };
    }

    // Arrancar el servidor EN SEGUNDO PLANO (background: true) — a
    // diferencia de install/build, este comando no debe esperarse a que
    // "termine" nunca, porque un servidor nunca termina por sí solo.
    // PORT se fija explícitamente porque muchos frameworks (Next.js
    // incluido) leen esta variable de entorno para decidir en qué puerto
    // escuchar, en vez de aceptar un argumento de línea de comandos fiable
    // en todos los casos.
    await sandbox.commands.run(`cd ${APP_DIR} && PORT=${SERVER_PORT} npm start`, {
      background: true,
      timeoutMs: 0,
    });

    // Esperar a que el servidor responda de verdad antes de dar la URL por
    // buena — arrancar "npm start" no es instantáneo (Next.js tarda unos
    // segundos en levantar el servidor de producción tras el build).
    const host = sandbox.getHost(SERVER_PORT);
    const liveUrl = `https://${host}`;
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    let serverReady = false;
    while (Date.now() < deadline) {
      try {
        const check = await fetch(liveUrl, { method: "GET" });
        // Cualquier respuesta HTTP (incluso un error de la propia app,
        // como un 404 de una ruta que no existe) confirma que el servidor
        // está vivo y respondiendo — solo un error de RED indicaría que
        // aún no ha arrancado.
        if (check.status) {
          serverReady = true;
          break;
        }
      } catch {
        // Aún no responde — normal en los primeros segundos, reintentar.
      }
      await new Promise((r) => setTimeout(r, SERVER_READY_POLL_MS));
    }

    if (!serverReady) {
      logger.warn({ sandboxId: sandbox.sandboxId, liveUrl }, "SSR import: el servidor no respondió a tiempo tras 'npm start'");
      await sandbox.kill().catch(() => {});
      return {
        ok: false,
        installLog: install.stdout,
        buildLog: build.stdout,
        reason: "El proyecto compiló correctamente pero el servidor no llegó a responder tras arrancar. Puede que 'npm start' no sea el comando correcto para este proyecto, o que necesite variables de entorno que no tenemos.",
      };
    }

    const expiresAt = new Date(Date.now() + SANDBOX_LIFETIME_MS);
    logger.info({ sandboxId: sandbox.sandboxId, liveUrl, expiresAt }, "SSR import: servidor en vivo arrancado correctamente");
    return { ok: true, liveUrl, sandboxId: sandbox.sandboxId, expiresAt };
  } catch (err: any) {
    logger.error({ err }, "startSSRServerInE2B: error inesperado");
    if (sandbox) await sandbox.kill().catch(() => {});
    return { ok: false, reason: `Error inesperado arrancando el servidor: ${err?.message || String(err)}` };
  }
  // NOTA IMPORTANTE, a diferencia de astroImportBuilder.ts: aquí NO se
  // mata el sandbox en el `finally` — el objetivo es dejarlo vivo y
  // sirviendo tráfico real. E2B lo apagará solo al llegar a
  // SANDBOX_LIFETIME_MS (timeoutMs pasado en Sandbox.create arriba).
}
