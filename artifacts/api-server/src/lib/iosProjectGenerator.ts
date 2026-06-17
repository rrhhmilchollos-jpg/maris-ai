/**
 * iosProjectGenerator.ts
 * 
 * Generador de proyectos iOS.
 * Prepara la estructura de Xcode lista para ser compilada en Mac.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

export interface IOSProjectOptions {
  projectPath: string;
  bundleId: string;
  appName: string;
  teamId?: string;
  deploymentTarget?: string;
}

export interface IOSProjectResult {
  success: boolean;
  projectPath?: string;
  duration: number;
  error?: string;
}

/**
 * Genera la estructura de proyecto iOS usando Capacitor
 */
export async function generateIOSProject(
  opts: IOSProjectOptions
): Promise<IOSProjectResult> {
  const startTime = Date.now();

  try {
    logger.info(
      { projectPath: opts.projectPath, bundleId: opts.bundleId },
      "Starting iOS project generation"
    );

    // Verificar que el proyecto tiene la estructura correcta
    if (!fs.existsSync(path.join(opts.projectPath, "package.json"))) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: "package.json not found",
      };
    }

    // Instalar dependencias si es necesario
    if (!fs.existsSync(path.join(opts.projectPath, "node_modules"))) {
      logger.info("Installing dependencies");
      execSync("npm install", {
        cwd: opts.projectPath,
        stdio: "pipe",
        timeout: 300000,
      });
    }

    // Compilar el código web
    logger.info("Building web assets");
    execSync("npm run build", {
      cwd: opts.projectPath,
      stdio: "pipe",
      timeout: 300000,
    });

    // Añadir plataforma iOS a Capacitor
    logger.info("Adding iOS platform to Capacitor");
    try {
      execSync("npx cap add ios", {
        cwd: opts.projectPath,
        stdio: "pipe",
        timeout: 120000,
      });
    } catch (error) {
      // Es posible que iOS ya exista, continuar de todas formas
      logger.warn("iOS platform may already exist");
    }

    // Sincronizar Capacitor
    logger.info("Syncing Capacitor");
    execSync("npx cap sync ios", {
      cwd: opts.projectPath,
      stdio: "pipe",
      timeout: 120000,
    });

    // Actualizar la configuración de iOS
    await updateIOSConfiguration(opts);

    // Generar el proyecto de Xcode
    const iosProjectPath = path.join(opts.projectPath, "ios", "App");
    if (!fs.existsSync(iosProjectPath)) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: "iOS project not generated",
      };
    }

    logger.info(
      { iosProjectPath },
      "iOS project generated successfully"
    );

    return {
      success: true,
      projectPath: iosProjectPath,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, "iOS project generation failed");

    return {
      success: false,
      duration: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Actualiza la configuración de iOS (Info.plist, etc.)
 */
async function updateIOSConfiguration(
  opts: IOSProjectOptions
): Promise<void> {
  const infoPlistPath = path.join(
    opts.projectPath,
    "ios",
    "App",
    "App",
    "Info.plist"
  );

  if (!fs.existsSync(infoPlistPath)) {
    logger.warn({ infoPlistPath }, "Info.plist not found");
    return;
  }

  try {
    // Leer el archivo plist
    let infoPlist = fs.readFileSync(infoPlistPath, "utf8");

    // Actualizar el bundle ID
    infoPlist = infoPlist.replace(
      /(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]*/,
      `$1${opts.bundleId}`
    );

    // Actualizar el nombre de la app
    infoPlist = infoPlist.replace(
      /(<key>CFBundleName<\/key>\s*<string>)[^<]*/,
      `$1${opts.appName}`
    );

    // Actualizar el nombre mostrado
    infoPlist = infoPlist.replace(
      /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*/,
      `$1${opts.appName}`
    );

    // Actualizar el target de deployment si se especifica
    if (opts.deploymentTarget) {
      infoPlist = infoPlist.replace(
        /(<key>MinimumOSVersion<\/key>\s*<string>)[^<]*/,
        `$1${opts.deploymentTarget}`
      );
    }

    fs.writeFileSync(infoPlistPath, infoPlist);
    logger.info({ infoPlistPath }, "Info.plist updated successfully");
  } catch (error) {
    logger.warn(
      { error, infoPlistPath },
      "Failed to update Info.plist"
    );
  }
}

/**
 * Actualiza el Team ID en el proyecto de Xcode
 */
export function updateXcodeTeamId(
  projectPath: string,
  teamId: string
): void {
  const pbxprojPath = path.join(
    projectPath,
    "ios",
    "App",
    "App.xcodeproj",
    "project.pbxproj"
  );

  if (!fs.existsSync(pbxprojPath)) {
    logger.warn({ pbxprojPath }, "project.pbxproj not found");
    return;
  }

  try {
    let pbxproj = fs.readFileSync(pbxprojPath, "utf8");

    // Actualizar el Team ID
    pbxproj = pbxproj.replace(
      /DEVELOPMENT_TEAM = [A-Z0-9]*/g,
      `DEVELOPMENT_TEAM = ${teamId}`
    );

    fs.writeFileSync(pbxprojPath, pbxproj);
    logger.info({ pbxprojPath, teamId }, "Team ID updated successfully");
  } catch (error) {
    logger.warn({ error, pbxprojPath }, "Failed to update Team ID");
  }
}

/**
 * Obtiene información del proyecto iOS
 */
export function getIOSProjectInfo(projectPath: string): {
  bundleId: string;
  appName: string;
  deploymentTarget: string;
} | null {
  const infoPlistPath = path.join(
    projectPath,
    "ios",
    "App",
    "App",
    "Info.plist"
  );

  if (!fs.existsSync(infoPlistPath)) {
    return null;
  }

  try {
    const infoPlist = fs.readFileSync(infoPlistPath, "utf8");

    const bundleIdMatch = infoPlist.match(
      /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/
    );
    const appNameMatch = infoPlist.match(
      /<key>CFBundleName<\/key>\s*<string>([^<]+)<\/string>/
    );
    const deploymentTargetMatch = infoPlist.match(
      /<key>MinimumOSVersion<\/key>\s*<string>([^<]+)<\/string>/
    );

    return {
      bundleId: bundleIdMatch ? bundleIdMatch[1] : "com.example.app",
      appName: appNameMatch ? appNameMatch[1] : "App",
      deploymentTarget: deploymentTargetMatch ? deploymentTargetMatch[1] : "13.0",
    };
  } catch (error) {
    logger.warn({ error }, "Failed to parse iOS project info");
    return null;
  }
}

/**
 * Crea un archivo de configuración para facilitar la compilación en Xcode
 */
export function generateXcodeBuildGuide(
  projectPath: string,
  opts: IOSProjectOptions
): void {
  const guidePath = path.join(projectPath, "ios", "BUILD_GUIDE.md");

  const guide = `# iOS Build Guide

## Requisitos
- Xcode 14.0 o superior
- CocoaPods
- Un Apple Developer Account

## Pasos para compilar

### 1. Instalar dependencias
\`\`\`bash
cd ios/App
pod install
\`\`\`

### 2. Abrir el proyecto en Xcode
\`\`\`bash
open App.xcworkspace
\`\`\`

### 3. Configurar el equipo de desarrollo
- Selecciona el proyecto "App" en el navegador
- Selecciona el target "App"
- Ve a "Signing & Capabilities"
- Selecciona tu equipo en "Team"

### 4. Configurar el Bundle ID
- El Bundle ID actual es: \`${opts.bundleId}\`
- Puedes cambiarlo en "Build Settings" > "Product Bundle Identifier"

### 5. Compilar
- Selecciona el simulador o dispositivo físico
- Presiona Cmd+B para compilar
- Presiona Cmd+R para ejecutar

## Información del Proyecto
- **App Name**: ${opts.appName}
- **Bundle ID**: ${opts.bundleId}
- **Deployment Target**: ${opts.deploymentTarget || "13.0"}

## Troubleshooting

### Pod install falla
\`\`\`bash
cd ios/App
rm -rf Pods
rm Podfile.lock
pod install
\`\`\`

### Problemas de firma
- Asegúrate de tener un Apple Developer Account válido
- Verifica que el Team ID esté configurado correctamente
- Intenta limpiar la compilación: Cmd+Shift+K

### Problemas de dependencias
\`\`\`bash
cd ios/App
pod deintegrate
pod install
\`\`\`
`;

  try {
    fs.writeFileSync(guidePath, guide);
    logger.info({ guidePath }, "Xcode build guide created");
  } catch (error) {
    logger.warn({ error }, "Failed to create Xcode build guide");
  }
}

/**
 * Prepara el proyecto para ser descargado y compilado en Mac
 */
export async function prepareIOSProjectForDownload(
  projectPath: string
): Promise<string> {
  const iosDir = path.join(projectPath, "ios");

  if (!fs.existsSync(iosDir)) {
    throw new Error("iOS directory not found");
  }

  logger.info({ iosDir }, "Preparing iOS project for download");

  // Limpiar archivos innecesarios
  const filesToRemove = [
    path.join(iosDir, "Pods"),
    path.join(iosDir, ".git"),
    path.join(iosDir, "node_modules"),
  ];

  for (const file of filesToRemove) {
    if (fs.existsSync(file)) {
      try {
        execSync(`rm -rf ${file}`, { stdio: "pipe" });
      } catch (error) {
        logger.warn({ file }, "Failed to remove file");
      }
    }
  }

  logger.info("iOS project ready for download");
  return iosDir;
}
