import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB } from "../lib/db";
import { NewsArticle } from "@workspace/db/schema";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const BASE = "https://www.marisai.es";

function html(title: string, desc: string, canonical: string, body: string, imageUrl?: string, isArticle?: boolean): string {
  const ogImage = imageUrl
    ? `<meta property="og:image" content="${imageUrl}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>`
    : "";
  const ogType = isArticle ? "article" : "website";
  const ldJson = isArticle
    ? `{"@context":"https://schema.org","@type":"NewsArticle","name":"${title}","url":"${canonical}","image":"${imageUrl || ""}","publisher":{"@type":"Organization","name":"Maris AI","url":"https://www.marisai.es"}}`
    : `{"@context":"https://schema.org","@type":"WebSite","name":"Maris AI","url":"https://www.marisai.es"}`;

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
${ogImage}
<script type="application/ld+json">
${ldJson}
</script>
</head>
<body>${body}</body>
</html>`;
}

router.get("/bot-render/", (_req: Request, res: Response) => {
  const body = `<header><a href="${BASE}"><img src="${BASE}/logo.svg" alt="Maris AI" width="120"/></a></header>
<main>
<h1>Maris AI — Generador de Apps con IA en Español</h1>
<p>Describe tu idea en español y 9 agentes de inteligencia artificial especializados generan tu app completa en menos de 5 minutos. Sin programar, sin contratar un desarrollador.</p>
<h2>¿Cómo funciona?</h2>
<ol>
<li><strong>Describe tu app</strong> — escribe en español lo que quieres construir.</li>
<li><strong>9 agentes IA trabajan en paralelo</strong> — Researcher, Architect, Designer, Frontend, Backend, Database, QA, DevOps y Optimizer.</li>
<li><strong>App lista en menos de 5 minutos</strong> — React + TypeScript + Tailwind + Express + MongoDB. Código 100% tuyo, exportable a GitHub.</li>
</ol>
<h2>¿Para quién es Maris AI?</h2>
<ul>
<li>Emprendedores y autónomos que quieren digitalizar su negocio sin contratar un desarrollador.</li>
<li>Startups que necesitan un MVP rápido para validar su idea.</li>
<li>Freelancers que quieren entregar proyectos más rápido.</li>
<li>Cualquier persona con una idea de app y sin conocimientos de programación.</li>
</ul>
<h2>Alternativa en español a Bolt, Lovable y v0</h2>
<p>Maris AI es la única herramienta de generación de apps con IA pensada específicamente para el mercado hispanohablante. Interfaz en español, soporte en español, y modelos optimizados para generar código documentado en español.</p>
<h2>Empieza gratis</h2>
<p>Crea tu primera app gratis, sin tarjeta de crédito. <a href="${BASE}/sign-up">Regístrate en Maris AI</a>.</p>
<nav><a href="${BASE}/news">Noticias sobre IA</a> | <a href="${BASE}/vs-emergent">Maris AI vs competidores</a></nav>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Maris AI — Generador de Apps con IA en Español",
    "Describe tu idea y 9 agentes IA generan tu app completa en menos de 5 minutos. Sin programar. Alternativa en español a Bolt y Lovable.",
    `${BASE}/`,
    body
  ));
});

router.get("/bot-render/pricing", (_req: Request, res: Response) => {
  const body = `<main>
<h1>Precios de Maris AI — Planes y tarifas</h1>
<p>Empieza gratis y escala según tus necesidades. Sin permanencia, cancela cuando quieras.</p>
<h2>Plan Gratuito</h2>
<ul><li>Acceso a los 9 agentes IA</li><li>Genera tu primera app sin tarjeta</li><li>Exportación de código incluida</li></ul>
<h2>Plan Pro</h2>
<ul><li>Apps ilimitadas</li><li>Generaciones prioritarias</li><li>Soporte directo</li></ul>
<p><a href="${BASE}/sign-up">Empieza gratis ahora</a></p>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Precios Maris AI — Planes gratuito y Pro",
    "Empieza gratis con Maris AI. Genera apps con IA sin programar. Plan gratuito disponible, sin tarjeta de crédito.",
    `${BASE}/pricing`,
    body
  ));
});

router.get("/bot-render/vs-emergent", (_req: Request, res: Response) => {
  const body = `<main>
<h1>Maris AI vs Bolt, Lovable y v0 — Comparativa de generadores de apps con IA</h1>
<p>Maris AI es la alternativa en español a las grandes herramientas de generación de apps con IA.</p>
<h2>¿Por qué Maris AI en lugar de Bolt o Lovable?</h2>
<ul>
<li><strong>En español</strong>: interfaz, soporte y código documentado en español.</li>
<li><strong>9 agentes especializados</strong>: arquitectura multi-agente frente al agente único de la competencia.</li>
<li><strong>Stack completo</strong>: frontend React + backend Express + base de datos, no solo frontend.</li>
<li><strong>Precio</strong>: más accesible para el mercado hispanohablante.</li>
</ul>
<p><a href="${BASE}/sign-up">Prueba Maris AI gratis</a></p>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Maris AI vs Bolt vs Lovable — Comparativa generadores apps IA en español",
    "Compara Maris AI con Bolt, Lovable y v0. La mejor alternativa en español para generar apps con IA sin programar.",
    `${BASE}/vs-emergent`,
    body
  ));
});

router.get("/bot-render/news", async (_req: Request, res: Response) => {
  await connectDB();
  try {
    const articles = await NewsArticle.find({}).sort({ publishedAt: -1 }).limit(20).lean();
    const links = articles.map(a =>
      `<li><a href="${BASE}/news/${a.slug}">${a.title}</a> — <time>${new Date(a.publishedAt).toLocaleDateString("es-ES")}</time></li>`
    ).join("\n");
    const body = `<main>
<h1>Noticias sobre Inteligencia Artificial — Maris AI</h1>
<p>Últimas noticias y artículos sobre IA, generación de apps, no-code y desarrollo sin programar.</p>
<ul>${links}</ul>
</main>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.send(html(
      "Noticias sobre IA — Maris AI Blog",
      "Últimas noticias sobre inteligencia artificial, generación de apps con IA y desarrollo no-code en español.",
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

    const articleBody = `<main>
<article>
<h1>${article.title}</h1>
<time datetime="${new Date(article.publishedAt).toISOString()}">${new Date(article.publishedAt).toLocaleDateString("es-ES")}</time>
${article.imageUrl ? `<img src="${article.imageUrl}" alt="${article.imageAlt || article.title}" style="max-width:100%;height:auto;"/>` : ""}
<div>${article.body || article.content || article.summary || ""}</div>
<p><a href="${BASE}/news">Volver a noticias</a></p>
</article>
</main>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(html(
      `${article.title} — Maris AI`,
      String(article.metaDescription || article.summary || article.title).slice(0, 160),
      `${BASE}/news/${article.slug}`,
      articleBody,
      article.imageUrl,   // ← og:image para Google Discover
      true                // ← schema NewsArticle en lugar de WebSite
    ));
  } catch (err) {
    logger.error({ err }, "bot-render /news/:slug error");
    res.status(500).send("Error");
  }
});

export default router;
