/**
 * dataOperationAgent.ts — Motor ENGINE_EXEC de Maris AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Este agente interpreta peticiones en lenguaje natural del usuario y ejecuta
 * operaciones CRUD reales sobre la base de datos SIN regenerar código fuente.
 *
 * Tipos de operaciones soportadas:
 *   - AÑADIR: insertar usuarios, leads, clientes, trabajadores, registros CRM
 *   - MODIFICAR: actualizar campos de registros existentes
 *   - ELIMINAR: borrar registros por criterio
 *   - CONSULTAR: buscar y mostrar registros
 *   - CONFIGURAR: cambiar ajustes de la app (título, descripción, notas del agente)
 *
 * El agente NO toca frontendCode, backendCode, ni ningún archivo de código.
 * Responde con confirmación clara de lo que hizo o por qué no pudo hacerlo.
 */

import Anthropic from "@anthropic-ai/sdk";
import { connectDB } from "./db";
import { GeneratedApp, User, AppMessage } from "@workspace/db/schema";
import { logger as rootLogger } from "./logger";
import type { Logger } from "pino";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type DataOperationType =
  | "INSERT"      // Añadir un nuevo registro
  | "UPDATE"      // Modificar un registro existente
  | "DELETE"      // Eliminar un registro
  | "QUERY"       // Consultar/buscar registros
  | "CONFIG"      // Cambiar configuración de la app (notas, título, descripción)
  | "UNKNOWN";    // No se pudo determinar la operación

export interface DataOperation {
  type: DataOperationType;
  collection: string;       // Nombre de la colección/entidad (ej: "usuarios", "leads", "trabajadores")
  fields: Record<string, any>;  // Campos a insertar/actualizar
  filter?: Record<string, any>; // Filtro para UPDATE/DELETE/QUERY
  rawRequest: string;       // Petición original del usuario
  confidence: number;       // 0-1, confianza en la interpretación
  explanation: string;      // Explicación en español de lo que se va a hacer
}

export interface DataOperationResult {
  success: boolean;
  operation: DataOperation;
  message: string;          // Respuesta para el usuario en español
  recordsAffected?: number;
  data?: any;               // Datos devueltos en QUERY
  error?: string;
}

// ─── Prompt del agente ────────────────────────────────────────────────────────

const DATA_AGENT_SYSTEM = `Eres el agente de operaciones de datos de Maris AI (ENGINE_EXEC).
Tu trabajo: interpretar peticiones en lenguaje natural del usuario y devolver un JSON estructurado con la operación de datos a ejecutar.

REGLAS CRÍTICAS:
1. NUNCA sugieras modificar código, HTML, CSS, JavaScript o archivos de la app.
2. SOLO operas sobre datos: usuarios, trabajadores, leads, clientes, CRM, configuración de la app.
3. Si la petición es ambigua, elige la interpretación más conservadora (QUERY antes que DELETE).
4. Si no puedes determinar la operación con seguridad, usa type: "UNKNOWN" y explica por qué.

FORMATO DE RESPUESTA (JSON puro, sin markdown):
{
  "type": "INSERT" | "UPDATE" | "DELETE" | "QUERY" | "CONFIG" | "UNKNOWN",
  "collection": "nombre de la entidad en minúsculas (ej: usuarios, leads, trabajadores, clientes, crm_ventas)",
  "fields": { "campo": "valor", ... },
  "filter": { "campo": "valor" },
  "confidence": 0.0-1.0,
  "explanation": "Explicación clara en español de lo que se va a hacer"
}

EJEMPLOS:
- "añade en base de datos de la CRM de ventas de seguxat como trabajador a Ivan con correo ivan@seguxat.com y contraseña 1234"
  → { "type": "INSERT", "collection": "trabajadores_crm", "fields": { "nombre": "Ivan", "email": "ivan@seguxat.com", "password_hash": "1234", "rol": "trabajador", "empresa": "seguxat", "crm": "ventas" }, "confidence": 0.95, "explanation": "Añadir trabajador Ivan a la CRM de ventas de Seguxat" }

- "elimina al usuario con email test@test.com de la CRM"
  → { "type": "DELETE", "collection": "usuarios_crm", "filter": { "email": "test@test.com" }, "fields": {}, "confidence": 0.9, "explanation": "Eliminar usuario test@test.com de la CRM" }

- "muéstrame todos los leads del mes de junio"
  → { "type": "QUERY", "collection": "leads", "filter": { "mes": "junio" }, "fields": {}, "confidence": 0.8, "explanation": "Consultar leads del mes de junio" }

- "cambia el título de la app a Seguxat Pro"
  → { "type": "CONFIG", "collection": "app_config", "fields": { "title": "Seguxat Pro" }, "confidence": 0.99, "explanation": "Actualizar el título de la app a Seguxat Pro" }`;

// ─── Función principal ────────────────────────────────────────────────────────

export async function executeDataOperation(opts: {
  appId: string;
  userId: string;
  message: string;
  appTitle: string;
  appDescription?: string;
  agentNotes?: string;
  log?: Logger;
}): Promise<DataOperationResult> {
  const log = opts.log || rootLogger;

  // 1. Interpretar la petición con IA
  let operation: DataOperation;
  try {
    operation = await interpretDataRequest(opts.message, opts.appTitle, opts.agentNotes, log);
  } catch (err) {
    log.warn({ err }, "dataOperationAgent: error interpretando petición");
    return {
      success: false,
      operation: {
        type: "UNKNOWN",
        collection: "desconocido",
        fields: {},
        rawRequest: opts.message,
        confidence: 0,
        explanation: "No se pudo interpretar la petición",
      },
      message: `⚠️ No pude interpretar tu petición correctamente. Por favor, sé más específico. Por ejemplo: "añade el usuario Juan con email juan@empresa.com y contraseña 1234 a la CRM de ventas".`,
      error: String(err),
    };
  }

  log.info({ operation }, "dataOperationAgent: operación interpretada");

  // 2. Ejecutar la operación
  return await executeOperation(operation, opts.appId, opts.userId, log);
}

// ─── Interpretación con IA ────────────────────────────────────────────────────

async function interpretDataRequest(
  message: string,
  appTitle: string,
  agentNotes: string | undefined,
  log: Logger,
): Promise<DataOperation> {
  const userContent = [
    `App: ${appTitle}`,
    agentNotes ? `Notas del agente: ${agentNotes.slice(0, 800)}` : "",
    ``,
    `Petición del usuario: "${message}"`,
    ``,
    `Devuelve SOLO el JSON de la operación.`,
  ].filter(Boolean).join("\n");

  const result = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    system: DATA_AGENT_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const text = (result.content || [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text as string)
    .join("\n")
    .trim();

  // Parsear JSON
  let parsed: any;
  try {
    const clean = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    parsed = JSON.parse(clean.slice(first, last + 1));
  } catch {
    log.warn({ rawText: text.slice(0, 200) }, "dataOperationAgent: JSON inválido del modelo");
    throw new Error("El modelo devolvió JSON inválido");
  }

  return {
    type: parsed.type || "UNKNOWN",
    collection: String(parsed.collection || "desconocido").toLowerCase(),
    fields: parsed.fields || {},
    filter: parsed.filter || {},
    rawRequest: message,
    confidence: Number(parsed.confidence) || 0.5,
    explanation: String(parsed.explanation || "Operación de datos"),
  };
}

// ─── Ejecución de la operación ────────────────────────────────────────────────

async function executeOperation(
  op: DataOperation,
  appId: string,
  userId: string,
  log: Logger,
): Promise<DataOperationResult> {
  await connectDB();

  // Operaciones de configuración de la app (no requieren colección externa)
  if (op.type === "CONFIG") {
    return await executeConfigOperation(op, appId, userId, log);
  }

  // Operaciones sobre datos de la app (guardados en agentNotes como JSON estructurado)
  if (op.type === "INSERT") {
    return await executeInsertOperation(op, appId, userId, log);
  }

  if (op.type === "UPDATE") {
    return await executeUpdateOperation(op, appId, userId, log);
  }

  if (op.type === "DELETE") {
    return await executeDeleteOperation(op, appId, userId, log);
  }

  if (op.type === "QUERY") {
    return await executeQueryOperation(op, appId, userId, log);
  }

  // UNKNOWN
  return {
    success: false,
    operation: op,
    message: `⚠️ No pude determinar qué operación realizar. Tu petición fue: "${op.rawRequest}"\n\nPor favor, sé más específico. Ejemplos:\n- "añade el usuario Juan con email juan@empresa.com a la CRM"\n- "elimina el lead con email test@test.com"\n- "muéstrame todos los trabajadores de Seguxat"`,
  };
}

// ─── Operaciones específicas ──────────────────────────────────────────────────

async function executeConfigOperation(
  op: DataOperation,
  appId: string,
  userId: string,
  log: Logger,
): Promise<DataOperationResult> {
  const updates: Record<string, any> = {};
  const changes: string[] = [];

  if (op.fields.title) {
    updates.title = String(op.fields.title).slice(0, 200);
    changes.push(`título → "${updates.title}"`);
  }
  if (op.fields.description) {
    updates.description = String(op.fields.description).slice(0, 1000);
    changes.push(`descripción actualizada`);
  }
  if (op.fields.agentNotes) {
    updates.agentNotes = String(op.fields.agentNotes).slice(0, 5000);
    changes.push(`notas del agente actualizadas`);
  }

  if (Object.keys(updates).length === 0) {
    return {
      success: false,
      operation: op,
      message: `⚠️ No identifiqué qué configuración cambiar. Campos disponibles: título, descripción, notas del agente.`,
    };
  }

  await GeneratedApp.findOneAndUpdate({ _id: appId, userId }, updates);
  log.info({ appId, updates }, "dataOperationAgent: CONFIG ejecutado");

  return {
    success: true,
    operation: op,
    message: `✅ Configuración actualizada correctamente:\n${changes.map(c => `  • ${c}`).join("\n")}`,
    recordsAffected: 1,
  };
}

async function executeInsertOperation(
  op: DataOperation,
  appId: string,
  userId: string,
  log: Logger,
): Promise<DataOperationResult> {
  // Los datos se guardan en el campo agentNotes de la app como un almacén JSON estructurado
  const app = await GeneratedApp.findOne({ _id: appId, userId }).lean();
  if (!app) {
    return { success: false, operation: op, message: "❌ App no encontrada.", error: "App not found" };
  }

  // Parsear el almacén de datos existente
  let dataStore: Record<string, any[]> = {};
  try {
    const notes = (app as any).agentNotes || "";
    const dataMatch = notes.match(/<!-- DATA_STORE_START -->([\s\S]*?)<!-- DATA_STORE_END -->/);
    if (dataMatch) {
      dataStore = JSON.parse(dataMatch[1]);
    }
  } catch {
    dataStore = {};
  }

  // Añadir el nuevo registro
  const collectionKey = op.collection;
  if (!dataStore[collectionKey]) {
    dataStore[collectionKey] = [];
  }

  const newRecord = {
    ...op.fields,
    _id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    _createdAt: new Date().toISOString(),
    _createdBy: userId,
  };

  // Hash de contraseñas si se detecta un campo de password
  const passwordFields = ["password", "contraseña", "password_hash", "pass"];
  for (const pf of passwordFields) {
    if (newRecord[pf]) {
      // Indicar que está guardado (en producción se usaría bcrypt)
      newRecord[pf] = `[PROTEGIDO:${Buffer.from(String(newRecord[pf])).toString("base64")}]`;
    }
  }

  dataStore[collectionKey].push(newRecord);

  // Guardar el almacén actualizado en agentNotes
  const existingNotes = ((app as any).agentNotes || "").replace(
    /<!-- DATA_STORE_START -->[\s\S]*?<!-- DATA_STORE_END -->/,
    ""
  ).trim();

  const newNotes = [
    existingNotes,
    `<!-- DATA_STORE_START -->${JSON.stringify(dataStore, null, 2)}<!-- DATA_STORE_END -->`,
  ].filter(Boolean).join("\n\n");

  await GeneratedApp.findOneAndUpdate({ _id: appId, userId }, { agentNotes: newNotes });

  log.info({ appId, collection: collectionKey, recordId: newRecord._id }, "dataOperationAgent: INSERT ejecutado");

  // Formatear respuesta legible
  const fieldsSummary = Object.entries(op.fields)
    .filter(([k]) => !["password", "contraseña", "password_hash", "pass"].includes(k))
    .map(([k, v]) => `  • ${k}: ${v}`)
    .join("\n");

  return {
    success: true,
    operation: op,
    message: `✅ Registro añadido correctamente a **${collectionKey}**:\n${fieldsSummary}\n\nID asignado: \`${newRecord._id}\`\nTotal en colección: ${dataStore[collectionKey].length} registro(s).`,
    recordsAffected: 1,
    data: { id: newRecord._id, collection: collectionKey },
  };
}

async function executeUpdateOperation(
  op: DataOperation,
  appId: string,
  userId: string,
  log: Logger,
): Promise<DataOperationResult> {
  const app = await GeneratedApp.findOne({ _id: appId, userId }).lean();
  if (!app) {
    return { success: false, operation: op, message: "❌ App no encontrada.", error: "App not found" };
  }

  let dataStore: Record<string, any[]> = {};
  try {
    const notes = (app as any).agentNotes || "";
    const dataMatch = notes.match(/<!-- DATA_STORE_START -->([\s\S]*?)<!-- DATA_STORE_END -->/);
    if (dataMatch) dataStore = JSON.parse(dataMatch[1]);
  } catch { dataStore = {}; }

  const collectionKey = op.collection;
  const collection = dataStore[collectionKey] || [];

  // Encontrar registros que coincidan con el filtro
  const filter = op.filter || {};
  let updated = 0;
  const updatedCollection = collection.map((record: any) => {
    const matches = Object.entries(filter).every(([k, v]) =>
      String(record[k] || "").toLowerCase() === String(v).toLowerCase()
    );
    if (matches) {
      updated++;
      return { ...record, ...op.fields, _updatedAt: new Date().toISOString() };
    }
    return record;
  });

  if (updated === 0) {
    return {
      success: false,
      operation: op,
      message: `⚠️ No se encontraron registros en **${collectionKey}** que coincidan con: ${JSON.stringify(filter)}`,
    };
  }

  dataStore[collectionKey] = updatedCollection;
  const existingNotes = ((app as any).agentNotes || "").replace(
    /<!-- DATA_STORE_START -->[\s\S]*?<!-- DATA_STORE_END -->/,
    ""
  ).trim();
  const newNotes = [
    existingNotes,
    `<!-- DATA_STORE_START -->${JSON.stringify(dataStore, null, 2)}<!-- DATA_STORE_END -->`,
  ].filter(Boolean).join("\n\n");

  await GeneratedApp.findOneAndUpdate({ _id: appId, userId }, { agentNotes: newNotes });
  log.info({ appId, collection: collectionKey, updated }, "dataOperationAgent: UPDATE ejecutado");

  return {
    success: true,
    operation: op,
    message: `✅ ${updated} registro(s) actualizado(s) en **${collectionKey}**.`,
    recordsAffected: updated,
  };
}

async function executeDeleteOperation(
  op: DataOperation,
  appId: string,
  userId: string,
  log: Logger,
): Promise<DataOperationResult> {
  const app = await GeneratedApp.findOne({ _id: appId, userId }).lean();
  if (!app) {
    return { success: false, operation: op, message: "❌ App no encontrada.", error: "App not found" };
  }

  let dataStore: Record<string, any[]> = {};
  try {
    const notes = (app as any).agentNotes || "";
    const dataMatch = notes.match(/<!-- DATA_STORE_START -->([\s\S]*?)<!-- DATA_STORE_END -->/);
    if (dataMatch) dataStore = JSON.parse(dataMatch[1]);
  } catch { dataStore = {}; }

  const collectionKey = op.collection;
  const collection = dataStore[collectionKey] || [];
  const filter = op.filter || {};

  if (Object.keys(filter).length === 0) {
    return {
      success: false,
      operation: op,
      message: `⚠️ No puedo eliminar sin un filtro específico. Por favor, indica qué registro eliminar (ej: por email, nombre o ID).`,
    };
  }

  const before = collection.length;
  dataStore[collectionKey] = collection.filter((record: any) =>
    !Object.entries(filter).every(([k, v]) =>
      String(record[k] || "").toLowerCase() === String(v).toLowerCase()
    )
  );
  const deleted = before - dataStore[collectionKey].length;

  if (deleted === 0) {
    return {
      success: false,
      operation: op,
      message: `⚠️ No se encontraron registros en **${collectionKey}** que coincidan con: ${JSON.stringify(filter)}`,
    };
  }

  const existingNotes = ((app as any).agentNotes || "").replace(
    /<!-- DATA_STORE_START -->[\s\S]*?<!-- DATA_STORE_END -->/,
    ""
  ).trim();
  const newNotes = [
    existingNotes,
    `<!-- DATA_STORE_START -->${JSON.stringify(dataStore, null, 2)}<!-- DATA_STORE_END -->`,
  ].filter(Boolean).join("\n\n");

  await GeneratedApp.findOneAndUpdate({ _id: appId, userId }, { agentNotes: newNotes });
  log.info({ appId, collection: collectionKey, deleted }, "dataOperationAgent: DELETE ejecutado");

  return {
    success: true,
    operation: op,
    message: `✅ ${deleted} registro(s) eliminado(s) de **${collectionKey}**.`,
    recordsAffected: deleted,
  };
}

async function executeQueryOperation(
  op: DataOperation,
  appId: string,
  userId: string,
  log: Logger,
): Promise<DataOperationResult> {
  const app = await GeneratedApp.findOne({ _id: appId, userId }).lean();
  if (!app) {
    return { success: false, operation: op, message: "❌ App no encontrada.", error: "App not found" };
  }

  let dataStore: Record<string, any[]> = {};
  try {
    const notes = (app as any).agentNotes || "";
    const dataMatch = notes.match(/<!-- DATA_STORE_START -->([\s\S]*?)<!-- DATA_STORE_END -->/);
    if (dataMatch) dataStore = JSON.parse(dataMatch[1]);
  } catch { dataStore = {}; }

  const collectionKey = op.collection;

  // Si no hay colección específica, listar todas
  if (collectionKey === "desconocido" || collectionKey === "all") {
    const collections = Object.keys(dataStore);
    if (collections.length === 0) {
      return {
        success: true,
        operation: op,
        message: `📋 No hay datos guardados en esta app todavía. Puedes añadir registros diciéndome, por ejemplo: "añade el usuario Juan con email juan@empresa.com a la CRM".`,
        data: {},
      };
    }
    const summary = collections.map(c => `  • **${c}**: ${dataStore[c].length} registro(s)`).join("\n");
    return {
      success: true,
      operation: op,
      message: `📋 Colecciones disponibles:\n${summary}`,
      data: dataStore,
    };
  }

  const collection = dataStore[collectionKey] || [];
  const filter = op.filter || {};

  // Aplicar filtro si existe
  const results = Object.keys(filter).length > 0
    ? collection.filter((record: any) =>
        Object.entries(filter).some(([k, v]) =>
          String(record[k] || "").toLowerCase().includes(String(v).toLowerCase())
        )
      )
    : collection;

  if (results.length === 0) {
    return {
      success: true,
      operation: op,
      message: `📋 No se encontraron registros en **${collectionKey}**${Object.keys(filter).length > 0 ? ` con filtro: ${JSON.stringify(filter)}` : ""}.`,
      data: [],
      recordsAffected: 0,
    };
  }

  // Formatear resultados (ocultar contraseñas)
  const safeResults = results.map((r: any) => {
    const safe = { ...r };
    for (const pf of ["password", "contraseña", "password_hash", "pass"]) {
      if (safe[pf]) safe[pf] = "[PROTEGIDO]";
    }
    return safe;
  });

  const formatted = safeResults.slice(0, 10).map((r: any, i: number) => {
    const fields = Object.entries(r)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => `    ${k}: ${v}`)
      .join("\n");
    return `  ${i + 1}. {\n${fields}\n  }`;
  }).join("\n");

  return {
    success: true,
    operation: op,
    message: `📋 **${collectionKey}** — ${results.length} registro(s) encontrado(s):\n\n${formatted}${results.length > 10 ? `\n\n... y ${results.length - 10} más.` : ""}`,
    data: safeResults,
    recordsAffected: results.length,
  };
}
