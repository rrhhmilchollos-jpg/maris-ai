import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useParams } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Calendar, User, Share2 } from "lucide-react";
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

      // Añadir etiqueta canónica
      let canonicalLink = document.querySelector("link[rel=\"canonical\"]");
      if (!canonicalLink) {
        canonicalLink = document.createElement("link");
        canonicalLink.setAttribute("rel", "canonical");
        document.head.appendChild(canonicalLink);
      }
      canonicalLink.setAttribute("href", window.location.href);

      // Añadir JSON-LD para NewsArticle
      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "mainEntityOfPage": {
          "@type": "WebPage",
          "@id": window.location.href
        },
        "headline": data.title,
        "image": [
          data.imageUrl
        ],
        "datePublished": data.publishedAt,
        "dateModified": data.updatedAt,
        "author": {
          "@type": "Person",
          "name": data.author
        },
        "publisher": {
          "@type": "Organization",
          "name": "Maris AI",
          "logo": {
            "@type": "ImageObject",
            "url": "https://marisai.es/logo.svg" // TODO: Reemplazar con la URL real del logo de Maris AI
          }
        },
        "description": data.metaDescription || data.body.substring(0, 160)
      };

      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.innerHTML = JSON.stringify(jsonLd);
      document.head.appendChild(script);

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
