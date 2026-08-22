import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wifi, RefreshCw, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface OnlineUser {
  userId: string;
  email: string | null;
  fullName: string | null;
  imageUrl: string | null;
  sockets: number;
  connectedAt: string;
  lastActivityAt: string;
  currentPage: string | null;
}

interface PresenceResponse {
  count: number;
  online: OnlineUser[];
}

/**
 * Clientes en vivo — quién tiene Maris AI abierto AHORA MISMO.
 *
 * El backend mantiene el estado real en memoria vía socket.io (ver
 * lib/presence.ts en el servidor); este panel solo consulta ese estado
 * por HTTP cada pocos segundos, no abre su propio WebSocket — es
 * suficiente para una vista de monitorización admin, sin duplicar
 * complejidad de conexión en tiempo real en dos sitios distintos.
 */
export function AdminPresencePanel() {
  const [data, setData] = useState<PresenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await apiFetch<PresenceResponse>("/api/admin/presence");
      setData(result);
      setError(null);
    } catch (err) {
      setError("No se pudo cargar la presencia en vivo.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ENCONTRADO: el botón de refrescar ya llamaba a load() correctamente al
  // pulsarlo (el onClick estaba bien conectado), pero no daba NINGUNA señal
  // visual de que algo había pasado — sin animación, sin estado de carga —
  // así que, salvo que el número de usuarios conectados cambiara justo en
  // ese instante, parecía que el botón "no hacía nada" aunque sí estuviera
  // refrescando el dato por debajo. FIX: estado refreshing dedicado para la
  // pulsación manual (distinto de loading, que es solo la carga inicial),
  // que gira el icono y deshabilita el botón mientras dura la petición —
  // un mínimo de 400ms de giro incluso si la respuesta es instantánea, para
  // que el feedback sea perceptible y no parpadee de forma casi invisible.
  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    const start = Date.now();
    await load();
    const elapsed = Date.now() - start;
    const MIN_VISIBLE_MS = 400;
    if (elapsed < MIN_VISIBLE_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_VISIBLE_MS - elapsed));
    }
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="bg-card/40 border border-white/5">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wifi className="h-4 w-4 text-emerald-400" />
              Clientes conectados ahora mismo
            </CardTitle>
            <CardDescription>
              Clientes con Maris AI abierto en este instante. Muestra la actividad operativa sin exponer el contenido de sus proyectos y se actualiza cada 5 s.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={handleManualRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!error && (
            <div className="text-3xl font-bold text-white">
              {data?.count ?? 0}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                {data?.count === 1 ? "usuario en línea" : "usuarios en línea"}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.online.length > 0 && (
        <div className="space-y-2">
          {data.online.map((u) => (
            <Card key={u.userId} className="bg-card/40 border border-white/5">
              <CardContent className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {u.fullName || u.email || u.userId}
                    </p>
                    {u.email && u.fullName && (
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    )}
                  </div>
                  {u.sockets > 1 && (
                    <Badge variant="secondary" className="shrink-0">{u.sockets} pestañas</Badge>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {u.currentPage && (
                    <p className="text-xs text-muted-foreground font-mono truncate max-w-[220px]">{u.currentPage}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Conectado desde {formatDistanceToNow(new Date(u.connectedAt), { locale: es, addSuffix: true })}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data && data.online.length === 0 && !error && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No hay ningún usuario conectado ahora mismo.
        </p>
      )}
    </div>
  );
}
