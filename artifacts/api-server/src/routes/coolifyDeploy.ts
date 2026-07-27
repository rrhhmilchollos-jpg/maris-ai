/**
 * coolifyDeploy.ts
 *
 * Despliega el backend real de una app generada al servidor Coolify propio
 * (self-hosted) — corrige el hueco encontrado de que el backend de las
 * apps nunca llegaba a desplegarse de forma persistente, solo el frontend
 * a Vercel. Ya no hace falta conectar ninguna cuenta ni token: las
 * credenciales de Coolify (COOLIFY_API_URL, COOLIFY_API_TOKEN,
 * COOLIFY_SERVER_UUID, COOLIFY_PROJECT_UUID) son del propio servidor, ver
 * lib/coolifyDeploy.ts.
 *
 * POST /api/apps/:appId/deploy-backend → despliega el backend real a Coolify
 */
import { Router, type Request, type Response } from "express";
import { GeneratedApp } from "@workspace/db/schema";
import { requireAuth } from "../lib/auth";
import { connectDB } from "../lib/db";
import { logger } from "../lib/logger";
import { deployBackendToCoolify } from "../lib/coolifyDeploy";
import { syncVercelEnvironmentVariables } from "../lib/vercelDeploy";

const router = Router();

router.post("/apps/:appId/deploy-backend", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { appId: appIdParam } = req.params;
    const appId = Array.isArray(appIdParam) ? (appIdParam[0] ?? "") : appIdParam;
    const userId = (req as any).userId as string;

    const app = await GeneratedApp.findOne({ _id: appId, userId }).lean();
    if (!app) return res.status(404).json({ error: "App no encontrada" });
    if ((app as any).architecture === "serverless") {
      return res.status(400).json({
        error: "Esta app usa arquitectura serverless — su backend ya se despliega automáticamente junto al frontend en Vercel (carpeta api/), no necesita ni puede desplegarse a Coolify.",
      });
    }
    if (!(app as any).backendCode || (app as any).backendCode.length < 50) {
      return res.status(400).json({ error: "Esta app no tiene backend que desplegar." });
    }

    const githubRepoFullName = (app as any).githubRepoFullName;
    if (!githubRepoFullName) {
      return res.status(400).json({ error: "Exporta esta app a GitHub primero — Coolify despliega directamente desde tu repositorio." });
    }

    const subdomain =
      (app as any).marisaiSubdomain ||
      `app-${appId.slice(-6)}`;

    await GeneratedApp.updateOne({ _id: appId }, { coolifyDeploymentStatus: "deploying" });

    const envVars: Record<string, string> = {};
    for (const ev of (app as any).requiredEnvVars || []) {
      if (ev.value) envVars[ev.name] = ev.value;
    }
    envVars.NODE_ENV = "production";

    try {
      const result = await deployBackendToCoolify({
        appId,
        appTitle: app.title,
        githubRepoFullName,
        envVars,
        subdomain,
      });

      if ("error" in result) {
        await GeneratedApp.updateOne({ _id: appId }, { coolifyDeploymentStatus: "failed", coolifyDeploymentError: result.error });
        logger.error({ appId, error: result.error }, "Coolify backend deploy failed");
        return res.status(500).json({ error: result.error });
      }

      await GeneratedApp.updateOne(
        { _id: appId },
        {
          coolifyApplicationUuid: result.applicationUuid,
          coolifyBackendUrl: result.publicUrl,
          coolifyDeploymentStatus: "deployed",
          coolifyDeploymentError: null,
        },
      );

      // Conecta el círculo completo: el frontend ya desplegado en Vercel
      // necesita saber la URL real del backend que se acaba de crear —
      // sin esto, VITE_API_URL seguiría vacío y el frontend en producción
      // seguiría intentando rutas relativas contra su propio dominio de
      // Vercel, donde no hay backend escuchando (el problema original que
      // este endpoint existe para resolver).
      const vercelProjectId = (app as any).vercelProjectId;
      if (vercelProjectId) {
        const syncResult = await syncVercelEnvironmentVariables({
          projectId: vercelProjectId,
          envVars: [{ name: "VITE_API_URL", value: result.publicUrl }],
          log: logger,
        });
        if (!syncResult.ok) {
          logger.warn({ appId, syncResult }, "Backend desplegado en Coolify, pero no se pudo sincronizar VITE_API_URL en Vercel automáticamente — el usuario deberá añadirla manualmente o redesplegar el frontend.");
        }
      } else {
        logger.warn({ appId }, "Backend desplegado en Coolify, pero la app no tiene vercelProjectId — despliega primero el frontend para poder sincronizar VITE_API_URL automáticamente.");
      }

      return res.json({ ok: true, backendUrl: result.publicUrl });
    } catch (deployErr) {
      const message = (deployErr as Error).message;
      await GeneratedApp.updateOne({ _id: appId }, { coolifyDeploymentStatus: "failed", coolifyDeploymentError: message });
      logger.error({ deployErr, appId }, "Coolify backend deploy failed");
      return res.status(500).json({ error: message });
    }
  } catch (err) {
    logger.error({ err }, "Error in deploy-backend endpoint");
    return res.status(500).json({ error: "Error interno al desplegar el backend" });
  }
});

export default router;
