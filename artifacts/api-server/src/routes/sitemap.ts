import { Router, Request, Response } from "express";
import { NewsArticle } from "@workspace/db/schema";
import { connectDB } from "../lib/db";

const router = Router();

/**
 * Sitemap principal — servido desde el backend para que Google Search Console lo encuentre.
 * Las landings y rutas SPA se incluyen aquí.
 *
 * ENCONTRADO: los artículos individuales de /news/<slug> NUNCA aparecían
 * aquí — la lista de URLs era fija y escrita a mano, sin consultar la base
 * de datos real de NewsArticle. Solo existían en news-sitemap.ts, que usa
 * el namespace especializado de Google News (news:news) — confirmado
 * contra la documentación oficial de Google que ese formato es para la
 * pestaña de Noticias/Discover, no para la indexación de búsqueda general,
 * y que Google solo procesa esas URLs como "noticias" si el dominio está
 * dado de alta en Google News Publisher Center. Sin esto, los artículos
 * quedaban "Descubierta: actualmente sin indexar, sin rastreo nunca
 * intentado" en Search Console — Google sabía que existían (por enlaces
 * internos) pero nunca recibió la señal estándar de sitemap.xml normal
 * diciéndole que son contenido de búsqueda general indexable.
 */
router.get("/api/sitemap.xml", async (_req: Request, res: Response) => {
  const today = new Date().toISOString().split("T")[0];

  const urls = [
    { loc: "https://www.marisai.es/", freq: "daily", priority: "1.0" },
    { loc: "https://www.marisai.es/pricing", freq: "weekly", priority: "0.9" },
    { loc: "https://www.marisai.es/vs-emergent", freq: "monthly", priority: "0.8" },
    // ENCONTRADO A PETICIÓN DEL USUARIO (auditoría SEO/GEO): estas 3
    // páginas de comparación existen y están bien construidas (schema.org
    // FAQ, tabla comparativa, veredicto), pero nunca se habían incluido
    // en el sitemap -- solo vs-emergent estaba. Sin aparecer aquí,
    // Google (y cualquier IA que use el sitemap para descubrir contenido)
    // podía tardar mucho mas en encontrarlas, o no encontrarlas nunca.
    { loc: "https://www.marisai.es/vs-bolt", freq: "monthly", priority: "0.8" },
    { loc: "https://www.marisai.es/vs-lovable", freq: "monthly", priority: "0.8" },
    { loc: "https://www.marisai.es/vs-base44", freq: "monthly", priority: "0.8" },
    { loc: "https://www.marisai.es/news", freq: "hourly", priority: "0.8" },
    { loc: "https://www.marisai.es/showcase", freq: "daily", priority: "0.8" },
    { loc: "https://www.marisai.es/glosario", freq: "weekly", priority: "0.7" },
    { loc: "https://www.marisai.es/que-es-vibe-coding", freq: "monthly", priority: "0.7" },
    { loc: "https://www.marisai.es/que-es-un-agente-de-ia", freq: "monthly", priority: "0.7" },
    { loc: "https://www.marisai.es/desarrollo-no-code-guia", freq: "monthly", priority: "0.7" },
    // Landings SEO ciudades
    { loc: "https://www.marisai.es/landings/crear-app-madrid.html", freq: "monthly", priority: "0.8" },
    { loc: "https://www.marisai.es/landings/crear-app-barcelona.html", freq: "monthly", priority: "0.8" },
    { loc: "https://www.marisai.es/landings/crear-app-valencia.html", freq: "monthly", priority: "0.8" },
    { loc: "https://www.marisai.es/landings/crear-app-mexico.html", freq: "monthly", priority: "0.8" },
    // Landings SEO sectores
    { loc: "https://www.marisai.es/landings/app-para-restaurantes.html", freq: "monthly", priority: "0.7" },
    { loc: "https://www.marisai.es/landings/app-para-clinicas.html", freq: "monthly", priority: "0.7" },
    // Landings competencia
    { loc: "https://www.marisai.es/landings/alternativa-bolt-new.html", freq: "monthly", priority: "0.9" },
    { loc: "https://www.marisai.es/landings/vibe-coding-espanol.html", freq: "monthly", priority: "0.9" },
    // Legal
    { loc: "https://www.marisai.es/legal/privacidad", freq: "yearly", priority: "0.3" },
    { loc: "https://www.marisai.es/legal/aviso-legal", freq: "yearly", priority: "0.3" },
    { loc: "https://www.marisai.es/legal/cookies", freq: "yearly", priority: "0.3" },
  ];

  // Artículos individuales — consultados en tiempo real, no codificados a
  // mano (a diferencia de la lista fija de arriba, los artículos cambian
  // constantemente y no es viable mantenerlos uno por uno aquí).
  try {
    await connectDB();
    const articles = await NewsArticle.find({}).select("slug publishedAt").sort({ publishedAt: -1 }).limit(1000).lean();
    for (const article of articles) {
      urls.push({
        loc: `https://www.marisai.es/news/${article.slug}`,
        freq: "monthly",
        priority: "0.6",
      });
    }
  } catch {
    // Si la consulta a la base de datos falla, el sitemap se sirve igual
    // con el resto de URLs fijas — un fallo aquí no debe romper todo el
    // sitemap completo, solo omitir temporalmente los artículos dinámicos.
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
  xml += `        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n`;

  for (const u of urls) {
    xml += `  <url>\n`;
    xml += `    <loc>${u.loc}</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>${u.freq}</changefreq>\n`;
    xml += `    <priority>${u.priority}</priority>\n`;
    xml += `  </url>\n`;
  }

  xml += `</urlset>\n`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).send(xml);
});

export default router;
