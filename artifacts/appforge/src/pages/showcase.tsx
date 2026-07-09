import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, ExternalLink, LayoutGrid, ArrowLeft, Star, Zap, Rocket, Search, Filter } from "lucide-react";
import { motion } from "framer-motion";

interface ShowcaseItem {
  title: string;
  description: string;
  techStack: string[];
  kind: string;
  language: string;
  publicSlug: string;
  demoUrl: string | null;
  publishedAt: string;
}

const KIND_LABELS: Record<string, string> = {
  fullstack: "Full-stack",
  landing: "Landing page",
  "game-2d": "Juego 2D",
  "game-3d": "Juego 3D",
  saas: "SaaS",
  ecommerce: "Tienda online",
  crm: "CRM",
  mobile: "App móvil (PWA)",
};

const FILTERS = [
  { id: "all", label: "Todo" },
  { id: "fullstack", label: "Full-stack" },
  { id: "landing", label: "Landings" },
  { id: "saas", label: "SaaS" },
  { id: "ecommerce", label: "Tiendas" },
];

export default function ShowcasePage() {
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = "Casos de éxito — Apps reales creadas con Maris AI | Maris AI";
    const setMeta = (sel: string, val: string) => { const el = document.querySelector(sel); if (el) el.setAttribute("content", val); };
    setMeta('meta[name="description"]', "Descubre apps reales creadas con Maris AI por emprendedores de España y Latinoamérica. Tiendas online, CRMs, plataformas de cursos, apps de reservas y más.");
    let canonical = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    if (!canonical) { canonical = document.createElement("link") as HTMLLinkElement; canonical.rel = "canonical"; document.head.appendChild(canonical); }
    canonical.href = "https://www.marisai.es/showcase";
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "name": "Casos de éxito — Apps creadas con Maris AI",
      "description": "Galería pública de aplicaciones reales creadas con Maris AI por emprendedores de España y Latinoamérica.",
      "url": "https://www.marisai.es/showcase",
      "inLanguage": "es",
    };
    let s = document.querySelector('script[data-showcase-schema]');
    if (s) s.remove();
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-showcase-schema", "true");
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (filter !== "all") params.set("kind", filter);
    fetch(`/api/showcase?${params}`)
      .then((r) => r.json())
      .then((d: any) => { setItems(d.items || []); setTotal(d.total || 0); setTotalPages(d.totalPages || 1); })
      .catch(() => { setItems([]); setTotal(0); })
      .finally(() => setIsLoading(false));
  }, [page, filter]);

  const filtered = search.trim()
    ? items.filter(i => i.title.toLowerCase().includes(search.toLowerCase()) || i.description?.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <Layout>
      <div className="min-h-screen bg-background">

        {/* ── Hero ── */}
        <section className="container max-w-5xl mx-auto px-4 pt-20 pb-12 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
              <LayoutGrid className="h-4 w-4" />
              {total > 0 ? `${total} apps reales creadas con Maris AI` : "Apps reales creadas con Maris AI"}
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">
              Lo que crean nuestros<br />
              <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">clientes en minutos</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Aplicaciones reales desplegadas y funcionando. Creadas por emprendedores, autónomos y startups de España y Latinoamérica sin saber programar.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/sign-up">
                <Button size="lg" className="gap-2 bg-primary hover:bg-primary/90 text-white font-bold shadow-lg shadow-primary/30">
                  <Rocket className="h-5 w-5" />Crear la mía gratis
                </Button>
              </Link>
              <Link href="/demo">
                <Button size="lg" variant="outline" className="gap-2 border-white/20 text-white hover:bg-white/[0.05]">
                  <Zap className="h-5 w-5" />Ver demo en vivo
                </Button>
              </Link>
            </div>
          </motion.div>
        </section>

        {/* ── Galería de apps ── */}
        <section className="container max-w-6xl mx-auto px-4 pb-20">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
            <h2 className="text-2xl font-black text-white">Galería de apps públicas</h2>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar apps..."
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 py-2 text-base sm:text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <Filter className="h-4 w-4 text-white/30" />
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => { setFilter(f.id); setPage(1); }}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${filter === f.id ? "border-primary bg-primary/15 text-primary font-medium" : "border-white/[0.08] text-white/50 hover:text-white hover:border-white/20"}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-52 rounded-xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 space-y-4">
              <p className="text-muted-foreground">
                {search ? "No hay apps que coincidan con tu búsqueda." : "Todavía no hay proyectos públicos en esta categoría."}
              </p>
              <Link href="/sign-up">
                <Button className="gap-2">Crear la primera <ArrowRight className="h-4 w-4" /></Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {filtered.map((item, i) => (
                  <motion.div
                    key={item.publicSlug}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 flex flex-col gap-3 hover:border-primary/30 transition group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline" className="text-[10px] px-2">{KIND_LABELS[item.kind] || item.kind}</Badge>
                          {item.techStack?.slice(0, 1).map(t => <Badge key={t} variant="secondary" className="text-[10px] px-2">{t}</Badge>)}
                        </div>
                        <h3 className="font-bold text-white truncate group-hover:text-primary transition">{item.title}</h3>
                      </div>
                    </div>
                    {item.description && (
                      <p className="text-sm text-white/50 line-clamp-2 leading-relaxed">{item.description}</p>
                    )}
                    <div className="flex gap-2 mt-auto pt-2 border-t border-white/[0.05]">
                      <Link href={`/showcase/${item.publicSlug}`} className="flex-1">
                        <Button variant="outline" size="sm" className="w-full text-xs border-white/10 hover:border-white/20">Ver detalles</Button>
                      </Link>
                      {item.demoUrl && (
                        <a href={item.demoUrl} target="_blank" rel="noreferrer" className="flex-1">
                          <Button size="sm" className="w-full text-xs gap-1">
                            Demo <ExternalLink className="h-3 w-3" />
                          </Button>
                        </a>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-8">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="gap-1 border-white/20 text-white">
                    <ArrowLeft className="h-4 w-4" /> Anterior
                  </Button>
                  <span className="text-sm text-muted-foreground">Página {page} de {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="gap-1 border-white/20 text-white">
                    Siguiente <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── CTA ── */}
        <section className="container max-w-3xl mx-auto px-4 pb-20 text-center">
          <div className="rounded-2xl bg-gradient-to-br from-primary/20 to-cyan-500/10 border border-primary/20 p-10 space-y-5">
            <h2 className="text-3xl font-black text-white">Tu app podría estar aquí</h2>
            <p className="text-white/60 max-w-md mx-auto">Empieza gratis hoy y en menos de 5 minutos tienes tu primera app funcionando. Sin tarjeta, sin inglés, sin saber programar.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/sign-up">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-white font-bold gap-2 h-12 px-8 shadow-lg shadow-primary/30">
                  <Rocket className="h-5 w-5" />Crear mi app gratis
                </Button>
              </Link>
              <Link href="/demo">
                <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/[0.05] h-12 px-8 gap-2">
                  <Zap className="h-5 w-5" />Ver cómo funciona
                </Button>
              </Link>
            </div>
            <p className="text-xs text-white/30">Soporte por ticket (respuesta en menos de 3-4 horas) · WhatsApp para casos urgentes: <a href="https://wa.me/34611935616" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/60 transition-colors">+34 611 935 616</a> · Sin compromisos</p>
          </div>
        </section>

      </div>
    </Layout>
  );
}
