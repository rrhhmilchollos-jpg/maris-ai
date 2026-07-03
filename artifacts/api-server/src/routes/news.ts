import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { NewsArticle } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Endpoint para crear una nueva noticia (solo admin)
router.post("/admin/news", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { title, slug, imageUrl, imageAlt, body, author, tags, isFeatured, metaDescription, relatedAppId } = req.body;

  if (!title || !slug || !imageUrl || !body) {
    return res.status(400).json({ error: "Título, slug, URL de imagen y cuerpo son obligatorios" });
  }

  try {
    const newArticle = await NewsArticle.create({
      title,
      slug,
      imageUrl,
      imageAlt,
      body,
      author: author || "Maris AI",
      tags: tags || [],
      isFeatured: isFeatured || false,
      metaDescription,
      relatedAppId,
    });

    // Dispara un redeploy del frontend en Vercel para que prerender.mjs
    // genere el HTML estático real de este artículo nuevo (si no, el
    // artículo solo tendría URL en el sitemap pero sin página prerenderizada
    // hasta el siguiente `git push` a main -> 404 para Googlebot mientras
    // tanto). Requiere la variable de entorno VERCEL_DEPLOY_HOOK_URL
    // (Vercel > Project Settings > Git > Deploy Hooks). Si no está
    // configurada, se omite sin romper la creación del artículo.
    if (process.env.VERCEL_DEPLOY_HOOK_URL) {
      fetch(process.env.VERCEL_DEPLOY_HOOK_URL, { method: "POST" }).catch((err) => {
        logger.warn({ err }, "No se pudo disparar el deploy hook de Vercel tras crear noticia");
      });
    }

    res.status(201).json(newArticle);
  } catch (error) {
    logger.error({ error }, "Error al crear noticia");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoint para obtener todas las noticias (público)
router.get("/news", async (_req, res) => {
  await connectDB();
  try {
    const articles = await NewsArticle.find({}).sort({ publishedAt: -1 }).lean();
    res.json(articles);
  } catch (error) {
    logger.error({ error }, "Error al obtener noticias");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoint para obtener una noticia por slug (público)
router.get("/news/:slug", async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { slug } = req.params;

  try {
    const article = await NewsArticle.findOne({ slug }).lean();
    if (!article) {
      return res.status(404).json({ error: "Noticia no encontrada" });
    }
    res.json(article);
  } catch (error) {
    logger.error({ error }, "Error al obtener noticia por slug");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoint para actualizar una noticia (solo admin)
router.put("/admin/news/:id", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { id } = req.params;
  const { title, slug, imageUrl, imageAlt, body, author, tags, isFeatured, metaDescription, relatedAppId } = req.body;

  try {
    const updatedArticle = await NewsArticle.findByIdAndUpdate(
      id,
      { title, slug, imageUrl, imageAlt, body, author, tags, isFeatured, metaDescription, relatedAppId },
      { new: true }
    ).lean();

    if (!updatedArticle) {
      return res.status(404).json({ error: "Noticia no encontrada" });
    }
    res.json(updatedArticle);
  } catch (error) {
    logger.error({ error }, "Error al actualizar noticia");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoint para eliminar una noticia (solo admin)
router.delete("/admin/news/:id", requireAuth, requireAdmin, async (req: any, res: any): Promise<void> => {
  await connectDB();
  const { id } = req.params;

  try {
    const deletedArticle = await NewsArticle.findByIdAndDelete(id).lean();
    if (!deletedArticle) {
      return res.status(404).json({ error: "Noticia no encontrada" });
    }
    res.status(204).send(); // No Content
  } catch (error) {
    logger.error({ error }, "Error al eliminar noticia");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
