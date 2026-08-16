import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";

const VEYA_APP_ID = "6a7e7b998c2ddda0ecd1f219";
const VEYA_PREVIEW_PATH = `/api/apps/${VEYA_APP_ID}/preview`;
const VEYA_API_BASE = `/api/apps/${VEYA_APP_ID}/aurevia/veya/employee-portal`;

type ApiOptions = RequestInit & { body?: string };

type Bootstrap = {
  bootstrap_token: string;
  employee_code: string;
  totp_secret: string;
};

type Employee = {
  name?: string;
  role?: string;
  department?: string;
};

function readableError(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => typeof item === "string" ? item : item?.msg || item?.message || "Dato no válido")
      .filter(Boolean);
    if (messages.length) return messages.join(" ");
  }
  return fallback;
}

async function employeeApi(path: string, options: ApiOptions = {}) {
  const response = await fetch(`${VEYA_API_BASE}/${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readableError(value.detail, "No se ha podido completar la operación."));
  return value;
}

function VeyaEmployeePortalPage() {
  const [stage, setStage] = useState<"loading" | "login" | "bootstrap" | "totp" | "portal">("loading");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [totp, setTotp] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const loadPortal = async () => {
    try {
      const me = await employeeApi("me");
      setEmployee(me);
      setStage("portal");
    } catch {
      setStage("login");
    }
  };

  useEffect(() => { void loadPortal(); }, []);

  const startLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const value = await employeeApi("login/start", {
        method: "POST",
        body: JSON.stringify({ employee_code: code.trim().toUpperCase(), password }),
      });
      setPendingToken(value.pending_token);
      setStage("totp");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido iniciar el acceso.");
    } finally {
      setLoading(false);
    }
  };

  const verifyTotp = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      await employeeApi("login/verify-totp", {
        method: "POST",
        body: JSON.stringify({ pending_token: pendingToken, totp_code: totp }),
      });
      await loadPortal();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Código del autenticador no válido.");
    } finally {
      setLoading(false);
    }
  };

  const startBootstrap = async () => {
    setLoading(true);
    setNotice("");
    try {
      const value = await employeeApi("bootstrap/start", { method: "POST", body: JSON.stringify({}) });
      setBootstrap(value);
      setCode(value.employee_code);
      setStage("bootstrap");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Inicia sesión en Veya con la cuenta autorizada antes de activar el perfil.");
    } finally {
      setLoading(false);
    }
  };

  const completeBootstrap = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== passwordConfirmation) {
      setNotice("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      const value = await employeeApi("bootstrap/complete", {
        method: "POST",
        body: JSON.stringify({
          bootstrap_token: bootstrap?.bootstrap_token,
          password,
          password_confirmation: passwordConfirmation,
          totp_code: totp,
        }),
      });
      setCode(value.employee_code);
      setPassword("");
      setPasswordConfirmation("");
      setTotp("");
      setBootstrap(null);
      setStage("login");
      setNotice("Acceso activado. Introduce tu código, contraseña y continúa con TOTP.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido completar la activación.");
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await employeeApi("logout", { method: "POST", body: JSON.stringify({}) }).catch(() => undefined);
    setEmployee(null);
    setStage("login");
  };

  return (
    <main className="min-h-[100dvh] bg-[#f7f6ff] text-[#1c1539]">
      <header className="flex items-center justify-between gap-4 border-b border-[#e7e1f7] bg-[#181231] px-5 py-3 text-white md:px-10">
        <a href="/veya" className="flex items-center gap-2 text-sm font-semibold text-white/85 hover:text-white">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#9b7cff] to-[#34d4b6] font-black">V</span>
          Veya
        </a>
        <div className="flex items-center gap-2 text-sm text-white/75"><ShieldCheck className="h-4 w-4 text-[#71e0c5]" /> Portal de empleados</div>
      </header>

      <section className="mx-auto flex min-h-[calc(100dvh-57px)] max-w-5xl items-center justify-center p-5">
        {stage === "loading" && <div className="flex items-center gap-3 rounded-2xl bg-white p-7 shadow-sm"><Loader2 className="h-5 w-5 animate-spin text-[#6544d9]" /> Comprobando sesión de empleado…</div>}

        {stage === "login" && <section className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl shadow-[#3d2a7c]/10 md:p-9">
          <span className="text-xs font-bold tracking-[0.16em] text-[#6544d9]">PORTAL INTERNO VEYA</span>
          <h1 className="mt-2 font-serif text-3xl font-semibold">Acceso de personal</h1>
          <p className="mt-3 text-sm leading-6 text-[#726b87]">Entorno separado para personal autorizado. Usa tu código de empleado, contraseña y autenticador TOTP.</p>
          {notice && <div className="mt-4 rounded-xl bg-[#f4f0ff] px-4 py-3 text-sm text-[#4b337d]">{notice}</div>}
          <form className="mt-6 grid gap-4" onSubmit={startLogin}>
            <label className="grid gap-2 text-sm font-semibold">Código de empleado
              <input name="veya_employee_code" autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ejemplo: VEYA-RRHH-001" className="rounded-xl border border-[#ddd7eb] px-4 py-3 font-normal outline-none focus:border-[#6544d9]" />
            </label>
            <label className="grid gap-2 text-sm font-semibold">Contraseña
              <input name="veya_employee_password" autoComplete="off" required type="password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-xl border border-[#ddd7eb] px-4 py-3 font-normal outline-none focus:border-[#6544d9]" />
            </label>
            <button disabled={loading} className="rounded-xl bg-[#6544d9] px-4 py-3 font-bold text-white disabled:opacity-60">{loading ? "Verificando…" : "Continuar con TOTP"}</button>
          </form>
          <div className="mt-6 border-t border-[#eeeaf6] pt-5">
            <b className="text-sm">¿Es tu primera vez?</b><p className="mt-1 text-xs leading-5 text-[#726b87]">Activa el perfil desde una sesión Veya autorizada. No existen contraseñas maestras ni se envían credenciales por chat.</p>
            <button onClick={startBootstrap} disabled={loading} className="mt-3 rounded-xl border border-[#cfc2ff] px-4 py-2 text-sm font-bold text-[#5134ba] disabled:opacity-60">Activar mi acceso de empleado</button>
          </div>
        </section>}

        {stage === "bootstrap" && <section className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-xl shadow-[#3d2a7c]/10 md:p-9">
          <span className="text-xs font-bold tracking-[0.16em] text-[#6544d9]">ACTIVACIÓN SEGURA</span>
          <h1 className="mt-2 font-serif text-3xl font-semibold">Configura tu acceso interno</h1>
          <p className="mt-3 text-sm leading-6 text-[#726b87]">Crea una contraseña propia y añade la clave temporal en Google Authenticator, Microsoft Authenticator, 1Password u otra aplicación TOTP.</p>
          {notice && <div className="mt-4 rounded-xl bg-[#f4f0ff] px-4 py-3 text-sm text-[#4b337d]">{notice}</div>}
          <div className="mt-5 grid gap-2 rounded-2xl bg-[#f4f0ff] p-4 text-sm"><b>Tu código de empleado</b><code className="rounded-lg bg-[#17112f] p-2 text-white">{bootstrap?.employee_code}</code><b className="mt-2">Clave temporal TOTP</b><code className="break-all rounded-lg bg-[#17112f] p-2 text-white">{bootstrap?.totp_secret}</code></div>
          <form className="mt-6 grid gap-4" onSubmit={completeBootstrap}>
            <label className="grid gap-2 text-sm font-semibold">Contraseña nueva<input autoComplete="new-password" type="password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Al menos 12 caracteres" className="rounded-xl border border-[#ddd7eb] px-4 py-3 font-normal outline-none focus:border-[#6544d9]" /></label>
            <label className="grid gap-2 text-sm font-semibold">Repite la contraseña<input autoComplete="new-password" type="password" required minLength={12} value={passwordConfirmation} onChange={(e) => setPasswordConfirmation(e.target.value)} className="rounded-xl border border-[#ddd7eb] px-4 py-3 font-normal outline-none focus:border-[#6544d9]" /></label>
            <label className="grid gap-2 text-sm font-semibold">Código de 6 dígitos<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} className="rounded-xl border border-[#ddd7eb] px-4 py-3 font-normal outline-none focus:border-[#6544d9]" /></label>
            <button disabled={loading} className="rounded-xl bg-[#6544d9] px-4 py-3 font-bold text-white disabled:opacity-60">{loading ? "Activando…" : "Activar acceso de empleado"}</button>
          </form>
        </section>}

        {stage === "totp" && <section className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl shadow-[#3d2a7c]/10 md:p-9">
          <span className="text-xs font-bold tracking-[0.16em] text-[#6544d9]">VERIFICACIÓN OBLIGATORIA</span><h1 className="mt-2 font-serif text-3xl font-semibold">Confirma tu identidad</h1><p className="mt-3 text-sm leading-6 text-[#726b87]">Introduce el código de seis dígitos de tu autenticador.</p>
          {notice && <div className="mt-4 rounded-xl bg-[#f4f0ff] px-4 py-3 text-sm text-[#4b337d]">{notice}</div>}
          <form className="mt-6 grid gap-4" onSubmit={verifyTotp}><input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} className="rounded-xl border border-[#ddd7eb] px-4 py-3 outline-none focus:border-[#6544d9]" /><button disabled={loading} className="rounded-xl bg-[#6544d9] px-4 py-3 font-bold text-white disabled:opacity-60">{loading ? "Validando…" : "Abrir portal interno"}</button></form>
        </section>}

        {stage === "portal" && <section className="w-full max-w-4xl rounded-3xl bg-white p-7 shadow-xl shadow-[#3d2a7c]/10 md:p-9"><div className="flex flex-wrap items-start justify-between gap-4"><div><span className="text-xs font-bold tracking-[0.16em] text-[#6544d9]">OPERACIONES VEYA · RESTRINGIDO</span><h1 className="mt-2 font-serif text-3xl font-semibold">Hola, {employee?.name || "empleado"}.</h1><p className="mt-2 text-sm text-[#726b87]">{employee?.role || "Perfil autorizado"} · {employee?.department || "Veya"}</p></div><button onClick={logout} className="rounded-xl border border-[#ddd7eb] px-4 py-2 text-sm font-bold">Cerrar sesión</button></div><div className="mt-8 grid gap-4 md:grid-cols-3"><article className="rounded-2xl bg-[#f7f6ff] p-5"><b className="text-2xl">✓</b><p className="mt-2 font-semibold">Sesión interna activa</p><small className="text-[#726b87]">TOTP validado</small></article><article className="rounded-2xl bg-[#f7f6ff] p-5"><b className="text-2xl">CRM</b><p className="mt-2 font-semibold">Datos minimizados</p><small className="text-[#726b87]">Acceso por rol</small></article><article className="rounded-2xl bg-[#f7f6ff] p-5"><b className="text-2xl">Audit</b><p className="mt-2 font-semibold">Trazabilidad activa</p><small className="text-[#726b87]">Sin facultades financieras</small></article></div><p className="mt-7 rounded-xl border border-[#eeeaf6] p-4 text-sm leading-6 text-[#726b87]">Este portal permite revisar expedientes internos según tu rol. No activa IBAN, tarjetas, pagos, movimientos ni productos financieros.</p></section>}
      </section>
    </main>
  );
}

/**
 * Public Veya client entry point. The customer interface continues using the
 * independently versioned bundle through the same-origin Maris proxy.
 */
export default function VeyaPage() {
  const [location] = useLocation();
  const employeePortal = location === "/veya/empleados";
  const previewSource = `${VEYA_PREVIEW_PATH}?portal=customer`;
  const [previewLoaded, setPreviewLoaded] = useState(false);
  useEffect(() => { setPreviewLoaded(false); }, [previewSource]);

  if (employeePortal) return <VeyaEmployeePortalPage />;

  return (
    <main className="min-h-[100dvh] bg-[#110d25] text-white">
      <header className="relative z-10 flex items-center justify-between gap-4 border-b border-white/10 bg-[#181231]/95 px-4 py-3 backdrop-blur md:px-8">
        <a href="/" className="flex items-center gap-2 text-sm font-semibold text-white/80 transition hover:text-white"><span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#9b7cff] to-[#34d4b6] font-black text-white">M</span>Maris AI</a>
        <div className="hidden items-center gap-2 text-sm text-white/70 sm:flex"><ShieldCheck className="h-4 w-4 text-[#71e0c5]" /> Espacio Veya protegido</div>
        <a href="/veya" className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold text-[#23184d] transition hover:bg-[#f0edff]">Espacio Veya <ExternalLink className="h-3.5 w-3.5" /></a>
      </header>
      <section className="relative h-[calc(100dvh-57px)] min-h-[680px] overflow-hidden bg-[#f7f6ff]">
        {!previewLoaded && <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-16 items-center justify-center bg-gradient-to-b from-[#110d25]/25 to-transparent" aria-live="polite"><div className="flex items-center gap-2 rounded-full border border-white/20 bg-[#17112d]/70 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur"><Loader2 className="h-3.5 w-3.5 animate-spin" />Cargando interfaz Veya…</div></div>}
        <iframe title="Veya" src={previewSource} className="h-full w-full border-0 bg-[#f7f6ff]" allow="camera; clipboard-write" referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setPreviewLoaded(true)} />
      </section>
    </main>
  );
}
