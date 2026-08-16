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

  useEffect(() => {
    if (stage !== "login") return;
    const clearAutofill = () => {
      setCode("");
      setPassword("");
      document.querySelectorAll<HTMLInputElement>('input[data-veya-employee-login="true"]').forEach((input) => {
        input.value = "";
      });
    };
    clearAutofill();
    const timer = window.setTimeout(clearAutofill, 350);
    return () => window.clearTimeout(timer);
  }, [stage]);

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
              <input name="veya_employee_code_9c2d" autoComplete="new-password" data-veya-employee-login="true" data-lpignore="true" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ejemplo: VEYA-RRHH-001" className="rounded-xl border border-[#ddd7eb] px-4 py-3 font-normal outline-none focus:border-[#6544d9]" />
            </label>
            <label className="grid gap-2 text-sm font-semibold">Contraseña
              <input name="veya_employee_password_9c2d" autoComplete="new-password" data-veya-employee-login="true" data-lpignore="true" required type="password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-xl border border-[#ddd7eb] px-4 py-3 font-normal outline-none focus:border-[#6544d9]" />
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

type VeyaClient = { name?: string; first_name?: string; full_name?: string; email?: string };
type VeyaAccount = { balance?: number; available_balance?: number; currency?: string; iban?: string; status?: string };
type VeyaRequest = { request_id?: string; reference?: string; request_type?: string; status?: string; created_at?: string };

const VEYA_CLIENT_API = `/api/apps/${VEYA_APP_ID}/aurevia`;

async function clientApi(path: string, options: ApiOptions = {}) {
  const response = await fetch(`${VEYA_CLIENT_API}${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readableError(value.detail, "No se ha podido completar la operación."));
  return value;
}

function money(value: unknown, currency = "EUR") {
  const number = typeof value === "number" ? value : Number(value || 0);
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(Number.isFinite(number) ? number : 0);
}

function VeyaNativeClientPage() {
  const [stage, setStage] = useState<"welcome" | "login" | "dashboard">("welcome");
  const [dni, setDni] = useState("");
  const [password, setPassword] = useState("");
  const [client, setClient] = useState<VeyaClient | null>(null);
  const [account, setAccount] = useState<VeyaAccount | null>(null);
  const [requests, setRequests] = useState<VeyaRequest[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const loadWorkspace = async () => {
    const [accountsResult, requestsResult] = await Promise.allSettled([
      clientApi("/veya/banking/accounts"),
      clientApi("/operations/requests"),
    ]);
    if (accountsResult.status === "fulfilled") {
      const result = accountsResult.value;
      const list = Array.isArray(result) ? result : result.accounts || [];
      setAccount(list[0] || result.account || null);
    }
    if (requestsResult.status === "fulfilled") {
      const result = requestsResult.value;
      setRequests(Array.isArray(result) ? result : result.requests || []);
    }
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const result = await clientApi("/auth/login-dni-password", {
        method: "POST",
        body: JSON.stringify({ dni: dni.trim().toUpperCase(), password }),
      });
      setClient(result.customer || result.user || result.client || { name: result.name });
      setPassword("");
      setStage("dashboard");
      await loadWorkspace();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido validar el acceso.");
    } finally {
      setLoading(false);
    }
  };

  const displayName = client?.first_name || client?.name || client?.full_name || "cliente";
  const balance = account?.available_balance ?? account?.balance ?? 0;
  const currency = account?.currency || "EUR";

  if (stage === "welcome") {
    return <main className="min-h-[100dvh] bg-[#f7f6ff] text-[#1c1539]">
      <header className="flex items-center justify-between border-b border-[#e7e1f7] bg-[#181231] px-5 py-4 text-white md:px-10"><a href="/" className="flex items-center gap-2 text-sm font-semibold text-white/85"><span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[#9b7cff] to-[#34d4b6] font-black">V</span>Veya</a><a href="/veya/empleados" className="text-xs text-white/70 hover:text-white">Portal de empleados</a></header>
      <section className="mx-auto grid min-h-[calc(100dvh-65px)] max-w-6xl items-center gap-10 px-5 py-14 md:grid-cols-[1.15fr_.85fr] md:px-10"><div><span className="inline-flex rounded-full bg-[#eee9ff] px-3 py-1 text-xs font-bold tracking-wide text-[#5134ba]">VEYA · ESPACIO DE CLIENTE</span><h1 className="mt-5 max-w-xl font-serif text-5xl font-semibold leading-[.98] tracking-tight md:text-7xl">Tu trabajo mueve.<br />Tu banca acompaña.</h1><p className="mt-6 max-w-xl text-lg leading-8 text-[#706989]">Una experiencia financiera clara para autónomos y microempresas. Consulta tu actividad, registra gestiones y prepara tus productos desde un único espacio protegido.</p><div className="mt-8 flex flex-wrap gap-3"><button onClick={() => setStage("login")} className="rounded-xl bg-[#6544d9] px-5 py-3 font-bold text-white shadow-lg shadow-[#6544d9]/20">Acceder a Veya</button><button onClick={() => setNotice("El alta se completa con verificación de identidad y revisión de elegibilidad.")} className="rounded-xl border border-[#d8d0ee] bg-white px-5 py-3 font-bold text-[#3d2a7c]">Solicitar acceso</button></div>{notice && <p className="mt-5 max-w-xl rounded-xl bg-white p-4 text-sm text-[#5f5873] shadow-sm">{notice}</p>}</div><aside className="rounded-[2rem] bg-[#181231] p-7 text-white shadow-2xl shadow-[#1a123f]/20"><div className="flex items-center justify-between text-sm text-white/70"><span>Veya Account</span><ShieldCheck className="h-5 w-5 text-[#71e0c5]" /></div><div className="mt-16 rounded-3xl bg-gradient-to-br from-[#765be5] to-[#30205f] p-6"><p className="text-sm text-white/70">Visibilidad de cuenta</p><p className="mt-3 text-3xl font-bold">Datos confirmados</p><p className="mt-3 text-sm leading-6 text-white/75">Los saldos y movimientos se muestran únicamente cuando el proveedor autorizado los confirma.</p></div><div className="mt-6 grid grid-cols-2 gap-3 text-sm"><div className="rounded-2xl bg-white/10 p-4"><b>Gestiones</b><p className="mt-1 text-white/60">Trazables</p></div><div className="rounded-2xl bg-white/10 p-4"><b>Soporte</b><p className="mt-1 text-white/60">Seguro</p></div></div></aside></section>
    </main>;
  }

  if (stage === "login") {
    return <main className="min-h-[100dvh] bg-[#f7f6ff] text-[#1c1539]"><header className="flex items-center justify-between border-b border-[#e7e1f7] bg-[#181231] px-5 py-4 text-white md:px-10"><button onClick={() => setStage("welcome")} className="text-sm font-semibold text-white/80 hover:text-white">← Veya</button><span className="inline-flex items-center gap-2 text-sm text-white/75"><ShieldCheck className="h-4 w-4 text-[#71e0c5]" /> Espacio protegido</span></header><section className="mx-auto flex min-h-[calc(100dvh-65px)] max-w-lg items-center p-5"><div className="w-full rounded-3xl bg-white p-8 shadow-xl shadow-[#3d2a7c]/10"><span className="text-xs font-bold tracking-[.16em] text-[#6544d9]">ACCESO DE CLIENTE</span><h1 className="mt-2 font-serif text-4xl font-semibold">Entra en Veya.</h1><p className="mt-3 text-sm leading-6 text-[#726b87]">Identifícate con tu DNI o NIE y tu contraseña personal.</p>{notice && <div className="mt-5 rounded-xl bg-[#f4f0ff] p-4 text-sm text-[#4b337d]">{notice}</div>}<form className="mt-6 grid gap-4" onSubmit={login}><label className="grid gap-2 text-sm font-semibold">DNI / NIE<input autoComplete="username" required value={dni} onChange={(e) => setDni(e.target.value.toUpperCase())} placeholder="Ejemplo: 12345678Z" className="rounded-xl border border-[#ddd7eb] px-4 py-3 font-normal outline-none focus:border-[#6544d9]" /></label><label className="grid gap-2 text-sm font-semibold">Contraseña<input autoComplete="current-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-xl border border-[#ddd7eb] px-4 py-3 font-normal outline-none focus:border-[#6544d9]" /></label><button disabled={loading} className="rounded-xl bg-[#6544d9] px-4 py-3 font-bold text-white disabled:opacity-60">{loading ? "Comprobando…" : "Acceder"}</button></form><button onClick={() => setNotice("La recuperación de contraseña requiere un correo de contacto verificado.")} className="mt-5 text-sm font-semibold text-[#5134ba]">¿Has olvidado tu contraseña?</button></div></section></main>;
  }

  return <main className="min-h-[100dvh] bg-[#f7f6ff] text-[#1c1539]"><header className="flex items-center justify-between border-b border-[#e7e1f7] bg-[#181231] px-5 py-4 text-white md:px-10"><a href="/veya" className="flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[#9b7cff] to-[#34d4b6] font-black">V</span>Veya</a><span className="inline-flex items-center gap-2 text-sm text-white/75"><ShieldCheck className="h-4 w-4 text-[#71e0c5]" /> Espacio protegido</span></header><section className="mx-auto grid max-w-7xl gap-6 px-5 py-8 md:grid-cols-[220px_1fr] md:px-10"><aside className="rounded-3xl bg-white p-4 shadow-sm"><p className="px-3 py-2 text-xs font-bold tracking-[.14em] text-[#726b87]">TU ESPACIO VEYA</p>{["Inicio", "Huchas", "Transferencias", "Mis gestiones", "Veya Pro", "Ayuda", "Mi cuenta"].map((item) => <button key={item} onClick={() => setNotice(item === "Transferencias" ? "La solicitud de transferencia se registra para revisión y permanece bloqueada hasta la habilitación del proveedor." : `${item} estará disponible desde este espacio de cliente.`)} className="mt-1 w-full rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-[#f4f0ff]">{item}</button>)}<button onClick={() => setStage("welcome")} className="mt-6 w-full rounded-xl border border-[#e0d9ee] px-3 py-2 text-sm font-semibold">Salir</button></aside><div className="grid gap-6"><div><span className="text-xs font-bold tracking-[.14em] text-[#6544d9]">TU ESPACIO VEYA</span><h1 className="mt-2 font-serif text-4xl font-semibold">Hola de nuevo, {displayName}.</h1><p className="mt-2 text-[#726b87]">Organiza tu actividad desde una sola experiencia.</p></div>{notice && <div className="rounded-2xl bg-[#f0edff] px-5 py-4 text-sm text-[#4b337d]">{notice}</div>}<div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><section className="rounded-3xl bg-[#181231] p-7 text-white shadow-xl shadow-[#21194d]/10"><div className="flex items-center justify-between"><span className="text-sm text-white/65">Veya Account</span><ShieldCheck className="h-5 w-5 text-[#71e0c5]" /></div><p className="mt-12 text-sm text-white/65">Saldo disponible confirmado</p><p className="mt-2 text-4xl font-bold">{account ? money(balance, currency) : "Pendiente de proveedor"}</p><p className="mt-4 text-sm text-white/65">{account?.iban ? `IBAN ${String(account.iban).slice(0, 4)} •••• ${String(account.iban).slice(-4)}` : "Los datos de cuenta aparecerán cuando el proveedor los confirme."}</p><div className="mt-8 flex flex-wrap gap-3"><button onClick={() => setNotice("La transferencia se registra como expediente protegido hasta que se habilite la operativa autorizada.")} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#2c2057]">Transferir</button><button onClick={() => setNotice("La vinculación de cuentas externas se prepara mediante consentimiento PSD2 y proveedor autorizado.")} className="rounded-xl border border-white/25 px-4 py-2 text-sm font-bold">Vincular cuenta</button></div></section><section className="rounded-3xl bg-white p-6 shadow-sm"><p className="text-sm font-bold">Mis gestiones</p><p className="mt-2 text-sm leading-6 text-[#726b87]">Solicitudes registradas desde tu espacio.</p><div className="mt-5 grid gap-3">{requests.length ? requests.slice(0, 4).map((request, index) => <div key={request.request_id || request.reference || index} className="rounded-xl bg-[#f7f6ff] p-3 text-sm"><b>{request.request_type || "Gestión Veya"}</b><p className="mt-1 text-xs text-[#726b87]">{request.status || "En revisión"} · {request.reference || request.request_id || "Referencia protegida"}</p></div>) : <div className="rounded-xl bg-[#f7f6ff] p-4 text-sm text-[#726b87]">Aún no tienes solicitudes registradas.</div>}</div></section></div></div></section></main>;
}

export default function VeyaPage() {
  const [location] = useLocation();
  if (location === "/veya/empleados") return <VeyaEmployeePortalPage />;
  return <VeyaNativeClientPage />;
}
