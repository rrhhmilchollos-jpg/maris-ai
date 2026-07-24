import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  apiFetch,
  useGetMyStats,
  useListApps,
  useGenerateApp,
  useGetMe,
  useGetGenerationJob,
  useGetMyPreferences,
  useUpdateMyPreferences,
  useListTemplates,
  useCreateCheckoutSession,
  getGetGenerationJobQueryKey,
  getGetMyStatsQueryKey,
  getListAppsQueryKey,
  getGetMeQueryKey,
  getGetMyPreferencesQueryKey,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { AgentNotesPanel } from "@/components/agent-notes-panel";
import { MediaAIGenerator } from "@/components/media-ai-generator";
import { SupportPanel } from "@/components/support-panel";
import { AdminTicketsPanel } from "@/components/admin-tickets-panel";
import { GenerationStudio } from "@/components/generation-studio";
import { PreGenerationChat } from "@/components/pre-generation-chat";
import {
  AttachmentPicker,
  AttachmentChips,
  type UploadedAttachment,
} from "@/components/attachment-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { 
  Sparkles, Code2, Plus, ArrowRight, Loader2, Cpu, Search, Wand2, 
  FileCheck2, Compass, Palette, ShieldCheck, Plug, Wrench, Bug, 
  Layers, Smartphone, Rocket, Gamepad2, Box, Globe, X, LayoutDashboard, Copy,
  ShoppingBag, Notebook, Joystick, Cat, Zap, Atom, Component, Flame, 
  Server, ListTodo, CloudSun, Newspaper, MessagesSquare, ImagePlay, 
  FileText, Brain, Mic, Webhook, Library, type LucideIcon, UserCircle, 
  Settings2, ShieldAlert, TestTube2, HardDrive, FolderUp, CheckCircle2,
  Bell, BellRing, ExternalLink, RefreshCw, ChevronUp, ChevronDown, Lock, AlertTriangle, Eye,
  PhoneCall, Video, TrendingUp, GraduationCap
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Rocket, ShoppingBag, Smartphone, Gamepad2, Notebook, Layers, Globe, Box, Joystick, Cat, Zap, Atom, ListTodo, CloudSun, Newspaper, MessagesSquare, ImagePlay, FileText, Brain, Mic, Webhook, Library,
};

const AGENTS = [
  { name: "Researcher", icon: Search, color: "text-blue-400" },
  { name: "Architect", icon: Compass, color: "text-purple-400" },
  { name: "Designer", icon: Palette, color: "text-pink-400" },
  { name: "Frontend", icon: Code2, color: "text-cyan-400" },
  { name: "Backend", icon: Server, color: "text-orange-400" },
  { name: "Database", icon: HardDrive, color: "text-emerald-400" },
  { name: "Integrator", icon: Plug, color: "text-yellow-400" },
  { name: "QA Auditor", icon: ShieldCheck, color: "text-red-400" },
  { name: "testing-agent", icon: Bug, color: "text-sky-400" },
];

const PHASE_LABELS: Record<string, { label: string; icon: typeof Loader2 }> = {
  queued:       { label: "En cola…",                                          icon: Loader2 },
  starting:     { label: "Iniciando equipo de 11 agentes…",                    icon: Loader2 },
  researching:  { label: "🔎 Researcher investigando referencias…",            icon: Search },
  architecting: { label: "🧠 Architect diseñando la arquitectura…",            icon: Compass },
  designing:    { label: "🎨 Designer definiendo el sistema visual…",          icon: Palette },
  schema:       { label: "🗄️ Database diseñando los modelos de datos…",        icon: FileCheck2 },
  frontend:     { label: "⚡ Frontend Engineer escribiendo el código…",        icon: Code2 },
  backend:      { label: "🖥️ Backend Engineer creando la API…",                icon: Server },
  integrations: { label: "🔌 API Integrator conectando servicios externos…",    icon: Plug },
  testing:      { label: "🧪 testing-agent analizando el bundle…",                 icon: Bug },
  patching:     { label: "🔧 testing-agent reparando errores…",                  icon: Wrench },
  validating:   { label: "🔍 testing-agent validando el código…",                  icon: Bug },
  fixing:       { label: "🛠️ testing-agent aplicando correcciones…",               icon: Wrench },
  parsing:      { label: "📦 Empaquetando archivos del proyecto…",             icon: FileCheck2 },
  ready:        { label: "¡Tu app está lista!",                                icon: FileCheck2 },
  failed:       { label: "La generación falló",                                icon: Loader2 },
};

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Notificaciones de soporte: movidas a la campanita del layout
  // compartido (components/layout.tsx, NotificationsBell) a petición
  // explícita del usuario. Se elimina también este fetch/efecto de aquí
  // -- mantenerlo hubiera duplicado la misma petición cada 5s dos veces
  // a la vez (una desde aquí, otra desde la campanita) mientras el
  // cliente está en el dashboard.
  // ENCONTRADO A PETICIÓN DEL USUARIO (investigación del 70% de abandono
  // entre form_start y generate_app): landing.tsx GUARDA la idea escrita
  // antes de redirigir a /sign-up (localStorage.appforge_pending_prompt),
  // pero NINGÚN sitio del código la leía después -- confirmado con grep
  // en todo el proyecto. Un visitante que SÍ completaba el registro
  // perdía igualmente su idea original y tenía que volver a escribirla
  // desde cero en el panel -- el flujo se quedó a medias, guardando pero
  // nunca recuperando. Se completa aquí: al cargar el panel, si existe
  // una idea pendiente, se usa como valor inicial y se borra de
  // localStorage (uso único, no debe reaparecer en visitas futuras).
  const [prompt, setPrompt] = useState(() => {
    try {
      const pending = localStorage.getItem("appforge_pending_prompt");
      if (pending) {
        localStorage.removeItem("appforge_pending_prompt");
        return pending;
      }
    } catch { /* localStorage no disponible -- no bloquea nada */ }
    return "";
  });
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [coderModel, setCoderModel] = useState<string>("auto");
  const [ultraThinking, setUltraThinking] = useState<boolean>(false);
  // Teaser comercial del botón Ultra: se abre al pasar el ratón por encima
  // (escritorio) o al tocar (móvil) SOLO para quien no tiene Ultra
  // desbloqueado — a petición explícita del usuario, para "engancharlos a
  // que quieran comprar". Quien ya puede usar Ultra no ve este teaser, el
  // botón le funciona directamente.
  const [showUltraTeaser, setShowUltraTeaser] = useState(false);
  const [legacyMode, setLegacyMode] = useState<boolean>(false);
  const [language, setLanguage] = useState<"typescript" | "javascript">("typescript");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [showNoCredits, setShowNoCredits] = useState(false);
  const [appsFilter, setAppsFilter] = useState<"all" | "deployed">("all");
  const [appSearchQuery, setAppSearchQuery] = useState("");
  const [mcpConnectors, setMcpConnectors] = useState<Record<string, { connected: boolean; values: Record<string, string> }>>({});
  type Kind = "fullstack" | "mobile" | "landing" | "game-2d" | "game-3d" | "hybrid-pwa" | "vue" | "svelte" | "nextjs" | "python-api" | "django" | "video-ai" | "imagen-ai";
  const [kind, setKind] = useState<Kind>("fullstack");
  // ENCONTRADO A PETICIÓN DEL USUARIO (auditoría de onboarding): el paso 3
  // del onboarding guardaba el tipo de app elegido (preferredAppType) vía
  // PUT /me/preferences, pero ese endpoint solo aceptaba "notes" -- la
  // preferencia nunca llegaba a guardarse de verdad (arreglado en el
  // propio endpoint), y aunque se hubiera guardado, el dashboard nunca la
  // leía al llegar -- el usuario elegía su tipo de app en el onboarding
  // para nada, siempre aterrizaba con "fullstack" por defecto. Se lee
  // aquí una sola vez al montar el componente, solo se aplica si el
  // usuario no ha tocado el selector todavía (kindTouchedRef), para no
  // pisar una elección manual si esto tardara en llegar.
  const kindTouchedRef = useRef(false);
  useEffect(() => {
    apiFetch<{ preferredAppType?: string | null }>("/api/me/preferences")
      .then((prefs) => {
        if (kindTouchedRef.current || !prefs?.preferredAppType) return;
        const ONBOARDING_TO_KIND: Record<string, Kind> = {
          web: "fullstack",
          landing: "landing",
          ecommerce: "fullstack",
          api: "python-api",
          mobile: "mobile",
          ui: "fullstack",
        };
        const mapped = ONBOARDING_TO_KIND[prefs.preferredAppType];
        if (mapped) setKind(mapped);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Movido aquí arriba (antes vivía más abajo en el componente) porque
  // KIND_META, justo debajo, necesita stats.isPremium para calcular el
  // coste real en créditos — ver comentario en BASE_KIND_COSTS.
  const { data: stats, isLoading: statsLoading } = useGetMyStats();
  // ENCONTRADO: esta tabla mostraba números inventados/obsoletos (1-3
  // créditos) completamente desconectados del coste real que cobra el
  // backend (apps.ts): ese coste real es baseCost×13 en plan free (tope 50)
  // o baseCost×10 en plan de pago — para "fullstack" son 39cr (free) o 30cr
  // (paid), no los "2cr" que se mostraban aquí. El usuario veía un precio
  // y se le cobraba otro muy distinto. baseCost es EXACTAMENTE la misma
  // tabla que KIND_COSTS en apps.ts — cualquier cambio ahí debe reflejarse
  // aquí también.
  const BASE_KIND_COSTS: Record<string, number> = {
    fullstack: 3, landing: 1, vue: 2, svelte: 2, mobile: 2, nextjs: 3,
    "python-api": 3, django: 3, "hybrid-pwa": 3, "game-2d": 3, "game-3d": 5,
    // video-ai / imagen-ai no están en KIND_COSTS del backend (caen al
    // default `?? 3` de apps.ts) — se refleja aquí igual, explícito, para
    // que no haya sorpresas si el backend cambia su default.
    "video-ai": 3, "imagen-ai": 3,
  };
  const isPaidPlan = !!(stats as any)?.isPremium;
  // Distinto de isPaidPlan: isPaidPlan refleja el PLAN ACTUAL (puede ser
  // true para un admin sin ningún pago real). hasVerifiedPayment refleja
  // si el usuario ha completado alguna vez un pago de verdad (Stripe/Viva)
  // -- el campo correcto para gatear el modo Ultra (Zoco Plus/Zoco Max),
  // a petición explícita del usuario: "solo clientes de pago verificados
  // que ya hayan realizado pagos".
  const hasVerifiedPayment = !!(stats as any)?.hasEverPaid;
  const computeRealCost = (kindKey: string) => {
    const base = BASE_KIND_COSTS[kindKey] ?? 3;
    return isPaidPlan ? base * 10 : Math.min(base * 13, 50);
  };

const KIND_META: Record<Kind, { label: string; icon: typeof Layers; placeholder: string; cost: number }> = {
    fullstack: { 
        label: "Micro-SaaS con IA", 
        icon: Layers, 
        placeholder: "ej. Un CRM automatizado que analiza correos entrantes, califica leads y genera respuestas personalizadas de forma autónoma...", 
        cost: computeRealCost("fullstack") 
    },
    mobile: { 
        label: "App Móvil Nativa", 
        icon: Smartphone, 
        placeholder: "ej. Una app de entrenamiento personal que usa la cámara del móvil para corregir la postura en tiempo real mediante visión por ordenador...", 
        cost: computeRealCost("mobile") 
    },
    landing: { 
        label: "Agente de Voz / Telefonía", 
        icon: PhoneCall, 
        placeholder: "ej. Configuración de agente de voz IA integrado con Twilio para gestionar llamadas entrantes, agendar citas en Calendar y enviar confirmaciones...", 
        cost: computeRealCost("landing") 
    },
    "game-2d": { 
        label: "Agente de Automatización", 
        icon: Cpu, 
        placeholder: "ej. Un bot autónomo para WhatsApp y Telegram que atiende clientes, procesa pedidos, consulta stock y emite facturas automáticamente...", 
        cost: computeRealCost("game-2d") 
    },
    "game-3d": { 
        label: "Agente para RRSS", 
        icon: Video, 
        placeholder: "ej. Un sistema que monitoriza tendencias de nicho, redacta guiones para TikTok/Reels, clona tu voz y genera vídeos listos para publicar...", 
        cost: computeRealCost("game-3d") 
    },
    "hybrid-pwa": { 
        label: "App de Negocio Automatizada", 
        icon: Globe, 
        placeholder: "ej. Una PWA instalable para clínicas que gestiona historiales médicos, predice citas fallidas y envía recordatorios inteligentes por WhatsApp...", 
        cost: computeRealCost("hybrid-pwa") 
    },
    vue: { 
        label: "Asistente Legal / Auditor", 
        icon: FileText, 
        placeholder: "ej. Una app que audita contratos en PDF, detecta cláusulas de riesgo ocultas y redacta anexos de enmienda basados en la ley vigente...", 
        cost: computeRealCost("vue") 
    },
    svelte: { 
        label: "Analista de Datos Financieros", 
        icon: TrendingUp, 
        placeholder: "ej. Un dashboard avanzado de finanzas que escanea facturas corporativas, concilia movimientos bancarios y predice el flujo de caja del trimestre...", 
        cost: computeRealCost("svelte") 
    },
    nextjs: { 
        label: "Plataforma Educativa IA", 
        icon: GraduationCap, 
        placeholder: "ej. Un tutor interactivo con avatares de IA que simula entrevistas de trabajo reales, evalúa tus respuestas y te da feedback personalizado...", 
        cost: computeRealCost("nextjs") 
    },
    "python-api": { 
        label: "API de Agentes Multi-Modal", 
        icon: Webhook, 
        placeholder: "ej. Endpoints CRUD optimizados con FastAPI para conectar modelos de visión, transcripción de audio (Whisper) y procesamiento de texto en un solo flujo...", 
        cost: computeRealCost("python-api") 
    },
    django: { 
        label: "E-commerce Autónomo", 
        icon: ShoppingBag, 
        placeholder: "ej. Tienda online con un recomendador de productos hiper-personalizado basado en el comportamiento del usuario y chat interactivo de ventas...", 
        cost: computeRealCost("django") 
    },
    "video-ai": { label: "🎬 Vídeo con IA", icon: ImagePlay, placeholder: "ej. Un vídeo de 30 segundos mostrando un producto de lujo con escenas cinematográficas y transiciones suaves...", cost: 10 },
    "imagen-ai": { label: "🖼️ Imagen con IA", icon: ImagePlay, placeholder: "ej. Una imagen realista de un coche deportivo rojo en una montaña al atardecer con luz dorada...", cost: computeRealCost("imagen-ai") },
  };
  const kindMeta = KIND_META[kind] ?? KIND_META.fullstack;
  const kindCost = kindMeta.cost;
  const [annualOpen, setAnnualOpen] = useState(false);

  // ─── Pre-Generation Chat ────────────────────────────────────────────────────
  const [preGenChatOpen, setPreGenChatOpen] = useState(false);
  const [preGenChatGenerating, setPreGenChatGenerating] = useState(false);
  const [inlineHint, setInlineHint] = useState<string | null>(null);
  const [quickChatHistory, setQuickChatHistory] = useState<{role:"user"|"maris", text:string}[]>([]);
  const [quickChatReply, setQuickChatReply] = useState<string | null>(null);
  const [quickChatLoading, setQuickChatLoading] = useState(false);

  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingAnswers, setOnboardingAnswers] = useState<Record<number, string>>({}); 
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ title: string; filesImported: number } | null>(null);
  const [importErrorDetail, setImportErrorDetail] = useState<{ reason: string; buildLog?: string; installLog?: string } | null>(null);
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null);

  const [preferencesDialogOpen, setPreferencesDialogOpen] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const { data: preferencesData } = useGetMyPreferences({ query: { enabled: preferencesDialogOpen } });
  const updatePreferences = useUpdateMyPreferences();

  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    if (preferencesData?.notes !== undefined) {
      setCustomInstructions(preferencesData.notes ?? "");
    }
  }, [preferencesData]);

  const handleSavePreferences = async () => {
    try {
      await updatePreferences.mutateAsync({ data: { notes: customInstructions } });
      toast({ title: "Preferencias guardadas", description: "Se aplicarán a tus próximas generaciones." });
      setPreferencesDialogOpen(false);
    } catch (error: any) {
      toast({ title: "Error al guardar", description: error?.message || "No se pudieron guardar las preferencias.", variant: "destructive" });
    }
  };

  const getOnboardingQuestions = () => [
    {
      id: 0,
      question: "¿Qué tipo de aplicación es?",
      type: "checkbox" as const,
      options: [
        "Landing page / web informativa",
        "Plataforma SaaS / dashboard",
        "E-commerce / tienda online",
        "App móvil (PWA)",
        "Juego / experiencia interactiva",
        "API / backend",
        "Otra (especifica)",
      ],
    },
    {
      id: 1,
      question: "¿Tienes contexto previo del proyecto?",
      type: "textarea" as const,
      placeholder: "ej. Tengo una carpeta con el logo, paleta de colores y una descripción del negocio...",
    },
    {
      id: 2,
      question: "¿Qué funcionalidades quieres implementar en esta sesión?",
      type: "textarea" as const,
      placeholder: "ej. Home page, autenticación, área de clientes, formulario de contacto, pasarela de pago...",
    },
    {
      id: 3,
      question: "¿Necesita alguna integración externa?",
      type: "checkbox" as const,
      options: [
        "Pagos con Stripe",
        "IA con Zoco IA (motor local)",
        "Email con Resend / SendGrid",
        "Google Auth / OAuth",
        "Mapas (Google Maps / Mapbox)",
        "Analytics (GA4 / Mixpanel)",
        "Ninguna",
        "Otra (especifica)",
      ],
    },
    {
      id: 4,
      question: "¿Tienes preferencias de diseño?",
      type: "textarea" as const,
      placeholder: "ej. Estilo oscuro y minimalista, colores morado y negro, tipografía moderna tipo Inter...",
    },
  ];

  const onboardingQuestions = getOnboardingQuestions();
  const currentQuestion = onboardingQuestions[onboardingStep];

  const handleOnboardingAnswer = (value: string) => {
    setOnboardingAnswers(prev => ({ ...prev, [onboardingStep]: value }));
  };

  const handleOnboardingCheckbox = (option: string, checked: boolean) => {
    const current = onboardingAnswers[onboardingStep] || "";
    const parts = current ? current.split(", ").filter(Boolean) : [];
    if (checked) {
      parts.push(option);
    } else {
      const idx = parts.indexOf(option);
      if (idx > -1) parts.splice(idx, 1);
    }
    setOnboardingAnswers(prev => ({ ...prev, [onboardingStep]: parts.join(", ") }));
  };

  const handleOnboardingNext = () => {
    if (onboardingStep < onboardingQuestions.length - 1) {
      setOnboardingStep(prev => prev + 1);
    } else {
      const enrichedContext = onboardingQuestions
        .map((q, i) => {
          const answer = onboardingAnswers[i];
          if (!answer || answer.trim() === "") return null;
          return `[${q.question}]\n${answer}`;
        })
        .filter(Boolean)
        .join("\n\n");

      const finalPrompt = enrichedContext
        ? `${prompt}\n\n--- Contexto adicional del proyecto ---\n${enrichedContext}`
        : prompt;

      setOnboardingOpen(false);
      localStorage.setItem("appforge_last_prompt", finalPrompt);
      generateMutation.mutate({ data: { prompt: finalPrompt, model: coderModel, language, kind, ultraThinking, legacyMode, mcpConnectors, attachments: attachments.map((a: any) => a.id) } });
    }
  };

  const handleOnboardingSkip = () => {
    setOnboardingOpen(false);
    localStorage.setItem("appforge_last_prompt", prompt);
    generateMutation.mutate({ data: { prompt, model: coderModel, language, kind, ultraThinking, legacyMode, mcpConnectors, attachments: attachments.map((a: any) => a.id) } });
  };

  const openOnboarding = () => {
    generateMutation.reset();
    setPreGenChatOpen(true);
  };

  const handlePreGenConfirm = (enrichedPrompt: string) => {
    setPreGenChatGenerating(true);
    localStorage.setItem("appforge_last_prompt", enrichedPrompt);
    generateMutation.mutate(
      { data: { prompt: enrichedPrompt, model: coderModel, language, kind, attachments: attachments.map((a: any) => a.id) } },
      {
        onSettled: () => {
          setPreGenChatGenerating(false);
          setPreGenChatOpen(false);
        },
      }
    );
  };

  const { data: me } = useGetMe();
  useEffect(() => {
    if (me?.isPremium && coderModel === "auto") setCoderModel("auto");
  }, [me?.isPremium, coderModel]);

  const { data: apps, isLoading: appsLoading } = useListApps({
    query: {
      refetchInterval: (query: any) => {
        const list = query?.state?.data as any[] | undefined;
        return list?.some((a) => a.importStatus === "processing") ? 5000 : false;
      },
    },
  });
  const isAdmin = !!me?.isAdmin;

  useEffect(() => {
    if (!isAdmin && stats && stats.credits <= 0) {
      setShowNoCredits(true);
    } else if (stats && stats.credits > 0) {
      setShowNoCredits(false);
    }
  }, [stats?.credits, isAdmin]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteApp = async (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!confirm(`¿Eliminar permanentemente "${title}"? Esta acción no se puede deshacer.`)) return;
    setDeletingId(id);
    try {
      await apiFetch<void>(`/api/apps/${id}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
      toast({ title: "App eliminada", description: `"${title}" ha sido borrada permanentemente.` });
    } catch (error: any) {
      toast({ title: "Error al eliminar", description: error?.message || "No se pudo eliminar la aplicación.", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const [forkingId, setForkingId] = useState<string | null>(null);

  const handleForkApp = async (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    e.preventDefault();
    setForkingId(id);
    try {
      const result = await apiFetch<{ ok: boolean; id: string; title: string }>(`/api/apps/${id}/fork`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
      toast({ title: "Proyecto duplicado", description: `Se creó una copia: "${result.title}".` });
    } catch (error: any) {
      toast({ title: "Error al duplicar", description: error?.message || "No se pudo duplicar la aplicación.", variant: "destructive" });
    } finally {
      setForkingId(null);
    }
  };

  const handleImportProject = async () => {
    if (!importFile) return;
    setImportLoading(true);
    setImportResult(null);
    setImportErrorDetail(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const initial = await apiFetch<any>("/api/import-app", { method: "POST", body: formData });
      const importId = initial.id;
      setImportStatusMessage(initial.message || "Importando...");
      queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });

      const POLL_INTERVAL_MS = 4000;
      const MAX_WAIT_MS = 15 * 60_000; 
      const deadline = Date.now() + MAX_WAIT_MS;

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const status = await apiFetch<any>(`/api/import-app/${importId}/status`);
        if (status.importStatus === "ready") {
          setImportResult({ title: status.title, filesImported: 0 });
          queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
          toast({ title: `✅ "${status.title}" importado`, description: "El proyecto se importó correctamente." });
          setTimeout(() => { setImportDialogOpen(false); setImportFile(null); setImportResult(null); }, 2000);
          return;
        }
        if (status.importStatus === "failed") {
          toast({ title: "Error al importar", description: status.importError, variant: "destructive" });
          if (status.buildLog || status.installLog) {
            setImportErrorDetail({ reason: status.importError, buildLog: status.buildLog, installLog: status.installLog });
          }
          return;
        }
        setImportStatusMessage("Importando... esto puede tardar varios minutos si el proyecto necesita compilarse.");
      }
      toast({ title: "Sigue en proceso", description: "La importación está tardando más de lo esperado. Puedes cerrar esta ventana — se avisará cuando termine.", variant: "destructive" });
    } catch (err: any) {
      toast({ title: "Error al importar", description: err.message, variant: "destructive" });
      if (err?.data?.buildLog || err?.data?.installLog) {
        setImportErrorDetail({
          reason: err.message,
          buildLog: err.data.buildLog,
          installLog: err.data.installLog,
        });
      }
    } finally {
      setImportLoading(false);
    }
  };

  const visibleApps = (apps ?? [])
    .filter((a) => appsFilter === "deployed" ? !!a.publicSlug : true)
    .filter((a) => appSearchQuery.trim() ? a.title?.toLowerCase().includes(appSearchQuery.trim().toLowerCase()) : true);

  const { data: job } = useGetGenerationJob(activeJobId ?? "", {
    query: {
      queryKey: getGetGenerationJobQueryKey(activeJobId ?? ""),
      enabled: activeJobId !== null,
      refetchInterval: (query) => {
        const data = query.state.data as { status?: string } | undefined;
        if (!data) return 800;
        if (data.status === "succeeded" || data.status === "failed") return false;
        return 800;
      },
    },
  });

  const generateMutation = useGenerateApp({
    mutation: {
      onSuccess: (data) => {
        if (data?.conversationOnly) {
          toast({ title: "Maris AI", description: data.reply || data.message || "Mensaje recibido." });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          return;
        }
        if (data?.id) {
          setActiveJobId(data.id);
          return;
        }
        toast({ title: "Respuesta inesperada", description: "No se ha iniciado ningún trabajo de generación.", variant: "destructive" });
      },
      onError: (error: any) => {
        toast({ title: "No pudimos encolar la generación", description: error?.message || error?.error || "Inténtalo otra vez.", variant: "destructive" });
      },
    },
  });

  useEffect(() => {
    if (!job) return;
    if (job.status === "succeeded" && job.appId) {
      queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      const appId = job.appId;
      setActiveJobId(null);
      setPrompt("");
      attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
      setAttachments([]);
      toast({ title: "¡App generada!", description: "Tu aplicación está lista para verla." });
      import("@/lib/analytics").then(({ trackAppSucceeded }) => { trackAppSucceeded(kind, 0); });
      setLocation(`/app/${appId}`);
    } else if (job.status === "failed") {
      toast({ title: "Falló la generación", description: job.errorMessage || "Inténtalo otra vez.", variant: "destructive" });
      setActiveJobId(null);
    }
  }, [job, queryClient, setLocation, toast, activeJobId, attachments, kind]);

  const looksLikeBuildIntent = (text: string): boolean => {
    if (attachments.length > 0) return true;
    const hasUrl = /https?:\/\/|www\.|[a-zA-Z0-9-]+\.(com|es|io|app|net|org|co)([\/\s]|$)/.test(text);
    if (hasUrl) return true;
    if (text.trim().length > 100) return true;
    const t = text.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const buildWords = [
      "crea", "crear", "genera", "generar", "haz ", "hazme", "hacer",
      "construye", "construir", "desarrolla", "desarrollar", "diseña", "disenar",
      "quiero una", "necesito una", "quiero un", "necesito un",
      "quiero que hagas", "quiero que crees", "quiero que generes",
      "ayudame a crear", "ayudame a hacer", "ayudas a crear", "ayudas a hacer",
      "me puedes crear", "me puedes hacer", "me puedes generar",
      "puedes crear", "puedes hacer", "puedes generar", "puedes construir",
      "algo como", "similar a", "igual que", "al estilo", "tipo ",
      "inspirado en", "copia de", "version de", "versión de",
      " app", "aplicacion", "aplicación", " web", "pagina", "página",
      "landing", "tienda", "ecommerce", "marketplace", "dashboard",
      "crm", "saas", "plataforma", "sistema", "juego", "game",
      "portal", "blog", "agenda", "calendario", "chatbot", "bot ",
      "ia telefonica", "asistente", "herramienta", "calculadora",
      "generador", "gestor", "gestion",
    ];
    if (buildWords.some(w => t.includes(w))) return true;
    if (t.length > 30 && quickChatHistory.length === 0) return true;
    const chatOnly = [
      "cuanto cuesta", "cuánto cuesta", "precio", "cuantos creditos",
      "como funciona maris", "que es maris",
      "no quiero", "cancelar", "olvidalo", "no crear", "no generar",
      "solo quiero preguntar",
    ];
    if (chatOnly.some(s => t.includes(s))) return false;
    if (t.length < 15) return false;
    return true;
  };

  const isSubmittingRef = useRef(false);
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setTimeout(() => { isSubmittingRef.current = false; }, 5000);
    const isLongPrompt = prompt.trim().length > 100;
    if (!isLongPrompt && !looksLikeBuildIntent(prompt)) {
      const userMsg = prompt.trim();
      setPrompt("");
      setQuickChatLoading(true);
      const newHistory = [...quickChatHistory, { role: "user" as const, text: userMsg }];
      setQuickChatHistory(newHistory);
      const appContext = (apps ?? []).slice(0, 5).map((a: any) => `"${a.title}" — ${a.description?.slice(0, 60) || "sin descripción"}`).join("; ");
      try {
        const data = await apiFetch<any>("/api/apps/quick-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: userMsg, history: quickChatHistory.slice(-6), appContext: appContext || null }),
        });
        const reply = data.reply || "Cuéntame más, ¿en qué puedo ayudarte?";
        setQuickChatReply(reply);
        setQuickChatHistory([...newHistory, { role: "maris" as const, text: reply }]);
        if (data.feedbackDetected) {
          apiFetch("/api/apps/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: userMsg, type: data.feedbackType }) }).catch(() => {});
        }
      } catch {
        const fallback = "Estoy aquí. ¿Tienes alguna duda sobre Maris AI o quieres construir algo?";
        setQuickChatReply(fallback);
        setQuickChatHistory([...newHistory, { role: "maris" as const, text: fallback }]);
      } finally {
        setQuickChatLoading(false);
      }
      return;
    }
    setQuickChatHistory([]);
    if (!isAdmin && stats && stats.credits <= 0) { setShowNoCredits(true); return; }
    if (!isAdmin && stats && stats.credits < kindCost) {
      toast({ title: "Créditos insuficientes", description: `Este proyecto necesita ${kindCost} crédito(s) y solo tienes ${stats.credits}.`, variant: "destructive" });
      setShowNoCredits(true);
      return;
    }
    import("@/lib/analytics").then(({ trackGenerateApp }) => {
      const isFirst = !apps || (apps as any[]).length === 0;
      trackGenerateApp(kind, isFirst);
    });
    openOnboarding();
  };

  const isWorking = activeJobId !== null;

  useEffect(() => {
    if (!showNoCredits || isAdmin) return;
    const interval = setInterval(async () => {
      try {
        const fresh = await apiFetch<any>("/api/me/stats");
        if (fresh?.credits > 0) {
          setShowNoCredits(false);
          toast({ title: "✅ ¡Créditos recargados!", description: `Tienes ${fresh.credits} créditos. ¡Ya puedes seguir generando!` });
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        }
      } catch { /* silencioso */ }
    }, 8000);
    return () => clearInterval(interval);
  }, [showNoCredits, isAdmin, queryClient, toast]);

  const phaseInfo = job ? PHASE_LABELS[job.phase] ?? PHASE_LABELS.queued : PHASE_LABELS.queued;
  const PhaseIcon = phaseInfo.icon;

  if (preGenChatOpen) {
    return (
      <PreGenerationChat
        initialPrompt={prompt}
        appKind={kind}
        onConfirm={handlePreGenConfirm}
        onCancel={() => setPreGenChatOpen(false)}
        isGenerating={preGenChatGenerating}
      />
    );
  }

  if (activeJobId) {
    return (
      <div className="h-screen w-screen bg-[#0a0a0f] fixed inset-0 z-[100]">
        <GenerationStudio
          jobId={activeJobId}
          job={job}
          phaseLabel={phaseInfo.label}
          PhaseIcon={PhaseIcon}
          appId={job?.appId ?? undefined}
        />
      </div>
    );
  }

  return (
    <Layout>
      <div className="container max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-4 sm:space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <Card className="bg-card/50 border-white/5 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Apps creadas</CardTitle>
              <Code2 className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-bold font-mono">{stats?.appsGenerated}</div>}
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-white/5 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Apps publicadas</CardTitle>
              <Sparkles className="h-4 w-4 text-emerald-400" />
            </CardHeader>
            <CardContent>
              {appsLoading ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-3xl font-bold font-mono text-emerald-400">
                  {(apps ?? []).filter((a: any) => a.marisaiSubdomain || (a.customDomain && a.customDomainVerified)).length}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-white/5 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Créditos disponibles</CardTitle>
              <Cpu className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-bold font-mono text-primary">{isAdmin ? "∞" : stats?.credits}</div>}
              {isAdmin && <p className="text-xs text-primary/70 font-mono mt-1">Modo propietario</p>}
            </CardContent>
          </Card>
        </div>

        {/* ─── Prompt Box ─────────────────────────────────────────────────────── */}
        <div className="relative rounded-2xl border border-white/[0.08] bg-[#0d0d12] overflow-hidden shadow-[0_0_60px_rgba(124,58,237,0.08)]">
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-base font-black text-white tracking-tight">¿Qué vas a construir hoy?</h2>
                <p className="text-[11px] text-white/30">11 agentes de IA especializados trabajarán para ti</p>
              </div>
            </div>
          </div>

          <div className="px-6 pb-4">
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(KIND_META) as [Kind, typeof KIND_META[Kind]][]).map(([k, meta]) => (
                <button key={k} type="button" onClick={() => { kindTouchedRef.current = true; setKind(k); }} disabled={isWorking}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border ${
                    kind === k ? "bg-primary/15 border-primary/40 text-primary shadow-sm shadow-primary/10" : "bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.06]"
                  }`}>
                  <meta.icon className="h-3 w-3" />
                  {meta.label}
                  {meta.cost > 1 && (
                    <span className={`ml-0.5 text-[9px] font-bold px-1 py-0.5 rounded-full ${kind === k ? "bg-primary/20 text-primary" : "bg-white/5 text-white/20"}`}>{k === "video-ai" ? `desde ${meta.cost}cr` : `${meta.cost}cr`}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {showNoCredits && !isAdmin && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-2xl bg-background/95 backdrop-blur-sm border border-destructive/20">
              <div className="text-center px-6 max-w-sm">
                <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="h-7 w-7 text-destructive" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Te has quedado sin créditos</h3>
                <p className="text-sm text-muted-foreground mb-5">Recarga ahora para seguir generando apps.</p>
                <div className="flex flex-col gap-2">
                  <Button className="w-full bg-primary hover:bg-primary/90 font-bold" onClick={() => setLocation("/billing")}>
                    <Sparkles className="mr-2 h-4 w-4" />Recargar créditos
                  </Button>
                  <p className="text-[11px] text-muted-foreground/60 animate-pulse">Detectando recarga automáticamente...</p>
                </div>
              </div>
            </div>
          )}

          {(kind === "video-ai" || kind === "imagen-ai") && (
            <div className="px-6 pb-4">
              <MediaAIGenerator mode={kind as "video-ai" | "imagen-ai"} />
            </div>
          )}

          <form onSubmit={handleGenerate} className={kind === "video-ai" || kind === "imagen-ai" ? "hidden" : ""}>
            <div className="px-6 pb-3">
              <div className="relative bg-[#0a0a10] border border-white/[0.07] rounded-xl focus-within:border-primary/40 transition-all">
                <Textarea
                  placeholder={kindMeta.placeholder}
                  className="min-h-[100px] sm:min-h-[140px] bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 resize-none text-base md:text-sm text-white placeholder:text-white/20 p-3 sm:p-4 pb-14"
                  value={prompt}
                  onChange={(e) => { setPrompt(e.target.value); if (inlineHint) setInlineHint(null); }}
                  disabled={isWorking}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (prompt.trim() && !isWorking) handleGenerate(e as any);
                    }
                  }}
                />
                <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2 border-t border-white/[0.05]">
                  <div className="flex items-center gap-1">
                    <AttachmentPicker attachments={attachments} onChange={setAttachments} disabled={isWorking} />
                    <Select value={coderModel} onValueChange={setCoderModel} disabled={isWorking}>
                      <SelectTrigger className="h-7 w-auto min-w-[90px] sm:min-w-[140px] bg-transparent border-0 text-[10px] font-semibold text-white/30 hover:text-white/60 focus:ring-0 px-2 gap-1">
                        <SelectValue placeholder="Modelo" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#16161e] border-white/10">
                        {ultraThinking ? (
                          <>
                            <SelectItem value="zoco-max" className="text-[11px] font-semibold"><div className="flex items-center gap-1.5"><Brain className="h-3 w-3 text-amber-400" />Zoco-Max — Ultra</div></SelectItem>
                          </>
                        ) : (
                          <>
                            <SelectItem value="auto" className="text-[11px] font-semibold"><div className="flex items-center gap-1.5"><Zap className="h-3 w-3 text-yellow-400" />Auto (11 Agentes)</div></SelectItem>
                            <SelectItem value="zoco-flash" className="text-[11px] font-semibold"><div className="flex items-center gap-1.5"><Zap className="h-3 w-3 text-green-400" />Zoco Flash (rápido)</div></SelectItem>
                            <SelectItem value="zoco-plus" className="text-[11px] font-semibold"><div className="flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-purple-400" />Zoco Plus</div></SelectItem>
                            <SelectItem value="zoco-max" className="text-[11px] font-semibold"><div className="flex items-center gap-1.5"><Brain className="h-3 w-3 text-blue-400" />Zoco Max (máx. calidad)</div></SelectItem>
                            {(hasVerifiedPayment || isAdmin) && (
                              <SelectItem value="gpt-5.4" className="text-[11px] font-semibold"><div className="flex items-center gap-1.5"><Cpu className="h-3 w-3 text-cyan-400" />Zoco Plus</div></SelectItem>
                            )}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <Popover open={showUltraTeaser && !hasVerifiedPayment && !isAdmin} onOpenChange={(o) => { if (hasVerifiedPayment || isAdmin) return; setShowUltraTeaser(o); }}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          onClick={() => {
                            if (!hasVerifiedPayment && !isAdmin) {
                              setShowUltraTeaser((v) => !v);
                              return;
                            }
                            setUltraThinking(v => {
                              const next = !v;
                              setCoderModel(next ? "zoco-max" : "auto");
                              return next;
                            });
                          }}
                          onMouseEnter={() => { if (!hasVerifiedPayment && !isAdmin) setShowUltraTeaser(true); }}
                          onMouseLeave={() => { if (!hasVerifiedPayment && !isAdmin) setShowUltraTeaser(false); }}
                          disabled={isWorking}
                          title={!hasVerifiedPayment && !isAdmin ? "Ultra solo está disponible para clientes con pago verificado" : undefined}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors ${
                            !hasVerifiedPayment && !isAdmin
                              ? "text-white/20 hover:text-white/40 border border-transparent cursor-pointer"
                              : ultraThinking
                              ? "bg-violet-600/30 text-violet-300 border border-violet-500/40"
                              : "text-white/20 hover:text-white/50 border border-transparent"
                          }`}
                        >
                          {(!hasVerifiedPayment && !isAdmin) ? <Lock className="h-3 w-3" /> : <Brain className="h-3 w-3" />}
                          <span className="hidden sm:inline">Ultra</span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="top"
                        align="start"
                        className="w-72 bg-[#16161e] border-violet-500/30 p-0 overflow-hidden"
                        onMouseEnter={() => setShowUltraTeaser(true)}
                        onMouseLeave={() => setShowUltraTeaser(false)}
                      >
                        <div className="p-3 space-y-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-md bg-violet-600/20 flex items-center justify-center">
                              <Lock className="h-3.5 w-3.5 text-violet-300" />
                            </div>
                            <p className="text-xs font-bold text-white">Modo Ultra — solo clientes de pago</p>
                          </div>
                          <p className="text-[11px] text-white/50 leading-relaxed">
                            Desbloquea los agentes especializados con los modelos más potentes de Zoco IA:
                          </p>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-1.5">
                              <Brain className="h-3 w-3 text-amber-400 flex-shrink-0" />
                              <span className="text-[11px] font-semibold text-amber-200">Zoco Max</span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            className="w-full h-7 text-[11px] bg-violet-600 hover:bg-violet-500 text-white"
                            onClick={() => setLocation("/billing")}
                          >
                            Actualizar a un plan de pago
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                    <button type="button" onClick={() => setLegacyMode(v => !v)} disabled={isWorking}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors ${legacyMode ? "bg-amber-600/30 text-amber-300 border border-amber-500/40" : "text-white/20 hover:text-white/50 border border-transparent"}`}>
                      <RefreshCw className="h-3 w-3" /><span className="hidden sm:inline">Legacy</span>
                    </button>
                  </div>
                  <Button type="submit" disabled={isWorking || !prompt.trim()} className="h-8 px-4 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 text-[12px] font-bold">
                    {isWorking ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Iniciando…</> : <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Generar app</>}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* ─── Recent Apps ───────────────────────────────────────────────────── */}
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                <LayoutDashboard className="h-5 w-5 text-white/70" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white tracking-tight">Mis proyectos</h3>
                <p className="text-[11px] text-white/30 uppercase tracking-widest font-bold">Panel de control</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/20 group-focus-within:text-primary/50 transition-colors" />
                <Input
                  placeholder="Buscar app..."
                  className="h-9 w-full sm:w-64 bg-white/[0.03] border-white/10 pl-9 text-xs focus:ring-primary/20"
                  value={appSearchQuery}
                  onChange={(e) => setAppSearchQuery(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" className="h-9 bg-white/[0.03] border-white/10 text-xs" onClick={() => setImportDialogOpen(true)}>
                <FolderUp className="mr-2 h-3.5 w-3.5" />Importar
              </Button>
            </div>
          </div>

          {appsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />)}
            </div>
          ) : visibleApps.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleApps.map((app) => (
                <Card key={app.id} className="group relative bg-[#0d0d12] border-white/[0.05] hover:border-primary/30 transition-all duration-300 overflow-hidden cursor-pointer shadow-sm hover:shadow-primary/5" onClick={() => setLocation(`/app/${app.id}`)}>
                  <div className="p-5 space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                        {(() => {
                          const Icon = TEMPLATE_ICONS[app.icon || "Box"] || Box;
                          return <Icon className="h-5 w-5" />;
                        })()}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-white/5 text-white/40 hover:text-white" onClick={(e) => handleForkApp(e, app.id, app.title)}>
                          {forkingId === app.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/10 text-white/40 hover:text-destructive" onClick={(e) => handleDeleteApp(e, app.id, app.title)}>
                          {deletingId === app.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-bold text-white group-hover:text-primary transition-colors line-clamp-1">{app.title}</h4>
                      <p className="text-xs text-white/40 line-clamp-2 mt-1 leading-relaxed">{app.description || "Sin descripción disponible"}</p>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-white/[0.03]">
                      <div className="flex items-center gap-2">
                        {app.publicSlug ? (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] font-bold px-2 py-0">Publicada</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-white/5 text-white/30 border-white/10 text-[10px] font-bold px-2 py-0">Borrador</Badge>
                        )}
                      </div>
                      <span className="text-[10px] font-medium text-white/20">{formatDistanceToNow(new Date(app.updatedAt), { addSuffix: true, locale: es })}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 bg-white/[0.02] rounded-3xl border border-dashed border-white/10">
              <div className="h-16 w-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                <Box className="h-8 w-8 text-white/20" />
              </div>
              <h3 className="text-lg font-bold text-white">No hay proyectos</h3>
              <p className="text-sm text-white/30 mt-1">Escribe tu idea arriba para empezar</p>
            </div>
          )}
        </div>
      </div>

      {/* Diálogos */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="bg-[#0d0d12] border-white/10 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Importar proyecto</DialogTitle>
            <DialogDescription>Sube un archivo .zip de un proyecto exportado previamente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!importLoading && !importResult && (
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-xl p-10 hover:border-primary/30 transition-colors cursor-pointer" onClick={() => document.getElementById("zip-upload")?.click()}>
                <FolderUp className="h-10 w-10 text-white/20 mb-3" />
                <p className="text-sm font-medium text-white/60">Haz clic para seleccionar un archivo</p>
                <p className="text-xs text-white/20 mt-1">Solo archivos .zip</p>
                <input id="zip-upload" type="file" accept=".zip" className="hidden" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
              </div>
            )}
            {importFile && !importLoading && !importResult && (
              <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-primary" />
                  <span className="text-sm text-white font-medium truncate max-w-[200px]">{importFile.name}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setImportFile(null)}><X className="h-4 w-4" /></Button>
              </div>
            )}
            {importLoading && (
              <div className="flex flex-col items-center justify-center py-6 space-y-4">
                <Loader2 className="h-10 w-10 text-primary animate-spin" />
                <p className="text-sm text-white font-medium text-center">{importStatusMessage}</p>
              </div>
            )}
            {importResult && (
              <div className="flex flex-col items-center justify-center py-6 space-y-3">
                <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                </div>
                <h4 className="font-bold text-white text-center">¡Proyecto importado!</h4>
                <p className="text-sm text-white/60 text-center">"{importResult.title}" ya está en tu lista.</p>
              </div>
            )}
            {importErrorDetail && (
              <div className="space-y-3">
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-xs text-destructive font-bold">Error: {importErrorDetail.reason}</p>
                </div>
                {(importErrorDetail.buildLog || importErrorDetail.installLog) && (
                  <div className="max-h-40 overflow-y-auto p-3 bg-black rounded-lg border border-white/5 font-mono text-[10px] text-white/40 whitespace-pre-wrap">
                    {importErrorDetail.buildLog || importErrorDetail.installLog}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportDialogOpen(false)} disabled={importLoading}>Cancelar</Button>
            <Button onClick={handleImportProject} disabled={!importFile || importLoading || !!importResult}>
              {importLoading ? "Importando..." : "Importar ahora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
