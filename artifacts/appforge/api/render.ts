// ══════════════════════════════════════════════════════════════════════
// Maris AI — Renderizado para bots (Vercel Serverless Function)
// ══════════════════════════════════════════════════════════════════════
// Sustituye a middleware.ts, que usaba `next/server` en un proyecto Vite
// y por tanto nunca llegaba a ejecutarse en producción (Vercel Edge
// Middleware es una convención exclusiva de Next.js).
//
// Este archivo SÍ funciona en cualquier proyecto desplegado en Vercel,
// incluido Vite: cualquier archivo dentro de /api se despliega como
// función serverless sin configuración adicional.
//
// vercel.json enruta aquí (vía "has": user-agent) las peticiones de
// crawlers que no ejecutan JavaScript. Los usuarios normales nunca pasan
// por esta función; siguen recibiendo la SPA de React de siempre.
//
// Para /news/:slug consulta el artículo real en el backend (Railway) en
// vez de servir contenido genérico — antes con middleware.ts (que no
// corría) e incluso con el div oculto de index.html, todas las URLs de
// artículo mostraban el mismo contenido de la home a cualquier crawler
// sin JS. Eso es contenido duplicado real en decenas de URLs.
// ══════════════════════════════════════════════════════════════════════

const API_BASE = "https://maris-ai-api-server-production-fbad.up.railway.app";
const SITE = "https://www.marisai.es";

interface RouteMeta {
  title: string;
  description: string;
  h1: string;
  content: string;
}

// Contenido estático para páginas conocidas que no dependen de la base de
// datos. Es la misma información que ya vive en index.html / la app React,
// simplemente servida como HTML plano para crawlers sin JS.
const STATIC_ROUTES: Record<string, RouteMeta> = {
  "/": {
    title: "Maris AI — Crear App con IA sin Programar",
    description:
      "Crea tu app web con IA en menos de 5 minutos. 9 agentes generan código React, backend y base de datos. Gratis para emprendedores en España.",
    h1: "Crear app con IA sin programar — Maris AI España",
    content: `
      <h2>La plataforma de vibe coding en español para emprendedores</h2>
      <p>Maris AI es la plataforma española para crear aplicaciones web completas con inteligencia artificial sin saber programar. 9 agentes de IA especializados generan tu app en menos de 5 minutos.</p>
      <h2>¿Cómo funciona Maris AI?</h2>
      <ol>
        <li><strong>Describe tu app en español</strong> — escribe en lenguaje natural lo que quieres construir.</li>
        <li><strong>9 agentes IA trabajan en paralelo</strong> — Researcher, Architect, Designer, Frontend, Backend, Database, QA, DevOps y Optimizer.</li>
        <li><strong>App lista en minutos</strong> — React + TypeScript + Tailwind + Express + MongoDB. Código 100% tuyo.</li>
      </ol>
      <nav>
        <a href="/pricing">Precios y créditos</a> |
        <a href="/showcase">Apps creadas con IA</a> |
        <a href="/vs-emergent">Maris AI vs competidores</a> |
        <a href="/news">Blog</a> |
        <a href="/que-es-vibe-coding">Qué es el vibe coding</a> |
        <a href="/glosario">Glosario de inteligencia artificial</a>
      </nav>
    `,
  },
  "/pricing": {
    title: "Precios Maris AI — Créditos de Bienvenida sin Tarjeta",
    description:
      "Empieza gratis, sin tarjeta. Paquetes de créditos que nunca caducan, con descuento progresivo cuanto más compras.",
    h1: "Precios de Maris AI — Planes y créditos",
    content: `<p>Consulta los planes y créditos actualizados en <a href="/pricing">marisai.es/pricing</a>.</p>`,
  },
  "/news": {
    title: "Blog IA para Emprendedores — Maris AI",
    description:
      "Noticias, tutoriales y guías sobre inteligencia artificial, vibe coding y creación de apps sin programar para emprendedores españoles.",
    h1: "Blog de inteligencia artificial para emprendedores",
    content: `<p>Consulta todos los artículos en <a href="/news">marisai.es/news</a>.</p>`,
  },
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHTML(opts: {
  title: string;
  description: string;
  canonical: string;
  h1: string;
  bodyHtml: string;
  jsonLd: Record<string, unknown>;
}): string {
  const { title, description, canonical, h1, bodyHtml, jsonLd } = opts;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:site_name" content="Maris AI" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<main>
<h1>${escapeHtml(h1)}</h1>
${bodyHtml}
</main>
</body>
</html>`;
}

async function renderArticle(slug: string): Promise<string | null> {
  try {
    const resp = await fetch(`${API_BASE}/news/${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json" },
    });
    if (!resp.ok) return null;
    const article = await resp.json();
    if (!article || !article.title) return null;

    const canonical = `${SITE}/news/${slug}`;
    const description: string =
      article.metaDescription || String(article.body || "").slice(0, 160);
    const paragraphs: string[] = String(article.body || "")
      .split("\n\n")
      .filter(Boolean)
      .map((p) => `<p>${escapeHtml(p)}</p>`);

    const relatedNav = `<nav><a href="/news">← Volver al blog</a></nav>`;

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      description,
      image: article.imageUrl,
      author: { "@type": "Organization", name: article.author || "Maris AI" },
      publisher: {
        "@type": "Organization",
        name: "Maris AI",
        logo: { "@type": "ImageObject", url: `${SITE}/logo.svg` },
      },
      datePublished: article.publishedAt,
      dateModified: article.updatedAt || article.publishedAt,
      mainEntityOfPage: canonical,
      keywords: Array.isArray(article.tags) ? article.tags.join(", ") : undefined,
    };

    return buildHTML({
      title: `${article.title} — Maris AI`,
      description,
      canonical,
      h1: article.title,
      bodyHtml: `${paragraphs.join("\n")}\n${relatedNav}`,
      jsonLd,
    });
  } catch {
    return null;
  }
}

export default async function handler(req: any, res: any) {
  const rawPath = typeof req.query.path === "string" ? req.query.path : "/";
  const path = ("/" + rawPath.replace(/^\/+/, "")).replace(/\/$/, "") || "/";

  let html: string | null = null;

  const newsMatch = path.match(/^\/news\/([^/]+)$/);
  if (newsMatch) {
    html = await renderArticle(newsMatch[1]);
  }

  if (!html) {
    const route = STATIC_ROUTES[path] || STATIC_ROUTES["/"];
    html = buildHTML({
      title: route.title,
      description: route.description,
      canonical: `${SITE}${path === "/" ? "/" : path}`,
      h1: route.h1,
      bodyHtml: route.content,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: route.title,
        description: route.description,
        url: `${SITE}${path}`,
      },
    });
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.setHeader("X-Robots-Tag", "index, follow");
  res.status(200).send(html);
}
