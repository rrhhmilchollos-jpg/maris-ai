import { Link, useLocation } from "wouter";
import { Show, useClerk, useUser } from "@clerk/react";
import { useGetMe, getGetMeQueryKey, getListAppsQueryKey, getGetMyStatsQueryKey } from "@/lib/api-client";
import { apiFetch } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { CreditBar } from "@/components/credit-bar";
import { LogOut, CreditCard, LayoutDashboard, Shield, BellRing } from "lucide-react";

/**
 * NotificationsBell — ENCONTRADO A PETICIÓN DEL USUARIO (caso real:
 * capturas mostrando avisos de soporte sueltos, ocupando toda la parte de
 * arriba de la pantalla de inicio del panel, en vez de vivir dentro de un
 * icono de campanita como en cualquier producto normal). Movido aquí, al
 * layout compartido, para que aparezca en TODAS las páginas con sesión
 * iniciada, no solo en el dashboard -- misma lógica de carga/descarte que
 * ya existía en dashboard.tsx, reutilizada tal cual.
 */
function NotificationsBell() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const prevNotifIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const fetchNotifs = async () => {
      try {
        const data = await apiFetch<any>("/api/notifications");
        const unread = (data.notifications || []).filter((n: any) => !n.read);
        setNotifications(unread);
        const newSupportNotifs = unread.filter(
          (n: any) => n.type === "support_patch" && !prevNotifIdsRef.current.has(n._id)
        );
        if (newSupportNotifs.length > 0) {
          queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        }
        prevNotifIdsRef.current = new Set(unread.map((n: any) => n._id));
      } catch { /* silencioso */ }
    };
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 5000);
    return () => clearInterval(interval);
  }, [queryClient]);

  const dismissNotif = async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n._id !== id));
    try { await apiFetch<any>(`/api/notifications/${id}/read`, { method: "PATCH" }); } catch { /* silencioso */ }
  };

  // Deduplicación real: mismo appId + mismo mensaje exacto = mismo aviso,
  // solo se muestra una vez, sin importar cuántas veces exista de verdad
  // en la base de datos (mismo criterio ya aplicado antes en dashboard.tsx).
  const uniqueNotifications = notifications.filter(
    (n, idx, arr) => arr.findIndex((o) => o.appId === n.appId && o.message === n.message) === idx
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <BellRing className="h-5 w-5 text-foreground/70" />
          {uniqueNotifications.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-violet-500 text-[10px] font-bold text-white flex items-center justify-center">
              {uniqueNotifications.length > 9 ? "9+" : uniqueNotifications.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-96 max-h-[70vh] overflow-y-auto" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">Mis notificaciones</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {uniqueNotifications.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">Sin notificaciones nuevas</div>
        ) : (
          uniqueNotifications.map((notif) => (
            <div key={notif._id} className="px-3 py-2.5 border-b border-border/40 last:border-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-violet-400 flex items-center gap-1.5 flex-wrap">
                  Actualización del equipo de soporte
                  {notif.appTitle && (
                    <span className="text-[10px] font-mono bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded-full">
                      {notif.appTitle}
                    </span>
                  )}
                </p>
                <button onClick={() => dismissNotif(notif._id)} className="text-muted-foreground hover:text-foreground shrink-0 text-xs">✕</button>
              </div>
              <p className="text-xs text-foreground/80 mt-1 leading-relaxed">{String(notif.message || "").replace(/\*\*/g, "")}</p>
              {notif.appId && (
                <button
                  onClick={() => { setOpen(false); setLocation(`/apps/${notif.appId}`); }}
                  className="mt-1.5 text-[11px] text-violet-400 hover:text-violet-300 font-medium"
                >
                  Ver mi app actualizada →
                </button>
              )}
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { data: me } = useGetMe({ query: { enabled: !!user, queryKey: getGetMeQueryKey() } });
  const isOwner = user?.primaryEmailAddress?.emailAddress === "rrhh.milchollos@gmail.com";
  const isAdmin = me?.isAdmin || isOwner;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-auto md:h-14 max-w-screen-2xl items-center flex-col md:flex-row gap-2 md:gap-0 py-2 md:py-0">
          <div className="flex px-4 md:px-8 w-full items-center justify-between">
            <Link href="/" className="flex items-center space-x-2">
              <img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/logo.svg`} alt="Maris AI" className="h-6 w-6" />
              <span className="font-bold sm:inline-block tracking-tight text-lg bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                Maris AI
              </span>
            </Link>

            <div className="flex items-center space-x-4 w-full md:w-auto">
              <Show when="signed-in">
                <nav className="flex items-center space-x-4 text-sm font-medium">
                  <Link href="/dashboard" className="transition-colors hover:text-foreground/80 text-foreground/60">
                    Panel
                  </Link>
                  <Link href="/billing" className="transition-colors hover:text-foreground/80 text-foreground/60">
                    Recargar créditos
                  </Link>
                  {isAdmin && (
                    <Link href="/admin" className="transition-colors hover:text-primary text-primary/80 font-semibold flex items-center gap-1">
                      <Shield className="h-3.5 w-3.5" /> Admin
                    </Link>
                  )}
                </nav>
                
                {me && (
                  <div className="hidden sm:block">
                    <CreditBar />
                  </div>
                )}

                <NotificationsBell />

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user?.imageUrl} alt={user?.fullName || ""} />
                        <AvatarFallback>{user?.firstName?.charAt(0) || "U"}</AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user?.fullName}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {user?.primaryEmailAddress?.emailAddress}
                        </p>
                        <p className="text-xs leading-none text-muted-foreground opacity-50 mt-1 font-mono select-all">
                          ID: {user?.id}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setLocation("/dashboard")}>
                      <LayoutDashboard className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>Panel</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setLocation("/billing")}>
                      <CreditCard className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>Recargar créditos</span>
                    </DropdownMenuItem>
                    {isAdmin && (
                      <DropdownMenuItem onClick={() => setLocation("/admin")}>
                        <Shield className="mr-2 h-4 w-4 text-primary" />
                        <span>Panel admin</span>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => signOut(() => setLocation("/"))}>
                      <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>Cerrar sesión</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Show>

              <Show when="signed-out">
                <Link href="/sign-in" className="text-sm font-medium transition-colors hover:text-foreground/80 text-foreground/60">
                  Iniciar Sesión
                </Link>
                <Link href="/sign-up">
                  <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">Empieza Gratis</Button>
                </Link>
              </Show>
            </div>
          </div>
        </div>
        <Show when="signed-in">
          {/* Mobile credit bar */}
          <div className="sm:hidden w-full px-4 pb-2">
            <CreditBar />
          </div>
        </Show>
      </header>

      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
