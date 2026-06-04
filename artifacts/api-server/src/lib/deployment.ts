/**
 * Maris AI Deployment Service
 *
 * Handles app deployment to Vercel with support for:
 * - Free tier: Automatic subdomain allocation (app-name.marisai.es)
 * - Paid tier: Custom domain support
 *
 * NOTE: appId is a MongoDB ObjectId string (e.g. "6641abc123...").
 * All functions accept and return string IDs — never numeric.
 */

import { logger } from "./logger";

const VERCEL_API_TOKEN = process.env.VERCEL_TOKEN ?? process.env.VERCEL_API_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;
export const MARIS_AI_DOMAIN = process.env.MARIS_AI_DOMAIN ?? "marisai.es";

async function disableVercelAuthentication(projectId: string): Promise<void> {
  if (!VERCEL_API_TOKEN) return;
  try {
    const response = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${VERCEL_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ssoProtection: null,
        ...(VERCEL_TEAM_ID ? { teamId: VERCEL_TEAM_ID } : {}),
      }),
    });
    if (!response.ok) {
      logger.warn({ projectId, status: response.status, body: await response.text() }, "No se pudo desactivar Vercel Authentication");
    }
  } catch (error) {
    logger.warn({ projectId, error }, "Error desactivando Vercel Authentication");
  }
}

export interface DeploymentConfig {
  /** MongoDB ObjectId string of the app being deployed. */
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
 * Generate a unique subdomain for free tier users.
 * Uses the first 8 chars of the MongoDB ObjectId as the unique suffix.
 */
export function generateMarisaiSubdomain(projectName: string, appId: string): string {
  const sanitized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);

  // Use first 8 chars of the MongoDB ObjectId for uniqueness
  const suffix = appId.slice(0, 8);
  return `${sanitized}-${suffix}`;
}

/**
 * Create a Vercel project for the app and trigger an initial deployment.
 * This is the legacy "simple deploy" path used by the deployment-buttons
 * component. For the full Vite-project deploy, see vercelDeploy.ts.
 */
export async function createVercelProject(config: DeploymentConfig): Promise<DeploymentResult> {
  if (!VERCEL_API_TOKEN) {
    logger.error("VERCEL_TOKEN not configured");
    return {
      success: false,
      error: "Deployment service not configured",
    };
  }

  try {
    const subdomain = generateMarisaiSubdomain(config.projectName, config.appId);
    const projectName = `maris-ai-${config.appId.slice(0, 12)}`;

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
        ...(VERCEL_TEAM_ID ? { teamId: VERCEL_TEAM_ID } : {}),
      }),
    });

    if (!projectResponse.ok) {
      const error = await projectResponse.text();
      logger.error({ error }, "Vercel project creation failed");
      return {
        success: false,
        error: "Failed to create Vercel project",
        logs: error,
      };
    }

    const project = (await projectResponse.json()) as { id: string; name: string };
    await disableVercelAuthentication(project.id);

    // Add domain
    const domainToUse =
      config.isPaidUser && config.customDomain
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
          ...(VERCEL_TEAM_ID ? { teamId: VERCEL_TEAM_ID } : {}),
        }),
      },
    );

    if (!domainResponse.ok) {
      const error = await domainResponse.text();
      logger.warn({ error }, "Domain addition failed (non-blocking)");
    }

    const deploymentUrl = `https://${domainToUse}`;

    logger.info({ appId: config.appId, projectId: project.id, subdomain }, `Deployment successful: ${deploymentUrl}`);

    return {
      success: true,
      deploymentUrl,
      subdomain: config.isPaidUser ? undefined : subdomain,
      customDomain: config.isPaidUser ? config.customDomain : undefined,
      projectId: project.id,
    };
  } catch (error) {
    logger.error({ error }, "Deployment error");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown deployment error",
    };
  }
}

/**
 * Trigger a re-deployment of an existing Vercel project.
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
        ...(VERCEL_TEAM_ID ? { teamId: VERCEL_TEAM_ID } : {}),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ error }, "Vercel redeployment failed");
      return {
        success: false,
        error: "Failed to redeploy project",
        logs: error,
      };
    }

    const deployment = (await response.json()) as { url: string };
    await disableVercelAuthentication(projectId);

    logger.info({ projectId }, `Redeployment successful: ${deployment.url}`);

    return {
      success: true,
      deploymentUrl: `https://${deployment.url}`,
      projectId,
    };
  } catch (error) {
    logger.error({ error }, "Redeployment error");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown redeployment error",
    };
  }
}

/**
 * Verify custom domain ownership via Vercel API.
 */
export async function verifyCustomDomain(projectId: string, domain: string): Promise<boolean> {
  if (!VERCEL_API_TOKEN) {
    return false;
  }

  try {
    const response = await fetch(
      `https://api.vercel.com/v10/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
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
    logger.error({ error }, "Domain verification error");
    return false;
  }
}

/**
 * Get deployment status from Vercel.
 */
export async function getDeploymentStatus(deploymentId: string): Promise<{
  status: string;
  url?: string;
  error?: string;
}> {
  if (!VERCEL_API_TOKEN) {
    return { status: "error", error: "Deployment service not configured" };
  }

  try {
    const response = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
      headers: {
        Authorization: `Bearer ${VERCEL_API_TOKEN}`,
      },
    });

    if (!response.ok) {
      return { status: "error", error: "Failed to fetch deployment status" };
    }

    const deployment = (await response.json()) as {
      readyState: string;
      url?: string;
      errorMessage?: string;
    };

    return {
      status: deployment.readyState,
      url: deployment.url ? `https://${deployment.url}` : undefined,
      error: deployment.errorMessage,
    };
  } catch (error) {
    logger.error({ error }, "Status check error");
    return { status: "error", error: "Failed to check deployment status" };
  }
}
