import { Router, type IRouter } from "express";
import { connectDB } from "../lib/db";
import { NewsArticle } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/news-sitemap.xml", async (_req, res) => {
  await connectDB();
  try {
    const articles = await NewsArticle.find({}).sort({ publishedAt: -1 }).limit(1000).lean(); // Google News sitemaps can contain up to 1,000 URLs

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n`;

    for (const article of articles) {
      const publicationDate = new Date(article.publishedAt).toISOString().split('T')[0];
      sitemap += `
        <url>
          <loc>https://maris-ai.shop/news/${article.slug}</loc>
          <news:news>
            <news:publication>
              <news:name>Maris AI</news:name>
              <news:language>es</news:language>
            </news:publication>
            <news:publication_date>${publicationDate}</news:publication_date>
            <news:title>${article.title}</news:title>
            ${article.tags.length > 0 ? `<news:keywords>${article.tags.join(', ')}</news:keywords>` : ''}
          </news:news>
        </url>
      `;
    }

    sitemap += `</urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(sitemap);
  } catch (error) {
    logger.error({ error }, "Error al generar el sitemap de noticias");
    res.status(500).send("Error al generar el sitemap de noticias");
  }
});

export default router;
