import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { NewsArticle, GeneratedApp } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Escapa caracteres especiales XML para evitar sitemap malformado.
 * Requerido por Google News para títulos con &, <, >, ", '
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

router.get("/api/news-sitemap.xml", async (_req, res) => {
  await connectDB();
  try {
    // Google News sitemaps: máximo 1000 URLs
    // IMPORTANTE: Google News solo indexa artículos de los últimos 2 días.
    // Para maximizar la cobertura, incluimos todos los artículos (Google ignora
    // los más antiguos de 2 días para Google News, pero los mantiene para Discover).
    const articles = await NewsArticle.find({})
      .sort({ publishedAt: -1 })
      .limit(1000)
      .lean();

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
    sitemap += `        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n`;

    for (const article of articles) {
      // Google News requiere fecha ISO 8601 completa con hora (no solo YYYY-MM-DD)
      const publicationDate = new Date(article.publishedAt).toISOString();
      const escapedTitle = escapeXml(String(article.title));
      const escapedKeywords = article.tags.length > 0
        ? escapeXml(article.tags.join(", "))
        : "";

      sitemap += `  <url>\n`;
      sitemap += `    <loc>https://www.marisai.es/news/${article.slug}</loc>\n`;
      sitemap += `    <news:news>\n`;
      sitemap += `      <news:publication>\n`;
      sitemap += `        <news:name>Maris AI</news:name>\n`;
      sitemap += `        <news:language>es</news:language>\n`;
      sitemap += `      </news:publication>\n`;
      sitemap += `      <news:publication_date>${publicationDate}</news:publication_date>\n`;
      sitemap += `      <news:title>${escapedTitle}</news:title>\n`;
      if (escapedKeywords) {
        sitemap += `      <news:keywords>${escapedKeywords}</news:keywords>\n`;
      }
      sitemap += `    </news:news>\n`;
      sitemap += `  </url>\n`;
    }

    sitemap += `</urlset>`;

    res.header("Content-Type", "application/xml; charset=utf-8");
    res.header("Cache-Control", "public, max-age=3600"); // Cache 1 hora
    res.send(sitemap);
  } catch (error) {
    logger.error({ error }, "Error al generar el sitemap de noticias");
    res.status(500).send("Error al generar el sitemap de noticias");
  }
});

/**
 * Sitemap general del sitio (para Google Search Console).
 * Incluye todas las páginas públicas estáticas.
 */
router.get("/api/sitemap-dynamic.xml", async (_req, res) => {
  await connectDB();
  try {
    const articles = await NewsArticle.find({}).sort({ publishedAt: -1 }).limit(1000).lean();
    const showcaseApps = await GeneratedApp.find(
      { isPublic: true, publicSlug: { $exists: true, $ne: null } },
      { publicSlug: 1, showcasePublishedAt: 1, createdAt: 1, updatedAt: 1 },
    ).sort({ showcasePublishedAt: -1 }).limit(1000).lean();

    const today = new Date().toISOString().split("T")[0];
    const staticPages = [
      { url: "https://www.marisai.es/", priority: "1.0", changefreq: "daily", lastmod: today },
      { url: "https://www.marisai.es/news", priority: "0.9", changefreq: "hourly", lastmod: today },
      { url: "https://www.marisai.es/pricing", priority: "0.8", changefreq: "weekly", lastmod: today },
      { url: "https://www.marisai.es/showcase", priority: "0.8", changefreq: "daily", lastmod: today },
      { url: "https://www.marisai.es/vs-emergent", priority: "0.8", changefreq: "monthly", lastmod: today },
      { url: "https://www.marisai.es/vs-lovable", priority: "0.8", changefreq: "monthly", lastmod: today },
      { url: "https://www.marisai.es/vs-bolt", priority: "0.8", changefreq: "monthly", lastmod: today },
      { url: "https://www.marisai.es/vs-base44", priority: "0.8", changefreq: "monthly", lastmod: today },
      { url: "https://www.marisai.es/que-es-vibe-coding", priority: "0.7", changefreq: "monthly", lastmod: today },
      { url: "https://www.marisai.es/que-es-un-agente-de-ia", priority: "0.7", changefreq: "monthly", lastmod: today },
      { url: "https://www.marisai.es/glosario", priority: "0.7", changefreq: "monthly", lastmod: today },
      { url: "https://www.marisai.es/desarrollo-no-code-guia", priority: "0.7", changefreq: "monthly", lastmod: today },
      { url: "https://www.marisai.es/legal/privacidad", priority: "0.4", changefreq: "yearly", lastmod: "2026-05-28" },
      { url: "https://www.marisai.es/legal/aviso-legal", priority: "0.4", changefreq: "yearly", lastmod: "2026-05-28" },
      { url: "https://www.marisai.es/legal/cookies", priority: "0.3", changefreq: "yearly", lastmod: "2026-05-28" },
    ];

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const page of staticPages) {
      sitemap += `  <url>\n`;
      sitemap += `    <loc>${page.url}</loc>\n`;
      sitemap += `    <lastmod>${page.lastmod}</lastmod>\n`;
      sitemap += `    <changefreq>${page.changefreq}</changefreq>\n`;
      sitemap += `    <priority>${page.priority}</priority>\n`;
      sitemap += `  </url>\n`;
    }

    for (const article of articles) {
      const lastmod = new Date(article.updatedAt || article.publishedAt).toISOString();
      sitemap += `  <url>\n`;
      sitemap += `    <loc>https://www.marisai.es/news/${article.slug}</loc>\n`;
      sitemap += `    <lastmod>${lastmod}</lastmod>\n`;
      sitemap += `    <changefreq>never</changefreq>\n`;
      sitemap += `    <priority>0.7</priority>\n`;
      sitemap += `  </url>\n`;
    }

    for (const app of showcaseApps) {
      const lastmod = new Date((app as any).updatedAt || app.showcasePublishedAt || (app as any).createdAt).toISOString();
      sitemap += `  <url>\n`;
      sitemap += `    <loc>https://www.marisai.es/showcase/${app.publicSlug}</loc>\n`;
      sitemap += `    <lastmod>${lastmod}</lastmod>\n`;
      sitemap += `    <changefreq>monthly</changefreq>\n`;
      sitemap += `    <priority>0.6</priority>\n`;
      sitemap += `  </url>\n`;
    }

    sitemap += `</urlset>`;

    res.header("Content-Type", "application/xml; charset=utf-8");
    res.header("Cache-Control", "public, max-age=3600");
    res.send(sitemap);
  } catch (error) {
    logger.error({ error }, "Error al generar el sitemap general");
    res.status(500).send("Error al generar el sitemap general");
  }
});

export default router;
