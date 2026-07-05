import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useParams } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ArrowRight, Calendar, User, Share2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface NewsArticle {
  _id: string;
  title: string;
  slug: string;
  imageUrl: string;
  imageAlt?: string;
  body: string;
  author: string;
  publishedAt: string;
  tags: string[];
  metaDescription?: string;
  createdAt: string;
  updatedAt: string;
}

export default function NewsDetailPage() {
  const [, setLocation] = useLocation();
  const { slug } = useParams() as { slug: string };
  const { toast } = useToast();
  const [article, setArticle] = useState<NewsArticle | null>(null);
  const [relatedArticles, setRelatedArticles] = useState<NewsArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (slug) {
      loadArticle();
    }
  }, [slug]);

  const loadArticle = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/news/${slug}`, {
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Noticia no encontrada");
      const data = await response.json();
      setArticle(data);
      // Actualizar metadatos de SEO
      document.title = `${data.title} - Maris AI Noticias`;
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        metaDescription.setAttribute("content", data.metaDescription || data.body.substring(0, 160));
      }

      // Construir URL canónica con www
      const canonicalUrl = `https://www.marisai.es/news/${data.slug}`;

      // Actualizar canonical
      let canonicalLink = document.getElementById('canonical-tag') as HTMLLinkElement | null;
      if (!canonicalLink) {
        canonicalLink = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
      }
      if (!canonicalLink) {
        canonicalLink = document.createElement("link") as HTMLLinkElement;
        (canonicalLink as HTMLLinkElement).setAttribute("rel", "canonical");
        document.head.appendChild(canonicalLink);
      }
      (canonicalLink as HTMLLinkElement).setAttribute("href", canonicalUrl);

      // Actualizar og:url y twitter:url
      const ogUrl = document.querySelector('meta[property="og:url"]');
      if (ogUrl) ogUrl.setAttribute('content', canonicalUrl);
      const twUrl = document.querySelector('meta[property="twitter:url"]');
      if (twUrl) twUrl.setAttribute('content', canonicalUrl);

      // Actualizar og:type a article
      const ogType = document.querySelector('meta[property="og:type"]');
      if (ogType) ogType.setAttribute('content', 'article');

      // Actualizar og:image y twitter:image con la imagen del artículo
      if (data.imageUrl) {
        const ogImg = document.querySelector('meta[property="og:image"]');
        if (ogImg) ogImg.setAttribute('content', data.imageUrl);
        const twImg = document.querySelector('meta[property="twitter:image"]');
        if (twImg) twImg.setAttribute('content', data.imageUrl);
      }

      // Actualizar og:title y twitter:title
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.setAttribute('content', `${data.title} - Maris AI`);
      const twTitle = document.querySelector('meta[property="twitter:title"]');
      if (twTitle) twTitle.setAttribute('content', `${data.title} - Maris AI`);

      // Actualizar og:description y twitter:description
      const desc = data.metaDescription || data.body.substring(0, 160);
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.setAttribute('content', desc);
      const twDesc = document.querySelector('meta[property="twitter:description"]');
      if (twDesc) twDesc.setAttribute('content', desc);

      // Eliminar JSON-LD anterior si existe (evitar duplicados en navegación SPA)
      const existingJsonLd = document.querySelector('script[data-news-article]');
      if (existingJsonLd) existingJsonLd.remove();

      // Añadir JSON-LD NewsArticle completo para Google News y Google Discover
      // IMPORTANTE: imagen con dimensiones explícitas (≥ 1200px requerido por Discover)
      const heroImage = data.imageUrl && !data.imageUrl.endsWith('.svg')
        ? data.imageUrl
        : "https://www.marisai.es/opengraph.jpg";
      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "mainEntityOfPage": {
          "@type": "WebPage",
          "@id": canonicalUrl
        },
        "headline": data.title,
        "image": [
          {
            "@type": "ImageObject",
            "url": heroImage,
            "width": 1200,
            "height": 630
          }
        ],
        "datePublished": new Date(data.publishedAt).toISOString(),
        "dateModified": new Date(data.updatedAt || data.publishedAt).toISOString(),
        "author": [{
          "@type": "Person",
          "name": data.author,
          "url": "https://www.marisai.es/"
        }],
        "publisher": {
          "@type": "NewsMediaOrganization",
          "name": "Maris AI",
          "url": "https://www.marisai.es/",
          "logo": {
            "@type": "ImageObject",
            "url": "https://www.marisai.es/opengraph.jpg",
            "width": 1200,
            "height": 630
          }
        },
        "description": desc,
        "keywords": data.tags?.join(", ") || "inteligencia artificial, IA, tecnología",
        "articleSection": "Inteligencia Artificial",
        "inLanguage": "es",
        "isAccessibleForFree": true,
        "wordCount": data.body ? data.body.split(/\s+/).length : undefined
      };

      // Añadir meta tags article:* para Open Graph (Google Discover los lee)
      const setOrCreate = (selector: string, attr: string, value: string) => {
        let el = document.querySelector(selector);
        if (!el) {
          el = document.createElement('meta');
          document.head.appendChild(el);
        }
        el.setAttribute(attr, value);
      };
      setOrCreate('meta[property="article:published_time"]', 'content', new Date(data.publishedAt).toISOString());
      setOrCreate('meta[property="article:modified_time"]', 'content', new Date(data.updatedAt || data.publishedAt).toISOString());
      setOrCreate('meta[property="article:author"]', 'content', data.author || 'Equipo Maris AI');
      setOrCreate('meta[property="article:section"]', 'content', 'Inteligencia Artificial');
      setOrCreate('meta[name="news_keywords"]', 'content', data.tags?.join(', ') || 'inteligencia artificial, IA');

      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.setAttribute('data-news-article', 'true');
      script.innerHTML = JSON.stringify(jsonLd);
      document.head.appendChild(script);

      // Artículos relacionados: mejora el enlazado interno hacia cada
      // /news/<slug> (antes cada artículo solo recibía 1 enlace interno en
      // todo el sitio — señal débil para que Google lo priorice). Prioriza
      // artículos que comparten tags; si no hay suficientes, rellena con
      // los más recientes que no sean el actual.
      try {
        const allRes = await fetch("/api/news");
        if (allRes.ok) {
          const all: NewsArticle[] = await allRes.json();
          const others = all.filter((a) => a.slug !== data.slug);
          const byTag = others.filter((a) => (a.tags || []).some((t) => (data.tags || []).includes(t)));
          const rest = others.filter((a) => !byTag.includes(a));
          setRelatedArticles([...byTag, ...rest].slice(0, 3));
        }
      } catch {
        // No pasa nada si falla — la sección de relacionados simplemente no se muestra
      }

    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo cargar la noticia",
        variant: "destructive",
      });
      setLocation("/news");
    } finally {
      setIsLoading(false);
    }
  };

  const shareArticle = () => {
    const url = window.location.href;
    const text = article?.title || "Mira esta noticia de Maris AI";
    if (navigator.share) {
      navigator.share({ title: text, url });
    } else {
      navigator.clipboard.writeText(url);
      toast({
        title: "Enlace copiado",
        description: "El enlace ha sido copiado al portapapeles",
      });
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="container max-w-4xl mx-auto px-4 py-10 space-y-6">
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-96 w-full rounded-lg" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Layout>
    );
  }

  if (!article) {
    return (
      <Layout>
        <div className="container max-w-4xl mx-auto px-4 py-10">
          <Card className="bg-card/40 border-white/5">
            <CardContent className="pt-12 pb-12 text-center">
              <p className="text-muted-foreground mb-4">Noticia no encontrada</p>
              <Button onClick={() => setLocation("/news")} variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver a Noticias
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container max-w-4xl mx-auto px-4 py-10 space-y-8">
        {/* Botón de regreso */}
        <Button variant="ghost" onClick={() => setLocation("/news")} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Volver a Noticias
        </Button>

        {/* Imagen destacada */}
        <div className="relative overflow-hidden rounded-lg h-96 border border-white/10">
          <img
            src={article.imageUrl}
            alt={article.imageAlt || article.title}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Contenido principal */}
        <article className="space-y-6">
          {/* Título y metadatos */}
          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight">{article.title}</h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                {article.author}
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true, locale: es })}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={shareArticle}
                className="gap-2 text-muted-foreground hover:text-foreground"
              >
                <Share2 className="h-4 w-4" />
                Compartir
              </Button>
            </div>

            {/* Tags */}
            {article.tags.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {article.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="bg-primary/20 text-primary border-primary/30">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Descripción meta */}
          {article.metaDescription && (
            <p className="text-lg text-muted-foreground italic">{article.metaDescription}</p>
          )}

          {/* Cuerpo del artículo */}
          <div className="prose prose-invert max-w-none space-y-4">
            {article.body.split("\n\n").map((paragraph, idx) => (
              <p key={idx} className="text-base leading-relaxed text-foreground/90">
                {paragraph}
              </p>
            ))}
          </div>
        </article>

        {/* Artículos relacionados */}
        {relatedArticles.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Artículos relacionados</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {relatedArticles.map((related) => (
                <Card
                  key={related._id}
                  className="bg-card/40 border-white/5 hover:border-primary/30 transition-colors cursor-pointer group"
                  onClick={() => {
                    setLocation(`/news/${related.slug}`);
                    window.scrollTo(0, 0);
                  }}
                >
                  <CardContent className="p-4 space-y-2">
                    <p className="font-medium text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                      {related.title}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-primary/80">
                      Leer más
                      <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-white/10 my-8"></div>

        {/* Call to action */}
        <Card className="bg-primary/10 border-primary/30">
          <CardContent className="pt-6 pb-6 space-y-4">
            <div>
              <h3 className="text-lg font-semibold mb-2">¿Listo para crear tu propia app?</h3>
              <p className="text-sm text-muted-foreground">
                Descubre cómo Maris AI puede ayudarte a generar aplicaciones profesionales con Live Coding.
              </p>
            </div>
            <Button className="bg-primary text-white hover:bg-primary/90 w-full sm:w-auto">
              Comenzar ahora
            </Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
