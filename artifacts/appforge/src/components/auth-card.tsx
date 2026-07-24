import { useState } from "react";
import { Link, useLocation } from "wouter";
import { apiFetch, getApiBaseUrl } from "@/lib/api-client";
import { Loader2 } from "lucide-react";

const API_BASE = getApiBaseUrl();

export function AuthCard({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsReset, setNeedsReset] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsReset(false);
    setLoading(true);
    try {
      if (mode === "sign-up") {
        await apiFetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, fullName }),
        });
        window.location.href = "/onboarding";
      } else {
        await apiFetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        window.location.href = "/dashboard";
      }
    } catch (err: any) {
      const code = err?.body?.code || err?.code;
      if (code === "PASSWORD_RESET_REQUIRED") {
        setNeedsReset(true);
      } else {
        setError(err?.body?.error || err?.message || "Ha ocurrido un error. Inténtalo de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#0f0f12] rounded-2xl w-[440px] max-w-full overflow-hidden border border-white/10 shadow-2xl p-8">
      <h1 className="text-white font-bold tracking-tight text-xl mb-1">
        {mode === "sign-up" ? "Crea tu cuenta" : "Inicia sesión"}
      </h1>
      <p className="text-[#a1a1aa] text-sm mb-6">
        {mode === "sign-up" ? "Empieza a crear apps con Maris AI" : "Bienvenido de nuevo a Maris AI"}
      </p>

      <div className="flex flex-col gap-2 mb-4">
        <a
          href={`${API_BASE}/api/auth/google`}
          className="flex items-center justify-center gap-2 rounded-md bg-[#18181b] border border-[#27272a] hover:bg-[#27272a] transition-colors py-2.5 text-white font-medium text-sm"
        >
          Continuar con Google
        </a>
        <a
          href={`${API_BASE}/api/auth/github`}
          className="flex items-center justify-center gap-2 rounded-md bg-[#18181b] border border-[#27272a] hover:bg-[#27272a] transition-colors py-2.5 text-white font-medium text-sm"
        >
          Continuar con GitHub
        </a>
      </div>

      <div className="flex items-center gap-3 my-4">
        <div className="h-px flex-1 bg-[#27272a]" />
        <span className="text-[#a1a1aa] text-xs">o con tu email</span>
        <div className="h-px flex-1 bg-[#27272a]" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {mode === "sign-up" && (
          <div>
            <label className="text-white font-medium text-sm block mb-1">Nombre</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-[#18181b] border border-[#27272a] text-white rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[#a855f7] focus:border-transparent transition-all"
            />
          </div>
        )}
        <div>
          <label className="text-white font-medium text-sm block mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-[#18181b] border border-[#27272a] text-white rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[#a855f7] focus:border-transparent transition-all"
          />
        </div>
        <div>
          <label className="text-white font-medium text-sm block mb-1">Contraseña</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-[#18181b] border border-[#27272a] text-white rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[#a855f7] focus:border-transparent transition-all"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {needsReset && (
          <div className="rounded-md bg-[#7f1d1d]/20 border border-[#7f1d1d]/50 p-3">
            <p className="text-sm text-white">
              Hemos actualizado nuestro sistema de acceso. Necesitas establecer una nueva contraseña.
            </p>
            <Link href="/forgot-password" className="text-[#a855f7] text-sm font-medium underline">
              Restablecer contraseña
            </Link>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="bg-[#a855f7] hover:bg-[#9333ea] text-white shadow-lg transition-colors font-medium rounded-md py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "sign-up" ? "Crear cuenta" : "Entrar"}
        </button>
      </form>

      <div className="bg-[#18181b]/50 py-4 mt-6 -mx-8 -mb-8 border-t border-[#27272a] text-center">
        {mode === "sign-up" ? (
          <p className="text-[#a1a1aa] text-sm">
            ¿Ya tienes cuenta?{" "}
            <Link href="/sign-in" className="text-[#a855f7] hover:text-[#c084fc] transition-colors font-medium">
              Inicia sesión
            </Link>
          </p>
        ) : (
          <p className="text-[#a1a1aa] text-sm">
            ¿No tienes cuenta?{" "}
            <Link href="/sign-up" className="text-[#a855f7] hover:text-[#c084fc] transition-colors font-medium">
              Regístrate
            </Link>
            {" · "}
            <Link href="/forgot-password" className="text-[#a855f7] hover:text-[#c084fc] transition-colors font-medium">
              Olvidé mi contraseña
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
