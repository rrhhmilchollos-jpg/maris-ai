import { Template, defaultBuildLogger } from "e2b";
import { logger } from "./logger";

/**
 * ENCONTRADO CON DATOS REALES (caso FANTASYWEB-main.zip): el sandbox por
 * defecto de E2B trae muy poca RAM (512 MiB según su propia documentación
 * -- "Start with default resources (2 vCPU, 512 MiB RAM)"). Un proyecto
 * con muchas dependencias (como uno de Wix Vibe, con decenas de paquetes
 * @wix/*) agota esa memoria durante `npm install` sin importar qué gestor
 * de paquetes se use -- confirmado con el código de salida 137 (128+9 =
 * SIGKILL) y el texto literal "Killed" en el log real.
 *
 * FIX: construir una plantilla personalizada de E2B con más memoria
 * (Build System 2.0 -- se define en código, no hace falta Dockerfile ni
 * su CLI). Esto es un paso de configuración de UNA SOLA VEZ: una vez
 * construida la plantilla en la cuenta de E2B, se reutiliza en todos los
 * imports futuros sin volver a construirla.
 *
 * Se dispara manualmente desde el panel admin (POST
 * /api/admin/e2b-build-import-template) la primera vez -- no se hace
 * automáticamente en cada import porque construir una plantilla tarda
 * minutos y consume créditos de E2B; no tiene sentido repetirlo en cada
 * generación.
 */
export const IMPORT_TEMPLATE_ALIAS = "maris-import-builder";

export interface TemplateBuildResult {
  ok: boolean;
  alias?: string;
  logs?: string[];
  reason?: string;
}

export async function buildImportTemplate(): Promise<TemplateBuildResult> {
  const logs: string[] = [];
  try {
    // NOTA: se quitó un paso de "corepack enable" que había aquí antes --
    // era para un enfoque con pnpm/corepack que se descartó (ver
    // astroImportBuilder.ts, ahora usa npm puro con --omit=dev). Ese paso
    // fallaba durante la CONSTRUCCIÓN de la propia plantilla ("failed to
    // run command 'corepack enable': exit status 1"), y no aporta nada
    // al objetivo real de esta plantilla (más memoria), así que se quita
    // en vez de intentar depurarlo sin necesidad.
    // AMPLIACIÓN (a petición explícita del usuario: "revisa todo, instala
    // dependencias y herramientas para que Astro funcione perfectamente"):
    // node:20 (Debian, no Alpine) ya trae lo necesario para que la
    // mayoría de paquetes con binarios precompilados funcionen sin nada
    // extra (sharp, por ejemplo, descarga su propio libvips precompilado
    // en sistemas glibc como este -- confirmado contra la documentación
    // oficial de sharp antes de asumirlo). Pero algunos paquetes nativos
    // de npm NO tienen binario precompilado para toda arquitectura/versión
    // y necesitan compilar desde cero en el momento de instalar -- eso
    // requiere python3, make y un compilador de C++ (g++), que la imagen
    // base de node:20 NO trae instalados por defecto. git se añade porque
    // algunos paquetes se instalan directamente desde una URL de git, no
    // desde el registro de npm.
    const template = Template()
      .fromImage("node:20")
      .runCmd("apt-get update && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates && rm -rf /var/lib/apt/lists/*");

    await Template.build(template, {
      alias: IMPORT_TEMPLATE_ALIAS,
      // 4GB de RAM -- 8x lo que trae el sandbox por defecto (512 MiB).
      // Suficiente margen para instalar un proyecto grande tipo Wix Vibe
      // sin quedarse sin memoria a mitad de npm install. 2 vCPU es
      // suficiente para esto (no es una carga de CPU intensiva, es
      // sobre todo E/S de disco y red durante la instalación).
      cpuCount: 2,
      memoryMB: 4096,
      onBuildLogs: (msg: string) => {
        logs.push(msg);
        defaultBuildLogger()(msg);
      },
    });

    logger.info({ alias: IMPORT_TEMPLATE_ALIAS }, "Plantilla E2B de importación construida correctamente con 4GB de RAM");
    return { ok: true, alias: IMPORT_TEMPLATE_ALIAS, logs };
  } catch (err: any) {
    logger.error({ err, logs }, "Fallo al construir la plantilla E2B de importación");
    return { ok: false, reason: err?.message || String(err), logs };
  }
}
