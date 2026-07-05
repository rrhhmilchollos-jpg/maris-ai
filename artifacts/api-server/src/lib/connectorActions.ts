/**
 * connectorActions.ts — Gateway de acciones de conectores (estilo Emergent).
 *
 * Filosofía: en lugar de dejar que el agente Frontend instale SDKs de npm
 * (googleapis, @slack/web-api, jira-client…) dentro de las apps generadas
 * — la causa clásica de bundles rotos y secretos filtrados al navegador —
 * TODAS las integraciones con servicios externos se ejecutan AQUÍ, en el
 * backend de Maris AI, con las credenciales cifradas del usuario
 * (connector_credentials en MongoDB) que el frontend jamás ve.
 *
 * Cada acción es una llamada HTTP mínima y directa a la API oficial del
 * servicio — sin SDKs, sin dependencias nuevas, sin sorpresas de versiones.
 *
 * Puntos de entrada:
 *   - executeConnectorAction(userId, connectorId, actionId, params)
 *     → usada por routes/connectors.ts (REST) y disponible para el motor
 *       de Workflows (nodo "webhook-out"/"action") y para agentes internos.
 *   - CONNECTOR_ACTIONS → catálogo introspectable (la UI lo lista).
 */

import { ConnectorCredential } from "@workspace/db/schema";
import { decryptCredentials } from "./connectorCrypto";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ActionResult {
  ok: boolean;
  /** Mensaje humano en español para mostrar en la UI. */
  message: string;
  /** Respuesta útil de la API externa (id creado, filas leídas…), si aplica. */
  data?: unknown;
}

export interface ActionDefinition {
  id: string;
  name: string;            // nombre humano en español
  description: string;
  /** Parámetros que espera `params` (documentación introspectable para la UI/agente). */
  params: Record<string, string>;
  run: (creds: Record<string, string>, params: Record<string, unknown>) => Promise<ActionResult>;
}

const FETCH_TIMEOUT_MS = 15_000;

async function callApi(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function str(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : "";
}

// ─── Slack ───────────────────────────────────────────────────────────────────
// Credenciales esperadas: SLACK_BOT_TOKEN (xoxb-…) y/o SLACK_WEBHOOK_URL.

const slackActions: ActionDefinition[] = [
  {
    id: "send-message",
    name: "Enviar mensaje",
    description: "Publica un mensaje en un canal de Slack (vía bot token o incoming webhook).",
    params: { channel: "Canal (#general o ID) — solo con bot token", text: "Texto del mensaje (obligatorio)" },
    async run(creds, params) {
      const text = str(params, "text");
      if (!text) return { ok: false, message: "Falta el texto del mensaje." };
      // Preferir bot token (permite elegir canal); caer a webhook si no hay.
      if (creds.SLACK_BOT_TOKEN) {
        const channel = str(params, "channel");
        if (!channel) return { ok: false, message: "Falta el canal (con bot token es obligatorio)." };
        const res = await callApi("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${creds.SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ channel, text }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; ts?: string };
        return data.ok
          ? { ok: true, message: "Mensaje enviado a Slack.", data: { ts: data.ts } }
          : { ok: false, message: `Slack rechazó el mensaje: ${data.error ?? res.status}` };
      }
      if (creds.SLACK_WEBHOOK_URL) {
        const res = await callApi(creds.SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        return res.ok
          ? { ok: true, message: "Mensaje enviado a Slack (webhook)." }
          : { ok: false, message: `El webhook de Slack respondió ${res.status}.` };
      }
      return { ok: false, message: "No hay SLACK_BOT_TOKEN ni SLACK_WEBHOOK_URL guardados." };
    },
  },
];

// ─── Webhook genérico ────────────────────────────────────────────────────────
// Credenciales esperadas: WEBHOOK_URL (y opcional WEBHOOK_SECRET → cabecera
// X-Maris-Signature para que el receptor pueda validar el origen).

const webhookActions: ActionDefinition[] = [
  {
    id: "post",
    name: "Enviar webhook",
    description: "Hace un POST JSON a la URL configurada. La base de la automatización: Zapier, Make, n8n o tu propio endpoint.",
    params: { payload: "Objeto JSON a enviar (se envía tal cual en el body)" },
    async run(creds, params) {
      const url = creds.WEBHOOK_URL;
      if (!url || !/^https?:\/\//.test(url)) return { ok: false, message: "WEBHOOK_URL no configurada o inválida." };
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (creds.WEBHOOK_SECRET) headers["X-Maris-Signature"] = creds.WEBHOOK_SECRET;
      const res = await callApi(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params.payload ?? params),
      });
      return res.ok
        ? { ok: true, message: `Webhook entregado (HTTP ${res.status}).` }
        : { ok: false, message: `El receptor respondió HTTP ${res.status}.` };
    },
  },
];

// ─── Notion ──────────────────────────────────────────────────────────────────
// Credenciales esperadas: NOTION_API_KEY.

const NOTION_VERSION = "2022-06-28";

const notionActions: ActionDefinition[] = [
  {
    id: "create-page",
    name: "Crear página",
    description: "Crea una página dentro de una base de datos de Notion.",
    params: { databaseId: "ID de la base de datos destino", title: "Título de la página", content: "Texto opcional del cuerpo" },
    async run(creds, params) {
      const databaseId = str(params, "databaseId");
      const title = str(params, "title");
      if (!databaseId || !title) return { ok: false, message: "Faltan databaseId o title." };
      const body: Record<string, unknown> = {
        parent: { database_id: databaseId },
        properties: { Name: { title: [{ text: { content: title } }] } },
      };
      const content = str(params, "content");
      if (content) {
        body.children = [
          { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content } }] } },
        ];
      }
      const res = await callApi("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.NOTION_API_KEY}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { id?: string; message?: string };
      return res.ok
        ? { ok: true, message: "Página creada en Notion.", data: { id: data.id } }
        : { ok: false, message: `Notion respondió ${res.status}: ${data.message ?? "error"}` };
    },
  },
  {
    id: "query-database",
    name: "Consultar base de datos",
    description: "Lee filas de una base de datos de Notion (hasta 25).",
    params: { databaseId: "ID de la base de datos a consultar" },
    async run(creds, params) {
      const databaseId = str(params, "databaseId");
      if (!databaseId) return { ok: false, message: "Falta databaseId." };
      const res = await callApi(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.NOTION_API_KEY}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 25 }),
      });
      const data = (await res.json()) as { results?: unknown[]; message?: string };
      return res.ok
        ? { ok: true, message: `Leídas ${data.results?.length ?? 0} filas.`, data: data.results }
        : { ok: false, message: `Notion respondió ${res.status}: ${data.message ?? "error"}` };
    },
  },
];

// ─── Airtable ────────────────────────────────────────────────────────────────
// Credenciales esperadas: AIRTABLE_API_KEY, AIRTABLE_BASE_ID.

const airtableActions: ActionDefinition[] = [
  {
    id: "create-record",
    name: "Crear registro",
    description: "Crea un registro en una tabla de Airtable.",
    params: { table: "Nombre o ID de la tabla", fields: "Objeto { columna: valor } del registro" },
    async run(creds, params) {
      const table = str(params, "table");
      const fields = params.fields;
      if (!table || !fields || typeof fields !== "object") return { ok: false, message: "Faltan table o fields." };
      const res = await callApi(
        `https://api.airtable.com/v0/${creds.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${creds.AIRTABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        },
      );
      const data = (await res.json()) as { id?: string; error?: { message?: string } };
      return res.ok
        ? { ok: true, message: "Registro creado en Airtable.", data: { id: data.id } }
        : { ok: false, message: `Airtable respondió ${res.status}: ${data.error?.message ?? "error"}` };
    },
  },
  {
    id: "list-records",
    name: "Listar registros",
    description: "Lee registros de una tabla de Airtable (hasta 25).",
    params: { table: "Nombre o ID de la tabla" },
    async run(creds, params) {
      const table = str(params, "table");
      if (!table) return { ok: false, message: "Falta table." };
      const res = await callApi(
        `https://api.airtable.com/v0/${creds.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?maxRecords=25`,
        { headers: { Authorization: `Bearer ${creds.AIRTABLE_API_KEY}` } },
      );
      const data = (await res.json()) as { records?: unknown[]; error?: { message?: string } };
      return res.ok
        ? { ok: true, message: `Leídos ${data.records?.length ?? 0} registros.`, data: data.records }
        : { ok: false, message: `Airtable respondió ${res.status}: ${data.error?.message ?? "error"}` };
    },
  },
];

// ─── Resend (email transaccional) ────────────────────────────────────────────
// Credenciales esperadas: RESEND_API_KEY, RESEND_FROM (remitente verificado).

const resendActions: ActionDefinition[] = [
  {
    id: "send-email",
    name: "Enviar email",
    description: "Envía un correo transaccional vía Resend.",
    params: { to: "Destinatario", subject: "Asunto", html: "Cuerpo HTML (o texto plano)" },
    async run(creds, params) {
      const to = str(params, "to");
      const subject = str(params, "subject");
      const html = str(params, "html");
      if (!to || !subject || !html) return { ok: false, message: "Faltan to, subject o html." };
      if (!creds.RESEND_FROM) return { ok: false, message: "Falta RESEND_FROM en las credenciales (remitente verificado en Resend)." };
      const res = await callApi("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: creds.RESEND_FROM, to: [to], subject, html }),
      });
      const data = (await res.json()) as { id?: string; message?: string };
      return res.ok
        ? { ok: true, message: "Email enviado.", data: { id: data.id } }
        : { ok: false, message: `Resend respondió ${res.status}: ${data.message ?? "error"}` };
    },
  },
];

// ─── GitHub ──────────────────────────────────────────────────────────────────
// Credenciales esperadas: GITHUB_TOKEN.

const githubActions: ActionDefinition[] = [
  {
    id: "create-issue",
    name: "Crear issue",
    description: "Abre un issue en un repositorio de GitHub.",
    params: { repo: "Repositorio owner/nombre", title: "Título del issue", body: "Descripción opcional" },
    async run(creds, params) {
      const repo = str(params, "repo");
      const title = str(params, "title");
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !title) return { ok: false, message: "Faltan repo (owner/nombre) o title." };
      const res = await callApi(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body: str(params, "body") }),
      });
      const data = (await res.json()) as { number?: number; html_url?: string; message?: string };
      return res.ok
        ? { ok: true, message: `Issue #${data.number} creado.`, data: { number: data.number, url: data.html_url } }
        : { ok: false, message: `GitHub respondió ${res.status}: ${data.message ?? "error"}` };
    },
  },
];

// ─── Supabase ────────────────────────────────────────────────────────────────
// Credenciales esperadas: SUPABASE_URL, SUPABASE_ANON_KEY (o service key).

const supabaseActions: ActionDefinition[] = [
  {
    id: "insert-row",
    name: "Insertar fila",
    description: "Inserta una fila en una tabla de Supabase (PostgREST).",
    params: { table: "Nombre de la tabla", row: "Objeto { columna: valor }" },
    async run(creds, params) {
      const table = str(params, "table");
      const row = params.row;
      if (!/^[\w]+$/.test(table) || !row || typeof row !== "object") return { ok: false, message: "Faltan table o row." };
      const base = (creds.SUPABASE_URL ?? "").replace(/\/$/, "");
      const res = await callApi(`${base}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          apikey: creds.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${creds.SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(row),
      });
      const data: unknown = await res.json().catch(() => null);
      return res.ok
        ? { ok: true, message: "Fila insertada en Supabase.", data }
        : { ok: false, message: `Supabase respondió ${res.status}.` };
    },
  },
  {
    id: "select-rows",
    name: "Leer filas",
    description: "Lee filas de una tabla de Supabase (hasta 25).",
    params: { table: "Nombre de la tabla" },
    async run(creds, params) {
      const table = str(params, "table");
      if (!/^[\w]+$/.test(table)) return { ok: false, message: "Falta table (solo letras, números y _)." };
      const base = (creds.SUPABASE_URL ?? "").replace(/\/$/, "");
      const res = await callApi(`${base}/rest/v1/${table}?select=*&limit=25`, {
        headers: { apikey: creds.SUPABASE_ANON_KEY, Authorization: `Bearer ${creds.SUPABASE_ANON_KEY}` },
      });
      const data: unknown = await res.json().catch(() => null);
      return res.ok
        ? { ok: true, message: `Filas leídas de ${table}.`, data }
        : { ok: false, message: `Supabase respondió ${res.status}.` };
    },
  },
];

// ─── Trello ──────────────────────────────────────────────────────────────────
// Credenciales esperadas: TRELLO_API_KEY, TRELLO_TOKEN.

const trelloActions: ActionDefinition[] = [
  {
    id: "create-card",
    name: "Crear tarjeta",
    description: "Crea una tarjeta en una lista de Trello.",
    params: { listId: "ID de la lista destino", name: "Título de la tarjeta", desc: "Descripción opcional" },
    async run(creds, params) {
      const listId = str(params, "listId");
      const name = str(params, "name");
      if (!listId || !name) return { ok: false, message: "Faltan listId o name." };
      const qs = new URLSearchParams({
        key: creds.TRELLO_API_KEY ?? "",
        token: creds.TRELLO_TOKEN ?? "",
        idList: listId,
        name,
        desc: str(params, "desc"),
      });
      const res = await callApi(`https://api.trello.com/1/cards?${qs}`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { id?: string; url?: string };
      return res.ok
        ? { ok: true, message: "Tarjeta creada en Trello.", data: { id: data.id, url: data.url } }
        : { ok: false, message: `Trello respondió ${res.status} — revisa API key y token.` };
    },
  },
];

// ─── Jira ────────────────────────────────────────────────────────────────────
// Credenciales esperadas: JIRA_DOMAIN (tuempresa.atlassian.net),
// JIRA_EMAIL, JIRA_API_TOKEN.

const jiraActions: ActionDefinition[] = [
  {
    id: "create-issue",
    name: "Crear issue",
    description: "Crea un issue en un proyecto de Jira Cloud.",
    params: { projectKey: "Clave del proyecto (p.ej. MAR)", summary: "Título del issue", description: "Descripción opcional", issueType: "Tipo (por defecto Task)" },
    async run(creds, params) {
      const projectKey = str(params, "projectKey");
      const summary = str(params, "summary");
      if (!projectKey || !summary) return { ok: false, message: "Faltan projectKey o summary." };
      const auth = Buffer.from(`${creds.JIRA_EMAIL}:${creds.JIRA_API_TOKEN}`).toString("base64");
      const description = str(params, "description");
      const res = await callApi(`https://${creds.JIRA_DOMAIN}/rest/api/3/issue`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            project: { key: projectKey },
            summary,
            issuetype: { name: str(params, "issueType") || "Task" },
            ...(description
              ? {
                  description: {
                    type: "doc",
                    version: 1,
                    content: [{ type: "paragraph", content: [{ type: "text", text: description }] }],
                  },
                }
              : {}),
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { key?: string; errorMessages?: string[] };
      return res.ok
        ? { ok: true, message: `Issue ${data.key} creado en Jira.`, data: { key: data.key } }
        : { ok: false, message: `Jira respondió ${res.status}: ${data.errorMessages?.join("; ") ?? "error"}` };
    },
  },
];

// ─── Catálogo ────────────────────────────────────────────────────────────────

export const CONNECTOR_ACTIONS: Record<string, ActionDefinition[]> = {
  slack: slackActions,
  webhook: webhookActions,
  notion: notionActions,
  airtable: airtableActions,
  resend: resendActions,
  github: githubActions,
  supabase: supabaseActions,
  trello: trelloActions,
  jira: jiraActions,
  // google-sheets, google-calendar, sharepoint/onedrive: requieren OAuth2 —
  // ver PENDIENTES.md. En cuanto exista el flujo OAuth, sus acciones se
  // añaden aquí igual que las demás (append-row, list-events…).
};

/** Catálogo introspectable sin las funciones (para GET /api/connectors). */
export function actionCatalog(): Record<
  string,
  Array<{ id: string; name: string; description: string; params: Record<string, string> }>
> {
  const out: Record<string, Array<{ id: string; name: string; description: string; params: Record<string, string> }>> = {};
  for (const [connectorId, actions] of Object.entries(CONNECTOR_ACTIONS)) {
    out[connectorId] = actions.map(({ id, name, description, params }) => ({ id, name, description, params }));
  }
  return out;
}

// ─── Ejecución ───────────────────────────────────────────────────────────────

/**
 * Ejecuta una acción de un conector con las credenciales CIFRADAS del usuario.
 * Este es el único camino por el que las apps/workflows tocan servicios
 * externos — los secretos nunca salen del servidor.
 */
export async function executeConnectorAction(
  userId: string,
  connectorId: string,
  actionId: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const actions = CONNECTOR_ACTIONS[connectorId];
  if (!actions) return { ok: false, message: `El conector "${connectorId}" no tiene acciones disponibles.` };
  const action = actions.find((a) => a.id === actionId);
  if (!action) return { ok: false, message: `Acción "${actionId}" no existe en ${connectorId}.` };

  const doc = await ConnectorCredential.findOne({ userId, connectorId }).lean();
  if (!doc) return { ok: false, message: `No hay credenciales guardadas para ${connectorId}. Conéctalo primero desde el panel de integraciones.` };

  let creds: Record<string, string>;
  try {
    creds = decryptCredentials({ ciphertext: doc.ciphertext, iv: doc.iv, authTag: doc.authTag });
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error && err.name === "EncryptionKeyMissingError"
          ? err.message
          : "No se pudieron descifrar las credenciales (¿cambió CONNECTOR_ENCRYPTION_KEY? Vuelve a conectar el servicio).",
    };
  }

  try {
    const result = await action.run(creds, params ?? {});
    // Telemetría no bloqueante
    ConnectorCredential.updateOne({ userId, connectorId }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    return result;
  } catch (err) {
    return { ok: false, message: `Error ejecutando la acción: ${(err as Error).message}` };
  }
}
