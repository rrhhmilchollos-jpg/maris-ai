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
          <p className="mt-3 text-sm leading-6 text-[#726b87]">Entorno separado para personal autorizado. Usa tu código interno de seis dígitos, contraseña y autenticador TOTP.</p>
          {notice && <div className="mt-4 rounded-xl bg-[#f4f0ff] px-4 py-3 text-sm text-[#4b337d]">{notice}</div>}
          <form className="mt-6 grid gap-4" onSubmit={startLogin}>
            <label className="grid gap-2 text-sm font-semibold">Código de empleado
              <input name="veya_employee_code_9c2d" autoComplete="new-password" data-veya-employee-login="true" data-lpignore="true" required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Ejemplo: 482913" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} className="rounded-xl border border-[#ddd7eb] px-4 py-3 font-normal outline-none focus:border-[#6544d9]" />
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
type VeyaAccount = { balance?: number; available_balance?: number; available_cents?: number; booked_cents?: number; currency?: string; iban?: string; status?: string; provider_confirmed_at?: string };
type VeyaRequest = { request_id?: string; reference?: string; request_type?: string; status?: string; created_at?: string };
type MarketplaceItem = { code: string; title: string; category: string; monthlyFrom: number; image: string; tag: string; detail: string };

const VEHICLE_CATALOG: MarketplaceItem[] = [
  { code: "urban-flex", title: "Urbano flexible", category: "Urbano", monthlyFrom: 299, image: "/veya/assets/veya-marketplace/vehicle-urban.jpg", tag: "Particulares", detail: "Compacto para el día a día" },
  { code: "suv-comfort", title: "SUV con espacio", category: "SUV", monthlyFrom: 429, image: "/veya/assets/veya-marketplace/vehicle-suv.jpg", tag: "Familia", detail: "Confort y versatilidad" },
  { code: "electric-flow", title: "Eléctrico eficiente", category: "Eléctrico", monthlyFrom: 459, image: "/veya/assets/veya-marketplace/vehicle-electric.jpg", tag: "Cero emisiones", detail: "Movilidad para la ciudad" },
  { code: "commercial-pro", title: "Comercial Pro", category: "Comercial", monthlyFrom: 519, image: "/veya/assets/veya-marketplace/vehicle-commercial.jpg", tag: "Empresas", detail: "Capacidad para tu actividad" },
];

const DEVICE_CATALOG: MarketplaceItem[] = [
  { code: "iphone-pro", title: "iPhone Pro", category: "Smartphone", monthlyFrom: 39, image: "/veya/assets/veya-marketplace/device-iphone.jpg", tag: "Apple", detail: "Rendimiento premium" },
  { code: "galaxy-ultra", title: "Galaxy Ultra", category: "Smartphone", monthlyFrom: 36, image: "/veya/assets/veya-marketplace/device-galaxy.jpg", tag: "Samsung", detail: "Productividad sin límites" },
  { code: "creator-kit", title: "Creator Kit", category: "Tecnología", monthlyFrom: 49, image: "/veya/assets/veya-marketplace/device-pro.jpg", tag: "Profesional", detail: "Móvil y espacio de trabajo" },
  { code: "android-premium", title: "Android Premium", category: "Smartphone", monthlyFrom: 29, image: "/veya/assets/veya-marketplace/device-android.jpg", tag: "Flexible", detail: "Tecnología a tu ritmo" },
];

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
  const [activeTab, setActiveTab] = useState<"inicio" | "marketplace" | "huchas" | "movimientos" | "pro">("inicio");
  const [dni, setDni] = useState("");
  const [password, setPassword] = useState("");
  const [client, setClient] = useState<VeyaClient | null>(null);
  const [account, setAccount] = useState<VeyaAccount | null>(null);
  const [requests, setRequests] = useState<VeyaRequest[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [marketSection, setMarketSection] = useState<"vehicles" | "devices" | "insurance">("vehicles");
  const [vehicleAudience, setVehicleAudience] = useState<"individual" | "business">("individual");
  const [selectedMarketplaceItem, setSelectedMarketplaceItem] = useState<MarketplaceItem | null>(null);
  const [marketSubmitting, setMarketSubmitting] = useState(false);
  const [marketReference, setMarketReference] = useState("");
  const [marketData, setMarketData] = useState<Record<string, string | boolean>>({
    dni_nie: "", employment_status: "employed", cif: "", legal_name: "", annual_revenue: "",
    preferred_start_date: new Date().toISOString().slice(0, 10), device_model: "", term_months: "24",
    registration: "", brand: "", model: "", year: String(new Date().getFullYear()), usage: "personal", coverage: "third_party_extended", consent: false,
  });

  useEffect(() => {
    if (stage !== "login") return;
    const clearAutofill = () => {
      setDni("");
      setPassword("");
      document.querySelectorAll<HTMLInputElement>('input[data-veya-client-login="true"]').forEach((input) => { input.value = ""; });
    };
    clearAutofill();
    const timer = window.setTimeout(clearAutofill, 350);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const loadWorkspace = async () => {
    const [accountsResult, requestsResult] = await Promise.allSettled([
      clientApi("/veya/banking/accounts"),
      clientApi("/operations/requests"),
    ]);
    if (accountsResult.status === "fulfilled") {
      const result = accountsResult.value;
      const list = Array.isArray(result) ? result : result.items || result.accounts || [];
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

  const updateMarketData = (key: string, value: string | boolean) => setMarketData((current) => ({ ...current, [key]: value }));

  const submitMarketplaceRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedMarketplaceItem) return;
    setMarketSubmitting(true);
    setMarketReference("");
    try {
      const requestType = marketSection === "vehicles"
        ? (vehicleAudience === "individual" ? "vehicle_renting_individual" : "vehicle_renting_business")
        : marketSection === "devices" ? "device_renting" : "insurance_auto";
      const data = marketSection === "vehicles"
        ? vehicleAudience === "individual"
          ? { dni_nie: marketData.dni_nie, employment_status: marketData.employment_status, preferred_start_date: marketData.preferred_start_date, vehicle_selection: selectedMarketplaceItem.title }
          : { cif: marketData.cif, legal_name: marketData.legal_name, annual_revenue: marketData.annual_revenue, preferred_start_date: marketData.preferred_start_date, vehicle_selection: selectedMarketplaceItem.title }
        : marketSection === "devices"
          ? { device_model: selectedMarketplaceItem.title, term_months: marketData.term_months, marketplace_source: "veya_marketplace" }
          : { registration: marketData.registration, brand: marketData.brand, model: marketData.model, year: marketData.year, usage: marketData.usage, coverage: marketData.coverage, preferred_start_date: marketData.preferred_start_date, consent: marketData.consent, marketplace_source: "veya_marketplace" };
      const result = await clientApi("/product-requests/requests", { method: "POST", body: JSON.stringify({ request_type: requestType, product_code: selectedMarketplaceItem.code, data }) });
      const reference = result.request_id || "Solicitud registrada";
      setMarketReference(reference);
      setRequests((current) => [{ request_id: reference, request_type: requestType, status: result.status || "submitted" }, ...current]);
      setNotice("Tu solicitud se ha registrado como expediente para revisión. Puedes consultar opciones externas si lo deseas.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se ha podido registrar la solicitud.");
    } finally {
      setMarketSubmitting(false);
    }
  };

  const displayName = client?.first_name || client?.name || client?.full_name || "cliente";
  const balance = account?.available_cents !== undefined ? account.available_cents / 100 : account?.available_balance ?? account?.balance ?? 0;
  const currency = account?.currency || "EUR";
  const hasConfirmedBalance = Boolean(account && (account.status === "provider_confirmed" || account.provider_confirmed_at));
  const nav = [
    ["inicio", "Inicio", "◉"],
    ["marketplace", "Servicios", "◇"],
    ["huchas", "Huchas", "◌"],
    ["movimientos", "Actividad", "↗"],
    ["pro", "Veya Pro", "✦"],
  ] as const;
  const samples = [
    ["Veya Account", "Datos de cuenta", "●", "Pendiente"],
    ["Transferencias", "Revisión protegida", "⇄", "Disponible"],
    ["Tarjetas", "Emisión con proveedor", "▣", "Pendiente"],
    ["Open Banking", "Conexión PSD2", "⌁", "Preparado"],
  ];

  if (stage === "welcome") {
    return <main className="min-h-[100dvh] overflow-hidden bg-[#050506] text-white selection:bg-[#849cff] selection:text-black">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-[18rem] -top-[21rem] h-[50rem] w-[50rem] rounded-full bg-[#3152c9]/25 blur-[135px]" />
        <div className="absolute -bottom-[22rem] right-[-14rem] h-[48rem] w-[48rem] rounded-full bg-[#1e9e88]/18 blur-[150px]" />
        <div className="absolute inset-0 opacity-[.07] [background-image:linear-gradient(rgba(255,255,255,.28)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.28)_1px,transparent_1px)] [background-size:72px_72px]" />
      </div>
      <header className="relative mx-auto flex max-w-[1400px] items-center justify-between px-5 py-6 md:px-10"><a href="/" className="group flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-[1rem] bg-white text-lg font-black text-black transition duration-300 group-hover:rotate-6 group-hover:scale-105">V</span><span className="text-lg font-semibold tracking-[-.04em]">Veya</span></a><nav className="hidden items-center gap-8 text-sm font-semibold text-white/55 lg:flex"><button onClick={() => setNotice("Veya reúne cuenta, productos y gestión operativa en un único espacio.")} className="transition hover:text-white">Producto</button><button onClick={() => setNotice("Veya está diseñada para el ritmo de autónomos y microempresas.")} className="transition hover:text-white">Para tu actividad</button><button onClick={() => setNotice("La información sensible se trata mediante controles y proveedores autorizados.")} className="transition hover:text-white">Seguridad</button></nav><div className="flex items-center gap-3"><a href="/veya/empleados" className="hidden rounded-full border border-white/10 bg-white/[.04] px-4 py-2 text-xs font-semibold text-white/65 transition hover:border-white/25 hover:bg-white/10 sm:block">Empleados</a><button onClick={() => setStage("login")} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black transition hover:-translate-y-0.5 hover:bg-[#dfe6ff]">Acceder</button></div></header>
      <section className="relative mx-auto grid min-h-[calc(100dvh-92px)] max-w-[1400px] items-center gap-10 px-5 pb-10 pt-8 md:px-10 lg:grid-cols-[1.04fr_.96fr] lg:gap-16"><div className="relative z-10"><div className="inline-flex items-center gap-2 rounded-full border border-[#96abff]/25 bg-[#657cff]/10 px-3 py-1.5 text-[11px] font-bold tracking-[.17em] text-[#b9c6ff]"><span className="h-1.5 w-1.5 rounded-full bg-[#8ba1ff] shadow-[0_0_10px_#8ba1ff]" />VEYA ACCOUNT · EN EVOLUCIÓN</div><h1 className="mt-7 max-w-3xl text-[clamp(3.7rem,7.1vw,7.4rem)] font-semibold leading-[.88] tracking-[-.085em]">Haz que cada<br /><span className="bg-gradient-to-r from-[#f3f5ff] via-[#7c94ff] to-[#68e0c6] bg-clip-text text-transparent">paso cuente.</span></h1><p className="mt-8 max-w-xl text-lg leading-8 text-white/60 md:text-xl">Una nueva manera de ordenar tus finanzas, moverte con calma y hacer que tu actividad tenga más espacio para crecer.</p><div className="mt-9 flex flex-wrap items-center gap-3"><button onClick={() => setStage("login")} className="group rounded-[1.2rem] bg-white px-6 py-4 font-bold text-black transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_45px_rgba(158,181,255,.22)]">Entrar en Veya <span className="ml-2 inline-block transition group-hover:translate-x-1">→</span></button><button onClick={() => setNotice("El acceso se solicita mediante identificación y revisión de elegibilidad.")} className="rounded-[1.2rem] border border-white/12 bg-white/[.045] px-6 py-4 font-bold text-white/85 backdrop-blur transition hover:-translate-y-1 hover:border-white/25 hover:bg-white/[.09]">Empezar ahora</button></div>{notice && <div className="mt-5 max-w-xl rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/65 backdrop-blur">{notice}</div>}<div className="mt-12 flex flex-wrap gap-x-8 gap-y-4 border-t border-white/10 pt-6 text-sm"><div><p className="font-semibold text-white">Claridad radical</p><p className="mt-1 text-white/45">Sin ruido. Solo contexto.</p></div><div><p className="font-semibold text-white">Control a tu ritmo</p><p className="mt-1 text-white/45">Una vista para decidir mejor.</p></div></div></div>
        <div className="relative mx-auto w-full max-w-[610px] py-8 lg:py-0"><div className="absolute left-1/2 top-1/2 h-[86%] w-[82%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#5578ff]/20 blur-[95px]" /><div className="relative overflow-hidden rounded-[2.65rem] border border-white/20 bg-[#111218]/85 p-5 shadow-[0_45px_130px_rgba(0,0,0,.66)] backdrop-blur-2xl"><div className="absolute -right-20 top-0 h-52 w-52 rounded-full bg-[#5074ff]/30 blur-[60px]" /><div className="relative flex items-center justify-between"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-lg font-black text-black">V</span><div><p className="text-sm font-semibold">Veya Account</p><p className="text-xs text-white/45">Tu espacio, en movimiento</p></div></div><span className="grid h-10 w-10 place-items-center rounded-full border border-[#78e5cf]/25 bg-[#70e0c3]/10 text-[#85ecd7]">◌</span></div><div className="relative mt-12 overflow-hidden rounded-[2rem] border border-white/15 bg-[linear-gradient(135deg,#6b83ff_0%,#3a51d5_50%,#131a58_100%)] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,.36)]"><div className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-white/20 blur-2xl" /><div className="relative"><p className="text-sm font-medium text-white/70">Tu siguiente movimiento</p><p className="mt-3 text-4xl font-semibold tracking-[-.06em]">Empieza aquí.</p><div className="mt-8 flex items-center justify-between rounded-2xl border border-white/20 bg-black/15 px-4 py-3 backdrop-blur"><span className="text-sm text-white/75">Datos disponibles</span><span className="rounded-full bg-white/16 px-3 py-1 text-xs font-bold">Protegidos</span></div></div></div><div className="relative mt-4 grid grid-cols-3 gap-3">{[["＋","Añadir dinero","Configura tu entrada"],["⇄","Transferir","Gestiona solicitudes"],["▣","Tarjetas","Prepara tu producto"]].map(([icon,title,detail]) => <button key={title} onClick={() => setNotice(`${title}: ${detail}.`)} className="group rounded-[1.35rem] border border-white/10 bg-white/[.055] p-4 text-left transition duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[.1]"><b className="text-xl text-white">{icon}</b><span className="mt-5 block text-xs font-bold text-white">{title}</span><span className="mt-1 block text-[10px] leading-4 text-white/40">{detail}</span></button>)}</div><div className="relative mt-4 flex items-center justify-between rounded-[1.4rem] border border-white/10 bg-black/20 px-4 py-3"><div className="flex items-center gap-3"><span className="h-2 w-2 animate-pulse rounded-full bg-[#ffc464] shadow-[0_0_12px_#ffc464]" /><span className="text-xs text-white/60">Información de cuenta pendiente de confirmación</span></div><span className="text-xs font-semibold text-[#9debd8]">Ver estado</span></div></div><div className="absolute -bottom-6 -left-5 hidden rounded-[1.45rem] border border-white/15 bg-[#15161d]/90 p-4 shadow-2xl backdrop-blur-xl sm:block"><p className="text-xs font-bold text-white">Tu actividad, más clara.</p><p className="mt-1 text-[11px] text-white/45">Todo lo importante, sin distraerte.</p></div><div className="absolute -right-6 top-[18%] hidden rounded-full border border-white/15 bg-white/[.08] px-3 py-2 text-[11px] font-bold text-[#b8c7ff] shadow-xl backdrop-blur-xl md:block">HECHO PARA AVANZAR</div></div></section>
      <section className="relative mx-auto max-w-[1400px] px-5 pb-10 md:px-10"><div className="grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-3"><div className="rounded-2xl bg-white/[.035] p-4"><p className="text-xs font-bold tracking-[.14em] text-[#b8c7ff]">01 / A TU RITMO</p><p className="mt-3 text-sm leading-6 text-white/55">Diseñada para dar contexto antes de pedir decisiones.</p></div><div className="rounded-2xl bg-white/[.035] p-4"><p className="text-xs font-bold tracking-[.14em] text-[#9ce9d8]">02 / CON PROPÓSITO</p><p className="mt-3 text-sm leading-6 text-white/55">Cada gestión queda trazada, protegida y fácil de seguir.</p></div><div className="rounded-2xl bg-white/[.035] p-4"><p className="text-xs font-bold tracking-[.14em] text-[#ffc464]">03 / SIN FALSA PRISA</p><p className="mt-3 text-sm leading-6 text-white/55">Los datos financieros aparecen cuando un proveedor los confirma.</p></div></div>
      </section>
    </main>;
  }

  if (stage === "login") {
    return <main className="min-h-[100dvh] bg-[#050506] text-white"><header className="flex items-center justify-between border-b border-white/10 px-5 py-5 md:px-10"><button onClick={() => setStage("welcome")} className="text-sm font-semibold text-white/70 hover:text-white">← Veya</button><span className="inline-flex items-center gap-2 text-xs font-semibold text-[#9debd8]"><span className="h-2 w-2 rounded-full bg-[#69dfc6] shadow-[0_0_12px_#69dfc6]" />Espacio protegido</span></header><section className="mx-auto flex min-h-[calc(100dvh-77px)] max-w-lg items-center p-5"><div className="w-full rounded-[2rem] border border-white/10 bg-white/[.055] p-8 shadow-2xl backdrop-blur-2xl"><p className="text-xs font-bold tracking-[.18em] text-[#aebdff]">ACCESO DE CLIENTE</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.05em]">Entra en Veya.</h1><p className="mt-3 text-sm leading-6 text-white/55">Identifícate con tu DNI o NIE y tu contraseña personal.</p>{notice && <div className="mt-5 rounded-2xl border border-[#7991ff]/25 bg-[#5274ff]/10 p-4 text-sm text-[#dbe3ff]">{notice}</div>}<form className="mt-7 grid gap-4" onSubmit={login} autoComplete="off"><label className="grid gap-2 text-sm font-semibold text-white/80">DNI / NIE<input name="veya_client_dni_47p" autoComplete="off" data-veya-client-login="true" data-lpignore="true" required value={dni} onChange={(e) => setDni(e.target.value.toUpperCase())} placeholder="Ejemplo: 12345678Z" className="rounded-2xl border border-white/12 bg-black/30 px-4 py-3.5 font-normal text-white outline-none placeholder:text-white/25 focus:border-[#7691ff]" /></label><label className="grid gap-2 text-sm font-semibold text-white/80">Contraseña<input name="veya_client_password_47p" autoComplete="new-password" data-veya-client-login="true" data-lpignore="true" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-2xl border border-white/12 bg-black/30 px-4 py-3.5 font-normal text-white outline-none focus:border-[#7691ff]" /></label><button disabled={loading} className="mt-2 rounded-2xl bg-white px-4 py-3.5 font-bold text-black transition hover:bg-[#dce5ff] disabled:opacity-60">{loading ? "Comprobando…" : "Acceder"}</button></form><button onClick={() => setNotice("La recuperación requiere un correo de contacto verificado.")} className="mt-5 text-sm font-semibold text-[#b7c6ff]">¿Has olvidado tu contraseña?</button></div></section></main>;
  }

  const overview = <>
    <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#18275f] via-[#101733] to-[#090a0e] p-6 shadow-[0_25px_80px_rgba(0,0,0,.3)] md:p-8"><div className="pointer-events-none absolute -right-10 -top-14 h-48 w-48 rounded-full bg-[#5274ff]/30 blur-3xl" /><div className="relative flex items-start justify-between"><div><p className="text-sm text-white/55">Saldo disponible</p><p className="mt-2 text-5xl font-semibold tracking-[-.07em] md:text-6xl">{hasConfirmedBalance ? money(balance, currency) : "0,00 €"}</p><p className="mt-3 flex items-center gap-2 text-sm text-[#b7c7ff]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#ffb54d] shadow-[0_0_12px_#ffb54d]" />{hasConfirmedBalance ? "Saldo confirmado por proveedor" : "Vista inicial · esperando confirmación de proveedor"}</p></div><button className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-white/5 text-white/70 transition hover:bg-white/10">◉</button></div><div className="relative mt-8 grid grid-cols-3 gap-3"><button onClick={() => setNotice("La entrada de fondos se habilitará cuando exista una vía autorizada.")} className="rounded-2xl border border-white/10 bg-white/[.08] p-3 text-left transition hover:-translate-y-0.5 hover:bg-white/[.14]"><b className="block text-xl">＋</b><span className="mt-2 block text-xs font-semibold">Añadir dinero</span></button><button onClick={() => setActiveTab("movimientos")} className="rounded-2xl border border-white/10 bg-white/[.08] p-3 text-left transition hover:-translate-y-0.5 hover:bg-white/[.14]"><b className="block text-xl">⇄</b><span className="mt-2 block text-xs font-semibold">Transferir</span></button><button onClick={() => setNotice("Las tarjetas se gestionan mediante expedientes y proveedor autorizado.")} className="rounded-2xl border border-white/10 bg-white/[.08] p-3 text-left transition hover:-translate-y-0.5 hover:bg-white/[.14]"><b className="block text-xl">▣</b><span className="mt-2 block text-xs font-semibold">Tarjetas</span></button></div></section>
    <section className="rounded-[2rem] border border-white/8 bg-white/[.045] p-5 backdrop-blur-xl"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Actividad reciente</p><p className="mt-1 text-xs text-white/45">Actividad disponible según confirmación del proveedor</p></div><button onClick={() => setActiveTab("movimientos")} className="rounded-full bg-white/8 px-3 py-2 text-xs font-bold text-white/75 hover:bg-white/12">Ver todo</button></div><div className="mt-4 max-h-[290px] space-y-2 overflow-y-auto pr-1">{requests.length ? requests.slice(0, 6).map((request, index) => <div key={request.request_id || request.reference || index} className="flex items-center justify-between rounded-2xl bg-black/20 p-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-[#5274ff]/20 text-[#b8c7ff]">{["⌁","⇄","▣","●"][index % 4]}</span><div><b className="block text-sm">{request.request_type || "Gestión Veya"}</b><span className="text-xs text-white/45">{request.status || "En revisión"}</span></div></div><span className="text-xs font-semibold text-white/60">{request.reference || request.request_id || "Protegido"}</span></div>) : samples.map(([name, detail, icon, state]) => <div key={name} className="flex items-center justify-between rounded-2xl bg-black/20 p-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-[#5274ff]/20 text-[#b8c7ff]">{icon}</span><div><b className="block text-sm">{name}</b><span className="text-xs text-white/45">{detail}</span></div></div><span className="text-xs font-semibold text-[#8fe5d1]">{state}</span></div>)}</div></section>
  </>;

  const huchas = <section className="grid gap-4 md:grid-cols-2"><div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#273e87] to-[#11162c] p-6"><p className="text-sm text-white/60">Huchas Veya</p><h2 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Objetivos que sí ves avanzar.</h2><p className="mt-4 max-w-md text-sm leading-6 text-white/60">Crea objetivos y guarda el avance de cada uno. Los fondos solo se separan cuando el proveedor lo confirme.</p><button onClick={() => setNotice("La creación de huchas se registra como objetivo protegido.")} className="mt-7 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black">Crear hucha</button></div><div className="rounded-[2rem] border border-white/10 bg-white/[.05] p-6"><p className="text-sm font-semibold">Progreso de objetivos</p><div className="mt-7 space-y-5">{[["Impuestos",38,"#7691ff"],["Equipo",12,"#72d9c2"],["Viaje",0,"#ffb54d"]].map(([label, amount, color]) => <div key={label as string}><div className="mb-2 flex justify-between text-sm"><span>{label}</span><span className="text-white/45">{amount}%</span></div><div className="h-2 rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${amount}%`, background: color as string }} /></div></div>)}</div></div></section>;

  const movements = <section className="rounded-[2rem] border border-white/10 bg-white/[.045] p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-white/55">Transferencias y actividad</p><h2 className="mt-1 text-3xl font-semibold tracking-[-.04em]">Todo, sin perder el contexto.</h2></div><button onClick={() => setNotice("La solicitud de transferencia se registra como expediente y permanece bloqueada hasta que exista raíl autorizado.")} className="rounded-2xl bg-[#6e8cff] px-4 py-3 text-sm font-bold text-[#061038]">Nueva transferencia</button></div><div className="mt-7 grid gap-3">{samples.map(([name, detail, icon, state]) => <div key={name} className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 p-4"><div className="flex items-center gap-4"><span className="grid h-11 w-11 place-items-center rounded-full bg-white/7 text-lg">{icon}</span><div><b>{name}</b><p className="mt-1 text-sm text-white/45">{detail}</p></div></div><span className="rounded-full bg-[#6dd9c1]/10 px-3 py-1 text-xs font-bold text-[#8fe5d1]">{state}</span></div>)}</div></section>;

  const pro = <section className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]"><div className="rounded-[2rem] border border-[#7991ff]/25 bg-gradient-to-br from-[#161f4b] to-[#090a0e] p-7"><span className="rounded-full bg-[#7991ff]/15 px-3 py-1 text-xs font-bold tracking-wide text-[#bac8ff]">VEYA PRO</span><h2 className="mt-4 text-4xl font-semibold tracking-[-.06em]">Tu negocio,
una visión.</h2><p className="mt-4 max-w-lg text-sm leading-7 text-white/60">Organizaciones, gastos, facturas, equipo y conciliación desde un espacio diseñado para tu actividad.</p><button onClick={() => setNotice("Veya Pro está preparado para organizaciones, roles, gastos y conciliación protegida.")} className="mt-7 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black">Abrir Veya Pro</button></div><div className="rounded-[2rem] border border-white/10 bg-white/[.05] p-6"><p className="text-sm font-semibold">En marcha</p><div className="mt-5 space-y-4">{[["Organizaciones","Preparado"],["Gastos y facturas","Expedientes"],["API e integraciones","Protegido"]].map(([label, status]) => <div key={label} className="flex items-center justify-between border-b border-white/8 pb-4 last:border-0"><span className="text-sm text-white/75">{label}</span><span className="text-xs font-bold text-[#8fe5d1]">{status}</span></div>)}</div></div></section>;

  const marketplace = <section className="space-y-5"><div className="relative overflow-hidden rounded-[2rem] border border-[#7d94ff]/20 bg-[radial-gradient(circle_at_82%_0%,rgba(94,122,255,.24),transparent_35%),linear-gradient(135deg,#10172e,#090a0e_60%)] p-6 md:p-8"><div className="max-w-2xl"><span className="rounded-full border border-[#9eb0ff]/20 bg-[#728cff]/10 px-3 py-1 text-xs font-bold tracking-wide text-[#c1cbff]">MARKETPLACE VEYA</span><h2 className="mt-4 text-4xl font-semibold tracking-[-.06em] md:text-5xl">Servicios que se adaptan a tu ritmo.</h2><p className="mt-4 max-w-xl text-sm leading-7 text-white/60">Explora movilidad, tecnología y protección. Primero registramos tu solicitud para seguimiento Veya; las opciones externas se abren solo si decides visitarlas.</p></div><div className="mt-7 flex flex-wrap gap-2">{[["vehicles","🚗","Renting de vehículos"],["devices","◌","Tecnología"],["insurance","◇","Seguro de coche"]].map(([id, icon, label]) => <button key={id} onClick={() => { setMarketSection(id as "vehicles" | "devices" | "insurance"); setSelectedMarketplaceItem(null); setMarketReference(""); }} className={`rounded-2xl border px-4 py-3 text-sm font-bold transition ${marketSection === id ? "border-white bg-white text-black" : "border-white/10 bg-white/[.05] text-white/65 hover:bg-white/10"}`}><span className="mr-2">{icon}</span>{label}</button>)}</div></div>

    {marketSection === "vehicles" && <><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-white/55">Renting de vehículos</p><h3 className="mt-1 text-3xl font-semibold tracking-[-.04em]">Elige cómo te mueves.</h3></div><div className="rounded-2xl border border-white/10 bg-white/[.045] p-1"><button onClick={() => { setVehicleAudience("individual"); setSelectedMarketplaceItem(null); }} className={`rounded-xl px-4 py-2 text-sm font-bold ${vehicleAudience === "individual" ? "bg-white text-black" : "text-white/55"}`}>Particulares</button><button onClick={() => { setVehicleAudience("business"); setSelectedMarketplaceItem(null); }} className={`rounded-xl px-4 py-2 text-sm font-bold ${vehicleAudience === "business" ? "bg-white text-black" : "text-white/55"}`}>Empresas</button></div></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{VEHICLE_CATALOG.map((item) => <article key={item.code} className="group overflow-hidden rounded-[1.65rem] border border-white/10 bg-white/[.045]"><img src={item.image} alt={item.title} className="h-44 w-full object-cover transition duration-500 group-hover:scale-105" /><div className="p-4"><div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-bold tracking-[.15em] text-[#aabaff]">{item.category.toUpperCase()}</span><h4 className="mt-1 font-semibold">{item.title}</h4></div><span className="rounded-full bg-[#70ddc5]/10 px-2 py-1 text-[10px] font-bold text-[#91ead8]">{item.tag}</span></div><p className="mt-2 text-xs text-white/45">{item.detail}</p><p className="mt-4 text-lg font-semibold">Desde {money(item.monthlyFrom)}<span className="text-xs font-normal text-white/45">/mes*</span></p><button onClick={() => { setSelectedMarketplaceItem(item); setMarketReference(""); }} className="mt-4 w-full rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-black transition hover:bg-[#dce5ff]">Solicitar estudio</button></div></article>)}</div></>}

    {marketSection === "devices" && <><div><p className="text-sm font-semibold text-white/55">Renting tecnológico</p><h3 className="mt-1 text-3xl font-semibold tracking-[-.04em]">Tecnología premium, con una cuota orientativa.</h3></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{DEVICE_CATALOG.map((item) => <article key={item.code} className="group overflow-hidden rounded-[1.65rem] border border-white/10 bg-white/[.045]"><img src={item.image} alt={item.title} className="h-44 w-full object-cover transition duration-500 group-hover:scale-105" /><div className="p-4"><div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-bold tracking-[.15em] text-[#aabaff]">{item.category.toUpperCase()}</span><h4 className="mt-1 font-semibold">{item.title}</h4></div><span className="rounded-full bg-[#70ddc5]/10 px-2 py-1 text-[10px] font-bold text-[#91ead8]">{item.tag}</span></div><p className="mt-2 text-xs text-white/45">{item.detail}</p><p className="mt-4 text-lg font-semibold">Desde {money(item.monthlyFrom)}<span className="text-xs font-normal text-white/45">/mes*</span></p><button onClick={() => { setSelectedMarketplaceItem(item); setMarketReference(""); }} className="mt-4 w-full rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-black transition hover:bg-[#dce5ff]">Solicitar renting</button></div></article>)}</div></>}

    {marketSection === "insurance" && <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><article className="overflow-hidden rounded-[1.8rem] border border-white/10 bg-white/[.045]"><img src="/veya/assets/veya-marketplace/vehicle-suv.jpg" alt="Vehículo para cotización de seguro" className="h-56 w-full object-cover" /><div className="p-6"><span className="text-xs font-bold tracking-[.16em] text-[#aabaff]">PROTECCIÓN DE MOVILIDAD</span><h3 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Cotiza tu coche con contexto.</h3><p className="mt-3 text-sm leading-6 text-white/55">Registra la información de tu vehículo en Veya para que el equipo pueda revisar tu expediente antes de que visites un comparador o aseguradora externa.</p><button onClick={() => { setSelectedMarketplaceItem({ code: "auto-cover", title: "Seguro de automóvil", category: "Seguro", monthlyFrom: 0, image: "", tag: "Cotización", detail: "" }); setMarketReference(""); }} className="mt-6 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black">Solicitar cotización</button></div></article><aside className="rounded-[1.8rem] border border-[#6fdfc6]/20 bg-[#6fdfc6]/[.06] p-6"><p className="text-sm font-semibold text-[#96e8d8]">En dos pasos</p><ol className="mt-5 space-y-4 text-sm text-white/65"><li><b className="mr-3 text-white">01</b>Completa los datos de tu vehículo.</li><li><b className="mr-3 text-white">02</b>Veya crea un expediente trazable.</li><li><b className="mr-3 text-white">03</b>Elige si quieres visitar una opción externa.</li></ol><p className="mt-7 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs leading-5 text-white/45">No emitimos una póliza desde esta pantalla ni compartimos tus datos con terceros por el simple hecho de crear una solicitud.</p></aside></div>}

    {selectedMarketplaceItem && <section className="rounded-[2rem] border border-[#8da5ff]/25 bg-[linear-gradient(135deg,rgba(41,57,133,.5),rgba(14,15,21,.96))] p-6 md:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[.16em] text-[#bdc9ff]">SOLICITUD VEYA</p><h3 className="mt-2 text-3xl font-semibold tracking-[-.05em]">{selectedMarketplaceItem.title}</h3><p className="mt-2 text-sm text-white/55">Crearemos un expediente interno antes de que decidas abrir una web externa.</p></div><button onClick={() => setSelectedMarketplaceItem(null)} className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-white/60">Cerrar</button></div><form onSubmit={submitMarketplaceRequest} className="mt-7 grid gap-4 md:grid-cols-2">{marketSection === "vehicles" && vehicleAudience === "individual" && <><label className="grid gap-2 text-sm font-semibold">DNI / NIE<input required value={String(marketData.dni_nie)} onChange={(e) => updateMarketData("dni_nie", e.target.value.toUpperCase())} placeholder="12345678Z" className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]" /></label><label className="grid gap-2 text-sm font-semibold">Situación profesional<select value={String(marketData.employment_status)} onChange={(e) => updateMarketData("employment_status", e.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]"><option value="employed">Empleado/a</option><option value="self_employed">Autónomo/a</option><option value="retired">Jubilado/a</option></select></label></>}{marketSection === "vehicles" && vehicleAudience === "business" && <><label className="grid gap-2 text-sm font-semibold">CIF<input required value={String(marketData.cif)} onChange={(e) => updateMarketData("cif", e.target.value.toUpperCase())} placeholder="B12345678" className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]" /></label><label className="grid gap-2 text-sm font-semibold">Razón social<input required value={String(marketData.legal_name)} onChange={(e) => updateMarketData("legal_name", e.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]" /></label><label className="grid gap-2 text-sm font-semibold">Facturación anual aproximada (€)<input required type="number" min="0" value={String(marketData.annual_revenue)} onChange={(e) => updateMarketData("annual_revenue", e.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]" /></label></>}{marketSection === "devices" && <label className="grid gap-2 text-sm font-semibold">Plazo de renting<select value={String(marketData.term_months)} onChange={(e) => updateMarketData("term_months", e.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]"><option value="12">12 meses</option><option value="24">24 meses</option><option value="36">36 meses</option></select></label>}{marketSection === "insurance" && <><label className="grid gap-2 text-sm font-semibold">Matrícula<input required value={String(marketData.registration)} onChange={(e) => updateMarketData("registration", e.target.value.toUpperCase())} placeholder="1234ABC" className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]" /></label><label className="grid gap-2 text-sm font-semibold">Marca<input required value={String(marketData.brand)} onChange={(e) => updateMarketData("brand", e.target.value)} placeholder="Marca" className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]" /></label><label className="grid gap-2 text-sm font-semibold">Modelo<input required value={String(marketData.model)} onChange={(e) => updateMarketData("model", e.target.value)} placeholder="Modelo" className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]" /></label><label className="grid gap-2 text-sm font-semibold">Año<input required type="number" min="1900" max={new Date().getFullYear() + 1} value={String(marketData.year)} onChange={(e) => updateMarketData("year", e.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]" /></label><label className="grid gap-2 text-sm font-semibold">Uso<select value={String(marketData.usage)} onChange={(e) => updateMarketData("usage", e.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]"><option value="personal">Particular</option><option value="business">Profesional</option></select></label><label className="grid gap-2 text-sm font-semibold">Cobertura deseada<select value={String(marketData.coverage)} onChange={(e) => updateMarketData("coverage", e.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]"><option value="third_party">Terceros</option><option value="third_party_extended">Terceros ampliado</option><option value="comprehensive">Todo riesgo</option></select></label></>}<label className="grid gap-2 text-sm font-semibold">{marketSection === "insurance" ? "Fecha de efecto deseada" : "Inicio aproximado"}<input required type="date" min={new Date().toISOString().slice(0, 10)} value={String(marketData.preferred_start_date)} onChange={(e) => updateMarketData("preferred_start_date", e.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 font-normal outline-none focus:border-[#8fa4ff]" /></label>{marketSection === "insurance" && <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/65"><input required type="checkbox" checked={marketData.consent === true} onChange={(e) => updateMarketData("consent", e.target.checked)} className="mt-0.5" />Confirmo que los datos son correctos y autorizo su tratamiento para tramitar esta solicitud.</label>}<div className="md:col-span-2 flex flex-wrap items-center gap-3"><button disabled={marketSubmitting} className="rounded-2xl bg-white px-5 py-3 font-bold text-black disabled:opacity-60">{marketSubmitting ? "Registrando expediente…" : "Registrar solicitud"}</button><span className="text-xs text-white/45">*Las cuotas son orientativas y no constituyen una oferta vinculante.</span></div></form>{marketReference && <div className="mt-5 rounded-2xl border border-[#78e1cc]/25 bg-[#6fdfc6]/10 p-4 text-sm text-[#c9fff4]">Expediente <b>{marketReference}</b> registrado. Ya puedes consultar alternativas externas; Veya no comparte tus datos de esta solicitud automáticamente.</div>}</section>}

    <section className="rounded-[1.8rem] border border-white/10 bg-white/[.035] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold">Opciones externas</p><p className="mt-1 max-w-2xl text-xs leading-5 text-white/45">Los siguientes enlaces abren los sitios oficiales de terceros. No son una contratación dentro de Veya ni transfieren la información de tu expediente.</p></div><span className="text-xs text-white/35">Imágenes de catálogo: Unsplash</span></div><div className="mt-4 flex flex-wrap gap-3">{(marketSection === "vehicles" ? vehicleAudience === "individual" ? [["Renting Finders · Particulares","https://rentingfinders.com/renting-particulares/"],["Idoneo · Renting","https://idoneo.com/renting/ofertas"]] : [["Renting Finders · Empresas","https://rentingfinders.com/renting-empresas/"],["Idoneo · Renting","https://idoneo.com/renting/ofertas"]] : marketSection === "devices" ? [["Grover España","https://www.grover.com/es-es"],["Rentik","https://rentik.com/"]] : [["Rastreator · Seguro de coche","https://www.rastreator.com/seguros-de-coche/"],["Balumba","https://www.balumba.es/"]]).map(([label, href]) => <a key={label} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[.05] px-4 py-3 text-sm font-bold text-white/80 transition hover:bg-white/10">{label}<ExternalLink className="h-3.5 w-3.5" /></a>)}</div></section></section>;

  const view = activeTab === "inicio" ? overview : activeTab === "marketplace" ? marketplace : activeTab === "huchas" ? huchas : activeTab === "movimientos" ? movements : pro;

  return <main className="min-h-[100dvh] bg-[#050506] text-white"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(56,80,194,.16),transparent_25%),radial-gradient(circle_at_85%_90%,rgba(74,213,184,.08),transparent_25%)]" /><header className="sticky top-0 z-20 border-b border-white/8 bg-[#050506]/75 backdrop-blur-2xl"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8"><a href="/veya" className="flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-xl bg-white text-sm font-black text-black">V</span> Veya</a><nav className="hidden items-center gap-1 rounded-full border border-white/8 bg-white/[.045] p-1 md:flex">{nav.map(([id,label,icon]) => <button key={id} onClick={() => setActiveTab(id)} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${activeTab === id ? "bg-white text-black shadow-lg" : "text-white/55 hover:text-white"}`}><span className="mr-1.5">{icon}</span>{label}</button>)}</nav><div className="flex items-center gap-3"><span className="hidden items-center gap-2 text-xs font-semibold text-white/50 sm:flex"><span className="h-2 w-2 rounded-full bg-[#6dd9c1] shadow-[0_0_10px_#6dd9c1]" />Protegido</span><button onClick={() => setNotice("Las notificaciones operativas aparecerán aquí.")} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[.05] text-white/70 transition hover:bg-white/10">◌</button></div></div></header><section className="relative mx-auto max-w-7xl px-5 py-7 pb-28 md:px-8 md:py-10"><div className="mb-7 flex items-end justify-between gap-4"><div><p className="text-xs font-bold tracking-[.16em] text-[#9eafff]">ESPACIO VEYA</p><h1 className="mt-2 text-3xl font-semibold tracking-[-.05em] md:text-4xl">Hola, {displayName}.</h1></div><button onClick={() => setNotice("Modo privado activado: los importes se ocultan al cerrar la sesión.")} className="rounded-full border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-semibold text-white/55 hover:bg-white/[.08]">Modo privado</button></div>{notice && <div className="mb-5 rounded-2xl border border-[#7991ff]/20 bg-[#5274ff]/10 px-5 py-4 text-sm text-[#dce4ff]">{notice}</div>}<div className="grid gap-5 xl:grid-cols-[1.16fr_.84fr]">{view}</div></section><nav className="fixed inset-x-4 bottom-4 z-30 flex items-center justify-around rounded-2xl border border-white/10 bg-[#17171c]/90 p-2 shadow-2xl backdrop-blur-2xl md:hidden">{nav.map(([id,label,icon]) => <button key={id} onClick={() => setActiveTab(id)} className={`grid place-items-center gap-0.5 rounded-xl px-3 py-2 text-[10px] font-semibold ${activeTab === id ? "bg-white text-black" : "text-white/55"}`}><b className="text-base">{icon}</b>{label}</button>)}</nav></main>;
}

export default function VeyaPage() {
  const [location] = useLocation();
  if (location === "/veya/empleados") return <VeyaEmployeePortalPage />;
  return <VeyaNativeClientPage />;
}
