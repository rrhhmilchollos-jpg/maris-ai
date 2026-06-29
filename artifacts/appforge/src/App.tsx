import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { trackPageView } from "@/lib/analytics";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, ClerkLoaded, ClerkLoading } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { esES } from "@clerk/localizations";

import { Toaster } from "@/components/ui/toaster";
import { CookieBanner } from "@/components/cookie-banner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { useGetMe, getGetMeQueryKey } from "@/lib/api-client";
import { useUser } from "@clerk/react";
import { Loader2, ShieldAlert } from "lucide-react";

import { setSentryUser } from "@/lib/sentry";
import { usePresence } from "@/hooks/use-presence";

// Pages — lazy loaded para reducir bundle inicial y mejorar LCP/FCP
const LandingPage = lazy(() => import("@/pages/landing"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const AppDetailPage = lazy(() => import("@/pages/app-detail"));
const BillingPage = lazy(() => import("@/pages/billing"));
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
const FisioterapeutaCRM = lazy(() => import("@/pages/crm/fisioterapeuta"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));

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

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  console.error("[Maris AI] VITE_CLERK_PUBLISHABLE_KEY no está definida.");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(272 72% 55%)",
    colorForeground: "hsl(0 0% 98%)",
    colorMutedForeground: "hsl(240 5% 65%)",
    colorBackground: "hsl(240 10% 6%)",
    colorInput: "hsl(240 4% 16%)",
    colorInputForeground: "hsl(0 0% 98%)",
    colorDanger: "hsl(0 62.8% 30.6%)",
    colorNeutral: "hsl(240 4% 16%)",
    fontFamily: "'Space Grotesk', 'Inter', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#0f0f12] rounded-2xl w-[440px] max-w-full overflow-hidden border border-white/10 shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white font-bold tracking-tight",
    headerSubtitle: "text-[#a1a1aa]",
    socialButtonsBlockButtonText: "text-white font-medium",
    formFieldLabel: "text-white font-medium",
    footerActionLink: "text-[#a855f7] hover:text-[#c084fc] transition-colors",
    footerActionText: "text-[#a1a1aa]",
    dividerText: "text-[#a1a1aa]",
    identityPreviewEditButton: "text-[#a855f7]",
    formFieldSuccessText: "text-green-400",
    alertText: "text-white",
    logoBox: "flex justify-center mb-6",
    logoImage: "h-8 w-auto",
    socialButtonsBlockButton: "bg-[#18181b] border border-[#27272a] hover:bg-[#27272a] transition-colors",
    formButtonPrimary: "bg-[#a855f7] hover:bg-[#9333ea] text-white shadow-lg transition-colors font-medium",
    formFieldInput: "bg-[#18181b] border border-[#27272a] text-white focus:ring-2 focus:ring-[#a855f7] focus:border-transparent transition-all",
    footerAction: "bg-[#18181b]/50 py-4 mt-6 border-t border-[#27272a]",
    dividerLine: "bg-[#27272a]",
    alert: "bg-[#7f1d1d]/20 border border-[#7f1d1d]/50",
    otpCodeFieldInput: "bg-[#18181b] border border-[#27272a] text-white focus:ring-2 focus:ring-[#a855f7]",
    formFieldRow: "mb-4",
    main: "p-8",
  },
};

/**
 * ClerkLoadingFallback — Se muestra mientras Clerk está inicializándose.
 * Incluye un mecanismo de timeout: si Clerk no carga en 8 segundos,
 * ofrece al usuario la opción de recargar la página.
 */
function ClerkLoadingFallback() {
  const [showRetry, setShowRetry] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowRetry(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#09090b] px-4">
      <div className="flex flex-col items-center gap-4">
        <img src={`${window.location.origin}${basePath}/logo.svg`} alt="Maris AI" className="h-10 w-auto" />
        <Loader2 className="h-6 w-6 animate-spin text-[#a855f7]" />
        <p className="text-sm text-[#a1a1aa]">Cargando autenticación...</p>
        {showRetry && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-xs text-[#a1a1aa] text-center max-w-xs">
              La carga está tardando más de lo esperado.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-[#a855f7] px-4 py-2 text-sm font-medium text-white hover:bg-[#9333ea] transition-colors"
            >
              Recargar página
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ClerkRecoveryGuard — Detecta cuando Clerk se queda atascado en estado "loading"
 * y fuerza una recarga automática del componente o de la página.
 * 
 * El problema original: clerk.browser.js se carga desde clerk.marisai.es con una
 * redirección 307, lo que puede tardar >10s. Cuando hay una race condition entre
 * la carga del script y la inicialización de React, Clerk se queda en "loading"
 * permanentemente y el formulario de login nunca se renderiza.
 * 
 * Solución: Este componente monitoriza el estado de Clerk y si después de un
 * timeout razonable sigue en "loading", intenta forzar Clerk.load() manualmente.
 * Si eso también falla, recarga la página automáticamente.
 */
function ClerkRecoveryGuard({ children }: { children: React.ReactNode }) {
  const [recovered, setRecovered] = useState(false);
  const attemptedRef = useRef(false);

  useEffect(() => {
    // Verificar periódicamente si Clerk está atascado
    const checkInterval = setInterval(() => {
      const clerk = (window as any).Clerk;
      if (!clerk) return;

      // Si Clerk ya está ready, no hacer nada
      if (clerk.status === "ready" || clerk.loaded === true) {
        clearInterval(checkInterval);
        return;
      }

      // Si Clerk está en "loading" por más de 10 segundos, intentar recuperar
      if (clerk.status === "loading" && !attemptedRef.current) {
        attemptedRef.current = true;
        console.warn("[Maris AI] Clerk atascado en 'loading'. Intentando recuperación...");

        // Intentar forzar la carga
        if (typeof clerk.load === "function") {
          clerk.load().then(() => {
            console.info("[Maris AI] Clerk recuperado exitosamente.");
            setRecovered(true);
            // Forzar re-render de toda la app
            window.dispatchEvent(new Event("clerk-recovered"));
          }).catch(() => {
            console.error("[Maris AI] No se pudo recuperar Clerk. Recargando página...");
            window.location.reload();
          });
        } else {
          // Si no hay método load, recargar
          window.location.reload();
        }
      }
    }, 2000); // Verificar cada 2 segundos

    // Timeout máximo: si después de 15 segundos Clerk no está listo, recargar
    const maxTimeout = setTimeout(() => {
      const clerk = (window as any).Clerk;
      if (clerk && clerk.status !== "ready" && clerk.loaded !== true) {
        console.error("[Maris AI] Timeout máximo alcanzado. Recargando página...");
        window.location.reload();
      }
    }, 15000);

    return () => {
      clearInterval(checkInterval);
      clearTimeout(maxTimeout);
    };
  }, []);

  return <>{children}</>;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#09090b] px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"></div>
      <div className="relative z-10 w-full max-w-md">
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#09090b] px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"></div>
      <div className="relative z-10 w-full max-w-md">
        <SignUp
          routing="path"
          path={`${basePath}/sign-up`}
          signInUrl={`${basePath}/sign-in`}
          fallbackRedirectUrl={`${basePath}/onboarding`}
          forceRedirectUrl={`${basePath}/onboarding`}
        />
      </div>
    </div>
  );
}

function PresenceTracker() {
  usePresence();
  return null;
}

function ClerkQueryClientCacheInvalidator() {
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
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Suspense fallback={<div style={{background:"hsl(240 10% 4%)",minHeight:"100vh"}} />}><LandingPage /></Suspense>
      </Show>
    </>
  );
}

function Gated({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
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

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        ...esES,
        signIn: {
          ...esES.signIn,
          start: {
            ...esES.signIn?.start,
            title: "Bienvenido de nuevo",
            subtitle: "Inicia sesión para entrar a tu espacio de Maris AI",
          },
        },
        signUp: {
          ...esES.signUp,
          start: {
            ...esES.signUp?.start,
            title: "Crea tu cuenta",
            subtitle: "Empieza a construir aplicaciones con IA hoy mismo",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <ClerkRecoveryGuard>
        <ClerkLoading>
          <ClerkLoadingFallback />
        </ClerkLoading>
        <ClerkLoaded>
          <QueryClientProvider client={queryClient}>
            <ClerkQueryClientCacheInvalidator />
            <PresenceTracker />
            <Suspense fallback={<PageLoader />}>
              <Switch>
                <Route path="/" component={HomeRedirect} />
                <Route path="/sign-in/*?" component={SignInPage} />
                <Route path="/sign-up/*?" component={SignUpPage} />

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
        </ClerkLoaded>
      </ClerkRecoveryGuard>
    </ClerkProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
      <CookieBanner />
    </TooltipProvider>
  );
}

export default App;
