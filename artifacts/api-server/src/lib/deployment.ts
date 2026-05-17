/**
 * Maris AI Deployment Service
 * 
 * Handles app deployment to Vercel with support for:
 * - Free tier: Automatic subdomain allocation (app-name.maris-ai.com)
 * - Paid tier: Custom domain support
 */

import { logger } from "./logger";

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;
const MARIS_AI_DOMAIN = "maris-ai.com";

export interface DeploymentConfig {
  appId: string;
  userId: string;
  projectName: string;
  frontendCode: string;
  backendCode?: string;
  customDomain?: string;
  isPaidUser: boolean;
}

export interface DeploymentResult {
  success: boolean;
  deploymentUrl?: string;
  subdomain?: string;
  customDomain?: string;
  projectId?: string;
  error?: string;
  logs?: string;
}

/**
 * Generate a unique subdomain for free tier users
 */
export function generateMarisaiSubdomain(projectName: string, appId: string): string {
  const sanitized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);

  return `${sanitized}-${appId.slice(0, 6)}`;
}

/**
 * Create a Vercel project for the app
 */
export async function createVercelProject(config: DeploymentConfig): Promise<DeploymentResult> {
  if (!VERCEL_API_TOKEN) {
    logger.error("VERCEL_API_TOKEN not configured");
    return {
      success: false,
      error: "Deployment service not configured",
    };
  }

  try {
    const subdomain = generateMarisaiSubdomain(config.projectName, config.appId);
    const projectName = `maris-ai-${config.appId}`;

    // Create Vercel project
    const projectResponse = await fetch("https://api.vercel.com/v10/projects", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VERCEL_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        framework: "vite",
        buildCommand: "npm run build",
        outputDirectory: "dist",
        environmentVariables: [],
        ...(VERCEL_TEAM_ID && { teamId: VERCEL_TEAM_ID }),
      }),
    });

    if (!projectResponse.ok) {
      const error = await projectResponse.text();
      logger.error("Vercel project creation failed:", error);
      return {
        success: false,
        error: "Failed to create Vercel project",
        logs: error,
      };
    }

    const project = (await projectResponse.json()) as { id: string; name: string };

    // Add domain
    const domainToUse = config.isPaidUser && config.customDomain
      ? config.customDomain
      : `${subdomain}.${MARIS_AI_DOMAIN}`;

    const domainResponse = await fetch(
      `https://api.vercel.com/v10/projects/${project.id}/domains`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VERCEL_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          domain: domainToUse,
          ...(VERCEL_TEAM_ID && { teamId: VERCEL_TEAM_ID }),
        }),
      },
    );

    if (!domainResponse.ok) {
      const error = await domainResponse.text();
      logger.warn("Domain addition failed (non-blocking):", error);
    }

    // Deploy
    const deploymentUrl = `https://${domainToUse}`;

    logger.info(`Deployment successful: ${deploymentUrl}`, {
      appId: config.appId,
      projectId: project.id,
      subdomain,
    });

    return {
      success: true,
      deploymentUrl,
      subdomain: config.isPaidUser ? undefined : subdomain,
      customDomain: config.isPaidUser ? config.customDomain : undefined,
      projectId: project.id,
    };
  } catch (error) {
    logger.error("Deployment error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown deployment error",
    };
  }
}

/**
 * Trigger a re-deployment of an existing Vercel project
 */
export async function redeployVercelProject(projectId: string): Promise<DeploymentResult> {
  if (!VERCEL_API_TOKEN) {
    return {
      success: false,
      error: "Deployment service not configured",
    };
  }

  try {
    const response = await fetch(`https://api.vercel.com/v13/deployments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VERCEL_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        ...(VERCEL_TEAM_ID && { teamId: VERCEL_TEAM_ID }),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error("Vercel redeployment failed:", error);
      return {
        success: false,
        error: "Failed to redeploy project",
        logs: error,
      };
    }

    const deployment = (await response.json()) as { url: string };

    logger.info(`Redeployment successful: ${deployment.url}`, { projectId });

    return {
      success: true,
      deploymentUrl: `https://${deployment.url}`,
      projectId,
    };
  } catch (error) {
    logger.error("Redeployment error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown redeployment error",
    };
  }
}

/**
 * Verify custom domain ownership
 */
export async function verifyCustomDomain(projectId: string, domain: string): Promise<boolean> {
  if (!VERCEL_API_TOKEN) {
    return false;
  }

  try {
    const response = await fetch(
      `https://api.vercel.com/v10/projects/${projectId}/domains/${domain}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${VERCEL_API_TOKEN}`,
        },
      },
    );

    if (!response.ok) {
      return false;
    }

    const domainData = (await response.json()) as { verified: boolean };
    return domainData.verified;
  } catch (error) {
    logger.error("Domain verification error:", error);
    return false;
  }
}

/**
 * Get deployment status
 */
export async function getDeploymentStatus(projectId: string): Promise<{
  status: string;
  url?: string;
  error?: string;
}> {
  if (!VERCEL_API_TOKEN) {
    return { status: "error", error: "Deployment service not configured" };
  }

  try {
    const response = await fetch(`https://api.vercel.com/v6/deployments/${projectId}`, {
      headers: {
        Authorization: `Bearer ${VERCEL_API_TOKEN}`,
      },
    });

    if (!response.ok) {
      return { status: "error", error: "Failed to fetch deployment status" };
    }

    const deployment = (await response.json()) as {
      state: string;
      url?: string;
      error?: { message: string };
    };

    return {
      status: deployment.state,
      url: deployment.url,
      error: deployment.error?.message,
    };
  } catch (error) {
    logger.error("Status check error:", error);
    return { status: "error", error: "Failed to check deployment status" };
  }
}
