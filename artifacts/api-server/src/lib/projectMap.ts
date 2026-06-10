/**
 * projectMap.ts — Sistema de mapa de proyecto para Maris AI
 *
 * Permite a los agentes conocer exactamente dónde está cada archivo
 * del proyecto generado (frontend, backend, base de datos) para ir
 * directo al archivo correcto sin buscar ni regenerar todo.
 *
 * Esto resuelve el problema de que los agentes regeneraban todo el
 * frontend cuando el usuario pedía solo modificar un dato en la CRM.
 */

import { analyzeSpanishIntent, firstMatchedTerm, hasSpanishDomain } from "./spanishIntentLexicon";

export interface ProjectFile {
  path: string;
  type: "frontend" | "backend" | "database" | "config" | "style" | "test";
  description: string;
  keywords: string[];
}

export interface ProjectMap {
  appId: string;
  appName: string;
  files: ProjectFile[];
  routes: { path: string; component: string; description: string }[];
  dataModels: { name: string; fields: string[]; location: string }[];
  apiEndpoints: { method: string; path: string; description: string }[];
  generatedAt: string;
}

/**
 * Analiza el código fuente de una app generada y construye su mapa de proyecto.
 * Este mapa se guarda en agentNotes para que los agentes lo consulten en cada petición.
 */
export function buildProjectMap(
  appId: string,
  appName: string,
  frontendCode: string,
  backendCode?: string
): ProjectMap {
  const files: ProjectFile[] = [];
  const routes: ProjectMap["routes"] = [];
  const dataModels: ProjectMap["dataModels"] = [];
  const apiEndpoints: ProjectMap["apiEndpoints"] = [];

  // ── Analizar el frontend ──────────────────────────────────────────────────
  if (frontendCode) {
    // Detectar archivos en el formato real del bundle persistido por Maris AI:
    // // === FILE: src/App.tsx ===
    // También mantenemos compatibilidad con marcadores legacy.
    const bundleFileMatches = Array.from(frontendCode.matchAll(/\/\/\s*===\s*FILE:\s*([^=\n]+?)\s*===/g)).map((m) => m[1].trim());
    const htmlFiles = frontendCode.match(/<!-- FILE: ([^\s]+) -->/g) || [];
    const jsFiles = frontendCode.match(/\/\/ FILE: ([^\s]+)/g) || [];
    const cssFiles = frontendCode.match(/\/\* FILE: ([^\s]+) \*\//g) || [];

    // Detectar rutas del router
    const routeMatches = frontendCode.matchAll(
      /(?:path|href|route)\s*[=:]\s*["']([/][^"']+)["']/g
    );
    for (const match of routeMatches) {
      const routePath = match[1];
      if (routePath && !routePath.includes("*") && routePath.length > 1) {
        routes.push({
          path: routePath,
          component: inferComponentFromPath(routePath),
          description: inferDescriptionFromPath(routePath),
        });
      }
    }

    // Detectar modelos de datos (tablas, colecciones, interfaces)
    const modelMatches = frontendCode.matchAll(
      /(?:interface|type|class|const)\s+(\w+(?:Model|Schema|Data|Record|Entry|Row|Item))\s*[={<]/g
    );
    for (const match of modelMatches) {
      dataModels.push({
        name: match[1],
        fields: extractFieldsFromModel(frontendCode, match[1]),
        location: "frontend/models",
      });
    }

    // Detectar tablas/listas de datos (CRM, inventario, etc.)
    const tableMatches = frontendCode.matchAll(
      /(?:crm|clientes|trabajadores|empleados|usuarios|ventas|productos|inventario|pedidos|facturas|contactos)\s*[=:]/gi
    );
    for (const match of tableMatches) {
      const tableName = match[0].replace(/[=:\s]/g, "").toLowerCase();
      if (!dataModels.find((m) => m.name.toLowerCase() === tableName)) {
        dataModels.push({
          name: tableName,
          fields: [],
          location: "frontend/data",
        });
      }
    }

    // Detectar endpoints de API llamados desde el frontend
    const fetchMatches = frontendCode.matchAll(
      /fetch\(['"`](\/api\/[^'"`]+)['"`]/g
    );
    for (const match of fetchMatches) {
      apiEndpoints.push({
        method: "GET",
        path: match[1],
        description: `Endpoint llamado desde el frontend`,
      });
    }

    // Clasificar archivos detectados
    const detectedFrontendFiles = [
      ...bundleFileMatches,
      ...[...htmlFiles, ...jsFiles, ...cssFiles].map((file) =>
        file.replace(/(?:<!-- FILE: |\/\/ FILE: |\/\* FILE: )\s*/, "").replace(/\s*(?:-->|\*\/)/, "").trim()
      ),
    ].filter(Boolean);

    for (const path of Array.from(new Set(detectedFrontendFiles))) {
      files.push({
        path,
        type: inferFileType(path),
        description: `Archivo de frontend: ${path}`,
        keywords: inferKeywordsFromPath(path),
      });
    }

    // Si no se detectaron archivos explícitos, añadir el bundle principal
    if (files.length === 0) {
      files.push({
        path: "index.html",
        type: "frontend",
        description: "Archivo principal del frontend (SPA)",
        keywords: ["html", "frontend", "principal", "index", "inicio", "home"],
      });
    }
  }

  // ── Analizar el backend ───────────────────────────────────────────────────
  if (backendCode) {
    const backendFileMatches = [
      ...Array.from(backendCode.matchAll(/\/\/\s*===\s*FILE:\s*([^=\n]+?)\s*===/g)).map((m) => m[1].trim()),
      ...Array.from(backendCode.matchAll(/\/\/ FILE: ([^\s]+)/g)).map((m) => m[1].trim()),
    ];
    for (const path of Array.from(new Set(backendFileMatches)).filter(Boolean)) {
      files.push({
        path,
        type: "backend",
        description: `Archivo de backend: ${path}`,
        keywords: inferKeywordsFromPath(path),
      });
    }

    // Detectar rutas de API en el backend
    const apiRouteMatches = backendCode.matchAll(
      /(?:app|router)\.(get|post|put|patch|delete)\(['"`](\/[^'"`]+)['"`]/gi
    );
    for (const match of apiRouteMatches) {
      apiEndpoints.push({
        method: match[1].toUpperCase(),
        path: match[2],
        description: inferDescriptionFromPath(match[2]),
      });
    }

    // Detectar modelos de base de datos
    const dbModelMatches = backendCode.matchAll(
      /(?:mongoose\.model|Schema|createTable|CREATE TABLE)\s*\(['"`]?(\w+)['"`]?/gi
    );
    for (const match of dbModelMatches) {
      dataModels.push({
        name: match[1],
        fields: extractFieldsFromModel(backendCode, match[1]),
        location: "backend/models",
      });
    }
  }

  // Deduplicar rutas y modelos
  const uniqueRoutes = routes.filter(
    (r, i, arr) => arr.findIndex((x) => x.path === r.path) === i
  );
  const uniqueModels = dataModels.filter(
    (m, i, arr) => arr.findIndex((x) => x.name === m.name) === i
  );
  const uniqueEndpoints = apiEndpoints.filter(
    (e, i, arr) =>
      arr.findIndex((x) => x.method === e.method && x.path === e.path) === i
  );

  return {
    appId,
    appName,
    files,
    routes: uniqueRoutes,
    dataModels: uniqueModels,
    apiEndpoints: uniqueEndpoints,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Dado un prompt del usuario, determina exactamente qué parte del proyecto
 * debe modificarse y devuelve el archivo/sección objetivo.
 *
 * Esto es lo que evita que los agentes regeneren todo el frontend cuando
 * el usuario pide solo añadir un registro a la CRM.
 */
export function resolveTargetFromPrompt(
  prompt: string,
  projectMap: ProjectMap
): {
  targetType: "frontend_file" | "backend_file" | "data_record" | "api_endpoint" | "style" | "full_rebuild";
  targetPath?: string;
  targetModel?: string;
  targetEndpoint?: string;
  confidence: number;
  reasoning: string;
} {
  const lowerPrompt = prompt.toLowerCase();
  const spanish = analyzeSpanishIntent(prompt);

  if (spanish.isDataOperation) {
    let targetModel: string | undefined;
    let maxScore = 0;
    for (const model of projectMap.dataModels) {
      const score = scoreModelRelevance(spanish.normalized, model);
      if (score > maxScore) {
        maxScore = score;
        targetModel = model.name;
      }
    }
    if (!targetModel) {
      if (hasSpanishDomain(spanish, ["crm"])) targetModel = "crm";
      else if (hasSpanishDomain(spanish, ["user"])) targetModel = "usuarios";
      else if (hasSpanishDomain(spanish, ["inventory"])) targetModel = "productos";
      else if (hasSpanishDomain(spanish, ["sales"])) targetModel = "ventas";
      else targetModel = "datos";
    }
    const term = firstMatchedTerm(spanish, ["action.", "domain."]) || "operación de datos";
    return {
      targetType: "data_record",
      targetModel,
      confidence: Math.max(0.95, spanish.confidence),
      reasoning: `Léxico español detectó operación de datos (${term}). Ir directo al modelo "${targetModel}" sin tocar el frontend.`,
    };
  }

  if (hasSpanishDomain(spanish, ["style"])) {
    const cssFile = projectMap.files.find((f) => f.type === "style");
    const term = firstMatchedTerm(spanish, ["domain.style", "action."]) || "estilo";
    return {
      targetType: "style",
      targetPath: cssFile?.path || findBestMatchingFile(spanish.normalized, projectMap.files.filter((f) => f.type === "style" || f.type === "frontend"))?.path || "src/App.tsx",
      confidence: Math.max(0.88, spanish.confidence),
      reasoning: `Léxico español detectó cambio de estilo (${term}). Ir directo al archivo visual objetivo.`,
    };
  }

  if (hasSpanishDomain(spanish, ["backend", "api"])) {
    const targetFile = findBestMatchingFile(spanish.normalized, projectMap.files.filter((f) => f.type === "backend"));
    const term = firstMatchedTerm(spanish, ["domain.backend", "domain.api", "action."]) || "backend/API";
    return {
      targetType: "backend_file",
      targetPath: targetFile?.path || "server.js",
      confidence: Math.max(0.84, spanish.confidence),
      reasoning: `Léxico español detectó lógica backend/API (${term}). Ir directo al archivo backend.`,
    };
  }

  if (spanish.isFullBuild) {
    const term = firstMatchedTerm(spanish, ["domain.full_build", "action.create"]) || "reconstrucción";
    return {
      targetType: "full_rebuild",
      confidence: Math.max(0.90, spanish.confidence),
      reasoning: `Léxico español detectó reconstrucción completa (${term}). Regenerar todo el proyecto.`,
    };
  }

  if (hasSpanishDomain(spanish, ["ui", "component", "frontend", "deployment"]) || spanish.isDirectEdit) {
    const targetFile = findBestMatchingFile(spanish.normalized, projectMap.files.filter((f) => f.type === "frontend" || f.type === "style"));
    const term = firstMatchedTerm(spanish, ["domain.ui", "domain.component", "domain.frontend", "domain.deployment", "action."]) || "frontend";
    return {
      targetType: "frontend_file",
      targetPath: targetFile?.path || "src/App.tsx",
      confidence: Math.max(0.80, spanish.confidence),
      reasoning: `Léxico español detectó cambio de UI/frontend (${term}). Ir directo al archivo "${targetFile?.path || "src/App.tsx"}".`,
    };
  }

  // ── Operaciones de datos (máxima prioridad) ───────────────────────────────
  const dataKeywords = [
    "añade", "agrega", "inserta", "crea un registro", "nuevo registro",
    "añadir usuario", "añadir cliente", "añadir trabajador", "añadir empleado",
    "añadir producto", "añadir venta", "añadir pedido", "añadir factura",
    "elimina", "borra", "eliminar registro", "borrar registro",
    "actualiza", "modifica", "cambia el valor", "edita el registro",
    "busca en", "lista los", "muestra los registros",
    "en base de datos", "en la base de datos", "en la crm", "en el crm",
    "en la tabla", "en el inventario", "en los contactos",
    "como trabajador", "como cliente", "como usuario", "como empleado",
    "con este correo", "con este email", "con esta contraseña",
  ];

  for (const keyword of dataKeywords) {
    if (lowerPrompt.includes(keyword)) {
      // Encontrar el modelo de datos más relevante
      let targetModel: string | undefined;
      let maxScore = 0;

      for (const model of projectMap.dataModels) {
        const score = scoreModelRelevance(lowerPrompt, model);
        if (score > maxScore) {
          maxScore = score;
          targetModel = model.name;
        }
      }

      // Si no encontramos modelo específico, inferir del contexto
      if (!targetModel) {
        if (lowerPrompt.includes("crm") || lowerPrompt.includes("cliente") || lowerPrompt.includes("contacto")) {
          targetModel = "crm";
        } else if (lowerPrompt.includes("trabajador") || lowerPrompt.includes("empleado") || lowerPrompt.includes("usuario")) {
          targetModel = "usuarios";
        } else if (lowerPrompt.includes("producto") || lowerPrompt.includes("inventario")) {
          targetModel = "productos";
        } else if (lowerPrompt.includes("venta") || lowerPrompt.includes("pedido") || lowerPrompt.includes("factura")) {
          targetModel = "ventas";
        }
      }

      return {
        targetType: "data_record",
        targetModel,
        confidence: 0.95,
        reasoning: `El usuario quiere realizar una operación de datos (detectado: "${keyword}"). Ir directo al modelo "${targetModel || "datos"}" sin tocar el frontend.`,
      };
    }
  }

  // ── Modificaciones de estilo/diseño ──────────────────────────────────────
  const styleKeywords = [
    "color", "fuente", "tipografía", "tamaño", "margen", "padding",
    "fondo", "background", "borde", "sombra", "animación", "transición",
    "css", "estilo", "diseño visual", "tema", "dark mode", "light mode",
  ];

  for (const keyword of styleKeywords) {
    if (lowerPrompt.includes(keyword)) {
      const cssFile = projectMap.files.find((f) => f.type === "style");
      return {
        targetType: "style",
        targetPath: cssFile?.path || "styles.css",
        confidence: 0.85,
        reasoning: `El usuario quiere modificar el estilo visual (detectado: "${keyword}"). Ir directo al archivo CSS/estilo.`,
      };
    }
  }

  // ── Modificaciones de un componente específico ────────────────────────────
  const componentKeywords = [
    "botón", "button", "formulario", "form", "tabla", "table",
    "menú", "menu", "navbar", "header", "footer", "modal", "popup",
    "tarjeta", "card", "lista", "list", "imagen", "logo",
    "página de", "sección de", "componente de",
  ];

  for (const keyword of componentKeywords) {
    if (lowerPrompt.includes(keyword)) {
      // Encontrar el archivo frontend más relevante
      const targetFile = findBestMatchingFile(lowerPrompt, projectMap.files.filter((f) => f.type === "frontend"));
      return {
        targetType: "frontend_file",
        targetPath: targetFile?.path || "index.html",
        confidence: 0.80,
        reasoning: `El usuario quiere modificar un componente UI (detectado: "${keyword}"). Ir directo al archivo "${targetFile?.path || "index.html"}".`,
      };
    }
  }

  // ── Modificaciones de lógica de backend ──────────────────────────────────
  const backendKeywords = [
    "api", "endpoint", "ruta", "servidor", "backend",
    "autenticación", "login", "registro", "contraseña",
    "email", "notificación", "webhook", "cron",
  ];

  for (const keyword of backendKeywords) {
    if (lowerPrompt.includes(keyword)) {
      const targetFile = findBestMatchingFile(lowerPrompt, projectMap.files.filter((f) => f.type === "backend"));
      return {
        targetType: "backend_file",
        targetPath: targetFile?.path || "server.js",
        confidence: 0.80,
        reasoning: `El usuario quiere modificar la lógica del backend (detectado: "${keyword}"). Ir directo al archivo "${targetFile?.path || "server.js"}".`,
      };
    }
  }

  // ── Reconstrucción completa (solo si es necesario) ────────────────────────
  const rebuildKeywords = [
    "rediseña", "reconstruye", "rehaz", "crea desde cero",
    "cambia completamente", "nueva versión", "refactoriza todo",
  ];

  for (const keyword of rebuildKeywords) {
    if (lowerPrompt.includes(keyword)) {
      return {
        targetType: "full_rebuild",
        confidence: 0.90,
        reasoning: `El usuario quiere una reconstrucción completa (detectado: "${keyword}"). Regenerar todo el proyecto.`,
      };
    }
  }

  // ── Por defecto: modificación de frontend ────────────────────────────────
  const targetFile = findBestMatchingFile(lowerPrompt, projectMap.files);
  return {
    targetType: "frontend_file",
    targetPath: targetFile?.path || "index.html",
    confidence: 0.60,
    reasoning: `No se detectó una operación específica. Modificar el archivo de frontend más relevante: "${targetFile?.path || "index.html"}".`,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function inferComponentFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1]
    ?.replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase()) || path;
}

function inferDescriptionFromPath(path: string): string {
  const descriptions: Record<string, string> = {
    "/": "Página de inicio",
    "/dashboard": "Panel de control",
    "/login": "Inicio de sesión",
    "/register": "Registro de usuario",
    "/crm": "CRM de clientes",
    "/ventas": "Gestión de ventas",
    "/productos": "Catálogo de productos",
    "/inventario": "Gestión de inventario",
    "/usuarios": "Gestión de usuarios",
    "/admin": "Panel de administración",
    "/api": "Endpoint de API",
  };
  for (const [key, desc] of Object.entries(descriptions)) {
    if (path.includes(key)) return desc;
  }
  return `Ruta: ${path}`;
}

function inferFileType(path: string): ProjectFile["type"] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".css") || lower.includes("style") || lower.includes("tailwind")) return "style";
  if (lower.includes("test") || lower.includes("spec")) return "test";
  if (lower.includes("package.json") || lower.includes("vite.config") || lower.includes("tsconfig") || lower.includes("config")) return "config";
  return "frontend";
}

function inferKeywordsFromPath(path: string): string[] {
  return path
    .toLowerCase()
    .replace(/[/.\\-_]/g, " ")
    .split(" ")
    .filter((w) => w.length > 2);
}

function extractFieldsFromModel(code: string, modelName: string): string[] {
  const fields: string[] = [];
  const modelRegex = new RegExp(
    `${modelName}[^{]*{([^}]+)}`,
    "s"
  );
  const match = code.match(modelRegex);
  if (match) {
    const fieldMatches = match[1].matchAll(/(\w+)\s*[?:]?\s*:/g);
    for (const f of fieldMatches) {
      fields.push(f[1]);
    }
  }
  return fields.slice(0, 20);
}

function scoreModelRelevance(prompt: string, model: ProjectMap["dataModels"][0]): number {
  let score = 0;
  const modelNameLower = model.name.toLowerCase();

  if (prompt.includes(modelNameLower)) score += 10;
  for (const field of model.fields) {
    if (prompt.includes(field.toLowerCase())) score += 2;
  }
  for (const keyword of model.keywords || []) {
    if (prompt.includes(keyword.toLowerCase())) score += 3;
  }

  return score;
}

function findBestMatchingFile(
  prompt: string,
  files: ProjectFile[]
): ProjectFile | undefined {
  let bestFile: ProjectFile | undefined;
  let maxScore = 0;

  for (const file of files) {
    let score = 0;
    for (const keyword of file.keywords) {
      if (prompt.includes(keyword.toLowerCase())) score += 3;
    }
    if (prompt.includes(file.path.toLowerCase())) score += 10;
    if (score > maxScore) {
      maxScore = score;
      bestFile = file;
    }
  }

  return bestFile || files[0];
}

// Añadir keywords a ProjectMap["dataModels"][0] para el scoring
declare module "./projectMap" {
  interface DataModel {
    keywords?: string[];
  }
}
