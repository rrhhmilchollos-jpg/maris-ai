/**
 * routes/mobile.ts
 * 
 * Rutas API para compilación de aplicaciones móviles.
 * Permite a los usuarios compilar sus apps generadas a APK/IPA.
 */

import { Router, Request, Response } from "express";
import { auth } from "../middleware/auth";
import { GeneratedApp } from "../models/GeneratedApp";
import { buildAPK, buildAAB, cleanBuild } from "../lib/androidBuilder";
import { generateIOSProject, updateXcodeTeamId, prepareIOSProjectForDownload } from "../lib/iosProjectGenerator";
import { generateMobileProjectStructure } from "../lib/capacitorGenerator";
import { logger } from "../lib/logger";
import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";

const router = Router();

/**
 * POST /api/mobile/apps/:appId/init-capacitor
 * Inicializa Capacitor en un proyecto existente
 */
router.post("/apps/:appId/init-capacitor", auth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { platforms = ["android", "ios"] } = req.body;

    // Verificar que el usuario es el propietario
    const app = await GeneratedApp.findById(appId);
    if (!app || app.userId !== req.user?.id) {
      return res.status(404).json({ error: "App not found" });
    }

    logger.info({ appId, platforms }, "Initializing Capacitor");

    // Generar estructura de archivos móviles
    const mobileStructure = generateMobileProjectStructure({
      appId: app._id.toString(),
      appName: app.name,
      packageName: `com.${app.name.toLowerCase().replace(/\s+/g, "")}`,
      bundleId: `com.${app.name.toLowerCase().replace(/\s+/g, "")}`,
    });

    // Actualizar el proyecto con la estructura móvil
    const updatedFrontendCode = app.frontendCode + "\n\n// === MOBILE CONFIGURATION ===\n" +
      Object.entries(mobileStructure)
        .map(([filePath, content]) => `// === FILE: ${filePath} ===\n${content}`)
        .join("\n\n");

    await GeneratedApp.updateOne(
      { _id: appId },
      {
        projectType: "mobile",
        frontendCode: updatedFrontendCode,
        platforms,
      }
    );

    res.json({
      success: true,
      message: "Capacitor initialized successfully",
      platforms,
    });
  } catch (error) {
    logger.error({ error }, "Failed to initialize Capacitor");
    res.status(500).json({ error: "Failed to initialize Capacitor" });
  }
});

/**
 * POST /api/mobile/apps/:appId/build-android
 * Compila la app a APK
 */
router.post("/apps/:appId/build-android", auth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { releaseType = "debug" } = req.body;

    // Verificar que el usuario es el propietario
    const app = await GeneratedApp.findById(appId);
    if (!app || app.userId !== req.user?.id) {
      return res.status(404).json({ error: "App not found" });
    }

    logger.info({ appId, releaseType }, "Starting Android build");

    // Obtener la ruta del proyecto
    const projectPath = path.join(process.env.APPS_DIR || "/tmp/apps", appId);

    // Verificar que el proyecto existe
    if (!fs.existsSync(projectPath)) {
      return res.status(400).json({ error: "Project not found" });
    }

    // Compilar
    const result = await buildAPK({
      projectPath,
      releaseType: releaseType as "debug" | "release",
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        duration: result.duration,
      });
    }

    // Actualizar el app con la información de compilación
    await GeneratedApp.updateOne(
      { _id: appId },
      {
        lastBuildType: "android",
        lastBuildTime: new Date(),
        buildStatus: "success",
      }
    );

    res.json({
      success: true,
      apkPath: result.apkPath,
      size: result.size,
      duration: result.duration,
      downloadUrl: `/api/mobile/apps/${appId}/download-apk?type=${releaseType}`,
    });
  } catch (error) {
    logger.error({ error }, "Android build failed");
    res.status(500).json({ error: "Android build failed" });
  }
});

/**
 * POST /api/mobile/apps/:appId/build-aab
 * Compila la app a AAB (Android App Bundle)
 */
router.post("/apps/:appId/build-aab", auth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;

    // Verificar que el usuario es el propietario
    const app = await GeneratedApp.findById(appId);
    if (!app || app.userId !== req.user?.id) {
      return res.status(404).json({ error: "App not found" });
    }

    logger.info({ appId }, "Starting AAB build");

    const projectPath = path.join(process.env.APPS_DIR || "/tmp/apps", appId);

    if (!fs.existsSync(projectPath)) {
      return res.status(400).json({ error: "Project not found" });
    }

    const result = await buildAAB({
      projectPath,
      releaseType: "release",
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        duration: result.duration,
      });
    }

    await GeneratedApp.updateOne(
      { _id: appId },
      {
        lastBuildType: "android-aab",
        lastBuildTime: new Date(),
        buildStatus: "success",
      }
    );

    res.json({
      success: true,
      aabPath: result.aabPath,
      size: result.size,
      duration: result.duration,
      downloadUrl: `/api/mobile/apps/${appId}/download-aab`,
    });
  } catch (error) {
    logger.error({ error }, "AAB build failed");
    res.status(500).json({ error: "AAB build failed" });
  }
});

/**
 * GET /api/mobile/apps/:appId/download-apk
 * Descarga el APK compilado
 */
router.get("/apps/:appId/download-apk", auth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { type = "debug" } = req.query;

    // Verificar que el usuario es el propietario
    const app = await GeneratedApp.findById(appId);
    if (!app || app.userId !== req.user?.id) {
      return res.status(404).json({ error: "App not found" });
    }

    const projectPath = path.join(process.env.APPS_DIR || "/tmp/apps", appId);
    const apkPath = type === "release"
      ? path.join(projectPath, "android", "app", "build", "outputs", "apk", "release", "app-release.apk")
      : path.join(projectPath, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");

    if (!fs.existsSync(apkPath)) {
      return res.status(404).json({ error: "APK not found. Please build first." });
    }

    res.download(apkPath, `${app.name}-${type}.apk`);
  } catch (error) {
    logger.error({ error }, "Failed to download APK");
    res.status(500).json({ error: "Failed to download APK" });
  }
});

/**
 * GET /api/mobile/apps/:appId/download-aab
 * Descarga el AAB compilado
 */
router.get("/apps/:appId/download-aab", auth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;

    // Verificar que el usuario es el propietario
    const app = await GeneratedApp.findById(appId);
    if (!app || app.userId !== req.user?.id) {
      return res.status(404).json({ error: "App not found" });
    }

    const projectPath = path.join(process.env.APPS_DIR || "/tmp/apps", appId);
    const aabPath = path.join(projectPath, "android", "app", "build", "outputs", "bundle", "release", "app-release.aab");

    if (!fs.existsSync(aabPath)) {
      return res.status(404).json({ error: "AAB not found. Please build first." });
    }

    res.download(aabPath, `${app.name}-release.aab`);
  } catch (error) {
    logger.error({ error }, "Failed to download AAB");
    res.status(500).json({ error: "Failed to download AAB" });
  }
});

/**
 * POST /api/mobile/apps/:appId/build-ios
 * Prepara el proyecto para Xcode
 */
router.post("/apps/:appId/build-ios", auth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { teamId } = req.body;

    // Verificar que el usuario es el propietario
    const app = await GeneratedApp.findById(appId);
    if (!app || app.userId !== req.user?.id) {
      return res.status(404).json({ error: "App not found" });
    }

    logger.info({ appId }, "Starting iOS project generation");

    const projectPath = path.join(process.env.APPS_DIR || "/tmp/apps", appId);

    if (!fs.existsSync(projectPath)) {
      return res.status(400).json({ error: "Project not found" });
    }

    const result = await generateIOSProject({
      projectPath,
      bundleId: `com.${app.name.toLowerCase().replace(/\s+/g, "")}`,
      appName: app.name,
      teamId,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        duration: result.duration,
      });
    }

    // Actualizar Team ID si se proporciona
    if (teamId) {
      updateXcodeTeamId(projectPath, teamId);
    }

    await GeneratedApp.updateOne(
      { _id: appId },
      {
        lastBuildType: "ios",
        lastBuildTime: new Date(),
        buildStatus: "success",
      }
    );

    res.json({
      success: true,
      message: "iOS project generated successfully",
      projectPath: result.projectPath,
      duration: result.duration,
      downloadUrl: `/api/mobile/apps/${appId}/download-xcode-project`,
    });
  } catch (error) {
    logger.error({ error }, "iOS project generation failed");
    res.status(500).json({ error: "iOS project generation failed" });
  }
});

/**
 * GET /api/mobile/apps/:appId/download-xcode-project
 * Descarga el proyecto de Xcode como ZIP
 */
router.get("/apps/:appId/download-xcode-project", auth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;

    // Verificar que el usuario es el propietario
    const app = await GeneratedApp.findById(appId);
    if (!app || app.userId !== req.user?.id) {
      return res.status(404).json({ error: "App not found" });
    }

    const projectPath = path.join(process.env.APPS_DIR || "/tmp/apps", appId);
    const iosDir = path.join(projectPath, "ios");

    if (!fs.existsSync(iosDir)) {
      return res.status(404).json({ error: "iOS project not found. Please build first." });
    }

    // Preparar proyecto para descarga
    await prepareIOSProjectForDownload(projectPath);

    // Crear ZIP
    const zipPath = path.join(projectPath, `${app.name}-ios.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      logger.error({ error: err }, "Failed to create ZIP");
      res.status(500).json({ error: "Failed to create ZIP" });
    });

    output.on("close", () => {
      res.download(zipPath, `${app.name}-ios.zip`, (err) => {
        if (err) logger.error({ error: err }, "Failed to download ZIP");
        // Limpiar archivo temporal
        fs.unlink(zipPath, () => {});
      });
    });

    archive.pipe(output);
    archive.directory(iosDir, "ios");
    archive.finalize();
  } catch (error) {
    logger.error({ error }, "Failed to download Xcode project");
    res.status(500).json({ error: "Failed to download Xcode project" });
  }
});

/**
 * GET /api/mobile/apps/:appId/build-status
 * Obtiene el estado de la última compilación
 */
router.get("/apps/:appId/build-status", auth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;

    // Verificar que el usuario es el propietario
    const app = await GeneratedApp.findById(appId);
    if (!app || app.userId !== req.user?.id) {
      return res.status(404).json({ error: "App not found" });
    }

    res.json({
      lastBuildType: app.lastBuildType || null,
      lastBuildTime: app.lastBuildTime || null,
      buildStatus: app.buildStatus || "not-built",
      projectType: app.projectType || "web",
    });
  } catch (error) {
    logger.error({ error }, "Failed to get build status");
    res.status(500).json({ error: "Failed to get build status" });
  }
});

export default router;
