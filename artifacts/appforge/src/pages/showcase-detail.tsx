import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";

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
  vue: "Vue",
  svelte: "Svelte",
  mobile: "App móvil (PWA)",
};

export default function ShowcaseDetailPage() {
  const params = useParams<{ slug: string }>();
  const [item, setItem] = useState<ShowcaseItem | null | undefined>(undefined);

  useEffect(() => {
    fetch(`/api/showcase/${params.slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ShowcaseItem | null) => setItem(d))
      .catch(() => setItem(null));
  }, [params.slug]);

  useEffect(() => {
    if (!item) return;
    const canonicalUrl = `https://www.marisai.es/showcase/${item.publicSlug}`;
    document.title = `${item.title} — Showcase Maris AI`;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", item.description.slice(0, 160));

    let canonicalLink = document.querySelector("link[rel='canonical']");
    if (!canonicalLink) {
      canonicalLink = document.createElement("link");
      canonicalLink.setAttribute("rel", "canonical");
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute("href", canonicalUrl);

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: item.title,
      description: item.description,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: canonicalUrl,
      ...(item.demoUrl ? { sameAs: item.demoUrl } : {}),
      creator: {
        "@type": "Organization",
        name: "Maris AI",
        url: "https://www.marisai.es/",
      },
      inLanguage: item.language || "es",
      datePublished: item.publishedAt,
    };
    const existing = document.querySelector("script[data-showcase-detail-schema]");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-showcase-detail-schema", "true");
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    return () => {
      const el = document.querySelector("script[data-showcase-detail-schema]");
      if (el) el.remove();
    };
  }, [item]);

  return (
    <Layout>
      <div className="container max-w-3xl mx-auto px-4 py-10 space-y-8">
        <Link href="/showcase" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white transition">
          <ArrowLeft className="h-4 w-4" /> Volver al showcase
        </Link>

        {item === undefined ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : item === null ? (
          <div className="text-center py-20 space-y-4">
            <h1 className="text-2xl font-bold text-white">Proyecto no encontrado</h1>
            <p className="text-muted-foreground">Este proyecto no existe o ya no es público.</p>
            <Link href="/showcase">
              <Button variant="outline" className="gap-2">Volver al showcase</Button>
            </Link>
          </div>
        ) : (
          <article className="space-y-6">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{KIND_LABELS[item.kind] || item.kind}</Badge>
              {item.techStack?.map((t) => (
                <Badge key={t} variant="secondary">{t}</Badge>
              ))}
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white">{item.title}</h1>
            <p className="text-lg text-muted-foreground leading-relaxed">{item.description}</p>

            {item.demoUrl && (
              <a href={item.demoUrl} target="_blank" rel="noreferrer">
                <Button size="lg" className="gap-2">
                  Ver demo en vivo <ExternalLink className="h-4 w-4" />
                </Button>
              </a>
            )}

            <div className="pt-6 border-t border-white/5">
              <p className="text-muted-foreground mb-4">
                Esta aplicación fue creada con Maris AI describiendo la idea en lenguaje natural — sin escribir código.
              </p>
              <Link href="/dashboard">
                <Button variant="outline" className="gap-2">
                  Crear mi propia app <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </article>
        )}
      </div>
    </Layout>
  );
}
