import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useGetMyStats,
  useListApps,
  useGenerateApp,
  useGetMe,
  useGetGenerationJob,
  useGetMyPreferences,
  useUpdateMyPreferences,
  useListTemplates,
  useCreateCheckoutSession,
  useDeleteApp,
  getGetGenerationJobQueryKey,
  getGetMyStatsQueryKey,
  getListAppsQueryKey,
  getGetMeQueryKey,
  getGetMyPreferencesQueryKey,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { AgentNotesPanel } from "@/components/agent-notes-panel";
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
  Layers, Smartphone, Rocket, Gamepad2, Box, Globe, X, LayoutDashboard, 
  ShoppingBag, Notebook, Joystick, Cat, Zap, Atom, Component, Flame, 
  Server, ListTodo, CloudSun, Newspaper, MessagesSquare, ImagePlay, 
  FileText, Brain, Mic, Webhook, Library, type LucideIcon, UserCircle, 
  Settings2, ShieldAlert, TestTube2, HardDrive
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
  { name: "DevOps", icon: Rocket, color: "text-indigo-400" },
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
  testing:      { label: "🧪 QA Specialist verificando errores…",              icon: ShieldCheck },
  patching:     { label: "🔧 DevOps Patcher auto-reparando errores…",           icon: Wrench },
  validating:   { label: "🔍 Compilando el código en memoria…",                icon: Bug },
  fixing:       { label: "🔧 Auto-reparando errores detectados…",              icon: Wrench },
  parsing:      { label: "📦 Empaquetando archivos del proyecto…",             icon: FileCheck2 },
  ready:        { label: "¡Tu app está lista!",                                icon: FileCheck2 },
  failed:       { label: "La generación falló",                                icon: Loader2 },
};

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [coderModel, setCoderModel] = useState<string>("auto");
  const [language, setLanguage] = useState<"typescript" | "javascript">("typescript");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [appsFilter, setAppsFilter] = useState<"all" | "deployed">("all");
  type Kind = "fullstack" | "mobile" | "landing" | "game-2d" | "game-3d" | "hybrid-pwa" | "vue" | "svelte" | "nextjs" | "python-api" | "django";
  const [kind, setKind] = useState<Kind>("fullstack");
  const KIND_META: Record<Kind, { label: string; icon: typeof Layers; placeholder: string; cost: number }> = {
    fullstack: { label: "App completa", icon: Layers, placeholder: "ej. Un marketplace estilo Wallapop con publicaciones, búsqueda, mensajes y perfil de usuario...", cost: 3 },
    mobile: { label: "App móvil", icon: Smartphone, placeholder: "ej. Un diario de hábitos para móvil con racha diaria, notificaciones de recordatorio y vista de calendario...", cost: 2 },
    landing: { label: "Landing page", icon: Rocket, placeholder: "ej. Una landing page para una herramienta SaaS de productividad con hero, features, testimonios, pricing y CTA final...", cost: 1 },
    "game-2d": { label: "Juego 2D", icon: Gamepad2, placeholder: "ej. Un juego arcade tipo Snake con controles WASD, niveles de dificultad creciente y tabla de records local...", cost: 3 },
    "game-3d": { label: "Juego 3D", icon: Box, placeholder: "ej. Un juego 3D first-person de coleccionar monedas en un laberinto con física básica y temporizador...", cost: 5 },
    "hybrid-pwa": { label: "App híbrida (PWA)", icon: Globe, placeholder: "ej. Una app instalable de notas con sincronización offline, búsqueda y categorías por colores...", cost: 3 },
    vue: { label: "Vue 3", icon: Component, placeholder: "ej. Una app de tareas con Vue 3 Composition API, vue-router y Pinia, persistida en localStorage...", cost: 2 },
    svelte: { label: "SvelteKit", icon: Flame, placeholder: "ej. Un dashboard del tiempo con SvelteKit, Svelte 5 runes y datos desde Open-Meteo...", cost: 2 },
    nextjs: { label: "Next.js", icon: Server, placeholder: "ej. Un blog full-stack con Next.js App Router, Server Components y API routes...", cost: 3 },
    "python-api": { label: "Python (FastAPI)", icon: Webhook, placeholder: "ej. Una API REST de tareas con FastAPI, validación pydantic, SQLAlchemy + SQLite y endpoints CRUD completos...", cost: 3 },
    django: { label: "Django", icon: Library, placeholder: "ej. Un blog en Django 5 con modelos, vistas, plantillas, admin y SQLite...", cost: 3 },
  };
  const kindMeta = KIND_META[kind] ?? KIND_META.fullstack;
  const kindCost = kindMeta.cost;
  const [annualOpen, setAnnualOpen] = useState(false);

  // ─── Pre-Generation Chat (Emergent.sh style) ────────────────────────────────
  const [preGenChatOpen, setPreGenChatOpen] = useState(false);
  const [preGenChatGenerating, setPreGenChatGenerating] = useState(false);

  // Legacy onboarding state (kept for reference, replaced by PreGenerationChat)
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingAnswers, setOnboardingAnswers] = useState<Record<number, string>>({}); 

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
      question: "¿Tienes contexto previo del proyecto? (descripción, documentos, capturas, branding, etc.) Si es así, descríbelo.",
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
      question: "¿Tienes preferencias de diseño? (colores, tipografía, estilo, referencias visuales)",
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
      // Build enriched prompt
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
      generateMutation.mutate({ data: { prompt: finalPrompt, model: coderModel, language, kind, attachments: attachments.map((a: any) => a.id) } });
    }
  };

  const handleOnboardingSkip = () => {
    setOnboardingOpen(false);
    localStorage.setItem("appforge_last_prompt", prompt);
    generateMutation.mutate({ data: { prompt, model: coderModel, language, kind, attachments: attachments.map((a: any) => a.id) } });
  };

  const openOnboarding = () => {
    // Use new PreGenerationChat instead of old modal
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
  const deleteMutation = useDeleteApp({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        toast({ title: "App eliminada", description: "La aplicación ha sido borrada permanentemente." });
      },
      onError: (error: any) => {
        toast({ title: "Error al eliminar", description: error?.message || "No se pudo eliminar la aplicación.", variant: "destructive" });
      },
    },
  });

  const handleDeleteApp = (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    if (confirm(`¿Estás seguro de que quieres eliminar permanentemente "${title}"? Esta acción no se puede deshacer.`)) {
      deleteMutation.mutate({ id });
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
          toast({ title: "Maris AI", description: data.reply || data.message || "Mensaje recibido. No se ha iniciado ninguna generación." });
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
        toast({ title: "No pudimos encolar la generación", description: error?.message || error?.error || "Inténtalo otra vez en un momento.", variant: "destructive" });
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
      setLocation(`/app/${appId}`);
    } else if (job.status === "failed") {
      toast({ title: "Falló la generación", description: job.errorMessage || "Inténtalo otra vez o ajusta el prompt.", variant: "destructive" });
      setActiveJobId(null);
    }
  }, [job, queryClient, setLocation, toast, activeJobId]);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (!isAdmin && stats && stats.credits < kindCost) {
      toast({ title: "Créditos insuficientes", description: kindCost > 1 ? `Este tipo de proyecto cuesta ${kindCost} créditos y solo tienes ${stats.credits}. Compra más para continuar.` : "Compra más créditos para seguir generando apps.", variant: "destructive" });
      setLocation("/billing");
      return;
    }
    // Open onboarding questions before generating
    openOnboarding();
  };

  const isWorking = generateMutation.isPending || activeJobId !== null;
  const phaseInfo = job ? PHASE_LABELS[job.phase] ?? PHASE_LABELS.queued : PHASE_LABELS.queued;
  const PhaseIcon = phaseInfo.icon;

  // ─── Pre-Generation Chat overlay ────────────────────────────────────────────
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
        />
      </div>
    );
  }

  return (
    <Layout>
      <div className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

        {/* ─── Emergent-style Prompt Box ─────────────────────────────────── */}
        <div className="relative rounded-2xl border border-white/[0.08] bg-[#0d0d12] overflow-hidden shadow-[0_0_60px_rgba(124,58,237,0.08)]">
          {/* Top gradient line */}
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

          {/* Header */}
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

          {/* Kind selector tabs */}
          <div className="px-6 pb-4">
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(KIND_META) as [Kind, typeof KIND_META[Kind]][]).map(([k, meta]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  disabled={isWorking}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border ${
                    kind === k
                      ? "bg-primary/15 border-primary/40 text-primary shadow-sm shadow-primary/10"
                      : "bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.06]"
                  }`}
                >
                  <meta.icon className="h-3 w-3" />
                  {meta.label}
                  {meta.cost > 1 && (
                    <span className={`ml-0.5 text-[9px] font-bold px-1 py-0.5 rounded-full ${
                      kind === k ? "bg-primary/20 text-primary" : "bg-white/5 text-white/20"
                    }`}>{meta.cost}cr</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Textarea */}
          <form onSubmit={handleGenerate}>
            <div className="px-6 pb-3">
              <div className="relative bg-[#0a0a10] border border-white/[0.07] rounded-xl focus-within:border-primary/40 transition-all">
                <Textarea
                  placeholder={kindMeta.placeholder}
                  className="min-h-[140px] bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 resize-none text-sm text-white placeholder:text-white/20 p-4 pb-14"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={isWorking}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.metaKey) {
                      e.preventDefault();
                      if (prompt.trim() && !isWorking) handleGenerate(e as any);
                    }
                  }}
                />
                {/* Bottom bar inside textarea */}
                <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2 border-t border-white/[0.05]">
                  <div className="flex items-center gap-1">
                    <AttachmentPicker attachments={attachments} onChange={setAttachments} disabled={isWorking} />
                    <Select value={coderModel} onValueChange={setCoderModel} disabled={isWorking}>
                      <SelectTrigger className="h-7 w-auto min-w-[140px] bg-transparent border-0 text-[10px] font-semibold text-white/30 hover:text-white/60 focus:ring-0 px-2 gap-1">
                        <SelectValue placeholder="Modelo" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#16161e] border-white/10">
                        <SelectItem value="auto" className="text-[11px] font-semibold">
                          <div className="flex items-center gap-1.5"><Zap className="h-3 w-3 text-yellow-400" />Auto (9 Agentes)</div>
                        </SelectItem>
                        <SelectItem value="claude-haiku-4-5" className="text-[11px] font-semibold">
                          <div className="flex items-center gap-1.5"><Zap className="h-3 w-3 text-green-400" />Haiku 4.5 (rápido)</div>
                        </SelectItem>
                        <SelectItem value="claude-sonnet-4-6" className="text-[11px] font-semibold">
                          <div className="flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-purple-400" />Sonnet 4.6</div>
                        </SelectItem>
                        <SelectItem value="claude-opus-4-7" className="text-[11px] font-semibold">
                          <div className="flex items-center gap-1.5"><Brain className="h-3 w-3 text-blue-400" />Opus 4.7 (máx. calidad)</div>
                        </SelectItem>
                        <SelectItem value="gpt-5.4" className="text-[11px] font-semibold">
                          <div className="flex items-center gap-1.5"><Cpu className="h-3 w-3 text-cyan-400" />GPT-5.4</div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="submit"
                    disabled={isWorking || !prompt.trim()}
                    className="h-8 px-4 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 text-[12px] font-bold"
                  >
                    {isWorking ? (
                      <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Iniciando…</>
                    ) : (
                      <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Generar <span className="hidden sm:inline">({kindCost} cr)</span></>
                    )}
                  </Button>
                </div>
              </div>
              {attachments.length > 0 && <AttachmentChips attachments={attachments} onChange={setAttachments} />}
            </div>

            {/* Quick suggestions */}
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
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setPrompt(suggestion)}
                    disabled={isWorking}
                    className="text-[11px] px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/80 hover:bg-white/[0.08] hover:border-primary/30 transition-all"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            {/* Agents row */}
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
                      <TooltipContent side="top">
                        <p className="text-xs font-semibold">{agent.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-white/20 italic hidden sm:block">
                ⌘+Enter para generar rápido
              </p>
            </div>
          </form>
        </div>

        {/* ─── Onboarding Questions Modal (legacy, replaced by PreGenerationChat) ─── */}
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
                  <div key={i} className={`h-1 flex-1 rounded-full transition-all ${ i <= onboardingStep ? "bg-primary" : "bg-white/10" }`} />
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
                <Textarea
                  placeholder={currentQuestion.placeholder}
                  className="min-h-[120px] bg-background/50 border-white/10 focus:border-primary/50 resize-none text-sm"
                  value={onboardingAnswers[onboardingStep] || ""}
                  onChange={(e) => handleOnboardingAnswer(e.target.value)}
                  autoFocus
                />
              )}
            </div>

            <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white" onClick={handleOnboardingSkip}>
                Saltar todo y generar
              </Button>
              <div className="flex gap-2">
                {onboardingStep > 0 && (
                  <Button variant="outline" size="sm" className="border-white/10" onClick={() => setOnboardingStep(p => p - 1)}>
                    Atrás
                  </Button>
                )}
                <Button size="sm" className="bg-primary hover:bg-primary/90 min-w-[100px]" onClick={handleOnboardingNext}>
                  {onboardingStep < onboardingQuestions.length - 1 ? (
                    <>Siguiente <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></>
                  ) : (
                    <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Generar app</>
                  )}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div>
          <h3 className="text-xl font-semibold flex items-center mb-4">
            <Code2 className="h-5 w-5 mr-2 text-muted-foreground" />Apps recientes
          </h3>
          {appsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {visibleApps.map((app: any) => (
                <Card key={app.id || app._id} className="bg-card/40 border-white/5 hover:border-primary/50 transition-all cursor-pointer group relative" onClick={() => setLocation(`/app/${app.id || app._id}`)}>
                  <button
                    className="absolute top-2 right-2 z-10 p-1 rounded-full bg-black/40 text-muted-foreground hover:bg-red-500/80 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                    onClick={(e) => handleDeleteApp(e, app.id || app._id, app.title)}
                    disabled={deleteMutation.isPending}
                    title="Eliminar proyecto"
                  >
                    <X className="h-3.5 w-3.5" />
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
