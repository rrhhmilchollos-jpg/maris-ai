import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB } from "../lib/db";
import { NewsArticle } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const BASE = "https://www.marisai.es";

function html(title: string, desc: string, canonical: string, body: string, options: { imageUrl?: string, isArticle?: boolean, articleData?: any } = {}): string {
  const { imageUrl, isArticle, articleData } = options;
  
  const ogImage = imageUrl
    ? `<meta property="og:image" content="${imageUrl}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>`
    : `<meta property="og:image" content="${BASE}/opengraph.jpg"/>`;

  const ogType = isArticle ? "article" : "website";
  
  let ldJson = "";
  if (isArticle && articleData) {
    // Imagen con dimensiones explícitas (requerido por Google Discover: mín 1200px)
    const heroImage = imageUrl && !imageUrl.endsWith('.svg')
      ? imageUrl
      : `${BASE}/opengraph.jpg`;
    const schema = {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      "headline": articleData.title,
      "image": [
        {
          "@type": "ImageObject",
          "url": heroImage,
          "width": 1200,
          "height": 630
        }
      ],
      "datePublished": new Date(articleData.publishedAt).toISOString(),
      "dateModified": new Date(articleData.updatedAt || articleData.publishedAt).toISOString(),
      "author": [{
        "@type": "Person",
        "name": articleData.author || "Equipo Maris AI",
        "url": BASE
      }],
      "publisher": {
        "@type": "NewsMediaOrganization",
        "name": "Maris AI",
        "url": BASE,
        "logo": {
          "@type": "ImageObject",
          "url": `${BASE}/opengraph.jpg`,
          "width": 1200,
          "height": 630
        }
      },
      "description": desc,
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": canonical
      },
      "keywords": (articleData.tags || []).join(", ") || "inteligencia artificial, IA, tecnología",
      "articleSection": "Inteligencia Artificial",
      "inLanguage": "es",
      "isAccessibleForFree": true,
      "wordCount": articleData.body ? articleData.body.split(/\s+/).length : undefined
    };
    ldJson = JSON.stringify(schema);
  } else {
    ldJson = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "Maris AI",
      "url": BASE,
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": `${BASE}/news?q={search_term_string}`
        },
        "query-input": "required name=search_term_string"
      }
    });
  }

  // Meta tags adicionales para artículos (Google Discover y Google News)
  const articleMeta = isArticle && articleData ? `
<meta property="article:published_time" content="${new Date(articleData.publishedAt).toISOString()}"/>
<meta property="article:modified_time" content="${new Date(articleData.updatedAt || articleData.publishedAt).toISOString()}"/>
<meta property="article:author" content="${articleData.author || 'Equipo Maris AI'}"/>
<meta property="article:section" content="Inteligencia Artificial"/>
<meta name="news_keywords" content="${(articleData.tags || []).join(', ') || 'inteligencia artificial, IA'}"/>
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"/>` : `
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"/>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<meta name="description" content="${desc}"/>
<link rel="canonical" href="${canonical}"/>
<meta property="og:title" content="${title}"/>
<meta property="og:description" content="${desc}"/>
<meta property="og:url" content="${canonical}"/>
<meta property="og:type" content="${ogType}"/>
<meta property="og:site_name" content="Maris AI"/>
<meta property="og:locale" content="es_ES"/>
${ogImage}
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:site" content="@marisai_es"/>
<meta name="twitter:title" content="${title}"/>
<meta name="twitter:description" content="${desc}"/>
<meta name="twitter:image" content="${imageUrl || `${BASE}/opengraph.jpg`}"/>${articleMeta}
<script type="application/ld+json">
${ldJson}
</script>
</head>
<body>
  <header style="padding: 20px; border-bottom: 1px solid #eee;">
    <a href="${BASE}"><img src="${BASE}/logo.svg" alt="Maris AI" width="120"/></a>
    <nav style="margin-top: 10px;">
      <a href="${BASE}/news">Noticias</a> | 
      <a href="${BASE}/pricing">Precios</a> | 
      <a href="${BASE}/vs-emergent">Comparativa</a>
    </nav>
  </header>
  ${body}
  <footer style="padding: 40px 20px; background: #f9f9f9; margin-top: 40px; border-top: 1px solid #eee;">
    <p>© ${new Date().getFullYear()} Maris AI - Generador de Apps con IA en Español</p>
    <p><a href="${BASE}/legal/privacidad">Privacidad</a> | <a href="${BASE}/legal/aviso-legal">Aviso Legal</a></p>
  </footer>
</body>
</html>`;
}

router.get("/bot-render/", (_req: Request, res: Response) => {
  const body = `<main style="max-width: 800px; margin: 0 auto; padding: 40px 20px;">
<h1>Maris AI — Generador de Apps con IA en Español</h1>
<p>Describe tu idea en español y 9 agentes de inteligencia artificial especializados generan tu app completa en menos de 5 minutos. Sin programar, sin contratar un desarrollador.</p>
<h2>¿Cómo funciona?</h2>
<ol>
<li><strong>Describe tu app</strong> — escribe en español lo que quieres construir.</li>
<li><strong>9 agentes IA trabajan en paralelo</strong> — Researcher, Architect, Designer, Frontend, Backend, Database, QA, DevOps y Optimizer.</li>
<li><strong>App lista en menos de 5 minutos</strong> — React + TypeScript + Tailwind + Express + MongoDB. Código 100% tuyo, exportable a GitHub.</li>
</ol>
<h2>Alternativa en español a Bolt, Lovable y v0</h2>
<p>Maris AI es la única herramienta de generación de apps con IA pensada específicamente para el mercado hispanohablante. Interfaz en español, soporte en español, y modelos optimizados para generar código documentado en español.</p>
<div style="margin-top: 30px;">
  <a href="${BASE}/sign-up" style="background: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Empieza gratis ahora</a>
</div>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Maris AI | Generador de Apps con IA — 9 Agentes Especializados",
    "Describe tu idea y 9 agentes IA generan tu app completa en menos de 5 minutos. Sin programar. Alternativa en español a Bolt y Lovable.",
    `${BASE}/`,
    body
  ));
});

router.get("/bot-render/pricing", (_req: Request, res: Response) => {
  const body = `<main style="max-width: 800px; margin: 0 auto; padding: 40px 20px;">
<h1>Precios de Maris AI — Planes y tarifas</h1>
<p>Empieza gratis y escala según tus necesidades. Sin permanencia, cancela cuando quieras.</p>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 30px;">
  <div style="border: 1px solid #eee; padding: 20px; border-radius: 12px;">
    <h2>Plan Gratuito</h2>
    <p>0€/mes</p>
    <ul><li>Acceso a los 9 agentes IA</li><li>Genera tu primera app sin tarjeta</li><li>Exportación de código incluida</li></ul>
  </div>
  <div style="border: 1px solid #7c3aed; padding: 20px; border-radius: 12px;">
    <h2>Plan Pro</h2>
    <p>Desde 20€/mes</p>
    <ul><li>Apps ilimitadas</li><li>Generaciones prioritarias</li><li>Soporte directo</li></ul>
  </div>
</div>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Precios — Maris AI | Planes desde 0€",
    "Elige el plan de Maris AI que mejor se adapte a ti. Plan gratuito con apps incluidas, Pro con generaciones ilimitadas.",
    `${BASE}/pricing`,
    body
  ));
});

router.get("/bot-render/vs-emergent", (_req: Request, res: Response) => {
  const body = `<main style="max-width: 800px; margin: 0 auto; padding: 40px 20px;">
<h1>Maris AI vs Bolt, Lovable y v0 — Comparativa</h1>
<p>Maris AI es la alternativa en español a las grandes herramientas de generación de apps con IA.</p>
<h2>¿Por qué elegir Maris AI?</h2>
<ul>
<li><strong>Interfaz en Español</strong>: No pierdas tiempo traduciendo.</li>
<li><strong>9 Agentes Especializados</strong>: Un pipeline real de desarrollo (Arquitecto, QA, DevOps...).</li>
<li><strong>Código Full-stack</strong>: No solo hacemos el diseño, generamos el backend y la base de datos.</li>
</ul>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Maris AI vs Bolt vs Lovable — La mejor alternativa en español",
    "Compara Maris AI con Bolt, Lovable y v0. Descubre por qué Maris AI es la mejor opción para el mercado hispanohablante.",
    `${BASE}/vs-emergent`,
    body
  ));
});

router.get("/bot-render/news", async (_req: Request, res: Response) => {
  await connectDB();
  try {
    const articles = await NewsArticle.find({}).sort({ publishedAt: -1 }).limit(20).lean();
    const links = articles.map(a =>
      `<li style="margin-bottom: 15px;"><a href="${BASE}/news/${a.slug}" style="font-size: 1.2rem; font-weight: bold; color: #7c3aed;">${a.title}</a><br/><time>${new Date(a.publishedAt).toLocaleDateString("es-ES")}</time></li>`
    ).join("\n");
    const body = `<main style="max-width: 800px; margin: 0 auto; padding: 40px 20px;">
<h1>Noticias sobre Inteligencia Artificial — Maris AI</h1>
<p>Últimas novedades en IA, desarrollo no-code y agentes inteligentes.</p>
<ul style="list-style: none; padding: 0;">${links}</ul>
</main>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.send(html(
      "Noticias de IA — Maris AI | Últimas novedades en inteligencia artificial",
      "Últimas noticias sobre inteligencia artificial, generación de código con IA y novedades de la plataforma Maris AI.",
      `${BASE}/news`,
      body
    ));
  } catch (err) {
    logger.error({ err }, "bot-render /news error");
    res.status(500).send("Error");
  }
});

router.get("/bot-render/news/:slug", async (req: Request, res: Response) => {
  await connectDB();
  try {
    const article = await NewsArticle.findOne({ slug: req.params.slug }).lean();
    if (!article) { res.status(404).send("Not found"); return; }

    const body = `<main style="max-width: 800px; margin: 0 auto; padding: 40px 20px;">
<article>
<h1>${article.title}</h1>
<div style="color: #666; margin-bottom: 20px;">
  Publicado por <strong>${article.author || "Equipo Maris AI"}</strong> el <time datetime="${new Date(article.publishedAt).toISOString()}">${new Date(article.publishedAt).toLocaleDateString("es-ES")}</time>
</div>
${article.imageUrl ? `<img src="${article.imageUrl}" alt="${article.imageAlt || article.title}" style="max-width:100%; height:auto; border-radius: 12px; margin-bottom: 30px;"/>` : ""}
<div style="line-height: 1.6; font-size: 1.1rem;">${article.body || ""}</div>
<div style="margin-top: 40px; padding: 20px; background: #f0ebff; border-radius: 12px;">
  <h3>¿Quieres crear tu propia app con IA?</h3>
  <p>Describe tu idea en Maris AI y deja que nuestros 9 agentes la construyan por ti.</p>
  <a href="${BASE}/sign-up" style="background: #7c3aed; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">Empezar gratis</a>
</div>
</article>
</main>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(html(
      `${article.title} — Maris AI`,
      String(article.metaDescription || article.title).slice(0, 160),
      `${BASE}/news/${article.slug}`,
      body,
      { 
        imageUrl: article.imageUrl, 
        isArticle: true, 
        articleData: article 
      }
    ));
  } catch (err) {
    logger.error({ err }, "bot-render /news/:slug error");
    res.status(500).send("Error");
  }
});

export default router;
