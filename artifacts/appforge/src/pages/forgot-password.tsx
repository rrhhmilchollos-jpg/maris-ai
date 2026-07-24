import { useState } from "react";
import { Link, useLocation } from "wouter";
import { apiFetch } from "@/lib/api-client";
import { Loader2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      setLoading(false);
      setSent(true); // se muestra igual haya o no cuenta, por seguridad
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#09090b] px-4">
      <div className="bg-[#0f0f12] rounded-2xl w-[440px] max-w-full border border-white/10 shadow-2xl p-8">
        <h1 className="text-white font-bold tracking-tight text-xl mb-1">Restablecer contraseña</h1>
        <p className="text-[#a1a1aa] text-sm mb-6">
          Te enviaremos un enlace por email para crear una nueva contraseña.
        </p>
        {sent ? (
          <p className="text-sm text-green-400">
            Si existe una cuenta con ese email, recibirás un enlace en breve. Revisa también spam.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input
              type="email"
              required
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#18181b] border border-[#27272a] text-white rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-[#a855f7] focus:border-transparent transition-all"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-[#a855f7] hover:bg-[#9333ea] text-white shadow-lg transition-colors font-medium rounded-md py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Enviar enlace
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
