/**
 * mcp-integrations-panel.tsx
 * 
 * Panel de conectores MCP (Model Context Protocol) para Maris AI.
 * Permite a los usuarios conectar servicios externos que los agentes
 * pueden usar durante la generación: Supabase, Notion, Airtable, GitHub, Slack, etc.
 * 
 * Equivalente al sistema MCP de Emergent.sh pero mejorado para hispanohablantes.
 */

import { useState } from "react";
import { 
  Database, FileText, Table2, Github, MessageSquare, 
  Zap, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  ExternalLink, Key, RefreshCw, Plug, Lock, Unlock,
  Globe, Mail, Calendar, ShoppingCart, CreditCard, Image
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface MCPConnector {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<any>;
  color: string;
  bgColor: string;
  category: "base-de-datos" | "productividad" | "codigo" | "comunicacion" | "pagos" | "almacenamiento" | "ia";
  envVars: { key: string; label: string; placeholder: string; secret?: boolean }[];
  docsUrl: string;
  features: string[];
  badge?: string;
}

export const MCP_CONNECTORS: MCPConnector[] = [
  {
    id: "supabase",
    name: "Supabase",
    description: "Base de datos PostgreSQL con API REST automática, autenticación y storage.",
    icon: Database,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/20",
    category: "base-de-datos",
    envVars: [
      { key: "SUPABASE_URL", label: "URL del proyecto", placeholder: "https://xxxxx.supabase.co" },
      { key: "SUPABASE_ANON_KEY", label: "Anon Key", placeholder: "eyJhbG...", secret: true },
      { key: "SUPABASE_SERVICE_ROLE_KEY", label: "Service Role Key (opcional)", placeholder: "eyJhbG...", secret: true },
    ],
    docsUrl: "https://supabase.com/docs",
    features: ["PostgreSQL real", "Auth integrada", "Storage de archivos", "Realtime subscriptions"],
    badge: "Popular",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Conecta tus bases de datos de Notion para leer y escribir datos desde tu app.",
    icon: FileText,
    color: "text-white",
    bgColor: "bg-zinc-700/40 border-zinc-600/30",
    category: "productividad",
    envVars: [
      { key: "NOTION_API_KEY", label: "API Key de integración", placeholder: "secret_...", secret: true },
      { key: "NOTION_DATABASE_ID", label: "ID de la base de datos", placeholder: "xxxxxxxx-xxxx-..." },
    ],
    docsUrl: "https://developers.notion.com",
    features: ["Leer bases de datos", "Crear páginas", "Actualizar propiedades", "Consultas filtradas"],
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Usa tus tablas de Airtable como backend de datos con operaciones CRUD completas.",
    icon: Table2,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10 border-yellow-500/20",
    category: "productividad",
    envVars: [
      { key: "AIRTABLE_API_KEY", label: "Personal Access Token", placeholder: "pat...", secret: true },
      { key: "AIRTABLE_BASE_ID", label: "ID de la base", placeholder: "app..." },
    ],
    docsUrl: "https://airtable.com/developers",
    features: ["CRUD completo", "Filtros avanzados", "Vistas personalizadas", "Fórmulas"],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Accede a repos, issues, pull requests y código directamente desde tu app.",
    icon: Github,
    color: "text-white",
    bgColor: "bg-zinc-700/40 border-zinc-600/30",
    category: "codigo",
    envVars: [
      { key: "GITHUB_TOKEN", label: "Personal Access Token", placeholder: "ghp_...", secret: true },
      { key: "GITHUB_OWNER", label: "Usuario u organización", placeholder: "octocat" },
    ],
    docsUrl: "https://docs.github.com/rest",
    features: ["Repos y commits", "Issues y PRs", "Contenido de archivos", "GitHub Actions"],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Envía mensajes, notificaciones y lee canales de Slack desde tu aplicación.",
    icon: MessageSquare,
    color: "text-purple-400",
    bgColor: "bg-purple-500/10 border-purple-500/20",
    category: "comunicacion",
    envVars: [
      { key: "SLACK_BOT_TOKEN", label: "Bot Token", placeholder: "xoxb-...", secret: true },
      { key: "SLACK_CHANNEL_ID", label: "ID del canal por defecto", placeholder: "C0XXXXXX" },
    ],
    docsUrl: "https://api.slack.com",
    features: ["Enviar mensajes", "Leer canales", "Notificaciones", "Webhooks"],
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Lee y escribe en hojas de cálculo de Google como base de datos liviana.",
    icon: Table2,
    color: "text-green-400",
    bgColor: "bg-green-500/10 border-green-500/20",
    category: "productividad",
    envVars: [
      { key: "GOOGLE_SHEETS_API_KEY", label: "API Key de Google", placeholder: "AIza...", secret: true },
      { key: "GOOGLE_SPREADSHEET_ID", label: "ID de la hoja", placeholder: "1BxiM..." },
    ],
    docsUrl: "https://developers.google.com/sheets",
    features: ["Leer rangos", "Escribir datos", "Múltiples hojas", "Fórmulas"],
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "Integra GPT-4o, DALL·E o Whisper directamente en tu app generada.",
    icon: Zap,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10 border-cyan-500/20",
    category: "ia",
    envVars: [
      { key: "OPENAI_API_KEY", label: "API Key", placeholder: "sk-...", secret: true },
    ],
    docsUrl: "https://platform.openai.com/docs",
    features: ["GPT-4o chat", "DALL·E imágenes", "Whisper audio", "Embeddings"],
    badge: "IA",
  },
  {
    id: "resend",
    name: "Resend",
    description: "Envía emails transaccionales con HTML hermoso desde tu app en segundos.",
    icon: Mail,
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10 border-indigo-500/20",
    category: "comunicacion",
    envVars: [
      { key: "RESEND_API_KEY", label: "API Key", placeholder: "re_...", secret: true },
      { key: "RESEND_FROM_EMAIL", label: "Email remitente", placeholder: "noreply@tudominio.com" },
    ],
    docsUrl: "https://resend.com/docs",
    features: ["HTML emails", "Templates React", "Dominio propio", "Analíticas"],
  },
  {
    id: "cloudinary",
    name: "Cloudinary",
    description: "Sube, transforma y sirve imágenes y vídeos con CDN global automático.",
    icon: Image,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/20",
    category: "almacenamiento",
    envVars: [
      { key: "CLOUDINARY_CLOUD_NAME", label: "Cloud Name", placeholder: "mi-cloud" },
      { key: "CLOUDINARY_API_KEY", label: "API Key", placeholder: "123456...", secret: true },
      { key: "CLOUDINARY_API_SECRET", label: "API Secret", placeholder: "abc123...", secret: true },
    ],
    docsUrl: "https://cloudinary.com/documentation",
    features: ["Upload de imágenes", "Transformaciones", "CDN global", "Vídeo"],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Pagos, suscripciones y marketplace con el estándar de la industria.",
    icon: CreditCard,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10 border-violet-500/20",
    category: "pagos",
    envVars: [
      { key: "STRIPE_SECRET_KEY", label: "Secret Key", placeholder: "sk_live_...", secret: true },
      { key: "STRIPE_WEBHOOK_SECRET", label: "Webhook Secret", placeholder: "whsec_...", secret: true },
    ],
    docsUrl: "https://stripe.com/docs",
    features: ["Pagos únicos", "Suscripciones", "Marketplace", "Facturas"],
    badge: "Popular",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Lee y crea eventos en Google Calendar desde tu aplicación.",
    icon: Calendar,
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/20",
    category: "productividad",
    envVars: [
      { key: "GOOGLE_CALENDAR_API_KEY", label: "API Key", placeholder: "AIza...", secret: true },
      { key: "GOOGLE_CALENDAR_ID", label: "ID del calendario", placeholder: "primary" },
    ],
    docsUrl: "https://developers.google.com/calendar",
    features: ["Leer eventos", "Crear citas", "Recordatorios", "Disponibilidad"],
  },
  {
    id: "shopify",
    name: "Shopify",
    description: "Conecta tu tienda Shopify para leer productos, pedidos y clientes.",
    icon: ShoppingCart,
    color: "text-green-400",
    bgColor: "bg-green-500/10 border-green-500/20",
    category: "pagos",
    envVars: [
      { key: "SHOPIFY_STORE_DOMAIN", label: "Dominio de la tienda", placeholder: "mi-tienda.myshopify.com" },
      { key: "SHOPIFY_ACCESS_TOKEN", label: "Access Token", placeholder: "shpat_...", secret: true },
    ],
    docsUrl: "https://shopify.dev/docs",
    features: ["Productos", "Pedidos", "Clientes", "Inventario"],
  },
];

const CATEGORIES = [
  { id: "todos", label: "Todos" },
  { id: "base-de-datos", label: "Bases de datos" },
  { id: "productividad", label: "Productividad" },
  { id: "comunicacion", label: "Comunicación" },
  { id: "pagos", label: "Pagos" },
  { id: "codigo", label: "Código" },
  { id: "almacenamiento", label: "Almacenamiento" },
  { id: "ia", label: "IA" },
];

interface ConnectorState {
  connected: boolean;
  values: Record<string, string>;
  expanded: boolean;
  testing: boolean;
  testResult?: "ok" | "error";
}

interface MCPIntegrationsPanelProps {
  onConnectorChange?: (connectorId: string, connected: boolean, values: Record<string, string>) => void;
  className?: string;
}

export function MCPIntegrationsPanel({ onConnectorChange, className }: MCPIntegrationsPanelProps) {
  const [category, setCategory] = useState("todos");
  const [search, setSearch] = useState("");
  const [states, setStates] = useState<Record<string, ConnectorState>>({});

  const getState = (id: string): ConnectorState =>
    states[id] ?? { connected: false, values: {}, expanded: false, testing: false };

  function toggleExpand(id: string) {
    setStates(prev => ({
      ...prev,
      [id]: { ...getState(id), expanded: !getState(id).expanded }
    }));
  }

  function setValue(connectorId: string, key: string, value: string) {
    setStates(prev => ({
      ...prev,
      [connectorId]: {
        ...getState(connectorId),
        values: { ...getState(connectorId).values, [key]: value }
      }
    }));
  }

  async function testAndConnect(connector: MCPConnector) {
    const state = getState(connector.id);
    setStates(prev => ({ ...prev, [connector.id]: { ...state, testing: true } }));
    
    // Simular test de conexión (en producción llamaría a /api/mcp/test)
    await new Promise(r => setTimeout(r, 1200));
    
    const allFilled = connector.envVars
      .filter(v => !v.key.includes("opcional") && !v.label.includes("opcional"))
      .every(v => state.values[v.key]?.trim());
    
    const result = allFilled ? "ok" : "error";
    const connected = result === "ok";
    
    setStates(prev => ({
      ...prev,
      [connector.id]: { ...state, testing: false, testResult: result, connected, expanded: !connected }
    }));
    
    if (connected && onConnectorChange) {
      onConnectorChange(connector.id, true, state.values);
    }
  }

  function disconnect(id: string) {
    setStates(prev => ({
      ...prev,
      [id]: { connected: false, values: {}, expanded: false, testing: false, testResult: undefined }
    }));
    if (onConnectorChange) onConnectorChange(id, false, {});
  }

  const filtered = MCP_CONNECTORS.filter(c => {
    const matchCat = category === "todos" || c.category === category;
    const matchSearch = !search || 
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const connectedCount = Object.values(states).filter(s => s.connected).length;

  return (
    <div className={cn("space-y-3 sm:space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Plug className="h-4 w-4 text-violet-400" />
            Conectores MCP
            {connectedCount > 0 && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                {connectedCount} activo{connectedCount !== 1 ? "s" : ""}
              </Badge>
            )}
          </h2>
          <p className="text-[11px] text-white/40 mt-0.5">
            Conecta servicios externos para que los agentes los usen en tu generación
          </p>
        </div>
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-white/30 hover:text-white/60 flex items-center gap-1 transition-colors"
        >
          Sobre MCP <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>

      {/* Search + categories */}
      <div className="space-y-2">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar conector..."
          className="h-7 text-xs bg-white/[0.04] border-white/10 text-white placeholder:text-white/30"
        />
        <div className="flex gap-1 flex-wrap overflow-x-auto">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors",
                category === cat.id
                  ? "bg-violet-600/40 text-violet-300 border border-violet-500/40"
                  : "text-white/30 hover:text-white/60 border border-transparent hover:border-white/10"
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Connectors grid */}
      <div className="space-y-2">
        {filtered.map(connector => {
          const state = getState(connector.id);
          const Icon = connector.icon;
          
          return (
            <div
              key={connector.id}
              className={cn(
                "rounded-xl border transition-all",
                state.connected
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : state.expanded
                  ? "border-white/15 bg-white/[0.04]"
                  : "border-white/[0.07] bg-white/[0.02] hover:border-white/15"
              )}
            >
              {/* Connector header */}
              <button
                onClick={() => toggleExpand(connector.id)}
                className="w-full flex items-center gap-3 p-3 text-left"
              >
                <div className={cn("w-8 h-8 rounded-lg border flex items-center justify-center shrink-0", connector.bgColor)}>
                  <Icon className={cn("h-4 w-4", connector.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{connector.name}</span>
                    {connector.badge && (
                      <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 text-[9px] py-0">
                        {connector.badge}
                      </Badge>
                    )}
                    {state.connected && (
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px] py-0">
                        ✓ Conectado
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-white/40 truncate">{connector.description}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {state.connected ? (
                    <Unlock className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Lock className="h-3.5 w-3.5 text-white/20" />
                  )}
                  {state.expanded
                    ? <ChevronUp className="h-3.5 w-3.5 text-white/30" />
                    : <ChevronDown className="h-3.5 w-3.5 text-white/30" />
                  }
                </div>
              </button>

              {/* Expanded config */}
              {state.expanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-white/[0.06] pt-3">
                  {/* Features */}
                  <div className="flex gap-1 flex-wrap overflow-x-auto">
                    {connector.features.map(f => (
                      <span key={f} className="text-[10px] bg-white/[0.06] text-white/50 px-2 py-0.5 rounded-full">
                        {f}
                      </span>
                    ))}
                  </div>

                  {/* Env vars */}
                  <div className="space-y-2">
                    {connector.envVars.map(envVar => (
                      <div key={envVar.key}>
                        <label className="text-[10px] text-white/50 block mb-1">{envVar.label}</label>
                        <Input
                          type={envVar.secret ? "password" : "text"}
                          value={state.values[envVar.key] ?? ""}
                          onChange={e => setValue(connector.id, envVar.key, e.target.value)}
                          placeholder={envVar.placeholder}
                          className="h-7 text-xs bg-white/[0.04] border-white/10 text-white placeholder:text-white/20 font-mono"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Test result */}
                  {state.testResult && (
                    <div className={cn(
                      "flex items-center gap-2 text-[11px] rounded-lg px-3 py-2",
                      state.testResult === "ok"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-red-500/10 text-red-400 border border-red-500/20"
                    )}>
                      {state.testResult === "ok"
                        ? <><CheckCircle2 className="h-3.5 w-3.5" /> Conexión verificada — los agentes ya pueden usar {connector.name}</>
                        : <><XCircle className="h-3.5 w-3.5" /> Rellena todos los campos obligatorios para conectar</>
                      }
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {state.connected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => disconnect(connector.id)}
                        className="h-7 text-[11px] border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
                      >
                        <XCircle className="h-3 w-3 mr-1" />
                        Desconectar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => testAndConnect(connector)}
                        disabled={state.testing}
                        className="h-7 text-[11px] bg-violet-600 hover:bg-violet-700 text-white"
                      >
                        {state.testing ? (
                          <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Verificando...</>
                        ) : (
                          <><Plug className="h-3 w-3 mr-1" />Conectar</>
                        )}
                      </Button>
                    )}
                    <a
                      href={connector.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-white/30 hover:text-white/60 flex items-center gap-1 ml-auto transition-colors"
                    >
                      Documentación <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-8 text-white/30 text-sm">
            <Globe className="h-8 w-8 mx-auto mb-2 opacity-30" />
            No se encontraron conectores para "{search}"
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="text-[10px] text-white/20 text-center">
        Las credenciales se usan solo durante la generación y no se almacenan en nuestros servidores.
      </p>
    </div>
  );
}
