import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Globe,
  Users,
  Clock,
} from "lucide-react";

interface MetricsResponse {
  generatedAt: string;
  jobs24h: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    avgDurationMs: number;
  };
  topFailingPhases: Array<{ phase: string; count: number }>;
  credits: { today: number; month: number };
  topUsers: Array<{ userId: string; email: string; creditsUsed: number }>;
  publishedApps: { today: number; total: number };
}

async function fetchMetrics(): Promise<MetricsResponse> {
  const r = await fetch("/api/admin/metrics", { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m ${rs}s`;
}

export default function AdminDashboardPage() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "metrics"],
    queryFn: fetchMetrics,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Panel de métricas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Resumen del negocio en tiempo real. Se actualiza automáticamente cada 30
              segundos.
            </p>
          </div>
          {dataUpdatedAt > 0 && (
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {new Date(dataUpdatedAt).toLocaleTimeString("es-ES")}
            </Badge>
          )}
        </header>

        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6 text-sm text-destructive">
              No se han podido cargar las métricas: {(error as Error).message}
            </CardContent>
          </Card>
        )}

        {isLoading || !data ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                icon={<Activity className="h-4 w-4" />}
                title="Generaciones (24h)"
                value={data.jobs24h.total.toString()}
                hint={
                  data.jobs24h.successRate !== null
                    ? `${data.jobs24h.successRate}% éxito`
                    : "Sin datos"
                }
              />
              <MetricCard
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                title="Generaciones OK (24h)"
                value={data.jobs24h.succeeded.toString()}
                hint={`Tiempo medio: ${formatDuration(data.jobs24h.avgDurationMs)}`}
              />
              <MetricCard
                icon={<AlertTriangle className="h-4 w-4 text-rose-500" />}
                title="Generaciones falladas (24h)"
                value={data.jobs24h.failed.toString()}
                hint={
                  data.topFailingPhases[0]
                    ? `Fase: ${data.topFailingPhases[0].phase}`
                    : "Sin fallos"
                }
              />
              <MetricCard
                icon={<Globe className="h-4 w-4 text-sky-500" />}
                title="Apps publicadas"
                value={data.publishedApps.total.toString()}
                hint={`Hoy: ${data.publishedApps.today}`}
              />
            </section>

            <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Créditos consumidos
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">Hoy</span>
                    <span className="text-2xl font-semibold">
                      {data.credits.today.toLocaleString("es-ES")}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">Este mes</span>
                    <span className="text-2xl font-semibold">
                      {data.credits.month.toLocaleString("es-ES")}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Fases con más fallos (24h)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.topFailingPhases.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Ninguna fase ha fallado en las últimas 24 horas.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {data.topFailingPhases.map((p) => (
                        <li
                          key={p.phase}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="font-mono">{p.phase}</span>
                          <Badge variant="destructive">{p.count}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Top 5 usuarios por créditos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.topUsers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Aún no hay consumo de créditos registrado.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {data.topUsers.map((u) => (
                        <li
                          key={u.userId}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="truncate max-w-[200px]" title={u.email}>
                            {u.email}
                          </span>
                          <Badge variant="secondary">
                            {u.creditsUsed.toLocaleString("es-ES")}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}

function MetricCard({
  icon,
  title,
  value,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      </CardContent>
    </Card>
  );
}
