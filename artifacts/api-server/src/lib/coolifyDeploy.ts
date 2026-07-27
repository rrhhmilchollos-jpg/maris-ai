/**
 * coolifyDeploy.ts
 *
 * Lógica de despliegue del backend de las apps generadas a tu servidor
 * Coolify propio (self-hosted), vía la API v1 de Coolify.
 */
import { logger } from "./logger";

const COOLIFY_API_URL = process.env.COOLIFY_API_URL || "https://app.coolify.io/api/v1";
const COOLIFY_API_TOKEN = process.env.COOLIFY_API_TOKEN;
const COOLIFY_SERVER_UUID = process.env.COOLIFY_SERVER_UUID;
const COOLIFY_PROJECT_UUID = process.env.COOLIFY_PROJECT_UUID;

export interface CoolifyDeployConfig {
  appId: string;
  appTitle: string;
  githubRepoFullName: string;
  envVars: Record<string, string>;
  subdomain: string;
}

export interface CoolifyDeployResult {
  applicationUuid: string;
  publicUrl: string;
}

async function coolifyRequest<T>(endpoint: string, method: string, body?: any): Promise<T> {
  if (!COOLIFY_API_TOKEN) {
    throw new Error("COOLIFY_API_TOKEN no está configurado.");
  }

  const res = await fetch(`${COOLIFY_API_URL}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${COOLIFY_API_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || json.error || `Coolify API Error: ${res.statusText}`);
  }
  return json as T;
}

/**
 * Crea y despliega una aplicación en Coolify.
 */
export async function deployBackendToCoolify(config: CoolifyDeployConfig): Promise<CoolifyDeployResult | { error: string }> {
  const { appId, appTitle, githubRepoFullName, envVars, subdomain } = config;
  const applicationName = `marisai-${appTitle.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${appId.slice(-6)}`;
  const publicUrl = `https://${subdomain}.marisai.es`;

  try {
    if (!COOLIFY_SERVER_UUID || !COOLIFY_PROJECT_UUID) {
      throw new Error("COOLIFY_SERVER_UUID o COOLIFY_PROJECT_UUID no configurados.");
    }

    // 1. Crear aplicación
    const appData = await coolifyRequest<{ uuid: string }>("/applications/public", "POST", {
      project_uuid: COOLIFY_PROJECT_UUID,
      server_uuid: COOLIFY_SERVER_UUID,
      environment_name: "production",
      name: applicationName,
      git_repository: `https://github.com/${githubRepoFullName}`,
      git_branch: "main",
      build_pack: "nixpacks",
      domains: publicUrl,
      is_auto_deploy_enabled: true,
      instant_deploy: false
    });

    const applicationUuid = appData.uuid;

    // 2. Inyectar variables de entorno (Bulk si es posible, o secuencial)
    for (const [key, value] of Object.entries(envVars)) {
      await coolifyRequest(`/applications/${applicationUuid}/envs`, "POST", {
        key,
        value,
        is_build_time: true,
        is_shown_in_ui: true
      });
    }

    // 3. Desplegar
    await coolifyRequest(`/applications/${applicationUuid}/deploy`, "POST");

    logger.info({ appId, applicationUuid, publicUrl }, "Despliegue en Coolify exitoso");
    
    return { applicationUuid, publicUrl };

  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ err, appId }, "Error en despliegue Coolify");
    return { error: `Error en Coolify: ${msg}` };
  }
}
