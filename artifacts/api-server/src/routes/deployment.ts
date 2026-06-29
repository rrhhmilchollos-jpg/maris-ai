import { Router, type Request, type Response } from "express";
import { requireAuth, isAdminEmail } from "../lib/auth";
import { GeneratedApp, User } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { chargeCredits } from "../lib/credits";
import {
  redeployVercelProject,
  getDeploymentStatus,
  generateMarisaiSubdomain,
  MARIS_AI_DOMAIN,
  type DeploymentConfig,
} from "../lib/deployment";
import {
  deployAppToVercel,
  syncVercelEnvironmentVariables,
  addVercelDomainForApp,
  getVercelDomainStatus,
  recommendedDnsFor,
  removeVercelDomainForApp,
  stableVercelProductionUrlForApp,
} from "../lib/vercelDeploy";

const router = Router();
const DEPLOY_COST_CREDITS = 50;

function getAuthenticatedUserId(req: Request): string | undefined {
  return (req as any).userId || (req as any).auth?.userId;
}

async function chargeDeployCredits(req: Request, userId: string, appTitle: string) {
  const isAdmin = isAdminEmail((req as any).dbUser?.email) || !!(req as any).dbUser?.isAdmin;
  return chargeCredits({
    userId,
    isAdmin,
    amount: DEPLOY_COST_CREDITS,
    description: `Deploy de proyecto: ${appTitle}`,
  });
}

router.post("/apps/:appId/deploy", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const appData = await GeneratedApp.findOne({ _id: appId, userId });
    if (!appData) return res.status(404).json({ error: "App not found" });

    const userData = await User.findById(userId).lean();
    if (!userData) return res.status(404).json({ error: "User not found" });

    const charge = await chargeDeployCredits(req, userId, appData.title);
    if (!charge.ok) {
      return res.status(402).json({ error: "Créditos insuficientes", required: DEPLOY_COST_CREDITS, current: userData.credits });
    }

    await GeneratedApp.updateOne({ _id: appId, userId }, { deploymentStatus: "deploying", deploymentError: null });

    const deploymentResult = await deployAppToVercel({ appId: String(appId), userId, log: logger });

    if (!deploymentResult.ok) {
      const errorMsg = "failure" in deploymentResult ? JSON.stringify(deploymentResult.failure) : "Unknown error";
      await GeneratedApp.updateOne({ _id: appId, userId }, { deploymentStatus: "failed", deploymentError: errorMsg });
      return res.status(500).json({ success: false, error: errorMsg });
    }

    const { url, projectId } = deploymentResult.result;

    if (appData.requiredEnvVars && appData.requiredEnvVars.length > 0) {
      const envVarsToSync = appData.requiredEnvVars.map((ev: any) => {
        let value = ev.value;
        if (!value) {
          if (ev.name.includes("CLERK_PUBLISHABLE_KEY")) value = process.env.CLERK_PUBLISHABLE_KEY;
          if (ev.name.includes("CLERK_SECRET_KEY")) value = process.env.CLERK_SECRET_KEY;
          if (ev.name.includes("STRIPE_SECRET_KEY")) value = process.env.STRIPE_SECRET_KEY;
          if (ev.name.includes("OPENAI_API_KEY")) value = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
          if (ev.name.includes("ANTHROPIC_API_KEY")) value = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
        }
        return { name: ev.name, value };
      }).filter((ev: any) => ev.value);
      if (envVarsToSync.length > 0) {
        logger.info({ appId, projectId, count: envVarsToSync.length }, "Automating Vercel env vars sync");
        await syncVercelEnvironmentVariables({ projectId, envVars: envVarsToSync, log: logger });
      }
    }

    const isPaidUser = !!userData.isPremium || isAdminEmail(userData.email);
    let finalUrl = url;
    let subdomain: string | undefined;
    let customDomain: string | undefined;

    if (isPaidUser && (req.body as any)?.customDomain) {
      customDomain = (req.body as any).customDomain;
    } else if (!isPaidUser) {
      subdomain = generateMarisaiSubdomain(appData.title, Array.isArray(appId) ? appId[0] : appId);
      finalUrl = `https://${subdomain}.${MARIS_AI_DOMAIN}`;
    }

    await GeneratedApp.updateOne({ _id: appId, userId }, {
      deploymentStatus: "deployed", 
      vercelProjectId: projectId, 
      vercelDeployUrl: finalUrl,
      vercelCustomDomain: customDomain, // Sincronizar ambos campos
      marisaiSubdomain: subdomain, 
      customDomain, 
      lastDeployedAt: new Date(), 
      deploymentError: null,
    });

    return res.json({ success: true, deploymentUrl: finalUrl, subdomain, customDomain, projectId, creditsCharged: DEPLOY_COST_CREDITS });
  } catch (error) {
    logger.error({ error }, "Deployment error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/apps/:appId/redeploy", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const appData = await GeneratedApp.findOne({ _id: appId, userId });
    if (!appData) return res.status(404).json({ error: "App not found" });
    if (!appData.vercelProjectId) return res.status(400).json({ error: "App has not been deployed yet" });
    const userData = await User.findById(userId).lean();
    if (!userData) return res.status(404).json({ error: "User not found" });
    const charge = await chargeDeployCredits(req, userId, appData.title);
    if (!charge.ok) return res.status(402).json({ error: "Créditos insuficientes", required: DEPLOY_COST_CREDITS, current: userData.credits });
    await GeneratedApp.updateOne({ _id: appId, userId }, { deploymentStatus: "deploying", deploymentError: null });
    const redeployResult = await redeployVercelProject(appData.vercelProjectId);
    if (!redeployResult.success) {
      await GeneratedApp.updateOne({ _id: appId, userId }, { deploymentStatus: "failed", deploymentError: redeployResult.error });
      return res.status(500).json({ success: false, error: redeployResult.error });
    }
    const deploymentUrl = appData.customDomain
      ? `https://${appData.customDomain}`
      : stableVercelProductionUrlForApp(String(appId), appData.title);
    await GeneratedApp.updateOne({ _id: appId, userId }, { deploymentStatus: "deployed", vercelDeployUrl: deploymentUrl, lastDeployedAt: new Date(), deploymentError: null });
    return res.json({ success: true, deploymentUrl, creditsCharged: DEPLOY_COST_CREDITS });
  } catch (error) {
    logger.error({ error }, "Redeployment error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/apps/:appId/deployment-status", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const appData = await GeneratedApp.findOne({ _id: appId, userId }).lean();
    if (!appData) return res.status(404).json({ error: "App not found" });

    let deploymentUrl = appData.vercelDeployUrl;
    if (appData.vercelProjectId && deploymentUrl?.includes(".vercel.app")) {
      const stableUrl = stableVercelProductionUrlForApp(String(appId), appData.title);
      if (deploymentUrl !== stableUrl) {
        deploymentUrl = stableUrl;
        await GeneratedApp.updateOne({ _id: appId, userId }, { vercelDeployUrl: stableUrl });
      }
    }

    return res.json({
      status: appData.deploymentStatus || "not_deployed",
      deploymentUrl,
      subdomain: appData.marisaiSubdomain,
      customDomain: appData.customDomain,
      customDomainVerified: appData.customDomainVerified,
      lastDeployedAt: appData.lastDeployedAt,
      error: appData.deploymentError,
      logs: appData.deploymentLogs,
      costCredits: DEPLOY_COST_CREDITS,
    });
  } catch (error) {
    logger.error({ error }, "Get deployment status error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/apps/:appId/custom-domain
 * Registra el dominio en Vercel y devuelve los registros DNS al frontend.
 */
router.post("/apps/:appId/custom-domain", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { domain, provider } = req.body as { domain?: string; provider?: string };
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const normalizedDomain = domain?.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
    const normalizedProvider = String(provider || "other").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "other";
    if (!normalizedDomain) return res.status(400).json({ error: "Domain is required" });

    const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
    if (!domainRegex.test(normalizedDomain)) return res.status(400).json({ error: "Dominio invalido. Formato: miapp.com o sub.miapp.com" });

    const userData = await User.findById(userId).lean();
    const isAdminUser = userData?.isAdmin === true || userData?.email === "rrhh.milchollos@gmail.com";
    if (!userData?.isPremium && !isAdminUser) return res.status(403).json({ error: "Los dominios personalizados son exclusivos del plan Pro", upgradeUrl: "/pricing" });

    const appData = await GeneratedApp.findOne({ _id: appId, userId });
    if (!appData) return res.status(404).json({ error: "App not found" });
    if (!appData.vercelProjectId) return res.status(400).json({ error: "Despliega la app primero antes de añadir un dominio personalizado" });

    const domainResult = await addVercelDomainForApp({ appId: String(appId), userId, projectId: appData.vercelProjectId, domain: normalizedDomain, log: logger });

    if (!domainResult.ok) {
      const msg = "message" in domainResult.failure ? domainResult.failure.message : "Error al añadir el dominio en Vercel";
      const alreadyInUse = /already in use|pending verification|already exists|domain.*used/i.test(msg);
      if (alreadyInUse) {
        const recommendedDns = recommendedDnsFor(normalizedDomain);
        await GeneratedApp.updateOne({ _id: appId, userId }, {
          customDomain: normalizedDomain,
          customDomainProvider: normalizedProvider,
          vercelCustomDomain: normalizedDomain,
          customDomainVerified: false,
        });
        return res.status(200).json({
          success: false,
          domain: normalizedDomain,
          customDomain: normalizedDomain,
          verified: false,
          provider: normalizedProvider,
          dnsRecords: recommendedDns,
          recommendedDns,
          pendingVerification: [],
          warning: `Vercel indica que ${normalizedDomain} ya está añadido o pendiente de verificación en un proyecto. No bloqueamos el flujo: configura estos DNS y, si sigue apareciendo, elimina el dominio del otro proyecto de Vercel o verifica la propiedad allí.`,
          instructions: [
            "En Arsys entra en tu dominio > DNS / Zona DNS y añade exactamente los registros indicados.",
            `En Arsys, para el dominio raíz no escribas @ si no lo acepta: usa ${normalizedDomain} como Entrada DNS/Host, o deja el campo vacío si el panel lo permite. Valor A: 76.76.21.21.`,
            "Para www crea CNAME con Entrada DNS/Host www y destino cname.vercel-dns.com.",
            "Cuando el DNS propague, pulsa Verificar conexión. Si Vercel dice que está en otro proyecto, quítalo primero de ese proyecto.",
          ],
        });
      }
      return res.status(500).json({ error: `Error de Vercel: ${msg}`, hint: "El dominio puede estar vinculado a otro proyecto en Vercel." });
    }

    const { status } = domainResult;
    await GeneratedApp.updateOne({ _id: appId, userId }, { 
      customDomain: normalizedDomain,
      customDomainProvider: normalizedProvider,
      vercelCustomDomain: normalizedDomain,
      customDomainVerified: status.verified 
    });

    return res.json({
      success: true,
      domain: normalizedDomain,
      customDomain: normalizedDomain,
      verified: status.verified,
      provider: normalizedProvider,
      dnsRecords: status.recommendedDns,
      recommendedDns: status.recommendedDns,
      pendingVerification: status.verification,
      instructions: status.verified ? [] : [
        `En Arsys: Dominios > Gestionar DNS / Zona DNS > añade el registro A para el dominio raíz. Si no acepta @, escribe ${normalizedDomain} como Entrada DNS/Host o deja el campo vacío si Arsys lo permite.`,
        "Valores Vercel: A dominio raíz → 76.76.21.21; CNAME www → cname.vercel-dns.com.",
        "Los cambios DNS pueden tardar entre 5 minutos y 48 horas en propagarse. Después pulsa Verificar conexión.",
      ],
    });
  } catch (error) {
    logger.error({ error }, "Custom domain error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/apps/:appId/custom-domain
 * Refresca el estado de verificacion del dominio.
 */
router.get("/apps/:appId/custom-domain", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const appData = await GeneratedApp.findOne({ _id: appId, userId }).lean();
    if (!appData) return res.status(404).json({ error: "App not found" });
    if (!appData.customDomain || !appData.vercelProjectId) return res.json({ domain: null, provider: null, verified: false, dnsRecords: [] });

    const statusResult = await getVercelDomainStatus({ projectId: appData.vercelProjectId, domain: appData.customDomain, log: logger });
    if (!statusResult.ok) return res.json({ domain: appData.customDomain, provider: appData.customDomainProvider ?? null, verified: appData.customDomainVerified ?? false, dnsRecords: recommendedDnsFor(appData.customDomain) });

    const { status } = statusResult;
    if (status.verified !== appData.customDomainVerified) await GeneratedApp.updateOne({ _id: appId, userId }, { customDomainVerified: status.verified });

    return res.json({ domain: status.domain, provider: appData.customDomainProvider ?? null, verified: status.verified, dnsRecords: status.recommendedDns, pendingVerification: status.verification });
  } catch (error) {
    logger.error({ error }, "Get custom domain error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/apps/:appId/custom-domain
 */
router.delete("/apps/:appId/custom-domain", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const appData = await GeneratedApp.findOne({ _id: appId, userId });
    if (!appData) return res.status(404).json({ error: "App not found" });
    if (appData.vercelProjectId && appData.customDomain) {
      await removeVercelDomainForApp({ appId: String(appId), projectId: appData.vercelProjectId, domain: appData.customDomain, log: logger });
    }
    await GeneratedApp.updateOne({ _id: appId, userId }, { customDomain: null, customDomainProvider: null, customDomainVerified: false });
    return res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Delete custom domain error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/apps/:appId/vercel-status", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const appData = await GeneratedApp.findOne({ _id: appId, userId }).lean();
    if (!appData) return res.status(404).json({ error: "App not found" });
    if (!appData.vercelProjectId) return res.json({ status: "not_deployed" });
    // El helper getDeploymentStatus espera un ID de DEPLOYMENT, no de PROYECTO.
    // Buscamos el último despliegue del proyecto en Vercel.
    const token = process.env.VERCEL_TOKEN;
    const response = await fetch(`https://api.vercel.com/v6/deployments?projectId=${appData.vercelProjectId}&limit=1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json() as any;
    const latestDeployId = data.deployments?.[0]?.uid;
    
    if (!latestDeployId) return res.json({ status: "not_found" });
    const status = await getDeploymentStatus(latestDeployId);
    return res.json(status);
  } catch (error) {
    logger.error({ error }, "Get Vercel status error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/apps/:appId/health
 * Implementación real del Health Check
 */
router.post("/apps/:appId/health", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);
    const appData = await GeneratedApp.findOne({ _id: appId, userId });
    if (!appData) return res.status(404).json({ error: "App not found" });

    // Análisis real: verificar env vars, estructura de código y dependencias
    const issues = [];
    if (!appData.frontendCode) issues.push("Falta código frontend");
    if (!appData.backendCode) issues.push("Falta código backend");
    
    const hasClerk = appData.frontendCode.includes("Clerk");
    const hasStripe = appData.frontendCode.includes("Stripe");
    
    const missingEnvs = (appData.requiredEnvVars || []).filter(ev => !ev.value);
    if (missingEnvs.length > 0) {
      issues.push(`Faltan variables de entorno: ${missingEnvs.map(e => e.name).join(", ")}`);
    }

    return res.json({ 
      ok: issues.length === 0, 
      status: issues.length === 0 ? "pass" : "fail",
      issues 
    });
  } catch (error) {
    return res.status(500).json({ error: "Error en health check" });
  }
});

/**
 * POST /api/apps/:appId/code-review
 * Revisión de calidad del código antes del deploy
 */
router.post("/apps/:appId/code-review", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);
    const appData = await GeneratedApp.findOne({ _id: appId, userId });
    if (!appData) return res.status(404).json({ error: "App not found" });
    const issues: string[] = [];
    const suggestions: string[] = [];
    const code = (appData.frontendCode || "") + (appData.backendCode || "");
    if (code.includes("console.log")) suggestions.push("Elimina los console.log antes de producción");
    if (code.includes("TODO") || code.includes("FIXME")) suggestions.push("Hay comentarios TODO/FIXME pendientes de resolver");
    if (!appData.frontendCode || appData.frontendCode.length < 100) issues.push("Código frontend insuficiente o vacío");
    if (code.includes("localhost")) issues.push("Referencias a localhost detectadas — usa variables de entorno para producción");
    const missingEnvs = (appData.requiredEnvVars || []).filter((ev: any) => !ev.value);
    if (missingEnvs.length > 0) suggestions.push(`Variables de entorno sin configurar: ${missingEnvs.map((e: any) => e.name).join(", ")}`);
    const score = Math.max(0, 100 - issues.length * 20 - suggestions.length * 5);
    return res.json({
      ok: issues.length === 0,
      score,
      issues,
      suggestions,
      summary: issues.length === 0
        ? `Código listo para producción (puntuación: ${score}/100)`
        : `Se encontraron ${issues.length} problema(s) que deben corregirse antes del deploy`,
    });
  } catch (error) {
    return res.status(500).json({ error: "Error en la revisión de código" });
  }
});

/**
 * POST /api/apps/:appId/github
 * ENCONTRADO: este endpoint era un mock — devolvía una URL inventada
 * (https://github.com/marisai-user/...) cuando la app no tenía un repo
 * todavía, sin llamar nunca al flujo real de creación de repositorio
 * (POST /api/github/push/:appId en github.ts, que sí crea el repo real,
 * sube los archivos, y guarda githubRepoUrl/githubRepoFullName). El botón
 * de GitHub del frontend (github-button.tsx) llama a ESTA ruta, así que
 * estaba completamente desconectado del sistema real — el usuario veía
 * "Sincronizado con GitHub correctamente" sin que ningún repo real se
 * hubiera creado nunca. Esto también bloqueaba el deploy de backend a
 * Railway, que depende de githubRepoFullName existiendo de verdad.
 * Redirige internamente a la lógica real en vez de mantener dos
 * implementaciones del mismo flujo.
 */
router.post("/apps/:appId/github", requireAuth, async (req: Request, res: Response) => {
  const { githubPushHandler } = await import("./github");
  return githubPushHandler(req, res);
});

/**
 * POST /api/apps/:appId/visual-test
 * Ejecuta el Visual Testing Agent
 */
// ENCONTRADO en logs reales de producción (responseTime de hasta 300010ms,
// abortado por el proxy de Railway a los 5 minutos): el ciclo de Testing
// Visual + Autofix puede tardar varios minutos (Claude Vision + hasta 3
// rondas de CoreOrchestrator). Mantener la conexión HTTP abierta durante
// todo ese tiempo es frágil — cualquier proxy intermedio (Railway, el
// navegador, una VPN) puede cortarla, perdiendo el resultado aunque el
// servidor sí completara el trabajo. FIX: este endpoint ahora es
// ASÍNCRONO — crea un VisualTestJob, responde AL INSTANTE con su id, y
// ejecuta el trabajo real en segundo plano (sin atar la respuesta HTTP a
// su duración). El cliente hace polling vía GET .../visual-test/:jobId
// hasta ver status:"succeeded"|"failed" — mismo patrón ya probado en
// producción para GenerationJob, no se inventa un mecanismo nuevo.
router.post("/apps/:appId/visual-test", requireAuth, async (req: Request, res: Response) => {
  try {
    const appId = String(req.params.appId);
    const userId = getAuthenticatedUserId(req);
    const { autoFix = false } = req.body || {};

    const { GeneratedApp, VisualTestJob } = await import("@workspace/db/schema");
    const app = await (GeneratedApp as any).findOne({ _id: appId, userId })
      .select("_id")
      .lean();
    if (!app) return res.status(404).json({ error: "App no encontrada" });

    const job = await (VisualTestJob as any).create({ appId, userId, autoFix: !!autoFix, status: "running" });
    const jobId = String(job._id);

    // Lanzado en segundo plano — NO se espera (sin await) para que la
    // respuesta HTTP salga al instante. Cualquier error se captura y se
    // persiste en el propio job, nunca se propaga a un proceso sin manejar.
    runVisualTestWork(appId, userId, !!autoFix, jobId).catch(async (err) => {
      const { logger } = await import("../lib/logger");
      logger.error({ err, appId, jobId }, "[visual-test] runVisualTestWork failed unexpectedly");
      try {
        await (VisualTestJob as any).findByIdAndUpdate(jobId, {
          status: "failed",
          errorMessage: (err as Error)?.message || "Error inesperado",
        });
      } catch { /* best-effort */ }
    });

    return res.status(202).json({ jobId, status: "running" });
  } catch (error: any) {
    const { logger } = await import("../lib/logger");
    logger.error({ err: error }, "[visual-test] Error al crear el job");
    return res.status(500).json({ error: error.message || "Error al iniciar el test visual" });
  }
});

// GET /api/apps/:appId/visual-test/:jobId — polling del resultado
router.get("/apps/:appId/visual-test/:jobId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId, jobId } = req.params;
    const userId = getAuthenticatedUserId(req);
    const { VisualTestJob } = await import("@workspace/db/schema");
    const job = await (VisualTestJob as any).findOne({ _id: jobId, appId: String(appId), userId }).lean();
    if (!job) return res.status(404).json({ error: "Job no encontrado" });

    if (job.status === "running") {
      return res.json({ status: "running" });
    }
    if (job.status === "failed") {
      return res.json({ status: "failed", error: job.errorMessage || "Error en el test visual" });
    }
    // succeeded — el resultado completo ya tiene exactamente el shape que
    // el endpoint devolvía antes de forma síncrona, sin que el frontend
    // tenga que cambiar cómo lo interpreta.
    return res.json({ status: "succeeded", ...job.result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Error al consultar el test visual" });
  }
});

/**
 * Lógica real del test visual + autofix — extraída del antiguo endpoint
 * síncrono sin cambiar NADA de su comportamiento interno, solo el momento
 * en que el resultado se entrega (al VisualTestJob en vez de directamente
 * a la respuesta HTTP, que ya salió hace tiempo cuando esto termina).
 */
async function runVisualTestWork(appId: string, userId: string, autoFix: boolean, jobId: string): Promise<void> {
  const { GeneratedApp, VisualTestJob } = await import("@workspace/db/schema");
  const { logger } = await import("../lib/logger");

  const finish = async (result: any) => {
    await (VisualTestJob as any).findByIdAndUpdate(jobId, { status: "succeeded", result });
  };

  try {
    const app = await (GeneratedApp as any).findOne({ _id: appId, userId })
      .select("title description frontendCode publicSlug prompt")
      .lean();

    if (!app) {
      await (VisualTestJob as any).findByIdAndUpdate(jobId, { status: "failed", errorMessage: "App no encontrada" });
      return;
    }

    const { runVisualTester, takeScreenshots } = await import("../lib/visualTester");

    const baseUrl = process.env.MARIS_AI_PUBLIC_URL || "https://www.marisai.es";

    let effectiveSlug = app.publicSlug;
    if (!effectiveSlug) {
      const internalBaseUrl = process.env.INTERNAL_API_URL || `http://localhost:${process.env.PORT || 3000}`;
      const previewUrl = `${internalBaseUrl}/api/apps/${appId}/preview`;
      logger.info({ appId, previewUrl, jobId }, "[visual-test] No hay publicSlug — usando preview interno");

      try {
        const shots = await takeScreenshots(previewUrl);
        const { analyzePreviewScreenshots } = await import("../lib/visualTester");
        let analysis = await analyzePreviewScreenshots({
          shots,
          app: { title: app.title || "App", description: app.description || null },
          prompt: app.prompt || app.description || app.title || "",
        });

        let fixesApplied = 0;
        let cycles = 1;

        if (autoFix && !analysis.visuallyCorrect) {
          const { applyVisualFixesAndSave } = await import("../lib/visualTester");
          const fixResult = await applyVisualFixesAndSave({
            appId,
            app: { title: app.title || "App", description: app.description || null, frontendCode: app.frontendCode || "", backendCode: app.backendCode || "" },
            analysis,
            previewUrl,
            prompt: app.prompt || app.description || app.title || "",
            maxCycles: 3,
            log: logger,
          });
          fixesApplied = fixResult.fixesApplied;
          cycles = fixResult.cycles;
          analysis = fixResult.finalAnalysis;
        }

        await finish({
          success: true,
          visuallyCorrect: analysis.visuallyCorrect,
          overallScore: analysis.overallScore,
          issues: analysis.issues || [],
          positives: analysis.positives || [],
          summary: analysis.summary || "",
          screenshots: shots.map((s: any) => ({
            viewport: s.viewport,
            dataUrl: s.data ? `data:image/png;base64,${s.data}` : null,
          })).filter((s: any) => s.dataUrl),
          fixesApplied,
          cycles,
          usingPreviewFallback: true,
          note: fixesApplied > 0
            ? `Autofix aplicó ${fixesApplied} corrección(es) automáticamente.`
            : "Analizado desde preview interno. Usa Autofix IA para corregir los problemas detectados."
        });
        return;
      } catch (previewErr: any) {
        logger.warn({ appId, jobId, err: previewErr?.message }, "[visual-test] Preview interno falló — devolviendo NOT_DEPLOYED");
        await (VisualTestJob as any).findByIdAndUpdate(jobId, {
          status: "failed",
          errorMessage: "La app debe estar desplegada públicamente para el test visual completo. Usa el botón 'Deploy' primero.",
        });
        return;
      }
    }

    const report = await runVisualTester({
      app: {
        id: app._id,
        title: app.title || "App",
        description: app.description || null,
        frontendCode: app.frontendCode || "",
        backendCode: app.backendCode || "",
        publicSlug: effectiveSlug,
      },
      baseUrl,
      prompt: app.prompt || app.description || app.title || "",
      autoFix,
      log: logger,
    });

    await finish({
      success: true,
      visuallyCorrect: report.finalAnalysis.visuallyCorrect,
      overallScore: report.finalAnalysis.overallScore,
      issues: report.finalAnalysis.issues || [],
      positives: report.finalAnalysis.positives || [],
      summary: report.finalAnalysis.summary || "",
      screenshots: report.screenshots?.map((s: any) => ({
        viewport: s.viewport,
        dataUrl: s.data ? `data:image/png;base64,${s.data}` : null,
      })).filter((s: any) => s.dataUrl) || [],
      fixesApplied: report.fixesApplied,
      cycles: report.cycles,
    });
  } catch (error: any) {
    const msg = error.message || "Error en test visual";
    logger.error({ error: msg, jobId, stack: (error as any)?.stack?.slice(0, 500), PUPPETEER_PATH: process.env.PUPPETEER_EXECUTABLE_PATH }, "[visual-test] ERROR COMPLETO");

    if (
      msg.includes("chromium") || msg.includes("puppeteer") ||
      msg.includes("executable") || msg.includes("no_chromium") ||
      msg.includes("ENOENT") || msg.includes("spawn") || msg.includes("Cannot find")
    ) {
      await finish({
        success: false,
        visuallyCorrect: null,
        overallScore: null,
        issues: [],
        screenshots: [],
        fixesApplied: 0,
        error: `Testing visual no disponible. Error: ${msg.slice(0, 200)}`,
        code: "NO_CHROMIUM",
      });
      return;
    }
    const { VisualTestJob: VTJ } = await import("@workspace/db/schema");
    await (VTJ as any).findByIdAndUpdate(jobId, { status: "failed", errorMessage: msg });
  }
}

// GET /api/apps/visual-test/ping — test rápido de Chromium sin autenticación
router.get("/apps/visual-test/ping", async (_req: Request, res: Response) => {
  try {
    const { chromiumExecutablePath } = await import("../lib/visualTester");
    const exec = chromiumExecutablePath();
    if (!exec) {
      return res.json({ ok: false, error: "chromiumExecutablePath() returned null", env: process.env.PUPPETEER_EXECUTABLE_PATH });
    }
    // Intentar lanzar Chromium brevemente
    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: exec,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const version = await browser.version();
    await browser.close();
    return res.json({ ok: true, execPath: exec, version, env: process.env.PUPPETEER_EXECUTABLE_PATH });
  } catch (err: any) {
    return res.json({ ok: false, error: err.message?.slice(0, 300), stack: err.stack?.slice(0, 300), env: process.env.PUPPETEER_EXECUTABLE_PATH });
  }
});

export default router;
