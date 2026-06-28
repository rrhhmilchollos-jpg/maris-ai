/**
 * railway.ts
 *
 * Conecta el cliente de Railway (lib/railwayDeploy.ts) con el flujo real
 * del usuario — corrige el hueco encontrado de que el backend de las apps
 * nunca llegaba a desplegarse de forma persistente.
 *
 * POST   /api/railway/connect          → guarda el API token de Railway del usuario
 * GET    /api/railway/status           → confirma si el usuario tiene Railway conectado
 * DELETE /api/railway/disconnect       → elimina el token guardado
 * POST   /api/apps/:appId/deploy-backend → despliega el backend real a Railway
 */
import { Router, type Request, type Response } from "express";
import { User, GeneratedApp } from "@workspace/db/schema";
import { requireAuth } from "../lib/auth";
import { connectDB } from "../lib/db";
import { logger } from "../lib/logger";
import { deployBackendToRailway } from "../lib/railwayDeploy";
import { syncVercelEnvironmentVariables } from "../lib/vercelDeploy";

const router = Router();

router.post("/railway/connect", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const userId = (req as any).userId as string;
    const { apiToken } = req.body as { apiToken?: string };
    if (!apiToken || apiToken.trim().length < 10) {
      return res.status(400).json({ error: "Token de Railway no válido. Créalo en railway.app/account/tokens." });
    }
    const verifyRes = await fetch("https://backboard.railway.com/graphql/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ query: "query { projects { edges { node { id } } } }" }),
    });
    const verifyJson = (await verifyRes.json()) as { errors?: Array<{ message: string }> };
    if (!verifyRes.ok || verifyJson.errors?.length) {
      return res.status(400).json({ error: "El token de Railway no es válido o no tiene permisos suficientes." });
    }

    await User.findOneAndUpdate({ _id: userId }, { railwayApiToken: apiToken, railwayConnectedAt: new Date() });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error connecting Railway");
    return res.status(500).json({ error: "Error interno al conectar Railway" });
  }
});

router.get("/railway/status", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const userId = (req as any).userId as string;
    const user = await User.findById(userId).select("railwayApiToken railwayConnectedAt").lean();
    return res.json({ connected: !!(user as any)?.railwayApiToken, connectedAt: (user as any)?.railwayConnectedAt ?? null });
  } catch (err) {
    logger.error({ err }, "Error checking Railway status");
    return res.status(500).json({ error: "Error interno" });
  }
});

router.delete("/railway/disconnect", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const userId = (req as any).userId as string;
    await User.findOneAndUpdate({ _id: userId }, { $unset: { railwayApiToken: "", railwayConnectedAt: "" } });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error disconnecting Railway");
    return res.status(500).json({ error: "Error interno" });
  }
});

router.post("/apps/:appId/deploy-backend", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDB();
    const { appId } = req.params;
    const userId = (req as any).userId as string;

    const user = await User.findById(userId).select("railwayApiToken githubLogin").lean();
    const railwayApiToken = (user as any)?.railwayApiToken;
    if (!railwayApiToken) {
      return res.status(400).json({ error: "Conecta tu cuenta de Railway primero (necesitas un token de railway.app/account/tokens)." });
    }

    const app = await GeneratedApp.findOne({ _id: appId, userId }).lean();
    if (!app) return res.status(404).json({ error: "App no encontrada" });
    if (!(app as any).backendCode || (app as any).backendCode.length < 50) {
      return res.status(400).json({ error: "Esta app no tiene backend que desplegar." });
    }

    const githubRepoFullName = (app as any).githubRepoFullName;
    if (!githubRepoFullName) {
      return res.status(400).json({ error: "Exporta esta app a GitHub primero — Railway despliega directamente desde tu repositorio." });
    }

    await GeneratedApp.updateOne({ _id: appId }, { railwayDeploymentStatus: "deploying" });

    const envVars: Record<string, string> = {};
    for (const ev of (app as any).requiredEnvVars || []) {
      if (ev.value) envVars[ev.name] = ev.value;
    }
    envVars.NODE_ENV = "production";

    try {
      const result = await deployBackendToRailway(
        { appId, appTitle: app.title, githubRepoFullName, envVars },
        railwayApiToken,
      );
      await GeneratedApp.updateOne(
        { _id: appId },
        {
          railwayProjectId: result.projectId,
          railwayServiceId: result.serviceId,
          railwayEnvironmentId: result.environmentId,
          railwayBackendUrl: result.publicUrl,
          railwayDeploymentStatus: "deployed",
          railwayDeploymentError: null,
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
          logger.warn({ appId, syncResult }, "Backend desplegado en Railway, pero no se pudo sincronizar VITE_API_URL en Vercel automáticamente — el usuario deberá añadirla manualmente o redesplegar el frontend.");
        }
      } else {
        logger.warn({ appId }, "Backend desplegado en Railway, pero la app no tiene vercelProjectId — despliega primero el frontend para poder sincronizar VITE_API_URL automáticamente.");
      }

      return res.json({ ok: true, backendUrl: result.publicUrl });
    } catch (deployErr) {
      const message = (deployErr as Error).message;
      await GeneratedApp.updateOne({ _id: appId }, { railwayDeploymentStatus: "failed", railwayDeploymentError: message });
      logger.error({ deployErr, appId }, "Railway backend deploy failed");
      return res.status(500).json({ error: message });
    }
  } catch (err) {
    logger.error({ err }, "Error in deploy-backend endpoint");
    return res.status(500).json({ error: "Error interno al desplegar el backend" });
  }
});

export default router;
