import { Router, Request, Response } from "express";

const router = Router();

/**
 * Sitemap principal — servido desde el backend para que Google Search Console lo encuentre.
 * Las landings y rutas SPA se incluyen aquí.
 */
router.get("/sitemap.xml", async (_req: Request, res: Response) => {
  const today = new Date().toISOString().split("T")[0];

  const urls = [
    { loc: "https://www.marisai.es/", freq: "daily", priority: "1.0" },
    { loc: "https://www.marisai.es/pricing", freq: "weekly", priority: "0.9" },
    { loc: "https://www.marisai.es/vs-emergent", freq: "monthly", priority: "0.8" },
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
