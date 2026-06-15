import { useState, useEffect } from "react";
import {
  LayoutDashboard, Workflow, CalendarDays, Users, Package, Trophy,
  Search, MapPin, Phone, Plus, TrendingUp, Clock, ShieldCheck,
  ArrowRight, ArrowLeft, X, CheckCircle2, Building2, Bell,
  LogOut, UserCog, Mail, Lock, Loader2, AlertCircle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
} from "recharts";

// ============================================================
// CONFIG — backend API y verificación con Google
// ============================================================
// URL del backend de Seguxat CRM una vez desplegado (Railway/Vercel).
// En desarrollo local sería algo como "http://localhost:4000/api".
const API_BASE = "/api";

// Sustituye por el Client ID real de tu proyecto en Google Cloud Console
// (APIs y servicios -> Credenciales -> ID de cliente de OAuth 2.0 -> Web).
const GOOGLE_CLIENT_ID = "560128973845-o2otvdgfboc3igncs9rovd506bt64l5e.apps.googleusercontent.com";

// ============================================================
// DATA
// ============================================================
const REPS = [
  { id: "r1", name: "Laura Gómez", initials: "LG", zone: "Centro / Ciutat Vella", color: "bg-amber-500" },
  { id: "r2", name: "Marc Ferrer", initials: "MF", zone: "Ruzafa / Eixample", color: "bg-teal-600" },
  { id: "r3", name: "Sara Beltrán", initials: "SB", zone: "Benimaclet / Algirós", color: "bg-sky-600" },
  { id: "r4", name: "Iván Soler", initials: "IS", zone: "Patraix / Jesús", color: "bg-violet-600" },
];

const STAGES = [
  { id: "nuevo", label: "Nuevo lead", color: "bg-slate-400" },
  { id: "contactado", label: "Contactado", color: "bg-sky-500" },
  { id: "cita", label: "Cita agendada", color: "bg-amber-500" },
  { id: "visita", label: "Visita realizada", color: "bg-orange-500" },
  { id: "propuesta", label: "Propuesta enviada", color: "bg-violet-500" },
  { id: "contrato", label: "Contrato firmado", color: "bg-teal-600" },
  { id: "instalacion", label: "Instalación programada", color: "bg-emerald-600" },
];

const KITS = {
  esencial: { name: "Hogar Esencial", alta: 199, cuota: 24.9, desc: "Central + 2 sensores apertura + 1 detector movimiento + sirena + app" },
  total: { name: "Hogar Total", alta: 349, cuota: 34.9, desc: "Central + 4 sensores + 2 cámaras HD + sirena ext. + detector humo + videoverificación" },
  negocio: { name: "Negocio", alta: 599, cuota: 49.9, desc: "Central + sensores perimetrales + cámaras HD + botón pánico + respuesta prioritaria" },
};

const INITIAL_LEADS = [
  { id: 1, name: "Carmen Ibáñez", zone: "El Carmen", phone: "612 345 001", kit: "esencial", source: "Puerta a puerta", rep: "r1", stage: "nuevo", days: 1 },
  { id: 2, name: "Roberto Sanz", zone: "Camins al Grau", phone: "612 345 002", kit: "total", source: "Web", rep: "r3", stage: "nuevo", days: 2 },
  { id: 3, name: "Almudena Pla", zone: "Cabanyal", phone: "612 345 003", kit: "esencial", source: "Referido", rep: "r2", stage: "nuevo", days: 1 },
  { id: 4, name: "Bar El Rincón", zone: "Ruzafa", phone: "612 345 004", kit: "negocio", source: "Campaña verano", rep: "r2", stage: "nuevo", days: 3 },
  { id: 5, name: "Federico Llorca", zone: "Patraix", phone: "612 345 005", kit: "esencial", source: "Puerta a puerta", rep: "r4", stage: "contactado", days: 2 },
  { id: 6, name: "Marisa Donat", zone: "Benimaclet", phone: "612 345 006", kit: "total", source: "Escudo Vecinal", rep: "r3", stage: "contactado", days: 4 },
  { id: 7, name: "Quique Navarro", zone: "Jesús", phone: "612 345 007", kit: "esencial", source: "Referido", rep: "r4", stage: "contactado", days: 1 },
  { id: 8, name: "Pilar Esteve", zone: "Algirós", phone: "612 345 008", kit: "total", source: "Web", rep: "r3", stage: "cita", days: 1, cita: "Hoy · 17:30" },
  { id: 9, name: "Vicente Roig", zone: "Ciutat Vella", phone: "612 345 009", kit: "esencial", source: "Puerta a puerta", rep: "r1", stage: "cita", days: 3, cita: "Mañana · 10:00" },
  { id: 10, name: "Farmacia Soler", zone: "Eixample", phone: "612 345 010", kit: "negocio", source: "Referido", rep: "r2", stage: "cita", days: 2, cita: "Jueves · 12:00" },
  { id: 11, name: "Teresa Bofill", zone: "Pla del Real", phone: "612 345 011", kit: "total", source: "Campaña verano", rep: "r3", stage: "visita", days: 2 },
  { id: 12, name: "Jaume Tormo", zone: "Jesús", phone: "612 345 012", kit: "esencial", source: "Puerta a puerta", rep: "r4", stage: "visita", days: 5 },
  { id: 13, name: "Inma Calatayud", zone: "Ruzafa", phone: "612 345 013", kit: "total", source: "Referido", rep: "r2", stage: "propuesta", days: 3 },
  { id: 14, name: "Óscar Membrillo", zone: "Centro", phone: "612 345 014", kit: "esencial", source: "Escudo Vecinal", rep: "r1", stage: "propuesta", days: 1 },
  { id: 15, name: "Gimnasio Pulso", zone: "Algirós", phone: "612 345 015", kit: "negocio", source: "Web", rep: "r3", stage: "contrato", days: 1 },
  { id: 16, name: "Lola Ferrandis", zone: "Benimaclet", phone: "612 345 016", kit: "total", source: "Referido", rep: "r3", stage: "instalacion", days: 2, cita: "Viernes · 09:00" },
];

const CUSTOMERS = [
  { id: 1, name: "Mari Carmen Soriano", zone: "Ruzafa, Valencia", kit: "total", since: "03/2026", status: "Activo", next: "Revisión 09/2026", rep: "r2" },
  { id: 2, name: "Antonio Belda", zone: "Benimaclet, Valencia", kit: "esencial", since: "01/2026", status: "Activo", next: "Revisión 07/2026", rep: "r3" },
  { id: 3, name: "Restaurante La Pepica", zone: "Cabanyal, Valencia", kit: "negocio", since: "11/2025", status: "Activo", next: "Revisión 11/2026", rep: "r2" },
  { id: 4, name: "Encarna Tortosa", zone: "Patraix, Valencia", kit: "esencial", since: "02/2026", status: "Pendiente instalación", next: "Instalación 18/06", rep: "r4" },
  { id: 5, name: "Familia Gironés", zone: "Algirós, Valencia", kit: "total", since: "05/2026", status: "Activo", next: "Revisión 11/2026", rep: "r3" },
  { id: 6, name: "Ferretería Casanova", zone: "Eixample, Valencia", kit: "negocio", since: "04/2026", status: "Activo", next: "Revisión 10/2026", rep: "r2" },
  { id: 7, name: "Lola Ferrandis", zone: "Benimaclet, Valencia", kit: "total", since: "06/2026", status: "Pendiente instalación", next: "Instalación 19/06", rep: "r3" },
  { id: 8, name: "Manuel Peris", zone: "Jesús, Valencia", kit: "esencial", since: "12/2025", status: "Activo", next: "Revisión 12/2026", rep: "r4" },
];

const VENTAS_MES = [
  { mes: "Ene", instalaciones: 8 },
  { mes: "Feb", instalaciones: 11 },
  { mes: "Mar", instalaciones: 9 },
  { mes: "Abr", instalaciones: 14 },
  { mes: "May", instalaciones: 12 },
  { mes: "Jun", instalaciones: 16 },
];

const LEADS_ORIGEN = [
  { name: "Puerta a puerta", value: 35, color: "#0f172a" },
  { name: "Referidos", value: 25, color: "#0d9488" },
  { name: "Web", value: 20, color: "#f59e0b" },
  { name: "Escudo Vecinal", value: 12, color: "#0284c7" },
  { name: "Campañas", value: 8, color: "#7c3aed" },
];

const REP_PERF = [
  { rep: "r1", ventas: 9, objetivo: 10 },
  { rep: "r2", ventas: 13, objetivo: 10 },
  { rep: "r3", ventas: 11, objetivo: 10 },
  { rep: "r4", ventas: 7, objetivo: 10 },
];

const AGENDA = [
  { day: "Lunes 16", items: [
    { time: "09:00", name: "Encarna Tortosa", type: "Instalación", zone: "Patraix", rep: "r4" },
    { time: "11:30", name: "Vicente Roig", type: "Primera visita", zone: "Ciutat Vella", rep: "r1" },
    { time: "17:00", name: "Marisa Donat", type: "Cita comercial", zone: "Benimaclet", rep: "r3" },
  ]},
  { day: "Martes 17", items: [
    { time: "10:00", name: "Federico Llorca", type: "Primera visita", zone: "Patraix", rep: "r4" },
    { time: "16:30", name: "Pilar Esteve", type: "Cita comercial", zone: "Algirós", rep: "r3" },
  ]},
  { day: "Miércoles 18", items: [
    { time: "09:30", name: "Encarna Tortosa", type: "Instalación", zone: "Patraix", rep: "r4" },
    { time: "12:00", name: "Farmacia Soler", type: "Cita comercial", zone: "Eixample", rep: "r2" },
    { time: "18:00", name: "Óscar Membrillo", type: "Firma contrato", zone: "Centro", rep: "r1" },
  ]},
  { day: "Jueves 19", items: [
    { time: "09:00", name: "Lola Ferrandis", type: "Instalación", zone: "Benimaclet", rep: "r3" },
    { time: "12:00", name: "Farmacia Soler", type: "Cita comercial", zone: "Eixample", rep: "r2" },
  ]},
  { day: "Viernes 20", items: [
    { time: "09:00", name: "Lola Ferrandis", type: "Instalación", zone: "Benimaclet", rep: "r3" },
    { time: "11:00", name: "Gimnasio Pulso", type: "Instalación", zone: "Algirós", rep: "r3" },
  ]},
  { day: "Sábado 21", items: [
    { time: "10:00", name: "Inma Calatayud", type: "Cita comercial", zone: "Ruzafa", rep: "r2" },
  ]},
];

const NAV = [
  { id: "dashboard", label: "Resumen", icon: LayoutDashboard },
  { id: "pipeline", label: "Pipeline", icon: Workflow },
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "catalogo", label: "Catálogo", icon: Package },
  { id: "comerciales", label: "Comerciales", icon: Trophy },
];

const PAGE_TITLES = {
  dashboard: "Resumen general",
  pipeline: "Pipeline de ventas",
  agenda: "Agenda de visitas",
  clientes: "Clientes",
  catalogo: "Catálogo y presupuestos",
  comerciales: "Equipo comercial",
  empleados: "Empleados",
};

// ============================================================
// HELPERS
// ============================================================
function repById(id) { return REPS.find((r) => r.id === id); }

function Avatar({ rep, size = "w-8 h-8" }) {
  return (
    <div className={`${size} ${rep.color} rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0`}>
      {rep.initials}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accent}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <div className="text-2xl font-serif font-bold text-slate-900 tabular-nums leading-none">{value}</div>
        <div className="text-sm text-slate-500 mt-1">{label}</div>
        {sub && <div className="text-xs text-teal-600 mt-1 font-medium">{sub}</div>}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    "Activo": "bg-teal-50 text-teal-700 border-teal-200",
    "Pendiente instalación": "bg-amber-50 text-amber-700 border-amber-200",
  };
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${styles[status] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
      {status}
    </span>
  );
}

// ============================================================
// VIEWS
// ============================================================
function DashboardView() {
  const totalLeadsActivos = INITIAL_LEADS.filter((l) => l.stage !== "instalacion").length;
  const citasSemana = AGENDA.reduce((acc, d) => acc + d.items.filter((i) => i.type !== "Instalación").length, 0);
  const mrr = CUSTOMERS.filter((c) => c.status === "Activo").reduce((acc, c) => acc + KITS[c.kit].cuota, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Leads activos en pipeline" value={totalLeadsActivos} sub="+4 esta semana" icon={Workflow} accent="bg-slate-900" />
        <StatCard label="Citas esta semana" value={citasSemana} sub="6 días, 4 comerciales" icon={CalendarDays} accent="bg-amber-500" />
        <StatCard label="Tasa de conversión" value="27%" sub="Lead → Contrato (últ. 30 días)" icon={TrendingUp} accent="bg-teal-600" />
        <StatCard label="MRR activo" value={`${mrr.toFixed(2).replace(".", ",")} €`} sub={`${CUSTOMERS.filter((c) => c.status === "Activo").length} clientes en monitorización`} icon={ShieldCheck} accent="bg-sky-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-serif text-base font-bold text-slate-900 mb-1">Instalaciones por mes</h3>
          <p className="text-sm text-slate-500 mb-4">Últimos 6 meses</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={VENTAS_MES}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} width={28} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }} />
                <Bar dataKey="instalaciones" fill="#f59e0b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-serif text-base font-bold text-slate-900 mb-1">Leads por origen</h3>
          <p className="text-sm text-slate-500 mb-2">Últimos 30 días</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={LEADS_ORIGEN} dataKey="value" nameKey="name" innerRadius={40} outerRadius={65} paddingAngle={2}>
                  {LEADS_ORIGEN.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 mt-2">
            {LEADS_ORIGEN.map((o) => (
              <div key={o.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: o.color }} />
                  <span className="text-slate-600">{o.name}</span>
                </div>
                <span className="text-slate-900 font-medium tabular-nums">{o.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-serif text-base font-bold text-slate-900 mb-3">Ranking comercial — junio</h3>
          <div className="space-y-3">
            {[...REP_PERF].sort((a, b) => b.ventas - a.ventas).map((p, i) => {
              const rep = repById(p.rep);
              const pct = Math.min(100, Math.round((p.ventas / p.objetivo) * 100));
              return (
                <div key={p.rep} className="flex items-center gap-3">
                  <span className="text-sm font-serif font-bold text-slate-400 w-4">{i + 1}</span>
                  <Avatar rep={rep} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-900">{rep.name}</span>
                      <span className="text-slate-500 tabular-nums">{p.ventas} / {p.objetivo}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 100 ? "bg-teal-600" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-serif text-base font-bold text-slate-900 mb-3">Próximas citas</h3>
          <div className="space-y-2">
            {AGENDA[0].items.concat(AGENDA[1].items.slice(0, 1)).map((item, i) => {
              const rep = repById(item.rep);
              return (
                <div key={i} className="flex items-center gap-3 text-sm border-b border-slate-100 last:border-0 pb-2 last:pb-0">
                  <div className="w-14 text-xs font-semibold text-slate-500 tabular-nums">{item.time}</div>
                  <div className="flex-1">
                    <div className="font-medium text-slate-900">{item.name}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" />{item.zone} · {item.type}</div>
                  </div>
                  <Avatar rep={rep} size="w-6 h-6" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewLeadModal({ onClose, onAdd }) {
  const [form, setForm] = useState({ name: "", zone: "", phone: "", kit: "esencial", source: "Puerta a puerta", rep: "r1" });
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-30 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-lg font-bold text-slate-900">Nuevo lead</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500">Nombre / negocio</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Ej: Manuela Ferri" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Zona</label>
              <input value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}
                className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="Ej: Ruzafa" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Teléfono</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="612 000 000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Interés</label>
              <select value={form.kit} onChange={(e) => setForm({ ...form, kit: e.target.value })}
                className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                {Object.entries(KITS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Comercial</label>
              <select value={form.rep} onChange={(e) => setForm({ ...form, rep: e.target.value })}
                className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                {REPS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Origen</label>
            <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
              className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              {["Puerta a puerta", "Referido", "Web", "Escudo Vecinal", "Campaña verano"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 border border-slate-300 rounded-lg py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button
            onClick={() => { if (form.name && form.zone) { onAdd(form); onClose(); } }}
            className="flex-1 bg-amber-500 hover:bg-amber-600 rounded-lg py-2 text-sm font-medium text-white">
            Crear lead
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadPanel({ lead, onClose, onMove }) {
  const rep = repById(lead.rep);
  const kit = KITS[lead.kit];
  const stageIdx = STAGES.findIndex((s) => s.id === lead.stage);
  const isBusiness = lead.kit === "negocio";
  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-white border-l border-slate-200 shadow-xl p-5 flex flex-col z-20">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full text-white ${STAGES[stageIdx].color}`}>{STAGES[stageIdx].label}</span>
        <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
      </div>
      <h3 className="font-serif text-xl font-bold text-slate-900 mt-2 flex items-center gap-2">
        {isBusiness && <Building2 className="w-4 h-4 text-slate-400" />}
        {lead.name}
      </h3>
      <div className="text-sm text-slate-500 mt-1 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{lead.zone}, Valencia</div>
      <div className="text-sm text-slate-500 mt-1 flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{lead.phone}</div>

      <div className="mt-4 bg-slate-50 rounded-lg p-3 space-y-2">
        <div className="flex justify-between text-sm"><span className="text-slate-500">Producto de interés</span><span className="font-medium text-slate-900">{kit.name}</span></div>
        <div className="flex justify-between text-sm"><span className="text-slate-500">Alta + cuota</span><span className="font-medium text-slate-900 tabular-nums">{kit.alta} € + {kit.cuota.toFixed(2).replace(".", ",")} €/mes</span></div>
        <div className="flex justify-between text-sm"><span className="text-slate-500">Origen</span><span className="font-medium text-slate-900">{lead.source}</span></div>
        <div className="flex justify-between text-sm"><span className="text-slate-500">Días en esta fase</span><span className="font-medium text-slate-900 tabular-nums">{lead.days}</span></div>
        {lead.cita && <div className="flex justify-between text-sm"><span className="text-slate-500">Próxima cita</span><span className="font-medium text-teal-600">{lead.cita}</span></div>}
      </div>

      <div className="mt-4">
        <div className="text-xs font-medium text-slate-500 mb-2">Comercial asignado</div>
        <div className="flex items-center gap-2">
          <Avatar rep={rep} />
          <div>
            <div className="text-sm font-medium text-slate-900">{rep.name}</div>
            <div className="text-xs text-slate-500">{rep.zone}</div>
          </div>
        </div>
      </div>

      <div className="mt-auto pt-4 border-t border-slate-100 flex gap-2">
        <button disabled={stageIdx === 0} onClick={() => onMove(lead.id, -1)}
          className="flex-1 flex items-center justify-center gap-1 border border-slate-300 rounded-lg py-2 text-sm font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50">
          <ArrowLeft className="w-4 h-4" /> Atrás
        </button>
        <button disabled={stageIdx === STAGES.length - 1} onClick={() => onMove(lead.id, 1)}
          className="flex-1 flex items-center justify-center gap-1 bg-amber-500 hover:bg-amber-600 rounded-lg py-2 text-sm font-medium text-white disabled:opacity-40">
          Avanzar <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function PipelineView() {
  const [leads, setLeads] = useState(INITIAL_LEADS);
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);

  function moveStage(id, dir) {
    setLeads((prev) => prev.map((l) => {
      if (l.id !== id) return l;
      const idx = STAGES.findIndex((s) => s.id === l.stage);
      const newIdx = Math.min(STAGES.length - 1, Math.max(0, idx + dir));
      return { ...l, stage: STAGES[newIdx].id, days: 0 };
    }));
    setSelected((sel) => sel && sel.id === id ? { ...sel, stage: STAGES[Math.min(STAGES.length - 1, Math.max(0, STAGES.findIndex((s) => s.id === sel.stage) + dir))].id, days: 0 } : sel);
  }

  function addLead(form) {
    const nextId = Math.max(...leads.map((l) => l.id)) + 1;
    setLeads((prev) => [...prev, { id: nextId, ...form, stage: "nuevo", days: 0 }]);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">{leads.length} leads en el embudo · pulsa una tarjeta para ver el detalle</p>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg px-3 py-2">
          <Plus className="w-4 h-4" /> Nuevo lead
        </button>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 flex-1">
        {STAGES.map((stage) => {
          const items = leads.filter((l) => l.stage === stage.id);
          const value = items.reduce((acc, l) => acc + KITS[l.kit].cuota, 0);
          return (
            <div key={stage.id} className="flex-shrink-0 w-64 flex flex-col">
              <div className={`h-1 rounded-full ${stage.color} mb-2`} />
              <div className="flex items-baseline justify-between mb-3 px-0.5">
                <h3 className="text-sm font-semibold text-slate-700">{stage.label}</h3>
                <span className="text-xs text-slate-400">{items.length}</span>
              </div>
              <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 260px)" }}>
                {items.map((lead) => {
                  const rep = repById(lead.rep);
                  const isBusiness = lead.kit === "negocio";
                  return (
                    <button key={lead.id} onClick={() => setSelected(lead)}
                      className="w-full text-left bg-white border border-slate-200 rounded-lg p-3 hover:border-amber-400 hover:shadow-sm transition">
                      <div className="font-medium text-sm text-slate-900 flex items-center gap-1.5">
                        {isBusiness && <Building2 className="w-3.5 h-3.5 text-slate-400" />}
                        {lead.name}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-1 mt-1"><MapPin className="w-3 h-3" />{lead.zone}</div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs font-medium text-amber-600">{KITS[lead.kit].name}</span>
                        <Avatar rep={rep} size="w-6 h-6" />
                      </div>
                      {lead.cita && <div className="text-xs text-teal-600 mt-1.5 flex items-center gap-1"><Clock className="w-3 h-3" />{lead.cita}</div>}
                    </button>
                  );
                })}
                {items.length === 0 && <div className="text-xs text-slate-400 italic px-1 py-2">Sin leads en esta fase</div>}
              </div>
              <div className="text-xs text-slate-400 mt-2 px-0.5 tabular-nums">{value.toFixed(2).replace(".", ",")} €/mes potencial</div>
            </div>
          );
        })}
      </div>
      {selected && <LeadPanel lead={selected} onClose={() => setSelected(null)} onMove={moveStage} />}
      {showModal && <NewLeadModal onClose={() => setShowModal(false)} onAdd={addLead} />}
    </div>
  );
}

function AgendaView() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {AGENDA.map((day) => (
        <div key={day.day} className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-serif text-base font-bold text-slate-900 mb-3">{day.day}</h3>
          <div className="space-y-2">
            {day.items.map((item, i) => {
              const rep = repById(item.rep);
              const typeColor = item.type === "Instalación" ? "text-emerald-600" : item.type === "Firma contrato" ? "text-teal-600" : "text-amber-600";
              return (
                <div key={i} className="flex items-center gap-3 border border-slate-100 rounded-lg p-2.5">
                  <div className="text-xs font-semibold text-slate-700 tabular-nums w-12">{item.time}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{item.name}</div>
                    <div className={`text-xs ${typeColor}`}>{item.type} · {item.zone}</div>
                  </div>
                  <Avatar rep={rep} size="w-6 h-6" />
                </div>
              );
            })}
            {day.items.length === 0 && <div className="text-xs text-slate-400 italic py-2">Sin visitas programadas</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ClientesView() {
  const [search, setSearch] = useState("");
  const filtered = CUSTOMERS.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.zone.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="p-4 border-b border-slate-100 flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente o zona..."
            className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <span className="text-sm text-slate-500 ml-auto">{filtered.length} clientes</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
            <th className="px-4 py-2 font-medium">Cliente</th>
            <th className="px-4 py-2 font-medium">Zona</th>
            <th className="px-4 py-2 font-medium">Plan</th>
            <th className="px-4 py-2 font-medium">Cliente desde</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium">Próximo evento</th>
            <th className="px-4 py-2 font-medium">Comercial</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((c) => (
            <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
              <td className="px-4 py-3 text-slate-500">{c.zone}</td>
              <td className="px-4 py-3 text-slate-700">{KITS[c.kit].name}</td>
              <td className="px-4 py-3 text-slate-500 tabular-nums">{c.since}</td>
              <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
              <td className="px-4 py-3 text-slate-500">{c.next}</td>
              <td className="px-4 py-3"><Avatar rep={repById(c.rep)} size="w-6 h-6" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CatalogoView() {
  const [kit, setKit] = useState("total");
  const [clientName, setClientName] = useState("");
  const [generated, setGenerated] = useState(false);
  const selected = KITS[kit];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Object.entries(KITS).map(([k, v]) => (
          <div key={k} className={`rounded-xl border p-5 ${kit === k ? "border-amber-400 ring-2 ring-amber-100" : "border-slate-200"} bg-white`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-serif text-lg font-bold text-slate-900">{v.name}</h3>
              {kit === k && <CheckCircle2 className="w-5 h-5 text-amber-500" />}
            </div>
            <p className="text-sm text-slate-500 mb-4">{v.desc}</p>
            <div className="text-2xl font-serif font-bold text-slate-900 tabular-nums">{v.alta} €</div>
            <div className="text-xs text-slate-400 mb-4">instalación · luego {v.cuota.toFixed(2).replace(".", ",")} €/mes</div>
            <button onClick={() => { setKit(k); setGenerated(false); }}
              className={`w-full rounded-lg py-2 text-sm font-medium ${kit === k ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
              {kit === k ? "Seleccionado" : "Seleccionar"}
            </button>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-serif text-base font-bold text-slate-900 mb-1">Generador de presupuesto</h3>
        <p className="text-sm text-slate-500 mb-4">Genera un resumen rápido para enviar o entregar en mano al cliente.</p>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input value={clientName} onChange={(e) => { setClientName(e.target.value); setGenerated(false); }}
            placeholder="Nombre del cliente"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <button onClick={() => setGenerated(true)} disabled={!clientName}
            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-4 py-2">
            Generar presupuesto
          </button>
        </div>
        {generated && (
          <div className="border border-dashed border-amber-300 rounded-lg p-4 bg-amber-50/40">
            <div className="text-xs uppercase tracking-wide text-amber-600 font-semibold mb-2">Presupuesto Seguxat</div>
            <div className="flex justify-between text-sm mb-1"><span className="text-slate-600">Cliente</span><span className="font-medium text-slate-900">{clientName}</span></div>
            <div className="flex justify-between text-sm mb-1"><span className="text-slate-600">Plan</span><span className="font-medium text-slate-900">{selected.name}</span></div>
            <div className="flex justify-between text-sm mb-1"><span className="text-slate-600">Instalación (pago único)</span><span className="font-medium text-slate-900 tabular-nums">{selected.alta.toFixed(2).replace(".", ",")} €</span></div>
            <div className="flex justify-between text-sm mb-1"><span className="text-slate-600">Cuota mensual monitorización</span><span className="font-medium text-slate-900 tabular-nums">{selected.cuota.toFixed(2).replace(".", ",")} €/mes</span></div>
            <div className="flex justify-between text-sm pt-2 mt-2 border-t border-amber-200"><span className="font-semibold text-slate-900">Total primer mes</span><span className="font-bold text-slate-900 tabular-nums">{(selected.alta + selected.cuota).toFixed(2).replace(".", ",")} €</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

function ComercialesView() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {REPS.map((rep) => {
        const perf = REP_PERF.find((p) => p.rep === rep.id);
        const activeLeads = INITIAL_LEADS.filter((l) => l.rep === rep.id && l.stage !== "instalacion").length;
        const pct = Math.min(100, Math.round((perf.ventas / perf.objetivo) * 100));
        const comision = perf.ventas * 35;
        return (
          <div key={rep.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-3 mb-4">
              <Avatar rep={rep} size="w-12 h-12" />
              <div>
                <div className="font-serif text-lg font-bold text-slate-900">{rep.name}</div>
                <div className="text-sm text-slate-500 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{rep.zone}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-xl font-serif font-bold text-slate-900 tabular-nums">{activeLeads}</div>
                <div className="text-xs text-slate-500 mt-0.5">Leads activos</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-xl font-serif font-bold text-slate-900 tabular-nums">{perf.ventas}</div>
                <div className="text-xs text-slate-500 mt-0.5">Ventas junio</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-xl font-serif font-bold text-slate-900 tabular-nums">{comision} €</div>
                <div className="text-xs text-slate-500 mt-0.5">Comisión est.</div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Objetivo mensual</span>
                <span className="tabular-nums">{perf.ventas} / {perf.objetivo} ({pct}%)</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${pct >= 100 ? "bg-teal-600" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// AUTENTICACIÓN — login con email/contraseña + verificación Google
// ============================================================

/**
 * Botón "Continuar con Google" usando Google Identity Services.
 * Si el script no puede cargarse (p. ej. en esta vista previa, sin acceso
 * a accounts.google.com), se muestra un botón de respaldo que explica la
 * situación en lugar de fallar en silencio.
 */
function GoogleButton({ onCredential, label }) {
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const containerId = "google-signin-button";

  useEffect(() => {
    let timeout;
    if (window.google?.accounts?.id) {
      setReady(true);
    } else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => setReady(true);
      script.onerror = () => setBlocked(true);
      document.head.appendChild(script);
      timeout = setTimeout(() => { if (!window.google?.accounts?.id) setBlocked(true); }, 2500);
    }
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!ready || !window.google?.accounts?.id) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (resp) => onCredential(resp.credential),
    });
    const el = document.getElementById(containerId);
    if (el) window.google.accounts.id.renderButton(el, { theme: "outline", size: "large", width: 280 });
  }, [ready]);

  if (blocked) {
    return (
      <div className="text-center">
        <button
          onClick={() => onCredential(null)}
          className="w-full flex items-center justify-center gap-2 border border-slate-300 rounded-lg py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ShieldCheck className="w-4 h-4 text-teal-600" /> {label || "Verificar con Google"}
        </button>
        <p className="text-xs text-slate-400 mt-2">
          No se pudo cargar el botón de Google en esta vista previa. En la app desplegada,
          aquí aparece el selector real de cuentas de Google.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div id={containerId} />
      {!ready && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
    </div>
  );
}

function LoginView({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState("credentials"); // credentials | google-verify | google-link
  const [pendingToken, setPendingToken] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  async function submitCredentials(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "No se pudo iniciar sesión"); return; }
      setPendingToken(data.pendingToken);
      setStep(data.step === "google-link-required" ? "google-link" : "google-verify");
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }

  async function submitGoogle(idToken) {
    setError(null);
    setLoading(true);
    const path = step === "google-link" ? "google-link" : "google-verify";
    try {
      const res = await fetch(`${API_BASE}/auth/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, googleIdToken: idToken }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "No se pudo verificar con Google"); return; }
      onLogin(data.employee, data.token);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-6">
        <div className="text-center mb-6">
          <div className="font-serif text-3xl font-bold tracking-tight text-slate-900">
            SEGU<span className="text-amber-500">X</span>AT
          </div>
          <div className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">CRM de ventas</div>
        </div>

        {step === "credentials" && (
          <form onSubmit={submitCredentials} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Email</label>
              <div className="relative mt-1">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="tu@seguxat.es" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Contraseña</label>
              <div className="relative mt-1">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="••••••••" />
              </div>
            </div>
            {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg py-2.5 flex items-center justify-center gap-2 disabled:opacity-60">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Iniciar sesión"}
            </button>
          </form>
        )}

        {(step === "google-verify" || step === "google-link") && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-slate-600">
              {step === "google-link"
                ? "Primer inicio de sesión: vincula tu cuenta de Google para activar la verificación en dos pasos."
                : "Verificación en dos pasos: confirma tu identidad con Google para continuar."}
            </p>
            <GoogleButton onCredential={submitGoogle} label={step === "google-link" ? "Vincular con Google" : "Verificar con Google"} />
            {error && <p className="text-xs text-red-600 flex items-center justify-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{error}</p>}
            <button onClick={() => { setStep("credentials"); setError(null); }} className="text-xs text-slate-400 hover:text-slate-600">
              ← Volver
            </button>
          </div>
        )}

        {offline && (
          <div className="mt-4 border-t border-slate-100 pt-4 text-center">
            <p className="text-xs text-slate-400 mb-2 flex items-center justify-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> No se pudo conectar con el servidor ({API_BASE}).
            </p>
            <button onClick={() => onLogin({ _id: "demo", name: "Ivan (demo)", email: "director@seguxat.es", role: "director", zone: "Toda Valencia" }, null)}
              className="text-sm font-medium text-amber-600 hover:text-amber-700">
              Continuar en modo demo →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// EMPLEADOS — solo director
// ============================================================
function EmpleadosView({ token, currentUser }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);

  async function load() {
    if (!token) { setLoading(false); setError("offline"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/employees`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEmployees(data.employees);
      setError(null);
    } catch {
      setError("offline");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [token]);

  async function toggleActive(emp) {
    if (!token) return;
    await fetch(`${API_BASE}/employees/${emp._id}/active`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ active: !emp.active }),
    });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Solo el director puede crear, desactivar o cambiar el rol de empleados.</p>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg px-3 py-2">
          <Plus className="w-4 h-4" /> Nuevo empleado
        </button>
      </div>

      {error === "offline" && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          No se pudo conectar con {API_BASE}/employees. Esta vista necesita el backend desplegado y en marcha.
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando...</div>
      ) : employees.length > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Rol</th>
                <th className="px-4 py-2 font-medium">Zona</th>
                <th className="px-4 py-2 font-medium">Google vinculado</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp._id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{emp.name}</td>
                  <td className="px-4 py-3 text-slate-500">{emp.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${emp.role === "director" ? "bg-slate-900 text-white border-slate-900" : "bg-slate-50 text-slate-600 border-slate-200"}`}>
                      {emp.role === "director" ? "Director" : "Comercial"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{emp.zone || "—"}</td>
                  <td className="px-4 py-3">
                    {emp.googleId ? <CheckCircle2 className="w-4 h-4 text-teal-600" /> : <span className="text-xs text-slate-400">Pendiente</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={emp.active ? "Activo" : "Inactivo"} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {emp._id !== currentUser._id && (
                      <button onClick={() => toggleActive(emp)} className="text-xs text-slate-400 hover:text-red-600">
                        {emp.active ? "Desactivar" : "Activar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showModal && <NewEmployeeModal token={token} onClose={() => setShowModal(false)} onCreated={load} />}
    </div>
  );
}

function NewEmployeeModal({ token, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "comercial", zone: "" });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    if (!form.name || !form.email || !form.password) { setError("Completa nombre, email y contraseña"); return; }
    if (form.password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres"); return; }
    if (!token) { setError("Sin conexión con el backend — no se puede crear el empleado en esta vista previa"); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "No se pudo crear el empleado"); return; }
      onCreated();
      onClose();
    } catch {
      setError("No se pudo conectar con el backend");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-30 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-lg font-bold text-slate-900">Nuevo empleado</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500">Nombre completo</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Email (será su usuario y su cuenta de Google a vincular)</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Contraseña inicial (mín. 8 caracteres)</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Rol</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="comercial">Comercial</option>
                <option value="director">Director</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Zona</label>
              <input value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}
                placeholder="Ej: Benimaclet"
                className="w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          </div>
          {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{error}</p>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 border border-slate-300 rounded-lg py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={submit} disabled={loading}
            className="flex-1 bg-amber-500 hover:bg-amber-600 rounded-lg py-2 text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-60">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Crear empleado"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// APP SHELL
// ============================================================
export default function SeguxatCRM() {
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(null);
  const [active, setActive] = useState("dashboard");

  if (!currentUser) {
    return <LoginView onLogin={(employee, tok) => { setCurrentUser(employee); setToken(tok); }} />;
  }

  const isDirector = currentUser.role === "director";
  const nav = isDirector ? [...NAV, { id: "empleados", label: "Empleados", icon: UserCog }] : NAV;

  const views = {
    dashboard: <DashboardView />,
    pipeline: <PipelineView />,
    agenda: <AgendaView />,
    clientes: <ClientesView />,
    catalogo: <CatalogoView />,
    comerciales: <ComercialesView />,
    empleados: <EmpleadosView token={token} currentUser={currentUser} />,
  };

  function logout() {
    setCurrentUser(null);
    setToken(null);
    setActive("dashboard");
  }

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-800 text-sm">
      {/* Sidebar */}
      <aside className="w-60 bg-slate-900 text-white flex flex-col shrink-0">
        <div className="p-5 border-b border-white/10">
          <div className="font-serif text-2xl font-bold tracking-tight">
            SEGU<span className="text-amber-400">X</span>AT
          </div>
          <div className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">CRM de ventas</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button key={item.id} onClick={() => setActive(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}>
                <Icon className={`w-4 h-4 ${isActive ? "text-amber-400" : ""}`} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-white/10 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-xs font-bold text-slate-900">
            {currentUser.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{currentUser.name}</div>
            <div className="text-xs text-slate-400 truncate">{isDirector ? "Director" : "Comercial"} · {currentUser.zone || "Seguxat"}</div>
          </div>
          <button onClick={logout} title="Cerrar sesión" className="ml-auto text-slate-400 hover:text-white">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          <div>
            <h1 className="font-serif text-xl font-bold text-slate-900">{PAGE_TITLES[active]}</h1>
            <p className="text-xs text-slate-400">Lunes, 15 de junio de 2026</p>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative text-slate-400 hover:text-slate-600">
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full" />
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          {views[active]}
        </main>
      </div>
    </div>
  );
}
