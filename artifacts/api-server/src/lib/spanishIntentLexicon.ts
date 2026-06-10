/*
 * spanishIntentLexicon.ts — Léxico español por capas para Maris AI.
 *
 * Objetivo: interpretar solicitudes reales de usuarios hispanohablantes sin
 * depender de un prompt largo ni gastar tokens innecesarios. Este módulo es
 * determinista y sirve como capa común para intentClassifier, planner y
 * projectMap.
 */

export type SpanishAction =
  | "add"
  | "modify"
  | "delete"
  | "query"
  | "fix"
  | "create"
  | "configure"
  | "research";

export type SpanishDomain =
  | "data"
  | "crm"
  | "user"
  | "sales"
  | "inventory"
  | "credentials"
  | "ui"
  | "style"
  | "component"
  | "frontend"
  | "backend"
  | "api"
  | "deployment"
  | "billing"
  | "research"
  | "full_build";

export interface SpanishLexiconAnalysis {
  original: string;
  normalized: string;
  actions: SpanishAction[];
  domains: SpanishDomain[];
  matchedTerms: Record<string, string[]>;
  isDataOperation: boolean;
  isDevOperation: boolean;
  isResearch: boolean;
  isBugFix: boolean;
  isFullBuild: boolean;
  isDirectEdit: boolean;
  confidence: number;
}

const ACTION_TERMS: Record<SpanishAction, string[]> = {
  add: [
    "anade", "anadir", "agrega", "agregar", "incluye", "incluir", "inserta", "insertar",
    "pon", "poner", "mete", "meter", "suma", "sumar", "incorpora", "incorporar",
    "crea un registro", "nuevo registro", "dar de alta", "alta de", "registrar", "registra",
  ],
  modify: [
    "modifica", "modificar", "cambia", "cambiar", "edita", "editar", "actualiza", "actualizar",
    "ajusta", "ajustar", "corrige el texto", "retoca", "retocar", "reemplaza", "reemplazar",
    "sustituye", "sustituir", "renombra", "renombrar", "ponlo", "dejalo", "dejala",
  ],
  delete: [
    "elimina", "eliminar", "borra", "borrar", "quita", "quitar", "suprime", "suprimir",
    "retira", "retirar", "desactiva", "desactivar", "revoca", "revocar", "oculta", "ocultar",
    "quita de ahi", "borralo", "borrala", "eliminalo", "eliminala",
  ],
  query: [
    "muestra", "mostrar", "muestrame", "lista", "listar", "consulta", "consultar", "ver",
    "visualiza", "visualizar", "ensenar", "ensename", "dime", "revisa", "revisar", "comprueba",
    "comprueba si", "cuantos", "cuantas", "donde esta", "que tiene",
  ],
  fix: [
    "arregla", "arreglar", "corrige", "corregir", "repara", "reparar", "soluciona", "solucionar",
    "fix", "fixea", "debug", "depura", "depurar", "no funciona", "no carga", "falla", "fallo",
    "roto", "rota", "pantalla en blanco", "error", "errores", "crash", "crashea",
  ],
  create: [
    "crea", "crear", "creame", "haz", "hacer", "construye", "construir", "genera", "generar",
    "desarrolla", "desarrollar", "programa", "programar", "monta", "montar", "prepara", "preparar",
  ],
  configure: [
    "configura", "configurar", "activa", "activar", "conecta", "conectar", "integra", "integrar",
    "sincroniza", "sincronizar", "enlaza", "enlazar", "vincula", "vincular", "setup",
  ],
  research: [
    "busca", "buscar", "buscame", "investiga", "investigar", "mira en internet", "mira la web",
    "consulta en internet", "revisa esta url", "abre esta url", "analiza esta web",
  ],
};

const DOMAIN_TERMS: Record<SpanishDomain, string[]> = {
  data: [
    "base de datos", "bbdd", "database", "mongodb", "mongo db", "coleccion", "collection",
    "tabla", "registro", "registros", "dato", "datos", "campo", "campos", "fila", "filas",
  ],
  crm: ["crm", "lead", "leads", "cliente", "clientes", "contacto", "contactos", "pipeline", "comercial", "comerciales"],
  user: ["usuario", "usuarios", "trabajador", "trabajadores", "empleado", "empleados", "miembro", "miembros", "admin", "administrador"],
  sales: ["venta", "ventas", "pedido", "pedidos", "factura", "facturas", "presupuesto", "presupuestos", "precio", "precios"],
  inventory: ["producto", "productos", "inventario", "stock", "catalogo", "tienda", "articulo", "articulos"],
  credentials: ["credenciales", "password", "contrasena", "clave", "email", "correo", "permiso", "permisos", "rol", "roles", "acceso"],
  ui: ["vista", "pagina", "pantalla", "seccion", "interfaz", "ui", "ux", "layout", "maquetacion", "web", "app"],
  style: ["color", "colores", "fondo", "background", "fuente", "tipografia", "tamano", "margen", "padding", "borde", "sombra", "css", "estilo", "estilos", "tema", "dark mode", "light mode"],
  component: ["boton", "formulario", "tabla", "menu", "navbar", "header", "footer", "modal", "popup", "tarjeta", "card", "lista", "imagen", "logo", "input", "select", "componente"],
  frontend: ["frontend", "react", "tsx", "jsx", "html", "tailwind", "vite", "cliente", "navegador"],
  backend: ["backend", "server", "servidor", "node", "express", "fastapi", "api server", "worker", "cola", "job"],
  api: ["api", "endpoint", "ruta", "webhook", "request", "response", "integracion", "servicio externo"],
  deployment: ["deploy", "despliegue", "vercel", "railway", "render", "dominio", "dns", "preview", "produccion", "hosting"],
  billing: ["credito", "creditos", "saldo", "limite", "facturacion", "billing", "pago", "stripe", "plan", "premium"],
  research: ["internet", "web", "url", "noticia", "competencia", "mercado", "investigacion", "fuente"],
  full_build: ["app completa", "aplicacion completa", "desde cero", "landing completa", "mvp", "saas", "marketplace", "red social", "clon de", "tipo instagram", "tipo tinder", "tipo wallapop", "tipo spotify"],
};

const COLOQUIAL_SPANISH_TERMS = [
  "ponme", "hazme", "mirame", "echale un ojo", "dejalo bien", "dejala bien", "como dios manda",
  "arreglame esto", "ponlo bonito", "quita eso", "mete esto", "dale cana", "que no falle",
  "perfecto", "bien hecho", "tal cual", "solo eso", "y para", "no toques mas",
];

function normalizeSpanish(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[“”«»]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9@._:\/\-\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function termToRegex(term: string): RegExp {
  const normalizedTerm = normalizeSpanish(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\b)${normalizedTerm}(\\b|$)`, "i");
}

function collectMatches(normalizedText: string, terms: string[]): string[] {
  const matches: string[] = [];
  for (const term of terms) {
    if (termToRegex(term).test(normalizedText)) matches.push(term);
  }
  return matches;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function analyzeSpanishIntent(text: string): SpanishLexiconAnalysis {
  const normalized = normalizeSpanish(text);
  const matchedTerms: Record<string, string[]> = {};
  const actions: SpanishAction[] = [];
  const domains: SpanishDomain[] = [];

  for (const [action, terms] of Object.entries(ACTION_TERMS) as Array<[SpanishAction, string[]]>) {
    const matches = collectMatches(normalized, terms);
    if (matches.length > 0) {
      actions.push(action);
      matchedTerms[`action.${action}`] = matches;
    }
  }

  for (const [domain, terms] of Object.entries(DOMAIN_TERMS) as Array<[SpanishDomain, string[]]>) {
    const matches = collectMatches(normalized, terms);
    if (matches.length > 0) {
      domains.push(domain);
      matchedTerms[`domain.${domain}`] = matches;
    }
  }

  const colloquialMatches = collectMatches(normalized, COLOQUIAL_SPANISH_TERMS);
  if (colloquialMatches.length > 0) matchedTerms["layer.colloquial"] = colloquialMatches;

  const dataDomains: SpanishDomain[] = ["data", "crm", "user", "sales", "inventory", "credentials"];
  const strongDataDomains: SpanishDomain[] = ["data", "crm", "user", "inventory", "credentials"];
  const devDomains: SpanishDomain[] = ["ui", "style", "component", "frontend", "backend", "api", "deployment"];
  const dataAction = actions.some((a) => ["add", "modify", "delete", "query", "configure"].includes(a));
  const devAction = actions.some((a) => ["add", "modify", "delete", "fix", "create", "configure"].includes(a));

  const hasDataDomain = domains.some((d) => dataDomains.includes(d));
  const hasStrongDataDomain = domains.some((d) => strongDataDomains.includes(d));
  const hasDevDomain = domains.some((d) => devDomains.includes(d));
  const hasExplicitTechnicalBackend = domains.some((d) => ["backend", "api", "deployment"].includes(d));
  const isResearch = actions.includes("research") || domains.includes("research") || /https?:\/\//i.test(text);
  const isBugFix = actions.includes("fix");
  const isFullBuild = domains.includes("full_build") || (actions.includes("create") && /\b(app|aplicacion|web|saas|mvp|marketplace)\b/i.test(normalized));

  // Evita falsos positivos: "elimina el modal de precios" contiene "precios",
  // pero el dominio fuerte es UI/componente, no una operación sobre ventas en BBDD.
  const isDataOperation = dataAction && hasDataDomain && !hasExplicitTechnicalBackend && (hasStrongDataDomain || !hasDevDomain);
  const isDevOperation = !isDataOperation && (hasDevDomain || isBugFix || isFullBuild || (devAction && !actions.includes("query")));
  const isDirectEdit = !isDataOperation && !isFullBuild && actions.some((a) => ["add", "modify", "delete"].includes(a)) && (hasDevDomain || colloquialMatches.length > 0 || normalized.split(/\s+/).length <= 28);

  const confidence = Math.min(
    0.99,
    0.45 + actions.length * 0.12 + domains.length * 0.08 + (isDataOperation || isDevOperation || isResearch ? 0.15 : 0),
  );

  return {
    original: text,
    normalized,
    actions: unique(actions),
    domains: unique(domains),
    matchedTerms,
    isDataOperation,
    isDevOperation,
    isResearch,
    isBugFix,
    isFullBuild,
    isDirectEdit,
    confidence,
  };
}

export function hasSpanishAction(analysis: SpanishLexiconAnalysis, actions: SpanishAction[]): boolean {
  return analysis.actions.some((action) => actions.includes(action));
}

export function hasSpanishDomain(analysis: SpanishLexiconAnalysis, domains: SpanishDomain[]): boolean {
  return analysis.domains.some((domain) => domains.includes(domain));
}

export function firstMatchedTerm(analysis: SpanishLexiconAnalysis, prefixes: string[]): string | undefined {
  for (const [key, values] of Object.entries(analysis.matchedTerms)) {
    if (prefixes.some((prefix) => key.startsWith(prefix)) && values.length > 0) return values[0];
  }
  return undefined;
}

export const SPANISH_LEXICON_PROMPT_SUMMARY = [
  "Semántica española literal: añadir/agregar/poner/incluir = añadir solo lo pedido; modificar/cambiar/editar/actualizar = modificar el objetivo existente; eliminar/borrar/quitar/suprimir = eliminar solo lo pedido.",
  "Operaciones sobre CRM, usuarios, leads, registros, credenciales o base de datos pertenecen a ENGINE_EXEC y no deben regenerar frontend.",
  "Cambios sobre botones, páginas, componentes, estilos, frontend, backend, APIs, deploy o preview pertenecen a ENGINE_DEV.",
  "Peticiones coloquiales como 'ponme', 'hazme', 'quita eso', 'arreglame esto' deben resolverse por intención, no por una palabra aislada.",
].join("\n");
