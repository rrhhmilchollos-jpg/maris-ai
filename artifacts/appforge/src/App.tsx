import { useEffect, useRef } from "react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { esES } from "@clerk/localizations";

import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { useGetMe, getGetMeQueryKey } from "@/lib/api-client";
import { useUser } from "@clerk/react";
import { Loader2, ShieldAlert } from "lucide-react";

// Pages
import { setSentryUser } from "@/lib/sentry";
import LandingPage from "@/pages/landing";
import DashboardPage from "@/pages/dashboard";
import AppDetailPage from "@/pages/app-detail";
import BillingPage from "@/pages/billing";
import BillingSuccessPage from "@/pages/billing-success";
import AdminPage from "@/pages/admin";
import AdminDashboardPage from "@/pages/admin-dashboard";
import NotFound from "@/pages/not-found";
import DebugPreviewPage from "@/pages/debug-preview";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// ✅ CORREGIDO: usar la clave directamente sin publishableKeyFromHost
// publishableKeyFromHost generaba un proxy automático basado en el dominio de Vercel
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// ✅ CORREGIDO: solo usar proxyUrl si está explícitamente definido
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL || undefined;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
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
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
      setSentryUser(
        user
          ? {
              id: user.id,
              email: user.primaryEmailAddress?.emailAddress,
            }
          : null,
      );
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
        <LandingPage />
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
  const { data: me, isLoading, isError } = useGetMe({
    query: { enabled: isLoaded && !!user, queryKey: getGetMeQueryKey() },
  });

  if (!isLoaded || isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !me?.isAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <ShieldAlert className="h-10 w-10 text-destructive mb-4" />
        <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
          Acceso restringido
        </h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Esta sección es solo para administradores. Si crees que es un error,
          contacta con el equipo de Maris AI.
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
      {...(clerkProxyUrl ? { proxyUrl: clerkProxyUrl } : {})}
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
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          
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

          <Route path="/__debug-preview/:id">
            {(params) => <DebugPreviewPage params={params as { id: string }} />}
          </Route>
          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
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
    </TooltipProvider>
  );
}

export default App;
