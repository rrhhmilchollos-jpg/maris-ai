import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, ArrowRight, Calendar, User, Newspaper } from "lucide-react";
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
  isFeatured: boolean;
  metaDescription?: string;
  createdAt: string;
  updatedAt: string;
}

export default function NewsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadNews();
    // Establecer metadatos de SEO
    document.title = "Noticias de Maris AI - Live Coding y Nuevas Apps";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", "Últimas noticias sobre Maris AI, Live Coding y nuevas aplicaciones generadas por IA.");
    }
  }, []);

  const loadNews = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/news", {
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Error al cargar noticias");
      const data = await response.json();
      setArticles(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudieron cargar las noticias",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const featuredArticles = articles.filter((a) => a.isFeatured);
  const regularArticles = articles.filter((a) => !a.isFeatured);

  return (
    <Layout>
      <div className="container max-w-6xl mx-auto px-4 py-10 space-y-12">
        {/* Encabezado */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Newspaper className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-white">Noticias de Maris AI</h1>
              <p className="text-muted-foreground mt-1">
                Descubre las últimas novedades sobre Live Coding, nuevas aplicaciones y actualizaciones de nuestra plataforma.
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-80 w-full rounded-lg" />
            ))}
          </div>
        ) : articles.length === 0 ? (
          <Card className="bg-card/40 border-white/5">
            <CardContent className="pt-12 pb-12 text-center">
              <Newspaper className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">No hay noticias disponibles en este momento.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Noticias destacadas */}
            {featuredArticles.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-2xl font-bold tracking-tight">Destacadas</h2>
                <div className="grid gap-6 md:grid-cols-2">
                  {featuredArticles.map((article) => (
                    <Card
                      key={article._id}
                      className="bg-card/60 border-primary/20 hover:border-primary/40 transition-colors cursor-pointer overflow-hidden group"
                      onClick={() => setLocation(`/news/${article.slug}`)}
                    >
                      <div className="relative overflow-hidden h-48">
                        <img
                          src={article.imageUrl}
                          alt={article.imageAlt || article.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                      </div>
                      <CardContent className="pt-4 pb-4 space-y-3">
                        <div className="space-y-2">
                          <h3 className="text-lg font-semibold line-clamp-2 group-hover:text-primary transition-colors">
                            {article.title}
                          </h3>
                          <p className="text-sm text-muted-foreground line-clamp-2">{article.metaDescription || article.body.substring(0, 100)}</p>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3 w-3" />
                            {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true, locale: es })}
                          </div>
                          <div className="flex items-center gap-2">
                            <User className="h-3 w-3" />
                            {article.author}
                          </div>
                        </div>
                        {article.tags.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {article.tags.slice(0, 2).map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-[10px]">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* Todas las noticias */}
            <section className="space-y-4">
              <h2 className="text-2xl font-bold tracking-tight">Todas las noticias</h2>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {regularArticles.map((article) => (
                  <Card
                    key={article._id}
                    className="bg-card/40 border-white/5 hover:border-primary/20 transition-colors cursor-pointer overflow-hidden group"
                    onClick={() => setLocation(`/news/${article.slug}`)}
                  >
                    <div className="relative overflow-hidden h-40">
                      <img
                        src={article.imageUrl}
                        alt={article.imageAlt || article.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <CardContent className="pt-4 pb-4 space-y-3">
                      <div className="space-y-2">
                        <h3 className="text-base font-semibold line-clamp-2 group-hover:text-primary transition-colors">
                          {article.title}
                        </h3>
                        <p className="text-xs text-muted-foreground line-clamp-2">{article.metaDescription || article.body.substring(0, 80)}</p>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true, locale: es })}
                        </div>
                      </div>
                      {article.tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {article.tags.slice(0, 1).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[9px]">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
