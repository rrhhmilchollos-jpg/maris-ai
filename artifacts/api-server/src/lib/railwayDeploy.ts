/**
 * railwayDeploy.ts
 *
 * Despliegue REAL y persistente del backend Express de las apps generadas.
 *
 * ENCONTRADO al auditar (sesión del 2026-06-28): el backend Express que
 * generan los agentes NUNCA llegaba a desplegarse de forma persistente —
 * solo el frontend estático llegaba a Vercel (confirmado con grep
 * exhaustivo: backendCode nunca se usaba en deployBundle.ts, y no existía
 * ninguna integración con ningún proveedor de hosting de backend real). El
 * backend solo corría dentro del sandbox temporal del preview en el
 * navegador del propio usuario. Cualquier app de cliente con backend real
 * (no solo una landing estática) estaba, en la práctica, rota en
 * producción — el frontend se publicaba sin nada al otro lado al que
 * conectarse.
 *
 * Este módulo usa la API GraphQL pública de Railway (confirmada contra su
 * documentación oficial: backboard.railway.com/graphql/v2) para:
 * 1. Crear un proyecto Railway por app (projectCreate)
 * 2. Crear el servicio backend conectado al repo de GitHub al que la app
 *    ya se exportó (serviceCreate con source.repo)
 * 3. Configurar todas las variables de entorno de una vez sin disparar
 *    deploys intermedios (variableCollectionUpsert con skipDeploys:true)
 * 4. Generar un dominio público real (serviceDomainCreate)
 * 5. Disparar el primer deploy real (serviceInstanceDeployV2)
 *
 * LIMITACIÓN HONESTA DOCUMENTADA (no se oculta al usuario): Railway no
 * tiene un "free tier" de cómputo persistente sin tarjeta como Vercel para
 * frontends estáticos — el usuario necesita un plan de pago de Railway
 * (Hobby, ~$5/mes con créditos incluidos) para que su backend funcione de
 * forma persistente. Esto se comunica explícitamente antes de intentar el
 * deploy, no se descubre como sorpresa después.
 */
import { logger } from "./logger";

const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2";

interface RailwayGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function railwayRequest<T>(query: string, variables: Record<string, unknown>, apiToken: string): Promise<T> {
  const res = await fetch(RAILWAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as RailwayGraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Railway API error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) {
    throw new Error("Railway API: respuesta sin datos");
  }
  return json.data;
}

export interface RailwayDeployConfig {
  appId: string;
  appTitle: string;
  githubRepoFullName: string;
  envVars: Record<string, string>;
}

export interface RailwayDeployResult {
  projectId: string;
  serviceId: string;
  environmentId: string;
  publicUrl: string;
}

/**
 * Ejecuta el flujo completo de despliegue real a Railway. Lanza un Error
 * con un mensaje específico de en qué paso falló — esto importa porque un
 * fallo a mitad del flujo (ej. tras crear el proyecto pero antes de
 * desplegar) debe quedar claro en los logs para poder depurarlo o
 * reintentar desde el punto correcto, no como un error genérico opaco.
 */
export async function deployBackendToRailway(config: RailwayDeployConfig, apiToken: string): Promise<RailwayDeployResult> {
  const { appId, appTitle, githubRepoFullName, envVars } = config;
  const projectName = `marisai-${appTitle.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40)}-${appId.slice(-6)}`;

  let projectId: string;
  let environmentId: string;
  try {
    const created = await railwayRequest<{ projectCreate: { id: string } }>(
      `mutation projectCreate($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }`,
      { input: { name: projectName, defaultEnvironmentName: "production" } },
      apiToken,
    );
    projectId = created.projectCreate.id;
  } catch (err) {
    throw new Error(`No se pudo crear el proyecto en Railway: ${(err as Error).message}`);
  }

  try {
    const project = await railwayRequest<{ project: { environments: { edges: Array<{ node: { id: string; name: string } }> } } }>(
      `query project($id: String!) { project(id: $id) { environments { edges { node { id name } } } } }`,
      { id: projectId },
      apiToken,
    );
    const env = project.project.environments.edges[0]?.node;
    if (!env) throw new Error("El proyecto no tiene ningún entorno disponible.");
    environmentId = env.id;
  } catch (err) {
    throw new Error(`No se pudo obtener el entorno del proyecto en Railway: ${(err as Error).message}`);
  }

  let serviceId: string;
  try {
    const service = await railwayRequest<{ serviceCreate: { id: string } }>(
      `mutation serviceCreate($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
      { input: { projectId, name: "backend", source: { repo: githubRepoFullName } } },
      apiToken,
    );
    serviceId = service.serviceCreate.id;
  } catch (err) {
    throw new Error(`No se pudo crear el servicio backend en Railway: ${(err as Error).message}`);
  }

  try {
    await railwayRequest(
      `mutation serviceInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }`,
      { serviceId, environmentId, input: { startCommand: "npm install && npm run build && npm start" } },
      apiToken,
    );
  } catch (err) {
    logger.warn({ err, appId }, "No se pudo configurar el comando de arranque explícito — Railway intentará detectarlo automáticamente");
  }

  try {
    await railwayRequest(
      `mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
      { input: { projectId, environmentId, serviceId, variables: envVars, skipDeploys: true } },
      apiToken,
    );
  } catch (err) {
    throw new Error(`No se pudieron configurar las variables de entorno en Railway: ${(err as Error).message}`);
  }

  let publicUrl: string;
  try {
    const domain = await railwayRequest<{ serviceDomainCreate: { domain: string } }>(
      `mutation serviceDomainCreate($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`,
      { input: { serviceId, environmentId } },
      apiToken,
    );
    publicUrl = `https://${domain.serviceDomainCreate.domain}`;
  } catch (err) {
    throw new Error(`No se pudo generar el dominio público en Railway: ${(err as Error).message}`);
  }

  try {
    await railwayRequest(
      `mutation serviceInstanceDeployV2($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }`,
      { serviceId, environmentId },
      apiToken,
    );
  } catch (err) {
    throw new Error(`No se pudo iniciar el deploy en Railway: ${(err as Error).message}`);
  }

  logger.info({ appId, projectId, serviceId, publicUrl }, "Backend deployed to Railway successfully");
  return { projectId, serviceId, environmentId, publicUrl };
}

/**
 * Redespliega un servicio ya existente (cambios en el código tras una
 * edición), sin recrear el proyecto ni el servicio desde cero.
 */
export async function redeployBackendToRailway(serviceId: string, environmentId: string, apiToken: string): Promise<void> {
  await railwayRequest(
    `mutation serviceInstanceDeployV2($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }`,
    { serviceId, environmentId },
    apiToken,
  );
}
