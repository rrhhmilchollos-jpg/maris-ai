import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { apiFetch } from "@/lib/api-client";

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string;
  imageUrl?: string;
  createdAt?: string;
  isAdmin?: boolean;
  // Compatibilidad con el shape que usaba @clerk/react en el código existente
  firstName?: string;
  primaryEmailAddress?: { emailAddress: string };
  externalAccounts?: Array<{ provider: string }>;
}

type Listener = (payload: { user: AuthUser | null }) => void;

interface AuthContextValue {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: AuthUser | null;
  signOut: () => Promise<void>;
  refetch: () => Promise<void>;
  addListener: (fn: Listener) => () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [listeners] = useState<Set<Listener>>(() => new Set());

  const notify = useCallback((u: AuthUser | null) => {
    listeners.forEach((fn) => fn({ user: u }));
  }, [listeners]);

  const refetch = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: AuthUser }>("/api/auth/me");
      const normalized: AuthUser = {
        ...data.user,
        firstName: data.user.fullName?.split(" ")[0],
        primaryEmailAddress: { emailAddress: data.user.email },
      };
      setUser(normalized);
      notify(normalized);
    } catch {
      setUser(null);
      notify(null);
    } finally {
      setIsLoaded(true);
    }
  }, [notify]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      notify(null);
      window.location.href = "/";
    }
  }, [notify]);

  const addListener = useCallback((fn: Listener) => {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, [listeners]);

  return (
    <AuthContext.Provider value={{ isLoaded, isSignedIn: !!user, user, signOut, refetch, addListener }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useUser/useClerk/useAuth deben usarse dentro de <AuthProvider>");
  return ctx;
}

// Mismo shape que el useUser() de @clerk/react que ya usaba el resto del código.
export function useUser() {
  const { isLoaded, isSignedIn, user } = useAuthContext();
  return { isLoaded, isSignedIn, user };
}

// Mismo shape que useAuth() de Clerk (usado en landing.tsx).
export function useAuth() {
  const { isLoaded, isSignedIn, signOut } = useAuthContext();
  return { isLoaded, isSignedIn, signOut };
}

// Sustituye a useClerk(): expone signOut() y addListener() (usado en
// layout.tsx, app-detail.tsx, account.tsx, ClerkQueryClientCacheInvalidator).
export function useClerk() {
  const { signOut, addListener } = useAuthContext();
  return { signOut, addListener, openUserProfile: () => { window.location.href = "/account"; } };
}
