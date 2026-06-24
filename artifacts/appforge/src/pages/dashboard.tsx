import { useState, useEffect } from "react";
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
  Bell, BellRing, ExternalLink, RefreshCw, ChevronUp, ChevronDown
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
  starting:     { label: "Iniciando equipo de 9 agentes…",                    icon: Loader2 },
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

  // ── Notificaciones de soporte ──
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifDismissed, setNotifDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchNotifs = async () => {
      try {
        const data = await apiFetch<any>("/api/notifications");
        const unread = (data.notifications || []).filter((n: any) => !n.read);
        setNotifications(unread);
      } catch { /* silencioso */ }
    };
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 30000);
    return () => clearInterval(interval);
  }, []);

  const dismissNotif = async (id: string) => {
    setNotifDismissed(p => new Set([...p, id]));
    try { await apiFetch<any>(`/api/notifications/${id}/read`, { method: "PATCH" }); } catch { /* silencioso */ }
  };
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [coderModel, setCoderModel] = useState<string>("auto");
  const [ultraThinking, setUltraThinking] = useState<boolean>(false);
  const [legacyMode, setLegacyMode] = useState<boolean>(false);
  const [language, setLanguage] = useState<"typescript" | "javascript">("typescript");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [showNoCredits, setShowNoCredits] = useState(false);
  const [appsFilter, setAppsFilter] = useState<"all" | "deployed">("all");
  const [mcpConnectors, setMcpConnectors] = useState<Record<string, { connected: boolean; values: Record<string, string> }>>({});
  type Kind = "fullstack" | "mobile" | "landing" | "game-2d" | "game-3d" | "hybrid-pwa" | "vue" | "svelte" | "nextjs" | "python-api" | "django" | "video-ai" | "imagen-ai";
  const [kind, setKind] = useState<Kind>("fullstack");
  const KIND_META: Record<Kind, { label: string; icon: typeof Layers; placeholder: string; cost: number }> = {
    fullstack: { label: "App completa", icon: Layers, placeholder: "ej. Un marketplace estilo Wallapop con publicaciones, búsqueda, mensajes y perfil de usuario...", cost: 2 },
    mobile: { label: "App móvil", icon: Smartphone, placeholder: "ej. Un diario de hábitos para móvil con racha diaria, notificaciones de recordatorio y vista de calendario...", cost: 2 },
    landing: { label: "Landing page", icon: Rocket, placeholder: "ej. Una landing page para una herramienta SaaS de productividad con hero, features, testimonios, pricing y CTA final...", cost: 1 },
    "game-2d": { label: "Juego 2D", icon: Gamepad2, placeholder: "ej. Un juego arcade tipo Snake con controles WASD, niveles de dificultad creciente y tabla de records local...", cost: 2 },
    "game-3d": { label: "Juego 3D", icon: Box, placeholder: "ej. Un juego 3D first-person de coleccionar monedas en un laberinto con física básica y temporizador...", cost: 3 },
    "hybrid-pwa": { label: "App híbrida (PWA)", icon: Globe, placeholder: "ej. Una app instalable de notas con sincronización offline, búsqueda y categorías por colores...", cost: 2 },
    vue: { label: "Vue 3", icon: Component, placeholder: "ej. Una app de tareas con Vue 3 Composition API, vue-router y Pinia, persistida en localStorage...", cost: 2 },
    svelte: { label: "SvelteKit", icon: Flame, placeholder: "ej. Un dashboard del tiempo con SvelteKit, Svelte 5 runes y datos desde Open-Meteo...", cost: 2 },
    nextjs: { label: "Next.js", icon: Server, placeholder: "ej. Un blog full-stack con Next.js App Router, Server Components y API routes...", cost: 2 },
    "python-api": { label: "Python (FastAPI)", icon: Webhook, placeholder: "ej. Una API REST de tareas con FastAPI, validación pydantic, SQLAlchemy + SQLite y endpoints CRUD completos...", cost: 2 },
    django: { label: "Django", icon: Library, placeholder: "ej. Un blog en Django 5 con modelos, vistas, plantillas, admin y SQLite...", cost: 2 },
    "video-ai": { label: "🎬 Vídeo con IA", icon: ImagePlay, placeholder: "ej. Un vídeo de 30 segundos mostrando un producto de lujo con escenas cinematográficas y transiciones suaves...", cost: 5 },
    "imagen-ai": { label: "🖼️ Imagen con IA", icon: ImagePlay, placeholder: "ej. Una imagen realista de un coche deportivo rojo en una montaña al atardecer con luz dorada...", cost: 1 },
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

  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingAnswers, setOnboardingAnswers] = useState<Record<number, string>>({}); 
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ title: string; filesImported: number } | null>(null);

  const [preferencesDialogOpen, setPreferencesDialogOpen] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const { data: preferencesData } = useGetMyPreferences({ query: { enabled: preferencesDialogOpen } });
  const updatePreferences = useUpdateMyPreferences();

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
        "IA con GPT / Claude / Gemini",
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

  const { data: stats, isLoading: statsLoading } = useGetMyStats();
  const { data: apps, isLoading: appsLoading } = useListApps();
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
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const data = await apiFetch<any>("/api/import-app", { method: "POST", body: formData });
      setImportResult({ title: data.title, filesImported: data.filesImported });
      queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
      toast({ title: `✅ "${data.title}" importado`, description: `${data.filesImported} archivos cargados.` });
      setTimeout(() => { setImportDialogOpen(false); setImportFile(null); setImportResult(null); }, 2000);
    } catch (err: any) {
      toast({ title: "Error al importar", description: err.message, variant: "destructive" });
    } finally {
      setImportLoading(false);
    }
  };

  const visibleApps = (apps ?? []).filter((a) => appsFilter === "deployed" ? !!a.publicSlug : true);

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
  }, [job, queryClient, setLocation, toast, activeJobId]);

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

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
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
  }, [showNoCredits, isAdmin]);

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

        {/* ── Notificaciones de soporte ── */}
        {notifications.filter(n => !notifDismissed.has(n._id)).map((notif) => (
          <div key={notif._id}
            className="relative flex items-start gap-4 rounded-xl border border-violet-500/40 bg-violet-500/8 px-5 py-4 shadow-lg shadow-violet-500/10 animate-in slide-in-from-top-2">
            <div className="shrink-0 mt-0.5">
              <div className="h-9 w-9 rounded-full bg-violet-500/20 flex items-center justify-center">
                <BellRing className="h-5 w-5 text-violet-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-violet-300 mb-1 flex items-center gap-2">
                Actualización del equipo de soporte
                {notif.appTitle && (
                  <span className="text-[10px] font-mono bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full border border-violet-500/30">
                    {notif.appTitle}
                  </span>
                )}
              </p>
              <p className="text-sm text-white/80 leading-relaxed">{notif.message.replace(/\*\*/g, "")}</p>
              {notif.appId && (
                <button onClick={() => setLocation(`/apps/${notif.appId}`)} className="mt-2 inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors">
                  <ExternalLink className="h-3 w-3" />Ver mi app actualizada
                </button>
              )}
            </div>
            <button onClick={() => dismissNotif(notif._id)} className="shrink-0 text-white/30 hover:text-white/60 transition-colors mt-0.5">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
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
          <Card className="bg-card/50 border-white/5 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Apps generadas</CardTitle>
              <Code2 className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-bold font-mono">{stats?.appsGenerated}</div>}
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-white/5 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total gastado</CardTitle>
              <Sparkles className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-bold font-mono text-muted-foreground">{stats?.creditsSpentTotal}</div>}
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
                <p className="text-[11px] text-white/30">9 agentes de IA especializados trabajarán para ti</p>
              </div>
            </div>
          </div>

          <div className="px-6 pb-4">
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(KIND_META) as [Kind, typeof KIND_META[Kind]][]).map(([k, meta]) => (
                <button key={k} type="button" onClick={() => setKind(k)} disabled={isWorking}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border ${
                    kind === k ? "bg-primary/15 border-primary/40 text-primary shadow-sm shadow-primary/10" : "bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.06]"
                  }`}>
                  <meta.icon className="h-3 w-3" />
                  {meta.label}
                  {meta.cost > 1 && (
                    <span className={`ml-0.5 text-[9px] font-bold px-1 py-0.5 rounded-full ${kind === k ? "bg-primary/20 text-primary" : "bg-white/5 text-white/20"}`}>{meta.cost}cr</span>
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
                  className="min-h-[100px] sm:min-h-[140px] bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 resize-none text-sm text-white placeholder:text-white/20 p-3 sm:p-4 pb-14"
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
                      <SelectTrigger className="h-7 w-auto min-w-[140px] bg-transparent border-0 text-[10px] font-semibold text-white/30 hover:text-white/60 focus:ring-0 px-2 gap-1">
                        <SelectValue placeholder="Modelo" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#16161e] border-white/10">
                        <SelectItem value="auto" className="text-[11px] font-semibold"><div className="flex items-center gap-1.5"><Zap className="h-3 w-3 text-yellow-400" />Auto (9 Agentes)</div></SelectItem>
                        <SelectItem value="claude-haiku-4-5" className="text-[11px] font-semibold"><div className="flex items-center gap-1.5"><Zap className="h-3 w-3 text-green-400" />Haiku 4.5 (rápido)</div></SelectItem>
                        <SelectItem value="claude-sonnet-4-6" className="text-[11px] font-semibold"><div className="flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-purple-400" />Sonnet 4.6</div></SelectItem>
                        <SelectItem value="claude-opus-4-7" className="text-[11px] font-semibold"><div className="flex items-center gap-1.5"><Brain className="h-3 w-3 text-blue-400" />Opus 4.7 (máx. calidad)</div></SelectItem>
                        <SelectItem value="gpt-5.4" className="text-[11px] font-semibold"><div className="flex items-center gap-1.5"><Cpu className="h-3 w-3 text-cyan-400" />GPT-5.4</div></SelectItem>
                      </SelectContent>
                    </Select>
                    <button type="button" onClick={() => setUltraThinking(v => !v)} disabled={isWorking}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors ${ultraThinking ? "bg-violet-600/30 text-violet-300 border border-violet-500/40" : "text-white/20 hover:text-white/50 border border-transparent"}`}>
                      <Brain className="h-3 w-3" /><span className="hidden sm:inline">Ultra</span>
                    </button>
                    <button type="button" onClick={() => setLegacyMode(v => !v)} disabled={isWorking}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors ${legacyMode ? "bg-amber-600/30 text-amber-300 border border-amber-500/40" : "text-white/20 hover:text-white/50 border border-transparent"}`}>
                      <RefreshCw className="h-3 w-3" /><span className="hidden sm:inline">Legacy</span>
                    </button>
                  </div>
                  <Button type="submit" disabled={isWorking || !prompt.trim()} className="h-8 px-4 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 text-[12px] font-bold">
                    {isWorking ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Iniciando…</> : <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Generar <span className="hidden sm:inline">({kindCost} cr)</span></>}
                  </Button>
                </div>
              </div>
              {attachments.length > 0 && <AttachmentChips attachments={attachments} onRemove={(id) => setAttachments((prev: any[]) => { const removed = prev.find((a:any) => a.id === id); if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl); return prev.filter((a:any) => a.id !== id); })} />}

              {(quickChatHistory.length > 0 || quickChatLoading) && (
                <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-md bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                        <Sparkles className="h-3 w-3 text-white" />
                      </div>
                      <span className="text-[11px] font-medium text-white/50">Maris</span>
                    </div>
                    <button onClick={() => { setQuickChatHistory([]); setQuickChatReply(null); }} className="text-white/20 hover:text-white/50">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="px-3 py-2 space-y-2 max-h-48 overflow-y-auto">
                    {quickChatHistory.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`text-[12px] leading-relaxed px-3 py-1.5 rounded-lg max-w-[85%] ${msg.role === "user" ? "bg-primary/15 text-primary border border-primary/20" : "bg-white/[0.05] text-white/80 border border-white/[0.05]"}`}>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                    {quickChatLoading && (
                      <div className="flex justify-start">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.05] border border-white/[0.05] rounded-lg">
                          <Loader2 className="h-3 w-3 animate-spin text-white/30" />
                          <span className="text-[12px] text-white/30">escribiendo...</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {!me?.isPremium && !isAdmin && (
              <div className="mx-6 mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-400/90 flex items-center gap-2">
                <Sparkles className="h-3 w-3 flex-shrink-0" />
                <span>Plan gratuito — genera una <strong>landing page</strong> de demostración con tus 15 créditos. <button onClick={() => setLocation("/billing")} className="underline hover:text-amber-300 transition-colors">Activa un plan</button> para apps completas con backend y sin límites.</span>
              </div>
            )}

            <div className="px-6 pb-5">
              <p className="text-[10px] text-white/20 uppercase tracking-widest font-bold mb-2">Sugerencias rápidas</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Marketplace tipo Wallapop con chat y pagos",
                  "SaaS de gestión de proyectos con Kanban",
                  "App de reservas para restaurante con QR",
                  "Dashboard de analytics con gráficas en tiempo real",
                  "Juego 2D tipo Tetris con tabla de records",
                  "Landing page para startup de IA con pricing",
                ].map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => setPrompt(suggestion)} disabled={isWorking}
                    className="text-[11px] px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/80 hover:bg-white/[0.08] hover:border-primary/30 transition-all">
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-white/[0.05] px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-white/20 uppercase tracking-widest font-bold">Equipo activo</span>
                <div className="flex items-center gap-1">
                  {AGENTS.map((agent) => (
                    <Tooltip key={agent.name}>
                      <TooltipTrigger asChild>
                        <div className={`h-6 w-6 rounded-lg bg-white/5 flex items-center justify-center cursor-help hover:bg-white/10 transition-colors ${agent.color}`}>
                          <agent.icon className="h-3 w-3" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p className="text-xs font-semibold">{agent.name}</p></TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-white/20 italic hidden sm:block">⌘/Ctrl + Enter para generar rápido</p>
            </div>
          </form>
        </div>

        {/* ─── Onboarding Modal ─── */}
        <Dialog open={onboardingOpen} onOpenChange={setOnboardingOpen}>
          <DialogContent className="max-w-lg bg-[#0d0d12] border-white/10">
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="text-xs font-bold uppercase tracking-widest text-primary">Maris AI — Análisis del proyecto</span>
              </div>
              <DialogTitle className="text-lg font-bold">{currentQuestion?.question}</DialogTitle>
              <div className="flex items-center gap-1 mt-2">
                {onboardingQuestions.map((_, i) => (
                  <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= onboardingStep ? "bg-primary" : "bg-white/10"}`} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Pregunta {onboardingStep + 1} de {onboardingQuestions.length}</p>
            </DialogHeader>
            <div className="py-2 space-y-3">
              {currentQuestion?.type === "checkbox" && currentQuestion.options && (
                <div className="space-y-2">
                  {currentQuestion.options.map((option) => {
                    const checked = (onboardingAnswers[onboardingStep] || "").split(", ").includes(option);
                    return (
                      <div key={option} className="flex items-center gap-3 p-3 rounded-lg border border-white/5 hover:border-primary/30 hover:bg-white/5 transition-all cursor-pointer" onClick={() => handleOnboardingCheckbox(option, !checked)}>
                        <Checkbox checked={checked} onCheckedChange={(c) => handleOnboardingCheckbox(option, !!c)} className="border-white/30" />
                        <Label className="cursor-pointer text-sm">{option}</Label>
                      </div>
                    );
                  })}
                </div>
              )}
              {currentQuestion?.type === "textarea" && (
                <Textarea placeholder={currentQuestion.placeholder} className="min-h-[120px] bg-background/50 border-white/10 focus:border-primary/50 resize-none text-sm"
                  value={onboardingAnswers[onboardingStep] || ""} onChange={(e) => handleOnboardingAnswer(e.target.value)} autoFocus />
              )}
            </div>
            <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white" onClick={handleOnboardingSkip}>Saltar todo y generar</Button>
              <div className="flex gap-2">
                {onboardingStep > 0 && (
                  <Button variant="outline" size="sm" className="border-white/10" onClick={() => setOnboardingStep(p => p - 1)}>Atrás</Button>
                )}
                <Button size="sm" className="bg-primary hover:bg-primary/90 min-w-[100px]" onClick={handleOnboardingNext}>
                  {onboardingStep < onboardingQuestions.length - 1 ? <>Siguiente <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></> : <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Generar app</>}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div>
          <h3 className="text-xl font-semibold flex items-center mb-4 justify-between">
            <span className="flex items-center">
              <Code2 className="h-5 w-5 mr-2 text-muted-foreground" />Apps recientes
            </span>
            <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={() => setPreferencesDialogOpen(true)}>
              <Settings2 className="h-4 w-4" />Instrucciones personalizadas
            </Button>
            <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={() => { setImportDialogOpen(true); setImportResult(null); setImportFile(null); }}>
              <FolderUp className="h-4 w-4" />Importar proyecto
            </Button>
          </h3>

          <Dialog open={preferencesDialogOpen} onOpenChange={setPreferencesDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-primary" />Instrucciones personalizadas</DialogTitle>
                <DialogDescription>Cuéntale a Maris AI cosas que quieres que tenga en cuenta en TODAS tus apps.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <Textarea value={customInstructions} onChange={(e) => setCustomInstructions(e.target.value.slice(0, 3000))}
                  placeholder="Ej: Mi negocio se llama 'Café Luna', está en Valencia. Usa tonos cálidos (naranja/marrón)."
                  className="min-h-[160px] resize-none" maxLength={3000} />
                <p className="text-xs text-muted-foreground text-right">{customInstructions.length}/3000</p>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPreferencesDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleSavePreferences} disabled={updatePreferences.isPending} className="gap-2">
                  {updatePreferences.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}Guardar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><FolderUp className="h-5 w-5 text-primary" />Importar proyecto existente</DialogTitle>
                <DialogDescription>Sube un archivo .zip o .rar con tu proyecto web.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {importResult ? (
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <CheckCircle2 className="h-12 w-12 text-green-500" />
                    <p className="font-medium text-lg">"{importResult.title}"</p>
                    <p className="text-sm text-muted-foreground">{importResult.filesImported} archivos importados correctamente.</p>
                  </div>
                ) : (
                  <>
                    <label htmlFor="import-file-input"
                      className={`flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${importFile ? "border-primary bg-primary/5" : "border-white/20 hover:border-primary/50 hover:bg-white/5"}`}>
                      <FolderUp className="h-8 w-8 mb-2 text-muted-foreground" />
                      {importFile ? <span className="text-sm font-medium text-primary">{importFile.name}</span> : (
                        <><span className="text-sm text-muted-foreground">Haz clic o arrastra tu archivo aquí</span><span className="text-xs text-muted-foreground mt-1">ZIP o RAR · máx. 150 MB</span></>
                      )}
                      <input id="import-file-input" type="file" accept=".zip,.rar,application/zip,application/x-rar-compressed" className="hidden" onChange={e => setImportFile(e.target.files?.[0] ?? null)} />
                    </label>
                    {importFile && <p className="text-xs text-muted-foreground text-center">{(importFile.size / 1024 / 1024).toFixed(1)} MB · listo para importar</p>}
                  </>
                )}
              </div>
              {!importResult && (
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setImportDialogOpen(false)} disabled={importLoading}>Cancelar</Button>
                  <Button onClick={handleImportProject} disabled={!importFile || importLoading} className="gap-2">
                    {importLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Importando…</> : <><FolderUp className="h-4 w-4" />Importar proyecto</>}
                  </Button>
                </DialogFooter>
              )}
            </DialogContent>
          </Dialog>

          {appsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {visibleApps.map((app: any) => (
                <Card key={app.id || app._id} className="bg-card/40 border-white/5 hover:border-primary/50 transition-all cursor-pointer group relative" onClick={() => setLocation(`/app/${app.id || app._id}`)}>
                  <button className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-black/50 text-muted-foreground hover:bg-red-500/80 hover:text-white transition-all opacity-60 sm:opacity-0 sm:group-hover:opacity-100"
                    onClick={(e) => handleDeleteApp(e, app.id || app._id, app.title)} disabled={deletingId === (app.id || app._id)} title="Eliminar proyecto">
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <button className="absolute top-2 right-10 z-10 p-1.5 rounded-full bg-black/50 text-muted-foreground hover:bg-primary/80 hover:text-white transition-all opacity-60 sm:opacity-0 sm:group-hover:opacity-100"
                    onClick={(e) => handleForkApp(e, app.id || app._id, app.title)} disabled={forkingId === (app.id || app._id)} title="Duplicar proyecto">
                    {forkingId === (app.id || app._id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg truncate group-hover:text-primary transition-colors pr-6">{app.title}</CardTitle>
                    <CardDescription className="line-clamp-2">{app.description}</CardDescription>
                  </CardHeader>
                  <CardFooter className="text-xs text-muted-foreground border-t border-white/5 pt-3">
                    {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true, locale: es })}
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
