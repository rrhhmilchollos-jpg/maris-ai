/**
 * androidBuilder.ts
 * 
 * Compilador de aplicaciones Android.
 * Convierte proyectos Capacitor en APK/AAB listos para distribuir.
 */

import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

export interface BuildOptions {
  projectPath: string;
  releaseType: "debug" | "release";
  keystorePath?: string;
  keystorePassword?: string;
  keystoreAlias?: string;
  keystoreAliasPassword?: string;
  timeout?: number;
}

export interface BuildResult {
  success: boolean;
  apkPath?: string;
  aabPath?: string;
  size?: number;
  duration: number;
  error?: string;
}

/**
 * Verifica que el proyecto tiene la estructura correcta
 */
function validateProjectStructure(projectPath: string): boolean {
  const requiredFiles = [
    "android/build.gradle",
    "android/settings.gradle",
    "android/app/build.gradle",
    "capacitor.config.ts",
    "package.json",
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(projectPath, file);
    if (!fs.existsSync(filePath)) {
      logger.warn({ file }, "Missing required file for Android build");
      return false;
    }
  }

  return true;
}

/**
 * Instala las dependencias del proyecto
 */
async function installDependencies(projectPath: string): Promise<void> {
  logger.info({ projectPath }, "Installing project dependencies");

  try {
    execSync("npm install", {
      cwd: projectPath,
      stdio: "pipe",
      timeout: 300000, // 5 minutos
    });
    logger.info("Dependencies installed successfully");
  } catch (error) {
    logger.error({ error }, "Failed to install dependencies");
    throw new Error("Failed to install dependencies");
  }
}

/**
 * Sincroniza el código web con Capacitor
 */
async function syncCapacitor(projectPath: string): Promise<void> {
  logger.info({ projectPath }, "Syncing Capacitor");

  try {
    execSync("npx cap sync android", {
      cwd: projectPath,
      stdio: "pipe",
      timeout: 120000, // 2 minutos
    });
    logger.info("Capacitor synced successfully");
  } catch (error) {
    logger.error({ error }, "Failed to sync Capacitor");
    throw new Error("Failed to sync Capacitor");
  }
}

/**
 * Compila el proyecto a APK
 */
export async function buildAPK(opts: BuildOptions): Promise<BuildResult> {
  const startTime = Date.now();

  try {
    // Validar estructura del proyecto
    if (!validateProjectStructure(opts.projectPath)) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: "Invalid project structure",
      };
    }

    logger.info({ projectPath: opts.projectPath }, "Starting Android APK build");

    // Instalar dependencias
    await installDependencies(opts.projectPath);

    // Compilar el código web
    logger.info("Building web assets");
    execSync("npm run build", {
      cwd: opts.projectPath,
      stdio: "pipe",
      timeout: 300000,
    });

    // Sincronizar Capacitor
    await syncCapacitor(opts.projectPath);

    // Ejecutar Gradle
    const androidDir = path.join(opts.projectPath, "android");
    const gradleCmd =
      opts.releaseType === "release"
        ? buildReleaseGradleCommand(opts)
        : "gradlew assembleDebug";

    logger.info({ gradleCmd }, "Running Gradle build");

    execSync(gradleCmd, {
      cwd: androidDir,
      stdio: "pipe",
      timeout: opts.timeout || 600000, // 10 minutos por defecto
      env: {
        ...process.env,
        ANDROID_HOME: process.env.ANDROID_HOME || "/opt/android-sdk",
      },
    });

    // Localizar el APK generado
    const apkPath = findAPK(opts.projectPath, opts.releaseType);
    if (!apkPath) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: "APK not found after build",
      };
    }

    const stats = fs.statSync(apkPath);
    logger.info(
      { apkPath, size: stats.size },
      "APK build completed successfully"
    );

    return {
      success: true,
      apkPath,
      size: stats.size,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, "APK build failed");

    return {
      success: false,
      duration: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Compila el proyecto a AAB (Android App Bundle)
 */
export async function buildAAB(opts: BuildOptions): Promise<BuildResult> {
  const startTime = Date.now();

  if (opts.releaseType !== "release") {
    return {
      success: false,
      duration: Date.now() - startTime,
      error: "AAB can only be built in release mode",
    };
  }

  try {
    if (!validateProjectStructure(opts.projectPath)) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: "Invalid project structure",
      };
    }

    logger.info({ projectPath: opts.projectPath }, "Starting Android AAB build");

    await installDependencies(opts.projectPath);

    execSync("npm run build", {
      cwd: opts.projectPath,
      stdio: "pipe",
      timeout: 300000,
    });

    await syncCapacitor(opts.projectPath);

    const androidDir = path.join(opts.projectPath, "android");
    const gradleCmd = buildReleaseGradleCommand(opts).replace(
      "assembleRelease",
      "bundleRelease"
    );

    logger.info({ gradleCmd }, "Running Gradle bundle");

    execSync(gradleCmd, {
      cwd: androidDir,
      stdio: "pipe",
      timeout: opts.timeout || 600000,
      env: {
        ...process.env,
        ANDROID_HOME: process.env.ANDROID_HOME || "/opt/android-sdk",
      },
    });

    const aabPath = findAAB(opts.projectPath);
    if (!aabPath) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: "AAB not found after build",
      };
    }

    const stats = fs.statSync(aabPath);
    logger.info(
      { aabPath, size: stats.size },
      "AAB build completed successfully"
    );

    return {
      success: true,
      aabPath,
      size: stats.size,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, "AAB build failed");

    return {
      success: false,
      duration: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Construye el comando de Gradle para release
 */
function buildReleaseGradleCommand(opts: BuildOptions): string {
  if (!opts.keystorePath || !opts.keystorePassword) {
    return "./gradlew assembleRelease";
  }

  const cmd = [
    "./gradlew",
    "assembleRelease",
    `-Pandroid.injected.signing.store.file=${opts.keystorePath}`,
    `-Pandroid.injected.signing.store.password=${opts.keystorePassword}`,
    `-Pandroid.injected.signing.key.alias=${opts.keystoreAlias || "key"}`,
    `-Pandroid.injected.signing.key.password=${opts.keystoreAliasPassword || opts.keystorePassword}`,
  ];

  return cmd.join(" ");
}

/**
 * Busca el archivo APK generado
 */
function findAPK(projectPath: string, releaseType: "debug" | "release"): string | null {
  const buildDir = path.join(projectPath, "android", "app", "build", "outputs", "apk");

  const possiblePaths = [
    releaseType === "release"
      ? path.join(buildDir, "release", "app-release.apk")
      : path.join(buildDir, "debug", "app-debug.apk"),
    releaseType === "release"
      ? path.join(buildDir, "release", "app-release-unsigned.apk")
      : path.join(buildDir, "debug", "app-debug-unsigned.apk"),
  ];

  for (const apkPath of possiblePaths) {
    if (fs.existsSync(apkPath)) {
      return apkPath;
    }
  }

  // Buscar recursivamente si no se encuentra en las ubicaciones esperadas
  const searchDir = path.join(projectPath, "android", "app", "build", "outputs");
  if (fs.existsSync(searchDir)) {
    const files = execSync(`find ${searchDir} -name "*.apk" -type f`, {
      encoding: "utf8",
    }).split("\n");

    for (const file of files) {
      if (file && fs.existsSync(file)) {
        return file;
      }
    }
  }

  return null;
}

/**
 * Busca el archivo AAB generado
 */
function findAAB(projectPath: string): string | null {
  const buildDir = path.join(
    projectPath,
    "android",
    "app",
    "build",
    "outputs",
    "bundle",
    "release"
  );

  const aabPath = path.join(buildDir, "app-release.aab");
  if (fs.existsSync(aabPath)) {
    return aabPath;
  }

  // Buscar recursivamente
  const searchDir = path.join(projectPath, "android", "app", "build", "outputs");
  if (fs.existsSync(searchDir)) {
    const files = execSync(`find ${searchDir} -name "*.aab" -type f`, {
      encoding: "utf8",
    }).split("\n");

    for (const file of files) {
      if (file && fs.existsSync(file)) {
        return file;
      }
    }
  }

  return null;
}

/**
 * Limpia los archivos de compilación anteriores
 */
export function cleanBuild(projectPath: string): void {
  const androidDir = path.join(projectPath, "android");
  const buildDir = path.join(androidDir, "app", "build");

  if (fs.existsSync(buildDir)) {
    logger.info({ buildDir }, "Cleaning previous build artifacts");
    try {
      execSync("rm -rf build", { cwd: path.join(androidDir, "app") });
    } catch (error) {
      logger.warn({ error }, "Failed to clean build directory");
    }
  }
}

/**
 * Obtiene información del proyecto Android
 */
export function getAndroidProjectInfo(projectPath: string): {
  packageName: string;
  versionCode: number;
  versionName: string;
} | null {
  const manifestPath = path.join(
    projectPath,
    "android",
    "app",
    "src",
    "main",
    "AndroidManifest.xml"
  );

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const manifest = fs.readFileSync(manifestPath, "utf8");
  const packageMatch = manifest.match(/package="([^"]+)"/);

  if (!packageMatch) {
    return null;
  }

  return {
    packageName: packageMatch[1],
    versionCode: 1,
    versionName: "1.0.0",
  };
}
