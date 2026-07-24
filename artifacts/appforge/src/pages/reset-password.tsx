import { useState } from "react";
import { Link } from "wouter";
import { apiFetch } from "@/lib/api-client";
import { Loader2 } from "lucide-react";

export default function ResetPasswordPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const email = params.get("email") || "";

  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, newPassword }),
      });
      setDone(true);
      setTimeout(() => { window.location.href = "/dashboard"; }, 1500);
    } catch (err: any) {
      setError(err?.body?.error || err?.message || "El enlace no es válido o ha caducado.");
    } finally {
      setLoading(false);
    }
  }

  if (!token || !email) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#09090b] px-4">
        <p className="text-white/80 text-sm">Enlace inválido. Solicita uno nuevo desde "Olvidé mi contraseña".</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#09090b] px-4">
      <div className="bg-[#0f0f12] rounded-2xl w-[440px] max-w-full border border-white/10 shadow-2xl p-8">
        <h1 className="text-white font-bold tracking-tight text-xl mb-1">Crea tu nueva contraseña</h1>
        <p className="text-[#a1a1aa] text-sm mb-6">Para la cuenta {email}</p>
        {done ? (
          <p className="text-sm text-green-400">Contraseña actualizada. Entrando...</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input
              type="password"
              required
              minLength={8}
              placeholder="Nueva contraseña (mínimo 8 caracteres)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-[#18181b] border border-[#27272a] text-white rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[#a855f7] focus:border-transparent transition-all"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="bg-[#a855f7] hover:bg-[#9333ea] text-white shadow-lg transition-colors font-medium rounded-md py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar contraseña
            </button>
          </form>
        )}
        <p className="text-[#a1a1aa] text-sm mt-6 text-center">
          <Link href="/sign-in" className="text-[#a855f7] hover:text-[#c084fc] transition-colors font-medium">
            Volver a inicio de sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
