import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-client";
import { Loader2, Plus, Trash2, Edit2, Eye } from "lucide-react";

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

export function AdminNewsEditor() {
  const { toast } = useToast();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: "",
    slug: "",
    imageUrl: "",
    imageAlt: "",
    body: "",
    author: "Maris AI",
    metaDescription: "",
    tags: "",
    isFeatured: false,
  });

  useEffect(() => {
    loadArticles();
  }, []);

  const loadArticles = async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch<NewsArticle[]>("/api/news");
      setArticles(Array.isArray(data) ? data : []);
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: checked }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);

    try {
      const payload = {
        ...formData,
        tags: formData.tags.split(",").map((t) => t.trim()).filter((t) => t),
      };

      const url = editingId ? `/api/admin/news/${editingId}` : "/api/admin/news";
      const method = editingId ? "PUT" : "POST";

      await apiFetch<NewsArticle>(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      toast({
        title: "Éxito",
        description: editingId ? "Noticia actualizada correctamente" : "Noticia creada correctamente",
      });

      resetForm();
      loadArticles();
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo guardar la noticia",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleEdit = (article: NewsArticle) => {
    setFormData({
      title: article.title,
      slug: article.slug,
      imageUrl: article.imageUrl,
      imageAlt: article.imageAlt || "",
      body: article.body,
      author: article.author,
      metaDescription: article.metaDescription || "",
      tags: article.tags.join(", "),
      isFeatured: article.isFeatured,
    });
    setEditingId(article._id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro de que deseas eliminar esta noticia?")) return;

    try {
      await apiFetch<void>(`/api/admin/news/${id}`, {
        method: "DELETE",
      });

      toast({
        title: "Éxito",
        description: "Noticia eliminada correctamente",
      });

      loadArticles();
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo eliminar la noticia",
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setFormData({
      title: "",
      slug: "",
      imageUrl: "",
      imageAlt: "",
      body: "",
      author: "Maris AI",
      metaDescription: "",
      tags: "",
      isFeatured: false,
    });
    setEditingId(null);
  };

  return (
    <div className="space-y-6">
      {/* Formulario de creación/edición */}
      <Card className="bg-card/60 border-primary/20">
        <CardHeader>
          <CardTitle>{editingId ? "Editar Noticia" : "Crear Nueva Noticia"}</CardTitle>
          <CardDescription>
            {editingId ? "Modifica los detalles de la noticia" : "Publica una nueva noticia para Google News"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Título *</label>
                <Input
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  placeholder="Ej: Maris AI Lanza Live Coding"
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Slug *</label>
                <Input
                  name="slug"
                  value={formData.slug}
                  onChange={handleInputChange}
                  placeholder="ej-maris-ai-lanza-live-coding"
                  required
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">URL de Imagen *</label>
              <Input
                name="imageUrl"
                value={formData.imageUrl}
                onChange={handleInputChange}
                placeholder="https://ejemplo.com/imagen.jpg"
                required
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Alt de Imagen</label>
              <Input
                name="imageAlt"
                value={formData.imageAlt}
                onChange={handleInputChange}
                placeholder="Descripción de la imagen para accesibilidad"
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Cuerpo del Artículo *</label>
              <Textarea
                name="body"
                value={formData.body}
                onChange={handleInputChange}
                placeholder="Escribe el contenido completo de la noticia aquí..."
                required
                rows={8}
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Autor</label>
                <Input
                  name="author"
                  value={formData.author}
                  onChange={handleInputChange}
                  placeholder="Maris AI"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Meta Descripción</label>
                <Input
                  name="metaDescription"
                  value={formData.metaDescription}
                  onChange={handleInputChange}
                  placeholder="Resumen breve para SEO (160 caracteres)"
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Etiquetas (separadas por comas)</label>
              <Input
                name="tags"
                value={formData.tags}
                onChange={handleInputChange}
                placeholder="Live Coding, IA, Desarrollo, Noticias"
                className="mt-1"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                name="isFeatured"
                checked={formData.isFeatured}
                onChange={handleCheckboxChange}
                id="featured"
                className="rounded"
              />
              <label htmlFor="featured" className="text-sm font-medium">
                Destacar esta noticia
              </label>
            </div>

            <div className="flex gap-2 justify-end">
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancelar
                </Button>
              )}
              <Button type="submit" disabled={isCreating} className="gap-2">
                {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? "Actualizar" : "Publicar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Lista de noticias */}
      <Card className="bg-card/40 border-white/5">
        <CardHeader>
          <CardTitle>Noticias Publicadas</CardTitle>
          <CardDescription>Gestiona todas tus noticias publicadas</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No hay noticias publicadas aún</p>
          ) : (
            <div className="space-y-3">
              {articles.map((article) => (
                <div
                  key={article._id}
                  className="flex items-start justify-between p-4 rounded-lg border border-white/10 hover:border-primary/30 transition-colors"
                >
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm mb-1">{article.title}</h4>
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-1">{article.body}</p>
                    <div className="flex gap-2 items-center flex-wrap">
                      {article.isFeatured && <Badge variant="default" className="text-[10px]">Destacada</Badge>}
                      {article.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[9px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEdit(article)}
                      className="gap-1"
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(article._id)}
                      className="gap-1 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
