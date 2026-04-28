import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useGetMyStats,
  useListApps,
  useGenerateApp,
  useGetMe,
  useGetGenerationJob,
  getGetGenerationJobQueryKey,
  getGetMyStatsQueryKey,
  getListAppsQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Sparkles, Code2, Plus, ArrowRight, Loader2, Cpu, Search, Wand2, FileCheck2, Compass, Palette, ShieldCheck, Plug, Wrench, Bug } from "lucide-react";

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
  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  const { data: me } = useGetMe();
  const { data: stats, isLoading: statsLoading } = useGetMyStats();
  const { data: apps, isLoading: appsLoading } = useListApps();
  const isAdmin = !!me?.isAdmin;

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
      onSuccess: (data) => {
        setActiveJobId(data.id);
      },
      onError: (error: any) => {
        toast({
          title: "No pudimos encolar la generación",
          description: error?.message || error?.error || "Inténtalo otra vez en un momento.",
          variant: "destructive",
        });
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
      toast({ title: "¡App generada!", description: "Tu aplicación está lista para verla." });
      setLocation(`/app/${appId}`);
      void id;
    } else if (job.status === "failed") {
      toast({
        title: "Falló la generación",
        description: job.errorMessage || "Inténtalo otra vez o ajusta el prompt.",
        variant: "destructive",
      });
      setActiveJobId(null);
    }
  }, [job, queryClient, setLocation, toast, activeJobId]);

  useEffect(() => {
    const saved = localStorage.getItem("appforge_pending_prompt");
    if (saved) {
      setPrompt(saved);
      localStorage.removeItem("appforge_pending_prompt");
    }
  }, []);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    if (!isAdmin && stats && stats.credits <= 0) {
      toast({
        title: "Sin créditos",
        description: "Compra más créditos para seguir generando apps.",
        variant: "destructive",
      });
      setLocation("/billing");
      return;
    }

    generateMutation.mutate({ data: { prompt } });
  };

  const isWorking = generateMutation.isPending || activeJobId !== null;
  const phaseInfo = job ? PHASE_LABELS[job.phase] ?? PHASE_LABELS.queued : PHASE_LABELS.queued;
  const PhaseIcon = phaseInfo.icon;
  const progressValue = job?.progress ?? (generateMutation.isPending ? 5 : 0);

  return (
    <Layout>
      <div className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
        
        {/* Estadísticas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-card/50 border-white/5 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Créditos disponibles</CardTitle>
              <Cpu className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-3xl font-bold font-mono text-primary">
                  {isAdmin ? "∞" : stats?.credits}
                </div>
              )}
              {isAdmin && (
                <p className="text-xs text-primary/70 font-mono mt-1">Modo propietario</p>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-white/5 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Apps generadas</CardTitle>
              <Code2 className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-3xl font-bold font-mono">{stats?.appsGenerated}</div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 border-white/5 shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total gastado</CardTitle>
              <Sparkles className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-3xl font-bold font-mono text-muted-foreground">{stats?.creditsSpentTotal}</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Generador */}
        <Card className="border-primary/20 bg-card/60 backdrop-blur shadow-lg overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-accent"></div>
          <CardHeader>
            <CardTitle className="text-xl flex items-center">
              <Sparkles className="h-5 w-5 text-primary mr-2" />
              Generar nueva aplicación
            </CardTitle>
            <CardDescription>Describe con detalle lo que quieres construir. Sé específico con las funciones, el diseño y el estilo.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate} className="space-y-4">
              <Textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="ej. Un rastreador elegante de hábitos con casillas diarias, gráfica de progreso y modo oscuro..." 
                className="min-h-[120px] bg-background/50 border-border/50 font-sans text-base focus-visible:ring-primary/50"
                disabled={isWorking}
                data-testid="input-prompt"
              />

              {isWorking && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3" data-testid="generation-progress">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <PhaseIcon className={`h-5 w-5 text-primary flex-shrink-0 ${phaseInfo.icon === Loader2 ? "animate-spin" : ""}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{phaseInfo.label}</p>
                        <p className="text-xs text-muted-foreground">
                          La generación puede tardar entre 30 segundos y 2 minutos según la complejidad.
                        </p>
                      </div>
                    </div>
                    <div className="text-sm font-mono text-primary tabular-nums">{progressValue}%</div>
                  </div>
                  <Progress value={progressValue} className="h-2" />
                </div>
              )}

              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground font-mono bg-background/50 px-2 py-1 rounded">
                  {isAdmin ? "Costo: gratis (admin)" : "Costo: 1 crédito"}
                </p>
                {!isAdmin && stats && stats.credits <= 0 ? (
                  <Button type="button" onClick={() => setLocation("/billing")} variant="destructive" data-testid="button-out-of-credits">
                    Sin créditos <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={isWorking || !prompt.trim()}
                    className="min-w-[140px] bg-primary text-white hover:bg-primary/90"
                    data-testid="button-generate"
                  >
                    {isWorking ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generando…
                      </>
                    ) : (
                      <>
                        Generar App <Plus className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground/70">
                Tip: si pides clonar una app existente (Wallapop, Vinted, Twitter…), nuestro investigador buscará en la web su diseño y funciones antes de generar.
              </p>
            </form>
          </CardContent>
        </Card>

        {/* Apps recientes */}
        <div>
          <h3 className="text-xl font-semibold mb-4 flex items-center">
            <Code2 className="h-5 w-5 mr-2 text-muted-foreground" />
            Apps recientes
          </h3>
          
          {appsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full" />)}
            </div>
          ) : apps && apps.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {apps.map(app => (
                <Card 
                  key={app.id} 
                  className="bg-card/40 border-white/5 hover:border-primary/50 transition-all cursor-pointer group hover:bg-card/60 flex flex-col"
                  onClick={() => setLocation(`/app/${app.id}`)}
                  data-testid={`card-app-${app.id}`}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg truncate group-hover:text-primary transition-colors">{app.title}</CardTitle>
                    <CardDescription className="line-clamp-2 min-h-[2.5rem]">{app.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto pt-4 pb-4">
                    <div className="flex gap-2 mb-2 flex-wrap">
                      {app.techStack?.slice(0, 3).map(tech => (
                        <Badge key={tech} variant="outline" className="bg-background/50 border-white/10 text-xs text-muted-foreground">
                          {tech}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0 text-xs text-muted-foreground flex justify-between items-center border-t border-white/5 mt-auto bg-black/10 py-3">
                    <span>{formatDistanceToNow(new Date(app.createdAt), { addSuffix: true, locale: es })}</span>
                    <span className="text-primary/70 group-hover:text-primary transition-colors font-medium">Ver código →</span>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 px-4 border border-dashed border-white/10 rounded-xl bg-card/20">
              <Code2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <h4 className="text-lg font-medium text-foreground mb-1">Aún no has generado apps</h4>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                Usa el cuadro de arriba para darle instrucciones al motor neuronal y crear tu primera aplicación.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
