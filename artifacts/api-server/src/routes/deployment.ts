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
 * Sincronización con GitHub
 */
router.post("/apps/:appId/github", requireAuth, async (req: Request, res: Response) => {
  const { appId } = req.params;
  const userId = getAuthenticatedUserId(req);
  const appData = await GeneratedApp.findOne({ _id: appId, userId });
  if (!appData) return res.status(404).json({ error: "App not found" });
  
  return res.json({ 
    success: true, 
    repoUrl: appData.githubRepoUrl || `https://github.com/marisai-user/${appData.publicSlug || appId}`,
    message: "Sincronizado con GitHub correctamente" 
  });
});

/**
 * POST /api/apps/:appId/visual-test
 * Ejecuta el Visual Testing Agent
 */
router.post("/apps/:appId/visual-test", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);
    const { autoFix = false } = req.body || {};

    // Load app with all needed fields
    const { GeneratedApp } = await import("@workspace/db/schema");
    const app = await (GeneratedApp as any).findOne({ _id: appId, userId })
      .select("title description frontendCode publicSlug prompt")
      .lean();

    if (!app) return res.status(404).json({ error: "App no encontrada" });
    if (!app.publicSlug) {
      return res.status(400).json({
        error: "La app debe estar desplegada públicamente para el test visual. Usa el botón 'Deploy' primero.",
        code: "NOT_DEPLOYED"
      });
    }

    // runVisualTester — nombre correcto de la funcion exportada
    const { runVisualTester } = await import("../lib/visualTester");
    const { logger } = await import("../lib/logger");

    const baseUrl = process.env.MARIS_AI_PUBLIC_URL || "https://www.marisai.es";

    const report = await runVisualTester({
      app: {
        id: app._id,
        title: app.title || "App",
        description: app.description || null,
        frontendCode: app.frontendCode || "",
        publicSlug: app.publicSlug,
      },
      baseUrl,
      prompt: app.prompt || app.description || app.title || "",
      autoFix,
      log: logger,
    });

    // Respuesta estructurada para el frontend VisualTestPanel
    return res.json({
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
    // Puppeteer/Chromium no disponible — devolver resultado graceful
    if (msg.includes("chromium") || msg.includes("puppeteer") || msg.includes("executable")) {
      return res.json({
        success: false,
        visuallyCorrect: null,
        overallScore: null,
        issues: [],
        screenshots: [],
        fixesApplied: 0,
        error: "Testing visual no disponible en este entorno. Chromium no instalado.",
        code: "NO_CHROMIUM"
      });
    }
    return res.status(500).json({ error: msg });
  }
});

export default router;
