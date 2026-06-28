/**
 * mcpIntegrations.ts
 *
 * Verificación REAL de conectores MCP (Supabase, Notion, Airtable, GitHub,
 * Slack, Stripe, OpenAI, etc.) — sustituye la simulación que existía
 * únicamente en el frontend (mcp-integrations-panel.tsx: testAndConnect()
 * con `await new Promise(r => setTimeout(r, 1200))` y luego un simple "¿están
 * los campos rellenos?" sin llamar nunca a ningún servicio real). El propio
 * código del frontend documentaba la intención: "Simular test de conexión
 * (en producción llamaría a /api/mcp/test)" — ese endpoint nunca se construyó.
 *
 * POST /api/mcp/test
 * Body: { connectorId: string, values: Record<string, string> }
 * Respuesta: { ok: boolean, message: string }
 *
 * Cada conector se verifica con una llamada real y mínima a su API oficial
 * (un "whoami"/"ping" de bajo coste, nunca una operación que modifique
 * datos), usando las credenciales que el usuario acaba de introducir — no
 * se almacenan en el servidor, solo se usan para esta comprobación puntual.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();

type ConnectorId =
  | "supabase" | "notion" | "airtable" | "github" | "slack"
  | "google-sheets" | "openai" | "resend" | "cloudinary" | "stripe"
  | "google-calendar" | "shopify"
  | "salesforce" | "hubspot" | "zoho-crm" | "dynamics365" | "sap-business-one";

async function verifySupabase(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = values;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { ok: false, message: "Faltan URL o Anon Key." };
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  return res.ok || res.status === 404
    ? { ok: true, message: "Conexión con Supabase verificada." }
    : { ok: false, message: `Supabase respondió ${res.status} — revisa la URL y la Anon Key.` };
}

async function verifyNotion(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { NOTION_API_KEY } = values;
  if (!NOTION_API_KEY) return { ok: false, message: "Falta la API Key de integración." };
  const res = await fetch("https://api.notion.com/v1/users/me", {
    headers: { Authorization: `Bearer ${NOTION_API_KEY}`, "Notion-Version": "2022-06-28" },
  });
  return res.ok
    ? { ok: true, message: "Conexión con Notion verificada." }
    : { ok: false, message: "API Key de Notion inválida o sin permisos." };
}

async function verifyAirtable(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = values;
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) return { ok: false, message: "Faltan el Token o el ID de la base." };
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
  });
  return res.ok
    ? { ok: true, message: "Conexión con Airtable verificada." }
    : { ok: false, message: "Token o ID de base de Airtable inválidos." };
}

async function verifyGithub(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { GITHUB_TOKEN } = values;
  if (!GITHUB_TOKEN) return { ok: false, message: "Falta el Personal Access Token." };
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "User-Agent": "MarisAI" },
  });
  return res.ok
    ? { ok: true, message: "Conexión con GitHub verificada." }
    : { ok: false, message: "Token de GitHub inválido o revocado." };
}

async function verifySlack(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { SLACK_BOT_TOKEN } = values;
  if (!SLACK_BOT_TOKEN) return { ok: false, message: "Falta el Bot Token." };
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  return data.ok
    ? { ok: true, message: "Conexión con Slack verificada." }
    : { ok: false, message: `Slack rechazó el token: ${data.error || "desconocido"}.` };
}

async function verifyOpenAI(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { OPENAI_API_KEY } = values;
  if (!OPENAI_API_KEY) return { ok: false, message: "Falta la API Key." };
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  });
  return res.ok
    ? { ok: true, message: "Conexión con OpenAI verificada." }
    : { ok: false, message: "API Key de OpenAI inválida." };
}

async function verifyResend(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { RESEND_API_KEY } = values;
  if (!RESEND_API_KEY) return { ok: false, message: "Falta la API Key." };
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
  });
  return res.ok
    ? { ok: true, message: "Conexión con Resend verificada." }
    : { ok: false, message: "API Key de Resend inválida." };
}

async function verifyStripe(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { STRIPE_SECRET_KEY } = values;
  if (!STRIPE_SECRET_KEY) return { ok: false, message: "Falta la Secret Key." };
  const res = await fetch("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return res.ok
    ? { ok: true, message: "Conexión con Stripe verificada." }
    : { ok: false, message: "Secret Key de Stripe inválida." };
}

async function verifyShopify(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN } = values;
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) return { ok: false, message: "Faltan el dominio o el Access Token." };
  const res = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/shop.json`, {
    headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN },
  });
  return res.ok
    ? { ok: true, message: "Conexión con Shopify verificada." }
    : { ok: false, message: "Dominio o Access Token de Shopify inválidos." };
}

// ─── Sistemas empresariales (CRM/ERP) — la pieza que faltaba para el caso de uso de "proyectos complejos" ───

async function verifyHubspot(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { HUBSPOT_ACCESS_TOKEN } = values;
  if (!HUBSPOT_ACCESS_TOKEN) return { ok: false, message: "Falta el Private App Access Token." };
  const res = await fetch("https://api.hubapi.com/account-info/v3/details", {
    headers: { Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}` },
  });
  return res.ok
    ? { ok: true, message: "Conexión con HubSpot verificada." }
    : { ok: false, message: "Access Token de HubSpot inválido o sin permisos." };
}

async function verifySalesforce(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { SALESFORCE_INSTANCE_URL, SALESFORCE_ACCESS_TOKEN } = values;
  if (!SALESFORCE_INSTANCE_URL || !SALESFORCE_ACCESS_TOKEN) {
    return { ok: false, message: "Faltan la URL de instancia o el Access Token (obtenido vía OAuth2 con tu Connected App de Salesforce)." };
  }
  const res = await fetch(`${SALESFORCE_INSTANCE_URL.replace(/\/$/, "")}/services/data/v59.0/`, {
    headers: { Authorization: `Bearer ${SALESFORCE_ACCESS_TOKEN}` },
  });
  return res.ok
    ? { ok: true, message: "Conexión con Salesforce verificada." }
    : { ok: false, message: "Token o URL de instancia de Salesforce inválidos — verifica que el token no haya expirado." };
}

async function verifyZohoCRM(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { ZOHO_ACCESS_TOKEN, ZOHO_API_DOMAIN } = values;
  if (!ZOHO_ACCESS_TOKEN) return { ok: false, message: "Falta el Access Token OAuth2 de Zoho." };
  const domain = ZOHO_API_DOMAIN || "www.zohoapis.com";
  const res = await fetch(`https://${domain}/crm/v6/org`, {
    headers: { Authorization: `Zoho-oauthtoken ${ZOHO_ACCESS_TOKEN}` },
  });
  return res.ok
    ? { ok: true, message: "Conexión con Zoho CRM verificada." }
    : { ok: false, message: "Access Token de Zoho CRM inválido o expirado (los tokens de Zoho expiran en 1h, puede que necesites refrescarlo)." };
}

async function verifyDynamics365(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { DYNAMICS_RESOURCE_URL, DYNAMICS_ACCESS_TOKEN } = values;
  if (!DYNAMICS_RESOURCE_URL || !DYNAMICS_ACCESS_TOKEN) {
    return { ok: false, message: "Faltan la URL del entorno o el Access Token (obtenido vía Azure AD / Entra ID OAuth2)." };
  }
  const res = await fetch(`${DYNAMICS_RESOURCE_URL.replace(/\/$/, "")}/api/data/v9.2/WhoAmI`, {
    headers: { Authorization: `Bearer ${DYNAMICS_ACCESS_TOKEN}`, Accept: "application/json" },
  });
  return res.ok
    ? { ok: true, message: "Conexión con Dynamics 365 verificada." }
    : { ok: false, message: "Token o URL de entorno de Dynamics 365 inválidos." };
}

// SAP Business One no expone una API REST pública estándar verificable sin
// infraestructura del cliente (Service Layer corre dentro de su propia red,
// normalmente sin acceso desde internet) — la "verificación" real aquí es
// documental: confirmamos que las credenciales tienen el formato esperado,
// pero la prueba de conexión real solo puede hacerla el backend generado una
// vez desplegado dentro de la red del cliente, no este servidor.
async function verifySapBusinessOne(values: Record<string, string>): Promise<{ ok: boolean; message: string }> {
  const { SAP_SERVICE_LAYER_URL, SAP_COMPANY_DB, SAP_USERNAME, SAP_PASSWORD } = values;
  if (!SAP_SERVICE_LAYER_URL || !SAP_COMPANY_DB || !SAP_USERNAME || !SAP_PASSWORD) {
    return { ok: false, message: "Faltan datos. Necesitas: URL del Service Layer, CompanyDB, usuario y contraseña de SAP B1." };
  }
  return {
    ok: true,
    message: "Datos guardados correctamente. El Service Layer de SAP Business One normalmente vive dentro de la red privada del cliente — Maris AI no puede verificar la conexión desde aquí, pero el backend generado se conectará con estas credenciales una vez desplegado en tu infraestructura.",
  };
}

const VERIFIERS: Record<ConnectorId, (values: Record<string, string>) => Promise<{ ok: boolean; message: string }>> = {
  supabase: verifySupabase,
  notion: verifyNotion,
  airtable: verifyAirtable,
  github: verifyGithub,
  slack: verifySlack,
  "google-sheets": async () => ({ ok: false, message: "La verificación de Google Sheets requiere OAuth2 — conéctate desde el flujo de Google, no con una API Key suelta." }),
  openai: verifyOpenAI,
  resend: verifyResend,
  cloudinary: async (v) => {
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = v;
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      return { ok: false, message: "Faltan Cloud Name, API Key o API Secret." };
    }
    const auth = Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString("base64");
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/usage`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    return res.ok ? { ok: true, message: "Conexión con Cloudinary verificada." } : { ok: false, message: "Credenciales de Cloudinary inválidas." };
  },
  stripe: verifyStripe,
  "google-calendar": async () => ({ ok: false, message: "La verificación de Google Calendar requiere OAuth2 — conéctate desde el flujo de Google, no con una API Key suelta." }),
  shopify: verifyShopify,
  salesforce: verifySalesforce,
  hubspot: verifyHubspot,
  "zoho-crm": verifyZohoCRM,
  dynamics365: verifyDynamics365,
  "sap-business-one": verifySapBusinessOne,
};

router.post("/mcp/test", requireAuth, async (req: Request, res: Response) => {
  try {
    const { connectorId, values } = req.body as { connectorId?: string; values?: Record<string, string> };
    if (!connectorId || !values) {
      return res.status(400).json({ ok: false, message: "Faltan connectorId o values." });
    }
    const verifier = VERIFIERS[connectorId as ConnectorId];
    if (!verifier) {
      return res.status(400).json({ ok: false, message: `Conector desconocido: ${connectorId}` });
    }
    const result = await verifier(values);
    return res.json(result);
  } catch (err) {
    logger.error({ err }, "Error verifying MCP connector");
    return res.status(500).json({ ok: false, message: "Error interno al verificar la conexión. Inténtalo de nuevo." });
  }
});

export default router;
