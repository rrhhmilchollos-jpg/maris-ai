import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RelatedLink {
  href: string;
  label: string;
}

interface PillarLayoutProps {
  /** Slug sin barras, ej: "que-es-vibe-coding" */
  slug: string;
  /** <title> del documento */
  pageTitle: string;
  /** <meta name="description"> */
  metaDescription: string;
  /** H1 visible */
  h1: string;
  /** Párrafo de introducción bajo el H1 */
  intro: string;
  /** Cuerpo del artículo (secciones con H2/H3/p) */
  children: React.ReactNode;
  /** Enlaces internos relacionados (otras páginas pilar / glosario) */
  relatedLinks?: RelatedLink[];
  /** Texto del CTA final */
  ctaTitle?: string;
  ctaDescription?: string;
}

/**
 * Layout reutilizable para páginas pilar de SEO (estilo "Wikipedia del
 * vibe-coding" recomendado en la auditoría SEO). Cada página:
 * - Define su propio <title>, meta description y canonical
 * - Añade Schema.org Article (E-E-A-T: autor/publisher = Maris AI)
 * - Incluye enlaces internos con anchor text rico hacia Home/Glosario/
 *   otras páginas pilar y otras páginas pilar (link equity)
 * - Termina con una CTA hacia /sign-up
 */
export function PillarLayout({
  slug,
  pageTitle,
  metaDescription,
  h1,
  intro,
  children,
  relatedLinks = [],
  ctaTitle = "Pasa de la idea a la app en minutos",
  ctaDescription = "Describe tu proyecto en español y Maris AI genera el código completo — frontend, backend y base de datos — listo para producción.",
}: PillarLayoutProps) {
  const canonicalUrl = `https://www.marisai.es/${slug}`;

  useEffect(() => {
    document.title = pageTitle;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", metaDescription);

    let canonicalLink = document.getElementById("canonical-tag") as HTMLLinkElement | null;
    if (!canonicalLink) {
      canonicalLink = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    }
    if (!canonicalLink) {
      canonicalLink = document.createElement("link") as HTMLLinkElement;
      canonicalLink.setAttribute("rel", "canonical");
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute("href", canonicalUrl);

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", pageTitle);
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", metaDescription);
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute("content", canonicalUrl);

    const existing = document.querySelector(`script[data-pillar-schema="${slug}"]`);
    if (existing) existing.remove();

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": h1,
      "description": metaDescription,
      "image": "https://www.marisai.es/opengraph.jpg",
      "mainEntityOfPage": { "@type": "WebPage", "@id": canonicalUrl },
      "inLanguage": "es",
      "articleSection": "Glosario de IA",
      "author": {
        "@type": "Organization",
        "name": "Maris AI",
        "url": "https://www.marisai.es/",
      },
      "publisher": {
        "@type": "Organization",
        "name": "Maris AI",
        "url": "https://www.marisai.es/",
        "logo": {
          "@type": "ImageObject",
          "url": "https://www.marisai.es/logo.svg",
        },
      },
      "datePublished": "2026-06-14",
      "dateModified": "2026-06-14",
    };

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-pillar-schema", slug);
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    return () => {
      const el = document.querySelector(`script[data-pillar-schema="${slug}"]`);
      if (el) el.remove();
    };
  }, [slug, pageTitle, metaDescription, h1, canonicalUrl]);

  return (
    <main className="min-h-screen bg-background">
      <section className="py-20 md:py-24 border-b border-white/5">
        <div className="container px-4 mx-auto max-w-3xl text-center">
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-6 leading-tight">{h1}</h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">{intro}</p>
        </div>
      </section>

      <article className="py-16 md:py-20">
        <div className="container px-4 mx-auto max-w-3xl space-y-12 text-white/80 leading-relaxed [&_h2]:text-2xl [&_h2]:md:text-3xl [&_h2]:font-bold [&_h2]:text-white [&_h2]:mb-4 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-white [&_h3]:mb-2 [&_p]:mb-4 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-primary/80">
          {children}
        </div>
      </article>

      {relatedLinks.length > 0 && (
        <section className="py-12 border-t border-white/5">
          <div className="container px-4 mx-auto max-w-3xl">
            <h2 className="text-xl font-bold text-white mb-4">Sigue leyendo</h2>
            <ul className="space-y-2">
              {relatedLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-primary hover:text-primary/80 underline underline-offset-2">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="py-24 border-t border-white/5">
        <div className="container px-4 mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white mb-6">{ctaTitle}</h2>
          <p className="text-lg text-muted-foreground mb-10">{ctaDescription}</p>
          <Link href="/sign-up">
            <Button size="lg" className="h-14 px-8 text-lg bg-primary text-white hover:bg-primary/90">
              Crear mi App Gratis <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="py-12 border-t border-white/5 bg-background/50">
        <div className="container px-4 mx-auto text-center">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Maris AI. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </main>
  );
}
