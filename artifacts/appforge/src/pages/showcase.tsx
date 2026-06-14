import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, ExternalLink, LayoutGrid, ArrowLeft } from "lucide-react";

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

interface ShowcaseResponse {
  items: ShowcaseItem[];
  page: number;
  totalPages: number;
  total: number;
}

const KIND_LABELS: Record<string, string> = {
  fullstack: "Full-stack",
  landing: "Landing page",
  vue: "Vue",
  svelte: "Svelte",
  mobile: "App móvil (PWA)",
};

export default function ShowcasePage() {
  const [data, setData] = useState<ShowcaseResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    document.title = "Showcase — Apps creadas con Maris AI | Maris AI";
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute(
        "content",
        "Galería pública de aplicaciones reales creadas con Maris AI por usuarios de toda España y Latinoamérica: tiendas online, plataformas de citas, CRMs y más.",
      );
    }
    let canonicalLink = document.querySelector("link[rel='canonical']");
    if (!canonicalLink) {
      canonicalLink = document.createElement("link");
      canonicalLink.setAttribute("rel", "canonical");
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute("href", "https://www.marisai.es/showcase");

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Showcase — Apps creadas con Maris AI",
      description: "Galería pública de aplicaciones reales generadas con inteligencia artificial usando Maris AI.",
      url: "https://www.marisai.es/showcase",
      inLanguage: "es",
    };
    const existing = document.querySelector('script[data-showcase-schema]');
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-showcase-schema", "true");
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/showcase?page=${page}`)
      .then((r) => r.json())
      .then((d: ShowcaseResponse) => setData(d))
      .catch(() => setData({ items: [], page: 1, totalPages: 1, total: 0 }))
      .finally(() => setIsLoading(false));
  }, [page]);

  return (
    <Layout>
      <div className="container max-w-6xl mx-auto px-4 py-10 space-y-10">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <LayoutGrid className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-white">Showcase</h1>
              <p className="text-muted-foreground mt-1">
                Aplicaciones reales creadas con Maris AI por nuestra comunidad — tiendas online, plataformas de citas, CRMs, landing pages y más.
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-64 w-full rounded-lg" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <p className="text-muted-foreground">
              Todavía no hay proyectos públicos en la galería. ¡Sé el primero en compartir el tuyo!
            </p>
            <Link href="/dashboard">
              <Button className="gap-2">
                Crear mi app <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {data.items.map((item) => (
                <Card key={item.publicSlug} className="bg-card/40 border-white/5 hover:border-primary/50 transition-all flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">{KIND_LABELS[item.kind] || item.kind}</Badge>
                      {item.techStack?.slice(0, 2).map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                      ))}
                    </div>
                    <CardTitle className="text-lg truncate">{item.title}</CardTitle>
                    <CardDescription className="line-clamp-3">{item.description}</CardDescription>
                  </CardHeader>
                  <CardFooter className="mt-auto flex gap-2 pt-3 border-t border-white/5">
                    <Link href={`/showcase/${item.publicSlug}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full">Ver detalles</Button>
                    </Link>
                    {item.demoUrl && (
                      <a href={item.demoUrl} target="_blank" rel="noreferrer" className="flex-1">
                        <Button size="sm" className="w-full gap-1">
                          Demo en vivo <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </a>
                    )}
                  </CardFooter>
                </Card>
              ))}
            </div>

            {data.totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-4">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="gap-1">
                  <ArrowLeft className="h-4 w-4" /> Anterior
                </Button>
                <span className="text-sm text-muted-foreground">Página {data.page} de {data.totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} className="gap-1">
                  Siguiente <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}

        <div className="text-center pt-6 border-t border-white/5">
          <p className="text-muted-foreground mb-4">¿Tienes una app creada con Maris AI? Publícala en la galería desde el panel de tu proyecto.</p>
          <Link href="/dashboard">
            <Button variant="outline" className="gap-2">
              Ir a mi panel <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
