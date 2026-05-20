import { Router, type Request, type Response } from "express";
import { requireAuth, isAdminEmail } from "../lib/auth";
import { GeneratedApp, User } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { chargeCredits } from "../lib/credits";
import {
  createVercelProject,
  redeployVercelProject,
  verifyCustomDomain,
  getDeploymentStatus,
  generateMarisaiSubdomain,
  type DeploymentConfig,
} from "../lib/deployment";

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

/**
 * POST /api/apps/:appId/deploy
 * Deploy an app to Vercel. Cada ejecución consume 50 créditos para usuarios no admin.
 */
router.post("/apps/:appId/deploy", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const appData = await GeneratedApp.findOne({ _id: appId, userId });
    if (!appData) {
      return res.status(404).json({ error: "App not found" });
    }

    const userData = await User.findById(userId).lean();
    if (!userData) {
      return res.status(404).json({ error: "User not found" });
    }

    const charge = await chargeDeployCredits(req, userId, appData.title);
    if (!charge.ok) {
      return res.status(402).json({
        error: "Créditos insuficientes",
        required: DEPLOY_COST_CREDITS,
        current: userData.credits,
      });
    }

    const isPaidUser = !!userData.isPremium;

    await GeneratedApp.updateOne(
      { _id: appId, userId },
      { deploymentStatus: "deploying", deploymentError: null },
    );

    const deploymentConfig: DeploymentConfig = {
      appId,
      userId,
      projectName: appData.title,
      frontendCode: appData.frontendCode,
      backendCode: appData.backendCode,
      customDomain: (req.body as any)?.customDomain,
      isPaidUser,
    };

    const deploymentResult = await createVercelProject(deploymentConfig);

    if (!deploymentResult.success) {
      await GeneratedApp.updateOne(
        { _id: appId, userId },
        {
          deploymentStatus: "failed",
          deploymentError: deploymentResult.error,
          deploymentLogs: deploymentResult.logs,
        },
      );

      return res.status(500).json({
        success: false,
        error: deploymentResult.error,
      });
    }

    const subdomain = deploymentResult.subdomain
      ? generateMarisaiSubdomain(appData.title, appId)
      : undefined;

    await GeneratedApp.updateOne(
      { _id: appId, userId },
      {
        deploymentStatus: "deployed",
        vercelProjectId: deploymentResult.projectId,
        vercelDeployUrl: deploymentResult.deploymentUrl,
        marisaiSubdomain: subdomain,
        customDomain: isPaidUser ? deploymentResult.customDomain : undefined,
        lastDeployedAt: new Date(),
        deploymentError: null,
      },
    );

    return res.json({
      success: true,
      deploymentUrl: deploymentResult.deploymentUrl,
      subdomain,
      customDomain: deploymentResult.customDomain,
      projectId: deploymentResult.projectId,
      creditsCharged: DEPLOY_COST_CREDITS,
    });
  } catch (error) {
    logger.error({ error }, "Deployment error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/apps/:appId/redeploy
 * Re-deploy an existing app. Cada ejecución consume 50 créditos para usuarios no admin.
 */
router.post("/apps/:appId/redeploy", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const appData = await GeneratedApp.findOne({ _id: appId, userId });
    if (!appData) {
      return res.status(404).json({ error: "App not found" });
    }

    if (!appData.vercelProjectId) {
      return res.status(400).json({ error: "App has not been deployed yet" });
    }

    const userData = await User.findById(userId).lean();
    if (!userData) {
      return res.status(404).json({ error: "User not found" });
    }

    const charge = await chargeDeployCredits(req, userId, appData.title);
    if (!charge.ok) {
      return res.status(402).json({
        error: "Créditos insuficientes",
        required: DEPLOY_COST_CREDITS,
        current: userData.credits,
      });
    }

    await GeneratedApp.updateOne(
      { _id: appId, userId },
      { deploymentStatus: "deploying", deploymentError: null },
    );

    const redeployResult = await redeployVercelProject(appData.vercelProjectId);

    if (!redeployResult.success) {
      await GeneratedApp.updateOne(
        { _id: appId, userId },
        {
          deploymentStatus: "failed",
          deploymentError: redeployResult.error,
        },
      );

      return res.status(500).json({
        success: false,
        error: redeployResult.error,
      });
    }

    await GeneratedApp.updateOne(
      { _id: appId, userId },
      {
        deploymentStatus: "deployed",
        vercelDeployUrl: redeployResult.deploymentUrl,
        lastDeployedAt: new Date(),
        deploymentError: null,
      },
    );

    return res.json({
      success: true,
      deploymentUrl: redeployResult.deploymentUrl,
      creditsCharged: DEPLOY_COST_CREDITS,
    });
  } catch (error) {
    logger.error({ error }, "Redeployment error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/apps/:appId/deployment-status
 * Get deployment status
 */
router.get("/apps/:appId/deployment-status", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const appData = await GeneratedApp.findOne({ _id: appId, userId }).lean();
    if (!appData) {
      return res.status(404).json({ error: "App not found" });
    }

    return res.json({
      status: appData.deploymentStatus || "not_deployed",
      deploymentUrl: appData.vercelDeployUrl,
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
 * Add or update custom domain (paid users only)
 */
router.post("/apps/:appId/custom-domain", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { domain } = req.body as { domain?: string };
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!domain) {
      return res.status(400).json({ error: "Domain is required" });
    }

    const userData = await User.findById(userId).lean();
    if (!userData?.isPremium) {
      return res.status(403).json({ error: "Custom domains are available for paid users only" });
    }

    const appData = await GeneratedApp.findOne({ _id: appId, userId });
    if (!appData) {
      return res.status(404).json({ error: "App not found" });
    }

    const verificationResult = await verifyCustomDomain(domain, appData.vercelProjectId || "");

    await GeneratedApp.updateOne(
      { _id: appId, userId },
      {
        customDomain: domain,
        customDomainVerified: verificationResult.verified,
      },
    );

    return res.json({
      success: true,
      domain,
      verified: verificationResult.verified,
      instructions: verificationResult.instructions,
    });
  } catch (error) {
    logger.error({ error }, "Custom domain error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/apps/:appId/vercel-status
 * Get real-time Vercel deployment status
 */
router.get("/apps/:appId/vercel-status", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const appData = await GeneratedApp.findOne({ _id: appId, userId }).lean();
    if (!appData) {
      return res.status(404).json({ error: "App not found" });
    }

    if (!appData.vercelProjectId) {
      return res.json({ status: "not_deployed" });
    }

    const status = await getDeploymentStatus(appData.vercelProjectId);
    return res.json(status);
  } catch (error) {
    logger.error({ error }, "Get Vercel status error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
