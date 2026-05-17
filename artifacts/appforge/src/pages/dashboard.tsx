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
import { AgentLogStream } from "@/components/agent-log-stream";
import { AgentNotesPanel } from "@/components/agent-notes-panel";
import { SupportPanel } from "@/components/support-panel";
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
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Sparkles, Code2, Plus, ArrowRight, Loader2, Cpu, Search, Wand2, FileCheck2, Compass, Palette, ShieldCheck, Plug, Wrench, Bug, Layers, Smartphone, Rocket, Gamepad2, Box, Globe, X, LayoutDashboard, ShoppingBag, Notebook, Joystick, Cat, Zap, Atom, Component, Flame, Server, ListTodo, CloudSun, Newspaper, MessagesSquare, ImagePlay, FileText, Brain, Mic, Webhook, Library, type LucideIcon } from "lucide-react";
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

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Rocket, ShoppingBag, Smartphone, Gamepad2, Notebook, Layers, Globe, Box, Joystick, Cat, Zap, Atom, ListTodo, CloudSun, Newspaper, MessagesSquare, ImagePlay, FileText, Brain, Mic, Webhook, Library,
};

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
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [appsFilter, setAppsFilter] = useState<"all" | "deployed">("all");
  type Kind = "fullstack" | "mobile" | "landing" | "game-2d" | "game-3d" | "hybrid-pwa" | "vue" | "svelte" | "nextjs" | "python-api" | "django";
  const [kind, setKind] = useState<Kind>("fullstack");
  const KIND_META: Record<Kind, { label: string; icon: typeof Layers; placeholder: string; cost: number }> = {
    fullstack: { label: "App completa", icon: Layers, placeholder: "ej. Un marketplace estilo Wallapop con publicaciones, búsqueda, mensajes y perfil de usuario...", cost: 1 },
    mobile: { label: "App móvil", icon: Smartphone, placeholder: "ej. Un diario de hábitos para móvil con racha diaria, notificaciones de recordatorio y vista de calendario...", cost: 2 },
    landing: { label: "Landing page", icon: Rocket, placeholder: "ej. Una landing page para una herramienta SaaS de productividad con hero, features, testimonios, pricing y CTA final...", cost: 1 },
    "game-2d": { label: "Juego 2D", icon: Gamepad2, placeholder: "ej. Un juego arcade tipo Snake con controles WASD, niveles de dificultad creciente y tabla de records local...", cost: 3 },
    "game-3d": { label: "Juego 3D", icon: Box, placeholder: "ej. Un juego 3D first-person de coleccionar monedas en un laberinto con física básica y temporizador...", cost: 5 },
    "hybrid-pwa": { label: "App híbrida (PWA)", icon: Globe, placeholder: "ej. Una app instalable de notas con sincronización offline, búsqueda y categorías por colores...", cost: 3 },
    vue: { label: "Vue 3", icon: Component, placeholder: "ej. Una app de tareas con Vue 3 Composition API, vue-router y Pinia, persistida en localStorage...", cost: 1 },
    svelte: { label: "SvelteKit", icon: Flame, placeholder: "ej. Un dashboard del tiempo con SvelteKit, Svelte 5 runes y datos desde Open-Meteo...", cost: 1 },
    nextjs: { label: "Next.js", icon: Server, placeholder: "ej. Un blog full-stack con Next.js App Router, Server Components y API routes...", cost: 2 },
    "python-api": { label: "Python (FastAPI)", icon: Webhook, placeholder: "ej. Una API REST de tareas con FastAPI, validación pydantic, SQLAlchemy + SQLite y endpoints CRUD completos...", cost: 2 },
    django: { label: "Django", icon: Library, placeholder: "ej. Un blog en Django 5 con modelos, vistas, plantillas, admin y SQLite...", cost: 2 },
  };
  const kindMeta = KIND_META[kind] ?? KIND_META.fullstack;
  const kindCost = kindMeta.cost;
  const [annualOpen, setAnnualOpen] = useState(false);

  const { data: me } = useGetMe();
  useEffect(() => {
    if (me?.isPremium && coderModel === "auto") setCoderModel("gpt-5");
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

  const handleDeleteApp = (e: React.MouseEvent, id: number, title: string) => {
    e.stopPropagation();
    if (confirm(`¿Estás seguro de que quieres eliminar permanentemente "${title}"? Esta acción no se puede deshacer.`)) {
      deleteMutation.mutate({ id });
    }
  };

  const visibleApps = (apps ?? []).filter((a) => appsFilter === "deployed" ? !!a.publicSlug : true);

  const { data: job } = useGetGenerationJob(activeJobId ?? 0, {
    query: {
      queryKey: getGetGenerationJobQueryKey(activeJobId ?? 0),
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
      const id = activeJobId;
      setActiveJobId(null);
      setPrompt("");
      attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
      setAttachments([]);
      toast({ title: "¡App generada!", description: "Tu aplicación está lista para verla." });
      setLocation(`/app/${appId}`);
      void id;
    } else if (job.status === "failed") {
      toast({ title: "Falló la generación", description: job.errorMessage || "Inténtalo otra vez o ajusta el prompt.", variant: "destructive" });
      setActiveJobId(null);
    }
  }, [job, queryClient, setLocation, toast, activeJobId]);

  useEffect(() => {
    const saved = localStorage.getItem("appforge_pending_prompt");
    if (saved) { setPrompt(saved); localStorage.removeItem("appforge_pending_prompt"); }
  }, []);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (!isAdmin && stats && stats.credits < kindCost) {
      toast({ title: "Créditos insuficientes", description: kindCost > 1 ? `Este tipo de proyecto cuesta ${kindCost} créditos y solo tienes ${stats.credits}. Compra más para continuar.` : "Compra más créditos para seguir generando apps.", variant: "destructive" });
      setLocation("/billing");
      return;
    }
    generateMutation.mutate({ data: { prompt, coderModel, language, kind, attachmentIds: attachments.map((a: any) => a.id) } });
  };

  useEffect(() => {
    if (!me || isAdmin) return undefined;
    let cleanup: (() => void) | undefined;
    try {
      const raw = localStorage.getItem("appforge_annual_modal_until");
      const until = raw ? Number(raw) : 0;
      if (Date.now() > until) {
        const t: any = setTimeout(() => setAnnualOpen(true), 1200);
        cleanup = () => clearTimeout(t);
      }
    } catch { /* ignore */ }
    return cleanup;
  }, [me, isAdmin]);

  const checkoutForAnnual = useCreateCheckoutSession({
    mutation: {
      onSuccess: (data) => { window.location.href = data.url; },
      onError: () => { setLocation("/billing"); },
    },
  });

  const dismissAnnual = (snoozeDays: number) => {
    try {
      const until = Date.now() + snoozeDays * 24 * 60 * 60 * 1000;
      localStorage.setItem("appforge_annual_modal_until", String(until));
    } catch { /* ignore */ }
    setAnnualOpen(false);
  };

  const isWorking = generateMutation.isPending || activeJobId !== null;
  const phaseInfo = job ? PHASE_LABELS[job.phase] ?? PHASE_LABELS.queued : PHASE_LABELS.queued;
  const PhaseIcon = phaseInfo.icon;
  const progressValue = job?.progress ?? (generateMutation.isPending ? 5 : 0);

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

        <UserPreferencesSection />

        <Card className="border-primary/20 bg-card/60 backdrop-blur shadow-lg overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-accent"></div>
          <CardHeader>
            <CardTitle className="text-xl flex items-center"><Sparkles className="h-5 w-5 text-primary mr-2" />Generar nueva aplicación</CardTitle>
            <CardDescription>Describe con detalle lo que quieres construir. Sé específico con las funciones, el diseño y el estilo.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate} className="space-y-4">
              <TemplateGallery disabled={isWorking} onPick={(t: any) => { setKind(t.kind as Kind); setPrompt(t.seedPrompt); }} />
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-background/50 p-1" role="group" aria-label="Tipo de proyecto" data-testid="kind-tabs">
                {(Object.keys(KIND_META) as Array<keyof typeof KIND_META>).map((k) => {
                  const meta = KIND_META[k];
                  const Icon = meta.icon;
                  const active = kind === k;
                  return (
                    <button key={k} type="button" aria-pressed={active} onClick={() => setKind(k)} disabled={isWorking} title={`${meta.label} — ${meta.cost} ${meta.cost === 1 ? "crédito" : "créditos"}`} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white hover:bg-white/5"}`} data-testid={`kind-tab-${k}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                      <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-mono leading-none ${active ? "bg-primary/25 text-primary" : "bg-white/5 text-muted-foreground/70"}`} data-testid={`kind-cost-${k}`}>{meta.cost}cr</span>
                    </button>
                  );
                })}
              </div>
              <div className="relative">
                <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={KIND_META[kind].placeholder} className="min-h-[120px] bg-background/50 border-border/50 font-sans text-base focus-visible:ring-primary/50 pl-12" disabled={isWorking} data-testid="input-prompt" />
                <div className="absolute left-2 bottom-2">
                  <AttachmentPicker attachments={attachments} onChange={setAttachments} disabled={isWorking} testIdPrefix="dashboard-attachment" />
                </div>
              </div>
              <AttachmentChips attachments={attachments} onRemove={(id) => { const removed = attachments.find((a) => a.id === id); if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl); setAttachments((prev) => prev.filter((a) => a.id !== id)); }} testIdPrefix="dashboard-attachment" />

              {isWorking && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3" data-testid="generation-progress">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <PhaseIcon className={`h-5 w-5 text-primary flex-shrink-0 ${phaseInfo.icon === Loader2 ? "animate-spin" : ""}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{phaseInfo.label}</p>
                        <p className="text-xs text-muted-foreground">La generación puede tardar entre 30 segundos y 2 minutos según la complejidad.</p>
                      </div>
                    </div>
                    <div className="text-sm font-mono text-primary tabular-nums">{progressValue}%</div>
                  </div>
                  <Progress value={progressValue} className="h-2" />
                  <AgentLogStream jobId={activeJobId} isActive={job?.status !== "succeeded" && job?.status !== "failed"} />
                </div>
              )}

              <div className="flex flex-wrap justify-between items-center gap-3">
                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground font-mono bg-background/50 px-2 py-1 rounded">{isAdmin ? "Costo: gratis (admin)" : `Costo: ${kindCost} ${kindCost === 1 ? "crédito" : "créditos"}`}</p>
                  <Select value={coderModel} onValueChange={setCoderModel} disabled={isWorking}>
                    <SelectTrigger className="h-9 w-[230px] text-xs bg-background/50 border-border/50"><SelectValue placeholder="Modelo del coder" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (Gemini Flash, rápido)</SelectItem>
                      <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                      <SelectItem value="gpt-5" disabled={!me?.isPremium}>⚡ GPT-5 Codex {me?.isPremium ? "(Ultra Rápido)" : "(Premium)"}</SelectItem>
                      <SelectItem value="claude-4-7-sonnet-20260416" disabled={!me?.isPremium}>Claude Sonnet 4.7 {me?.isPremium ? "(calidad)" : "(Premium)"}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={language} onValueChange={(v) => setLanguage(v as "typescript" | "javascript")} disabled={isWorking}>
                    <SelectTrigger className="h-9 w-[160px] text-xs bg-background/50 border-border/50"><SelectValue placeholder="Lenguaje" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="typescript">TypeScript (.tsx)</SelectItem>
                      <SelectItem value="javascript">JavaScript (.jsx)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {!isAdmin && stats && stats.credits <= 0 ? (
                  <Button type="button" onClick={() => setLocation("/billing")} variant="destructive" data-testid="button-out-of-credits">Sin créditos <ArrowRight className="ml-2 h-4 w-4" /></Button>
                ) : (
                  <Button type="submit" disabled={isWorking || !prompt.trim()} className="min-w-[140px] bg-primary text-white hover:bg-primary/90" data-testid="button-generate">
                    {isWorking ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generando…</>) : (<>Generar {!isAdmin && <span className="ml-1.5 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-mono leading-none">{kindCost}cr</span>}<Plus className="ml-2 h-4 w-4" /></>)}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground/70">Tip: si pides clonar una app existente (Wallapop, Vinted, Twitter…), nuestro investigador buscará en la web su diseño y funciones antes de generar.</p>
            </form>
          </CardContent>
        </Card>

        <div>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h3 className="text-xl font-semibold flex items-center"><Code2 className="h-5 w-5 mr-2 text-muted-foreground" />Apps recientes</h3>
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-card/40 p-1" role="group" aria-label="Filtrar apps recientes">
              <Button variant="ghost" size="sm" onClick={() => setAppsFilter("all")} aria-pressed={appsFilter === "all"} className={`h-7 px-3 text-xs rounded-md ${appsFilter === "all" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"}`} data-testid="filter-apps-all">
                Todas{apps && <span className="ml-1.5 text-[10px] opacity-70 font-mono">{apps.length}</span>}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAppsFilter("deployed")} aria-pressed={appsFilter === "deployed"} className={`h-7 px-3 text-xs rounded-md ${appsFilter === "deployed" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white hover:bg-white/5"}`} data-testid="filter-apps-deployed">
                Desplegadas{apps && <span className="ml-1.5 text-[10px] opacity-70 font-mono">{apps.filter((a) => !!a.publicSlug).length}</span>}
              </Button>
            </div>
          </div>

          {appsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full" />)}</div>
          ) : visibleApps.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleApps.map((app: any) => (
                <Card key={(app._id || app.id)} className="bg-card/40 border-white/5 hover:border-primary/50 transition-all cursor-pointer group hover:bg-card/60 flex flex-col relative" onClick={() => setLocation(`/app/${(app._id || app.id)}`)} data-testid={`card-app-${(app._id || app.id)}`}>
                  <button
                    onClick={(e) => handleDeleteApp(e, (app._id || app.id), app.title)}
                    className="absolute top-2 right-2 p-2 rounded-full bg-black/20 text-muted-foreground hover:bg-destructive/20 hover:text-destructive opacity-0 group-hover:opacity-100 transition-all z-10"
                    title="Eliminar app"
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  </button>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg truncate group-hover:text-primary transition-colors pr-8">{app.title}</CardTitle>
                    <CardDescription className="line-clamp-2 min-h-[2.5rem]">{app.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto pt-4 pb-4">
                    <div className="flex gap-2 mb-2 flex-wrap">{app.techStack?.slice(0, 3).map((tech: any) => <Badge key={tech} variant="outline" className="bg-background/50 border-white/10 text-xs text-muted-foreground">{tech}</Badge>)}</div>
                  </CardContent>
                  <CardFooter className="pt-0 text-xs text-muted-foreground flex justify-between items-center border-t border-white/5 mt-auto bg-black/10 py-3">
                    <span>{formatDistanceToNow(new Date(app.createdAt), { addSuffix: true, locale: es })}</span>
                    <span className="text-primary/70 group-hover:text-primary transition-colors font-medium">Ver código →</span>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : appsFilter === "deployed" && apps && apps.length > 0 ? (
            <div className="text-center py-16 px-4 border border-dashed border-white/10 rounded-xl bg-card/20">
              <Code2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <h4 className="text-lg font-medium text-foreground mb-1">No tienes apps desplegadas todavía</h4>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto">Abre cualquier app y pulsa "Publicar" para conseguirle una URL pública. Cambia a "Todas" para ver el resto.</p>
            </div>
          ) : (
            <div className="text-center py-16 px-4 border border-dashed border-white/10 rounded-xl bg-card/20">
              <Code2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <h4 className="text-lg font-medium text-foreground mb-1">Aún no has generado apps</h4>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto">Usa el cuadro de arriba para darle instrucciones al motor neuronal y crear tu primera aplicación.</p>
            </div>
          )}
        </div>

        <SupportPanel />
      </div>

      <Dialog open={annualOpen} onOpenChange={(open) => { if (!open) dismissAnnual(7); }}>
        <DialogContent className="max-w-md border-primary/30 bg-card" data-testid="modal-annual">
          <DialogHeader>
            <div className="flex items-center justify-between mb-2">
              <Badge className="bg-primary text-primary-foreground font-semibold tracking-wide">AHORRA 58%</Badge>
              <button type="button" onClick={() => dismissAnnual(7)} className="text-muted-foreground hover:text-white transition-colors" aria-label="Cerrar" data-testid="button-annual-close"><X className="h-4 w-4" /></button>
            </div>
            <DialogTitle className="text-2xl">Plan Anual de Maris AI</DialogTitle>
            <DialogDescription className="text-base text-muted-foreground pt-2">600 créditos por <span className="font-bold text-white">$399</span> en lugar de $960. Suficiente combustible para 12 meses de generación intensiva al mejor precio por crédito.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-white/10 bg-background/50 p-4 my-2 space-y-2">
            <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Créditos incluidos</span><span className="font-mono text-white">600</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Precio por crédito</span><span className="font-mono text-primary">$0.67</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Vs. plan Pro</span><span className="font-mono text-green-400">−58%</span></div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => dismissAnnual(7)} className="text-muted-foreground" data-testid="button-annual-later">Tal vez después</Button>
            <Button onClick={() => checkoutForAnnual.mutate({ data: { priceId: "annual" } })} disabled={checkoutForAnnual.isPending} className="bg-primary text-white hover:bg-primary/90" data-testid="button-annual-buy">
              {checkoutForAnnual.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (<>Comprar plan anual<ArrowRight className="ml-2 h-4 w-4" /></>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function UserPreferencesSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetMyPreferences();
  const updateMutation = useUpdateMyPreferences({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetMyPreferencesQueryKey() }); },
    },
  });
  return (
    <AgentNotesPanel
      title="Mis preferencias para el agente"
      description="Reglas que el agente respetará en TODAS tus apps. Por ejemplo: idioma del producto, estética, librerías favoritas o cosas que nunca debe hacer."
      initialValue={data?.notes}
      isLoading={isLoading}
      isSaving={updateMutation.isPending}
      onSave={async (notes) => { await updateMutation.mutateAsync({ data: { notes } }); }}
      testIdPrefix="user-preferences"
    />
  );
}

function TemplateGallery({ disabled, onPick }: { disabled?: boolean; onPick: (t: { id: string; kind: string; seedPrompt: string; name: string }) => void }) {
  const { data, isLoading } = useListTemplates();
  const templates = data?.templates ?? [];
  if (isLoading) return <div className="flex flex-wrap gap-2" data-testid="template-gallery-loading">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-44 rounded-lg" />)}</div>;
  if (templates.length === 0) return null;
  return (
    <div data-testid="template-gallery">
      <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        Empieza desde una plantilla
        <span className="text-muted-foreground/60 font-normal">(rellena el prompt, lo puedes editar antes de generar)</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {templates.map((t: any) => {
          const Icon = TEMPLATE_ICONS[t.icon] ?? Sparkles;
          return (
            <button key={t.id} type="button" onClick={() => onPick(t)} disabled={disabled} title={t.description} className="group flex flex-col items-start gap-1 rounded-lg border border-white/10 bg-background/40 hover:bg-primary/5 hover:border-primary/40 p-3 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed" data-testid={`template-card-${t.id}`}>
              <Icon className="h-4 w-4 text-primary/80 group-hover:text-primary" />
              <div className="text-xs font-semibold text-white leading-tight">{t.name}</div>
              <div className="text-[10px] text-muted-foreground leading-tight line-clamp-2">{t.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
