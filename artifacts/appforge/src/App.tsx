import { Component, useEffect, useRef, useState, useCallback, lazy, Suspense, type ReactNode } from "react";
import { trackPageView } from "@/lib/analytics";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { AuthProvider, useUser, useClerk } from "@/lib/auth-context";
import { AuthCard } from "@/components/auth-card";

import { Toaster } from "@/components/ui/toaster";
import { CookieBanner } from "@/components/cookie-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MaintenanceGate } from "@/components/maintenance-gate";

import { useGetMe, getGetMeQueryKey } from "@/lib/api-client";
import { Loader2, ShieldAlert } from "lucide-react";

import { setSentryUser } from "@/lib/sentry";
import { usePresence } from "@/hooks/use-presence";

// Pages — lazy loaded para reducir bundle inicial y mejorar LCP/FCP
const LandingPage = lazy(() => import("@/pages/landing"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const AppDetailPage = lazy(() => import("@/pages/app-detail"));
const BillingPage = lazy(() => import("@/pages/billing"));
const AccountPage = lazy(() => import("@/pages/account"));
const BillingSuccessPage = lazy(() => import("@/pages/billing-success"));
const AdminPage = lazy(() => import("@/pages/admin"));
const AdminDashboardPage = lazy(() => import("@/pages/admin-dashboard"));
const NotFound = lazy(() => import("@/pages/not-found"));
const DebugPreviewPage = lazy(() => import("@/pages/debug-preview"));
const NewsPage = lazy(() => import("@/pages/news"));
const NewsDetailPage = lazy(() => import("@/pages/news-detail"));
const VsCompetidoresPage = lazy(() => import("@/pages/vs-emergent"));
const VsLovablePage = lazy(() => import("@/pages/vs-lovable"));
const VsBoltPage = lazy(() => import("@/pages/vs-bolt"));
const VsBase44Page = lazy(() => import("@/pages/vs-base44"));
const PricingPage = lazy(() => import("@/pages/pricing"));
const PrivacidadPage = lazy(() => import("@/pages/legal/privacidad"));
const AvisoLegalPage = lazy(() => import("@/pages/legal/aviso-legal"));
const CookiesPage = lazy(() => import("@/pages/legal/cookies"));
const GlossaryPage = lazy(() => import("@/pages/glosario"));
const QueEsVibeCodingPage = lazy(() => import("@/pages/que-es-vibe-coding"));
const QueEsAgenteIaPage = lazy(() => import("@/pages/que-es-un-agente-de-ia"));
const DesarrolloNoCodeGuiaPage = lazy(() => import("@/pages/desarrollo-no-code-guia"));
const ShowcasePage = lazy(() => import("@/pages/showcase"));
const ShowcaseDetailPage = lazy(() => import("@/pages/showcase-detail"));
const DemoPage = lazy(() => import("@/pages/demo"));
const AfiliadosPage = lazy(() => import("@/pages/afiliados"));
const FisioterapeutaCRM = lazy(() => import("@/pages/crm/fisioterapeuta"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const ForgotPasswordPage = lazy(() => import("@/pages/forgot-password"));
const ResetPasswordPage = lazy(() => import("@/pages/reset-password"));
const VeyaPage = lazy(() => import("@/pages/veya"));

function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

function SuspendedRoute({ component: Component, ...props }: any) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component {...props} />
    </Suspense>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#09090b] px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"></div>
      <div className="relative z-10 w-full max-w-md">
        <AuthCard mode="sign-in" />
      </div>
    </div>
  );
}

function SignUpPage() {
  // ENCONTRADO A PETICIÓN DEL USUARIO (investigación del 70% de abandono
  // entre form_start y generate_app en la landing): quien escribe su idea
  // y pulsa "Generar App" sin sesión iniciada aterriza aquí, en un
  // formulario de registro genérico que no reconoce en absoluto lo que
  // acaba de escribir -- sensación de "muro frío" justo en el punto de
  // mayor fricción del embudo. Se añade un mensaje breve que confirma que
  // su idea ya está guardada, para que la conexión entre "escribí algo" y
  // "ahora regístrate" sea explícita, no un salto de contexto sin
  // explicación.
  const [pendingPrompt] = useState<string | null>(() => {
    try { return localStorage.getItem("appforge_pending_prompt"); } catch { return null; }
  });
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#09090b] px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"></div>
      <div className="relative z-10 w-full max-w-md">
        {pendingPrompt && (
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-center">
            <p className="text-sm text-white/90">
              ✨ Tu idea ya está guardada — crea tu cuenta gratis para verla cobrar vida:
            </p>
            <p className="mt-1 text-xs text-primary font-medium line-clamp-2">"{pendingPrompt}"</p>
          </div>
        )}
        <AuthCard mode="sign-up" />
      </div>
    </div>
  );
}

/**
 * PresenceTracker envuelto en su propio error boundary aislado.
 * Si Socket.io falla (WebSocket cerrado, token inválido, red caída),
 * el error se captura aquí y NO se propaga al ErrorBoundary global
 * que tumbaría toda la aplicación con "Error de autenticación".
 */
function PresenceTracker() {
  usePresence();
  return null;
}

/**
 * Wrapper que aísla completamente los errores de PresenceTracker.
 * Usa un mini error boundary inline que simplemente renderiza null
 * si hay un error — presencia es best-effort, no crítica.
 */
class PresenceErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    // Silenciar completamente — presencia es opcional
    console.debug("[Maris AI] Error de presencia silenciado:", error?.message);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function SafePresenceTracker() {
  return (
    <PresenceErrorBoundary>
      <PresenceTracker />
    </PresenceErrorBoundary>
  );
}

function AuthQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
      setSentryUser(user ? { id: user.id, email: user.primaryEmailAddress?.emailAddress } : null);

      if (user) {
        const createdAt = user.createdAt ? new Date(user.createdAt).getTime() : 0;
        const isNewUser = Date.now() - createdAt < 2 * 60 * 1000;
        if (isNewUser) {
          import("@/lib/analytics").then(({ trackSignUp }) => {
            const userEmail = user.primaryEmailAddress?.emailAddress;
            trackSignUp(user.id, user.externalAccounts?.[0]?.provider || "email", userEmail);
          });
        }
      }
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  // ENCONTRADO A PETICIÓN DEL USUARIO (fallo real y urgente en producción:
  // la ruta "/" mostraba la página 404 "No encontrada" para CUALQUIER
  // visitante, confirmado con una petición real y directa a
  // https://www.marisai.es/, no solo para Google). Causa más probable,
  // respaldada por la propia documentación oficial de Clerk: <Show
  // when="signed-in"> y <Show when="signed-out"> pueden no cubrir de
  // forma fiable el estado "todavía cargando" durante la resolución
  // inicial de la sesión -- Clerk recomienda EXPLÍCITAMENTE usar
  // useAuth()/useUser() con isLoaded para cualquier decisión de
  // enrutamiento crítica, en vez de <Show>, precisamente para evitar
  // este tipo de ambigüedad. Sustituido por el patrón oficial
  // recomendado: se espera a isLoaded antes de decidir nada, sin
  // renderizar contenido ambiguo mientras tanto.
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) {
    return <div style={{background:"hsl(240 10% 4%)",minHeight:"100vh"}} />;
  }
  if (isSignedIn) {
    return <Redirect to="/dashboard" />;
  }
  return (
    <Suspense fallback={<div style={{background:"hsl(240 10% 4%)",minHeight:"100vh"}} />}>
      <LandingPage />
    </Suspense>
  );
}

function Gated({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) {
    return <div style={{ background: "hsl(240 10% 4%)", minHeight: "100vh" }} />;
  }
  if (!isSignedIn) {
    return <Redirect to="/" />;
  }
  return <>{children}</>;
}

function AdminGuardInner({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const [location] = useLocation();

  useEffect(() => {
    trackPageView(location);
  }, [location]);

  const { data: me, isLoading, isError } = useGetMe({
    query: { enabled: isLoaded && !!user, queryKey: getGetMeQueryKey(), retry: 3, retryDelay: 2000 },
  });

  if (!isLoaded || isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isError && me && !me.isAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <ShieldAlert className="h-10 w-10 text-destructive mb-4" />
        <h2 className="text-2xl font-bold tracking-tight text-white mb-2">Acceso restringido</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Esta sección es solo para administradores.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

function AdminGated({ children }: { children: React.ReactNode }) {
  return (
    <Gated>
      <AdminGuardInner>{children}</AdminGuardInner>
    </Gated>
  );
}

function AppRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthQueryClientCacheInvalidator />
      <SafePresenceTracker />
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/forgot-password" component={ForgotPasswordPage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route path="/veya/empleados"><VeyaPage /></Route>
          <Route path="/veya"><VeyaPage /></Route>

                <Route path="/onboarding">
                  <Gated><OnboardingPage /></Gated>
                </Route>

                <Route path="/dashboard">
                  <Gated><DashboardPage /></Gated>
                </Route>

                <Route path="/app/:id">
                  {(params) => <Gated><AppDetailPage params={params} /></Gated>}
                </Route>

                <Route path="/billing">
                  <Gated><BillingPage /></Gated>
                </Route>

                <Route path="/account">
                  <Gated><AccountPage /></Gated>
                </Route>

                <Route path="/billing/success">
                  <Gated><BillingSuccessPage /></Gated>
                </Route>

                <Route path="/admin">
                  <AdminGated><AdminPage /></AdminGated>
                </Route>

                <Route path="/admin/jobs">
                  <AdminGated><AdminPage initialTab="queue" /></AdminGated>
                </Route>

                <Route path="/admin/memory">
                  <AdminGated><AdminPage initialTab="memory" /></AdminGated>
                </Route>

                <Route path="/admin/dashboard">
                  <AdminGated><AdminDashboardPage /></AdminGated>
                </Route>

                <Route path="/news">
                  <NewsPage />
                </Route>

                <Route path="/news/:slug">
                  <NewsDetailPage />
                </Route>

                {/* ── Páginas de comparativa SEO ─────────────────────────── */}
                <Route path="/vs-emergent">
                  <VsCompetidoresPage />
                </Route>

                <Route path="/vs-lovable">
                  <VsLovablePage />
                </Route>

                <Route path="/vs-bolt">
                  <VsBoltPage />
                </Route>

                <Route path="/vs-base44">
                  <VsBase44Page />
                </Route>

                <Route path="/pricing">
                  <PricingPage />
                </Route>

                <Route path="/glosario">
                  <GlossaryPage />
                </Route>

                <Route path="/que-es-vibe-coding">
                  <QueEsVibeCodingPage />
                </Route>

                <Route path="/que-es-un-agente-de-ia">
                  <QueEsAgenteIaPage />
                </Route>

                <Route path="/desarrollo-no-code-guia">
                  <DesarrolloNoCodeGuiaPage />
                </Route>

                <Route path="/showcase/:slug">
                  <ShowcaseDetailPage />
                </Route>

                <Route path="/showcase">
                  <ShowcasePage />
                </Route>

                {/* Demo pública — sin autenticación, cualquier visitante puede verla */}
                <Route path="/demo">
                  <DemoPage />
                </Route>

                {/* Programa de afiliados — pública con panel para usuarios logados */}
                <Route path="/afiliados">
                  <AfiliadosPage />
                </Route>

                <Route path="/crm/fisioterapeuta">
                  <FisioterapeutaCRM />
                </Route>

                <Route path="/legal/privacidad">
                  <PrivacidadPage />
                </Route>

                <Route path="/legal/aviso-legal">
                  <AvisoLegalPage />
                </Route>

                <Route path="/legal/cookies">
                  <CookiesPage />
                </Route>

                <Route path="/__debug-preview/:id">
                  {(params) => <DebugPreviewPage params={params as { id: string }} />}
                </Route>

                <Route component={NotFound} />
        </Switch>
      </Suspense>
          </QueryClientProvider>
  );
}

function App() {
  // Capturar el código de afiliado de la URL (?ref=XXXX) y guardarlo en
  // localStorage para usarlo en el onboarding al registrarse
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref && ref.length >= 6 && ref.length <= 12) {
        localStorage.setItem("maris_ref", ref.toUpperCase());
      }
    } catch {}
  }, []);

  return (
    <TooltipProvider>
      <AuthProvider>
        <WouterRouter base={basePath}>
          <AppRoutes />
        </WouterRouter>
      </AuthProvider>
      <Toaster />
      <CookieBanner />
    </TooltipProvider>
  );
}

export default App;
