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
  queued: { label: "En cola…", icon: Loader2 },
  starting: { label: "Iniciando equipo de agentes…", icon: Loader2 },
  researching: { label: "🔎 Investigador buscando referencias…", icon: Search },
  architecting: { label: "🧠 Arquitecto diseñando la estructura…", icon: Compass },
  integrating: { label: "🔌 Definiendo integraciones (auth, pagos, IA)…", icon: Plug },
  designing: { label: "🎨 Diseñador definiendo el sistema visual…", icon: Palette },
  generating: { label: "⚡ Ingenieros escribiendo el código…", icon: Wand2 },
  reviewing: { label: "✅ QA revisando + 🧪 generando tests…", icon: ShieldCheck },
  validating: { label: "🔍 Compilando el código en memoria…", icon: Bug },
  testing: { label: "🧪 Testing Agent verificando errores…", icon: Wrench },
  fixing: { label: "🔧 Auto-reparando errores detectados…", icon: Wrench },
  parsing: { label: "📦 Empaquetando archivos…", icon: FileCheck2 },
  ready: { label: "¡Listo!", icon: FileCheck2 },
  failed: { label: "Falló", icon: Loader2 },
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
      onSuccess: (data) => { setActiveJobId(data.id); },
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
    localStorage.setItem("appforge_last_prompt", prompt);
    generateMutation.mutate({ data: { prompt, coderModel, language, kind, attachmentIds: attachments.map((a: any) => a.id) } });
  };

  const isWorking = generateMutation.isPending || activeJobId !== null;
  const phaseInfo = job ? PHASE_LABELS[job.phase] ?? PHASE_LABELS.queued : PHASE_LABELS.queued;
  const PhaseIcon = phaseInfo.icon;

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

        <Card className="border-primary/20 bg-card/60 backdrop-blur shadow-lg overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-accent"></div>
          <CardHeader>
            <CardTitle className="text-xl flex items-center"><Sparkles className="h-5 w-5 text-primary mr-2" />Generar nueva aplicación</CardTitle>
            <CardDescription>Describe con detalle lo que quieres construir. Maris AI coordinará a su equipo de agentes de élite.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate} className="space-y-6">
              <div className="relative group">
                <Textarea
                  placeholder={kindMeta.placeholder}
                  className="min-h-[160px] bg-background/50 border-white/10 focus:border-primary/50 transition-all resize-none text-base p-4 pb-12"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={isWorking}
                />
                <div className="absolute left-2 bottom-2">
                  <AttachmentPicker attachments={attachments} onChange={setAttachments} disabled={isWorking} />
                </div>
              </div>

              {/* Cuadrícula de Agentes — Estilo Emergent */}
              <div className="bg-black/20 rounded-xl p-4 border border-white/5">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3 font-bold">Equipo de Agentes Activos</p>
                <div className="grid grid-cols-3 md:grid-cols-9 gap-4">
                  {AGENTS.map((agent) => (
                    <Tooltip key={agent.name}>
                      <TooltipTrigger asChild>
                        <div className="flex flex-col items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity cursor-help">
                          <div className={`p-2 rounded-lg bg-white/5 ${agent.color}`}>
                            <agent.icon className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] font-medium text-muted-foreground">{agent.name}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">Agente especialista: {agent.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap justify-between items-center gap-4">
                <div className="flex items-center gap-3">
                  <Select value={coderModel} onValueChange={setCoderModel} disabled={isWorking}>
                    <SelectTrigger className="h-10 w-[280px] bg-background/50 border-white/10">
                      <SelectValue placeholder="Modelo de orquestación" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        <div className="flex items-center">
                          <Zap className="h-4 w-4 mr-2 text-yellow-400" />
                          <span>Auto (Orquestación de 9 Agentes)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="claude-4-8-sonnet">
                        <div className="flex items-center">
                          <Sparkles className="h-4 w-4 mr-2 text-purple-400" />
                          <span>Claude 4.8 Sonnet (Líder de Ingeniería)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="claude-mithos">
                        <div className="flex items-center">
                          <Palette className="h-4 w-4 mr-2 text-pink-400" />
                          <span>Claude Mithos (Especialista UI/UX)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="gemini-3">
                        <div className="flex items-center">
                          <Brain className="h-4 w-4 mr-2 text-blue-400" />
                          <span>Gemini 3 (Investigación & QA)</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button type="submit" disabled={isWorking || !prompt.trim()} size="lg" className="min-w-[180px] bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20">
                  {isWorking ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Iniciando equipo…</>
                  ) : (
                    <>Generar Aplicación <Plus className="ml-2 h-4 w-4" /></>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground/60 text-center italic">
                Tip: Al pulsar generar, los 9 agentes analizarán tu petición para construir una app completa y optimizada.
              </p>
            </form>
          </CardContent>
        </Card>

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
                <Card key={app.id || app._id} className="bg-card/40 border-white/5 hover:border-primary/50 transition-all cursor-pointer group" onClick={() => setLocation(`/app/${app.id || app._id}`)}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg truncate group-hover:text-primary transition-colors">{app.title}</CardTitle>
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
