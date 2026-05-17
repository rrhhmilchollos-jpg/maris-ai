import { Router, Request, Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db } from "../lib/db";
import { generatedApps, users } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  createVercelProject,
  redeployVercelProject,
  verifyCustomDomain,
  getDeploymentStatus,
  generateMarisaiSubdomain,
  type DeploymentConfig,
} from "../lib/deployment";

const router = Router();

/**
 * POST /api/apps/:appId/deploy
 * Deploy an app to Vercel
 */
router.post("/apps/:appId/deploy", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Get app
    const app = await db
      .select()
      .from(generatedApps)
      .where(and(eq(generatedApps.id, parseInt(appId)), eq(generatedApps.userId, userId)))
      .limit(1);

    if (app.length === 0) {
      return res.status(404).json({ error: "App not found" });
    }

    const appData = app[0];

    // Get user subscription status
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = user[0];
    const isPaidUser = userData.subscriptionStatus === "active";

    // Update deployment status to "deploying"
    await db
      .update(generatedApps)
      .set({ deploymentStatus: "deploying" })
      .where(eq(generatedApps.id, parseInt(appId)));

    // Create deployment config
    const deploymentConfig: DeploymentConfig = {
      appId,
      userId,
      projectName: appData.title,
      frontendCode: appData.frontendCode,
      backendCode: appData.backendCode,
      customDomain: req.body?.customDomain,
      isPaidUser,
    };

    // Deploy to Vercel
    const deploymentResult = await createVercelProject(deploymentConfig);

    if (!deploymentResult.success) {
      await db
        .update(generatedApps)
        .set({
          deploymentStatus: "failed",
          deploymentError: deploymentResult.error,
          deploymentLogs: deploymentResult.logs,
        })
        .where(eq(generatedApps.id, parseInt(appId)));

      return res.status(500).json({
        success: false,
        error: deploymentResult.error,
      });
    }

    // Update app with deployment info
    const subdomain = deploymentResult.subdomain
      ? generateMarisaiSubdomain(appData.title, appId)
      : undefined;

    await db
      .update(generatedApps)
      .set({
        deploymentStatus: "deployed",
        vercelProjectId: deploymentResult.projectId,
        vercelDeployUrl: deploymentResult.deploymentUrl,
        marisaiSubdomain: subdomain,
        customDomain: isPaidUser ? deploymentResult.customDomain : undefined,
        lastDeployedAt: new Date(),
        deploymentError: null,
      })
      .where(eq(generatedApps.id, parseInt(appId)));

    return res.json({
      success: true,
      deploymentUrl: deploymentResult.deploymentUrl,
      subdomain,
      customDomain: deploymentResult.customDomain,
      projectId: deploymentResult.projectId,
    });
  } catch (error) {
    logger.error("Deployment error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/apps/:appId/redeploy
 * Re-deploy an existing app
 */
router.post("/apps/:appId/redeploy", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Get app
    const app = await db
      .select()
      .from(generatedApps)
      .where(and(eq(generatedApps.id, parseInt(appId)), eq(generatedApps.userId, userId)))
      .limit(1);

    if (app.length === 0) {
      return res.status(404).json({ error: "App not found" });
    }

    const appData = app[0];

    if (!appData.vercelProjectId) {
      return res.status(400).json({ error: "App has not been deployed yet" });
    }

    // Update deployment status
    await db
      .update(generatedApps)
      .set({ deploymentStatus: "deploying" })
      .where(eq(generatedApps.id, parseInt(appId)));

    // Redeploy
    const redeployResult = await redeployVercelProject(appData.vercelProjectId);

    if (!redeployResult.success) {
      await db
        .update(generatedApps)
        .set({
          deploymentStatus: "failed",
          deploymentError: redeployResult.error,
        })
        .where(eq(generatedApps.id, parseInt(appId)));

      return res.status(500).json({
        success: false,
        error: redeployResult.error,
      });
    }

    // Update app
    await db
      .update(generatedApps)
      .set({
        deploymentStatus: "deployed",
        vercelDeployUrl: redeployResult.deploymentUrl,
        lastDeployedAt: new Date(),
        deploymentError: null,
      })
      .where(eq(generatedApps.id, parseInt(appId)));

    return res.json({
      success: true,
      deploymentUrl: redeployResult.deploymentUrl,
    });
  } catch (error) {
    logger.error("Redeployment error:", error);
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
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Get app
    const app = await db
      .select()
      .from(generatedApps)
      .where(and(eq(generatedApps.id, parseInt(appId)), eq(generatedApps.userId, userId)))
      .limit(1);

    if (app.length === 0) {
      return res.status(404).json({ error: "App not found" });
    }

    const appData = app[0];

    return res.json({
      status: appData.deploymentStatus || "not_deployed",
      deploymentUrl: appData.vercelDeployUrl,
      subdomain: appData.marisaiSubdomain,
      customDomain: appData.customDomain,
      customDomainVerified: appData.customDomainVerified,
      lastDeployedAt: appData.lastDeployedAt,
      error: appData.deploymentError,
      logs: appData.deploymentLogs,
    });
  } catch (error) {
    logger.error("Status check error:", error);
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
    const { domain } = req.body;
    const userId = req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!domain) {
      return res.status(400).json({ error: "Domain is required" });
    }

    // Get user subscription status
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user.length === 0 || user[0].subscriptionStatus !== "active") {
      return res.status(403).json({ error: "Only paid users can add custom domains" });
    }

    // Get app
    const app = await db
      .select()
      .from(generatedApps)
      .where(and(eq(generatedApps.id, parseInt(appId)), eq(generatedApps.userId, userId)))
      .limit(1);

    if (app.length === 0) {
      return res.status(404).json({ error: "App not found" });
    }

    const appData = app[0];

    if (!appData.vercelProjectId) {
      return res.status(400).json({ error: "App must be deployed first" });
    }

    // Verify domain ownership
    const verified = await verifyCustomDomain(appData.vercelProjectId, domain);

    if (!verified) {
      return res.status(400).json({
        error: "Domain verification failed. Please ensure your DNS records are correctly configured.",
      });
    }

    // Update app with custom domain
    await db
      .update(generatedApps)
      .set({
        customDomain: domain,
        customDomainVerified: true,
      })
      .where(eq(generatedApps.id, parseInt(appId)));

    return res.json({
      success: true,
      customDomain: domain,
      verified: true,
    });
  } catch (error) {
    logger.error("Custom domain error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
