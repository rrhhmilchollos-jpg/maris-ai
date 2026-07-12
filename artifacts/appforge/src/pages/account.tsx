/**
 * account.tsx
 *
 * Página "Mi cuenta" — no existía como página propia en Maris AI (solo
 * había un menú desplegable en la barra superior). Es 100% aditiva: usa
 * únicamente hooks que ya existen (useGetMe, Clerk useUser/useClerk) y no
 * modifica ningún endpoint, flujo de pago, generación o dato existente.
 * Es una pantalla de solo lectura + acciones que ya existían en otro
 * sitio (recargar créditos, cerrar sesión) reunidas en un solo lugar.
 */
import { useUser, useClerk } from "@clerk/react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useGetMe } from "@/lib/api-client";
import { CreditCard, LogOut, Calendar, Sparkles, Loader2 } from "lucide-react";

export default function AccountPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const { data: me, isLoading } = useGetMe();

  if (isLoading || !me) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  const memberSince = me.createdAt
    ? new Date(me.createdAt).toLocaleDateString("es-ES", { year: "numeric", month: "long" })
    : null;

  return (
    <Layout>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold mb-6">Mi cuenta</h1>

        <div className="rounded-2xl bg-white/5 border border-white/10 p-6 mb-4">
          <div className="flex items-center gap-4 mb-5">
            <img
              src={user?.imageUrl}
              alt={user?.fullName || "Avatar"}
              className="h-14 w-14 rounded-full object-cover"
            />
            <div>
              <p className="font-medium text-white">{me.fullName || user?.fullName || "Sin nombre"}</p>
              <p className="text-sm text-muted-foreground">{me.email}</p>
              {me.marisId && (
                <p className="text-[11px] text-muted-foreground/60 font-mono mt-0.5">ID: {me.marisId}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Plan actual</p>
              <p className="text-sm font-medium text-white flex items-center gap-1.5">
                {me.isAdmin ? "Admin" : me.planName}
                {me.isPremium && !me.isAdmin && <Sparkles className="h-3.5 w-3.5 text-amber-400" />}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Créditos disponibles</p>
              <p className="text-sm font-medium text-white">{me.isAdmin ? "∞" : me.credits}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Apps generadas</p>
              <p className="text-sm font-medium text-white">{me.appsGenerated}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Cliente desde</p>
              <p className="text-sm font-medium text-white flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                {memberSince || "—"}
              </p>
            </div>
          </div>

          {me.plan !== "free" && me.planExpiresAt && (
            <p className="text-xs text-muted-foreground mt-4 border-t border-white/10 pt-3">
              {me.planActive
                ? `Tu plan se renueva el ${new Date(me.planExpiresAt).toLocaleDateString("es-ES")}.`
                : "Tu plan ha expirado."}
            </p>
          )}

          {me.topUpCreditsExpiresAt && (
            <p className="text-xs text-muted-foreground mt-2 border-t border-white/10 pt-3">
              Tus créditos de recarga caducan el {new Date(me.topUpCreditsExpiresAt).toLocaleDateString("es-ES")}.
            </p>
          )}
        </div>

        <div className="rounded-2xl bg-white/5 border border-white/10 divide-y divide-white/10 overflow-hidden">
          <button
            onClick={() => setLocation("/billing")}
            className="w-full flex items-center gap-3 px-5 py-4 text-sm text-left hover:bg-white/5 transition-colors"
          >
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            Facturación y créditos
          </button>
          <button
            onClick={() => signOut(() => setLocation("/"))}
            className="w-full flex items-center gap-3 px-5 py-4 text-sm text-left text-red-400 hover:bg-red-500/5 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      </div>
    </Layout>
  );
}
