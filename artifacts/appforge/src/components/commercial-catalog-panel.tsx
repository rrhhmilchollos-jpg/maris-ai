import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BriefcaseBusiness, Loader2, RefreshCw, Sparkles, CheckCircle2 } from "lucide-react";

type Offer = {
  _id: string;
  title: string;
  vertical: string;
  deliveryModel: string;
  summary: string;
  buyer: string;
  differentiator: string;
  modules: string[];
  integrations: string[];
  pricing: { implementationMinEur: number; implementationMaxEur: number; enterpriseProgramMaxEur?: number; recurringFromEur?: number };
  commercialStatus: "draft" | "ready_to_generate" | "generated" | "ready_to_sell" | "sold" | "archived";
  regulatoryNotes?: string;
  playbook?: {
    businessOutcome?: string;
    discoveryQuestions?: string;
    generationBrief?: string;
    implementationPhases?: string;
    demoData?: string;
    integrations?: string;
    acceptanceCriteria?: string;
    salesDelivery?: string;
    riskLimits?: string;
  };
};

const STATUS_LABELS: Record<Offer["commercialStatus"], string> = {
  draft: "Borrador",
  ready_to_generate: "Lista para generar",
  generated: "App generada",
  ready_to_sell: "Lista para vender",
  sold: "Vendida",
  archived: "Archivada",
};

const money = (value?: number) => typeof value === "number" ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value) : "—";

export function CommercialCatalogPanel() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const response = await apiFetch<{ offers: Offer[] }>("/api/admin/commercial-catalog");
      setOffers(response.offers || []);
    } catch {
      setError("No se ha podido cargar el inventario comercial privado.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const seed = async () => {
    setSeeding(true); setError(null);
    try {
      const response = await apiFetch<{ offers: Offer[] }>("/api/admin/commercial-catalog/seed", { method: "POST" });
      setOffers(response.offers || []);
    } catch { setError("No se ha podido preparar el catálogo inicial."); }
    finally { setSeeding(false); }
  };

  const startGeneration = (offer: Offer) => {
    const brief = [
      `Construye ${offer.title}, una ${offer.deliveryModel.toLowerCase()} para ${offer.vertical.toLowerCase()}.`,
      `Resumen: ${offer.summary}`,
      `Comprador: ${offer.buyer}`,
      `Diferenciación: ${offer.differentiator}`,
      `Módulos obligatorios: ${offer.modules.join(", ")}.`,
      `Integraciones previstas: ${offer.integrations.join(", ")}.`,
      "Genera una aplicación completa, funcional, con interfaz profesional en español, datos de demostración explícitamente etiquetados, control de roles, auditoría y sin pantallas placeholder.",
      "No actives pagos, llamadas, integraciones reguladas ni acciones externas sin credenciales y autorización explícita.",
    ].join("\n\n");
    try { localStorage.setItem("appforge_pending_prompt", brief); } catch { /* la navegación sigue disponible */ }
    window.location.assign("/dashboard");
  };

  const setStatus = async (id: string, commercialStatus: Offer["commercialStatus"]) => {
    setUpdatingId(id);
    try {
      const response = await apiFetch<{ offer: Offer }>(`/api/admin/commercial-catalog/${id}/status`, { method: "PATCH", body: JSON.stringify({ commercialStatus }) });
      setOffers((current) => current.map((offer) => offer._id === id ? response.offer : offer));
    } catch { setError("No se ha podido actualizar el estado comercial."); }
    finally { setUpdatingId(null); }
  };

  const totals = useMemo(() => ({
    ready: offers.filter((offer) => offer.commercialStatus === "ready_to_generate").length,
    sellable: offers.filter((offer) => offer.commercialStatus === "ready_to_sell").length,
    potentialMin: offers.reduce((sum, offer) => sum + offer.pricing.implementationMinEur, 0),
  }), [offers]);

  return <div className="space-y-4">
    <Card className="bg-card/40 border-violet-500/20">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5 text-violet-400" /> Inventario comercial privado</CardTitle>
          <CardDescription className="mt-1 max-w-3xl">Productos digitales de implantación consultiva. Son propuestas privadas para tu cartera: no se publican, cobran ni se ofrecen automáticamente a terceros.</CardDescription>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
          <Button size="sm" onClick={() => void seed()} disabled={seeding}><Sparkles className="h-4 w-4 mr-2" />{seeding ? "Preparando…" : offers.length ? "Actualizar catálogo" : "Crear catálogo"}</Button>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-white/10 p-3"><p className="text-xs text-muted-foreground">Ofertas privadas</p><p className="text-2xl font-semibold">{offers.length}</p></div>
        <div className="rounded-lg border border-white/10 p-3"><p className="text-xs text-muted-foreground">Listas para generar</p><p className="text-2xl font-semibold text-violet-300">{totals.ready}</p></div>
        <div className="rounded-lg border border-white/10 p-3"><p className="text-xs text-muted-foreground">Valor mínimo del inventario</p><p className="text-2xl font-semibold text-emerald-300">{money(totals.potentialMin)}</p></div>
      </CardContent>
    </Card>

    {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
    {loading ? <div className="flex items-center justify-center py-14 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Cargando inventario…</div> : offers.length === 0 ? <Card><CardContent className="py-10 text-center text-muted-foreground">Crea el catálogo inicial para ver las ofertas privadas.</CardContent></Card> : <div className="grid gap-4 xl:grid-cols-2">
      {offers.map((offer) => <Card key={offer._id} className="bg-card/35 border-white/10 overflow-hidden">
        <CardHeader className="space-y-2">
          <div className="flex justify-between gap-3"><div><CardTitle className="text-base">{offer.title}</CardTitle><CardDescription>{offer.vertical} · {offer.deliveryModel}</CardDescription></div><Badge variant="outline" className="h-fit whitespace-nowrap">{STATUS_LABELS[offer.commercialStatus]}</Badge></div>
          <p className="text-sm text-muted-foreground leading-relaxed">{offer.summary}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3 text-sm"><div className="rounded-md bg-black/20 p-3"><p className="text-xs text-muted-foreground">Implantación orientativa</p><p className="font-semibold text-emerald-300">{money(offer.pricing.implementationMinEur)}–{money(offer.pricing.implementationMaxEur)}</p>{offer.pricing.enterpriseProgramMaxEur && <p className="mt-1 text-xs text-muted-foreground">Programa enterprise hasta {money(offer.pricing.enterpriseProgramMaxEur)}</p>}</div><div className="rounded-md bg-black/20 p-3"><p className="text-xs text-muted-foreground">Comprador objetivo</p><p className="text-sm">{offer.buyer}</p></div></div>
          <div><p className="text-xs font-medium mb-1">Diferenciación</p><p className="text-sm text-muted-foreground">{offer.differentiator}</p></div>
          <div className="flex flex-wrap gap-1">{offer.modules.slice(0, 5).map((module) => <Badge key={module} variant="secondary" className="text-[11px]">{module}</Badge>)}</div>
          {offer.playbook && <details className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-sm">
            <summary className="cursor-pointer font-medium text-violet-200">Guía completa · de descubrimiento a operación</summary>
            <div className="mt-4 space-y-4 text-muted-foreground">
              <section><p className="font-medium text-foreground">Resultado y encaje</p><p className="whitespace-pre-line">{offer.playbook.businessOutcome}</p></section>
              <section><p className="font-medium text-foreground">Preguntas de descubrimiento</p><p className="whitespace-pre-line">{offer.playbook.discoveryQuestions}</p></section>
              <section><p className="font-medium text-foreground">Brief automático para generar</p><p className="whitespace-pre-line">{offer.playbook.generationBrief}</p></section>
              <section><p className="font-medium text-foreground">Paso a paso de implantación</p><p className="whitespace-pre-line">{offer.playbook.implementationPhases}</p></section>
              <section><p className="font-medium text-foreground">Datos demo e integraciones</p><p className="whitespace-pre-line">{offer.playbook.demoData}\n\n{offer.playbook.integrations}</p></section>
              <section><p className="font-medium text-foreground">Validación y entrega comercial</p><p className="whitespace-pre-line">{offer.playbook.acceptanceCriteria}\n\n{offer.playbook.salesDelivery}</p></section>
              <section><p className="font-medium text-amber-200">Límites y riesgos</p><p className="whitespace-pre-line">{offer.playbook.riskLimits}</p></section>
            </div>
          </details>}
          <div className="flex flex-wrap gap-2 pt-1"><Button size="sm" variant="secondary" onClick={() => startGeneration(offer)}><Sparkles className="h-4 w-4 mr-1" />Crear con Maris AI</Button><Button size="sm" variant="outline" disabled={updatingId === offer._id} onClick={() => void setStatus(offer._id, "generated")}>Marcar generada</Button><Button size="sm" disabled={updatingId === offer._id} onClick={() => void setStatus(offer._id, "ready_to_sell")}><CheckCircle2 className="h-4 w-4 mr-1" />Lista para vender</Button></div>
        </CardContent>
      </Card>)}
    </div>}
  </div>;
}
