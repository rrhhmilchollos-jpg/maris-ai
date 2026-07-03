import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB } from "../lib/db";
import { NewsArticle, type INewsArticle } from "@workspace/db/schema";
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
    const links = articles.map((a: INewsArticle) =>
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

// ── RUTAS COMPARATIVAS Y DE CONTENIDO — alto valor SEO ──────────────────────
// Las rutas declaradas en el canonical JS del index.html pero sin versión
// pre-renderizada para Googlebot. Sin esto, el bot ve "Cargando Maris AI..."
// (texto visible en el HTML estático antes de que React hidrate) en vez del
// contenido real — exactamente el síntoma ya documentado en el comentario de
// app.ts para /news. Con estas rutas, Googlebot recibe HTML completo con
// texto rastreable, H1/H2, datos estructurados y enlaces internos en cada
// una de estas páginas de alto valor para keywords de comparativa.

router.get("/bot-render/vs-base44", (_req: Request, res: Response) => {
  const body = `<main style="max-width:800px;margin:0 auto;padding:40px 20px;">
<h1>Maris AI vs Base44 — Comparativa Completa 2026</h1>
<p>Base44 es una plataforma de generación de aplicaciones con IA muy popular. Sin embargo, Maris AI ofrece ventajas clave para el mercado hispanohablante y para desarrolladores que necesitan control real sobre su código.</p>
<h2>Diferencias clave entre Maris AI y Base44</h2>
<ul>
<li><strong>Idioma</strong>: Maris AI está completamente en español — interfaz, soporte y generación de código. Base44 opera principalmente en inglés.</li>
<li><strong>Exportación de código</strong>: Maris AI genera código 100% exportable a GitHub sin vendor lock-in. Con Base44, el código generado puede tener dependencias de su propia plataforma.</li>
<li><strong>Backend incluido</strong>: Maris AI genera automáticamente un backend Express + MongoDB completo. Base44 se centra más en el frontend.</li>
<li><strong>Precios en euros</strong>: Maris AI cobra en euros con cumplimiento RGPD. Ideal para empresas y autónomos en España y Europa.</li>
<li><strong>Créditos sin caducidad</strong>: Los créditos de Maris AI nunca caducan. 65 créditos gratis al registrarte, sin tarjeta de crédito.</li>
</ul>
<h2>¿Cuándo elegir Maris AI sobre Base44?</h2>
<p>Elige Maris AI si necesitas: aplicaciones con backend real y base de datos, código exportable sin restricciones, soporte en español, precios predecibles en euros, o cumplimiento con la normativa europea de datos (RGPD).</p>
<h2>¿Cuándo puede ser mejor Base44?</h2>
<p>Base44 puede ser adecuada si tu equipo trabaja principalmente en inglés y no necesita exportar el código fuente completo.</p>
<h2>Conclusión</h2>
<p>Para emprendedores y empresas en España y Latinoamérica, Maris AI es la alternativa más completa a Base44: mismo nivel de automatización con IA, pero completamente en español, con backend incluido y código 100% tuyo.</p>
<a href="https://www.marisai.es/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;">Probar Maris AI gratis</a>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Maris AI vs Base44 — Comparativa Completa 2026 | Alternativa en Español",
    "Compara Maris AI con Base44. Descubre por qué Maris AI es la mejor alternativa para el mercado español: código exportable, backend incluido y precios en euros.",
    `${BASE}/vs-base44`,
    body
  ));
});

router.get("/bot-render/vs-lovable", (_req: Request, res: Response) => {
  const body = `<main style="max-width:800px;margin:0 auto;padding:40px 20px;">
<h1>Maris AI vs Lovable — Comparativa 2026</h1>
<p>Lovable es una herramienta popular para crear interfaces web con IA. Maris AI ofrece una alternativa más completa para el mercado hispanohablante.</p>
<h2>Diferencias principales</h2>
<ul>
<li><strong>Sin Supabase obligatorio</strong>: Lovable requiere Supabase para el backend. Maris AI genera su propio backend Express + MongoDB sin dependencias externas.</li>
<li><strong>En español</strong>: Maris AI está completamente localizada para España y Latinoamérica. Lovable solo opera en inglés.</li>
<li><strong>Créditos sin caducidad</strong>: A diferencia de Lovable, los créditos de Maris AI nunca caducan.</li>
<li><strong>Precios predecibles</strong>: Maris AI cobra en euros por proyecto, sin suscripciones mensuales obligatorias.</li>
<li><strong>Stack completo</strong>: Maris AI genera React + TypeScript + Tailwind + Express + MongoDB. Lovable se centra principalmente en el frontend.</li>
</ul>
<h2>Conclusión</h2>
<p>Maris AI es la mejor alternativa a Lovable para desarrolladores y emprendedores en España que necesitan una app completa (frontend + backend + base de datos) sin depender de servicios externos como Supabase.</p>
<a href="https://www.marisai.es/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;">Probar Maris AI gratis</a>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Maris AI vs Lovable — Alternativa en Español con Backend Incluido",
    "Compara Maris AI con Lovable. Sin Supabase obligatorio, completamente en español, con backend Express + MongoDB incluido y créditos que nunca caducan.",
    `${BASE}/vs-lovable`,
    body
  ));
});

router.get("/bot-render/vs-bolt", (_req: Request, res: Response) => {
  const body = `<main style="max-width:800px;margin:0 auto;padding:40px 20px;">
<h1>Maris AI vs Bolt.new — Comparativa 2026</h1>
<p>Bolt.new es una de las herramientas de generación de código con IA más conocidas del mercado. Maris AI es la alternativa en español pensada para emprendedores y desarrolladores hispanohablantes.</p>
<h2>¿Por qué Maris AI es mejor que Bolt.new para el mercado español?</h2>
<ul>
<li><strong>Completamente en español</strong>: Bolt.new opera en inglés. Maris AI está diseñada para el mercado hispanohablante desde cero.</li>
<li><strong>Backend real incluido</strong>: Maris AI genera automáticamente un servidor Express + MongoDB completo. Bolt.new genera principalmente frontend.</li>
<li><strong>Precios en euros</strong>: Sin conversión de divisas ni sorpresas en la factura. Maris AI cobra en euros con IVA incluido.</li>
<li><strong>9 agentes especializados</strong>: Maris AI usa un pipeline multi-agente (Arquitecto, QA, DevOps, PM Agent) para garantizar calidad. Bolt.new usa un único modelo generativo.</li>
<li><strong>Créditos sin caducidad</strong>: Los créditos de Maris AI no tienen fecha de vencimiento.</li>
</ul>
<h2>Conclusión</h2>
<p>Para emprendedores en España y Latinoamérica, Maris AI es la mejor alternativa a Bolt.new: misma velocidad de generación, pero con soporte en español, backend incluido y precios transparentes en euros.</p>
<a href="https://www.marisai.es/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;">Probar Maris AI gratis</a>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Maris AI vs Bolt.new — La mejor alternativa en español 2026",
    "Compara Maris AI con Bolt.new. En español, con backend Express + MongoDB incluido, precios en euros y 9 agentes especializados. La mejor alternativa para España.",
    `${BASE}/vs-bolt`,
    body
  ));
});

router.get("/bot-render/que-es-vibe-coding", (_req: Request, res: Response) => {
  const body = `<main style="max-width:800px;margin:0 auto;padding:40px 20px;">
<h1>Qué es el Vibe Coding — Guía Completa 2026</h1>
<p>El vibe coding es el nuevo paradigma de desarrollo de software donde describes tu idea en lenguaje natural y la inteligencia artificial genera el código completo automáticamente. No necesitas saber programar.</p>
<h2>¿Cómo funciona el vibe coding?</h2>
<ol>
<li><strong>Describes tu idea</strong>: Escribes en lenguaje natural lo que quieres construir. Por ejemplo: "Quiero una app de gestión de citas para mi clínica dental".</li>
<li><strong>La IA genera el código</strong>: Uno o varios agentes de inteligencia artificial analizan tu petición y generan el código fuente completo (frontend, backend, base de datos).</li>
<li><strong>Recibes tu app funcional</strong>: En minutos tienes una aplicación web real, lista para desplegar y usar.</li>
</ol>
<h2>¿Qué herramientas de vibe coding existen?</h2>
<p>Las principales herramientas de vibe coding en 2026 son: Maris AI (en español), Bolt.new, Lovable, Emergent.sh, Cursor y GitHub Copilot. Maris AI es la única plataforma de vibe coding completamente en español.</p>
<h2>¿El vibe coding reemplaza a los programadores?</h2>
<p>No. El vibe coding es una herramienta que amplifica la productividad de los desarrolladores y permite a personas no técnicas crear prototipos y MVPs rápidamente. Los proyectos complejos siguen requiriendo supervisión técnica.</p>
<h2>Ventajas del vibe coding con Maris AI</h2>
<ul>
<li>Crea una app funcional en menos de 5 minutos</li>
<li>Sin conocimientos de programación necesarios</li>
<li>Código exportable a GitHub sin restricciones</li>
<li>Backend y base de datos incluidos automáticamente</li>
<li>En español, para el mercado hispanohablante</li>
</ul>
<a href="https://www.marisai.es/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;">Probar vibe coding con Maris AI gratis</a>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Qué es el Vibe Coding — Guía Completa 2026 | Maris AI",
    "El vibe coding es el nuevo paradigma donde describes tu idea y la IA genera el código. Guía completa sobre cómo crear apps con IA en España sin programar.",
    `${BASE}/que-es-vibe-coding`,
    body
  ));
});

router.get("/bot-render/que-es-un-agente-de-ia", (_req: Request, res: Response) => {
  const body = `<main style="max-width:800px;margin:0 auto;padding:40px 20px;">
<h1>Qué es un Agente de IA — Guía para Emprendedores 2026</h1>
<p>Un agente de inteligencia artificial es un sistema autónomo que percibe su entorno, toma decisiones y ejecuta acciones para conseguir un objetivo concreto. A diferencia de un chatbot simple, un agente de IA puede planificar, usar herramientas externas y trabajar durante varios pasos sin intervención humana.</p>
<h2>¿Cómo funcionan los agentes de IA?</h2>
<p>Los agentes de IA utilizan modelos de lenguaje avanzados (como Claude de Anthropic o GPT de OpenAI) combinados con herramientas externas (acceso a internet, bases de datos, APIs) para completar tareas complejas de forma autónoma.</p>
<h2>Los 9 agentes de IA de Maris AI</h2>
<ol>
<li><strong>Researcher</strong>: Investiga el mercado y define requisitos</li>
<li><strong>Architect</strong>: Diseña la arquitectura técnica completa</li>
<li><strong>Designer</strong>: Define sistema visual y UX</li>
<li><strong>Frontend Engineer</strong>: Genera código React + TypeScript + Tailwind</li>
<li><strong>Backend Engineer</strong>: Desarrolla API REST con Express + MongoDB</li>
<li><strong>QA Auditor</strong>: Revisa errores y seguridad</li>
<li><strong>PM Agent</strong>: Valida que el resultado cumple el objetivo</li>
<li><strong>Image Agent</strong>: Integra imágenes reales con IA</li>
<li><strong>Visual Evaluator</strong>: Analiza la app con visión artificial</li>
</ol>
<h2>¿Para qué sirven los agentes de IA en el desarrollo de software?</h2>
<p>Los agentes de IA permiten automatizar el ciclo completo de desarrollo: desde el análisis de requisitos hasta el despliegue en producción, pasando por el diseño, la programación y las pruebas. Maris AI usa esta tecnología para que cualquier persona pueda crear una app completa sin saber programar.</p>
<a href="https://www.marisai.es/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;">Crear mi app con agentes de IA</a>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Qué es un Agente de IA — Guía para Emprendedores | Maris AI",
    "Un agente de IA es un sistema autónomo que planifica, razona y ejecuta tareas. Maris AI usa 9 agentes especializados para crear tu app completa en minutos.",
    `${BASE}/que-es-un-agente-de-ia`,
    body
  ));
});

router.get("/bot-render/glosario", (_req: Request, res: Response) => {
  const body = `<main style="max-width:800px;margin:0 auto;padding:40px 20px;">
<h1>Glosario de Inteligencia Artificial para Emprendedores — Maris AI</h1>
<p>Todos los términos de IA y desarrollo de software que necesitas conocer como emprendedor en 2026, explicados en español de forma sencilla.</p>
<dl>
<dt style="font-weight:700;margin-top:1.5rem;">Vibe Coding</dt>
<dd>Paradigma de desarrollo donde describes tu idea en lenguaje natural y la IA genera el código. Maris AI es la plataforma de vibe coding líder en español.</dd>
<dt style="font-weight:700;margin-top:1.5rem;">Agente de IA (AI Agent)</dt>
<dd>Sistema autónomo de inteligencia artificial que planifica, toma decisiones y ejecuta acciones para completar una tarea sin intervención humana continua.</dd>
<dt style="font-weight:700;margin-top:1.5rem;">LLM (Large Language Model)</dt>
<dd>Modelo de lenguaje de gran escala entrenado con enormes cantidades de texto. Ejemplos: Claude (Anthropic), GPT-4 (OpenAI), Gemini (Google).</dd>
<dt style="font-weight:700;margin-top:1.5rem;">React</dt>
<dd>Biblioteca JavaScript de Meta para construir interfaces de usuario. Es el estándar de la industria para aplicaciones web modernas. Maris AI genera aplicaciones en React + TypeScript.</dd>
<dt style="font-weight:700;margin-top:1.5rem;">TypeScript</dt>
<dd>Lenguaje de programación que añade tipos estáticos a JavaScript, reduciendo errores y mejorando la mantenibilidad del código.</dd>
<dt style="font-weight:700;margin-top:1.5rem;">Tailwind CSS</dt>
<dd>Framework de CSS utilitario que permite diseñar interfaces modernas directamente en el HTML. Todas las apps de Maris AI usan Tailwind por defecto.</dd>
<dt style="font-weight:700;margin-top:1.5rem;">MongoDB</dt>
<dd>Base de datos NoSQL orientada a documentos, ideal para aplicaciones web flexibles y de rápido desarrollo. El backend de Maris AI usa MongoDB por defecto.</dd>
<dt style="font-weight:700;margin-top:1.5rem;">Express.js</dt>
<dd>Framework minimalista para construir APIs y servidores web con Node.js. Maris AI genera backends con Express automáticamente.</dd>
<dt style="font-weight:700;margin-top:1.5rem;">SaaS (Software as a Service)</dt>
<dd>Modelo de negocio donde el software se ofrece como servicio a través de internet, con pago por suscripción. Maris AI permite crear plataformas SaaS sin programar.</dd>
<dt style="font-weight:700;margin-top:1.5rem;">No-code / Low-code</dt>
<dd>Herramientas que permiten crear aplicaciones sin escribir código (no-code) o con muy poco código (low-code). Maris AI va más allá: genera código real y completo que puedes exportar.</dd>
</dl>
<a href="https://www.marisai.es/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;">Crear mi primera app con IA</a>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Glosario de Inteligencia Artificial para Emprendedores 2026 | Maris AI",
    "Todos los términos de IA que necesitas: vibe coding, agentes, LLM, React, TypeScript, MongoDB, SaaS y más. Explicados en español para emprendedores.",
    `${BASE}/glosario`,
    body
  ));
});

router.get("/bot-render/desarrollo-no-code-guia", (_req: Request, res: Response) => {
  const body = `<main style="max-width:800px;margin:0 auto;padding:40px 20px;">
<h1>Guía de Desarrollo No-Code con IA para Emprendedores Españoles 2026</h1>
<p>Crear una aplicación web ya no requiere años de experiencia en programación. Con las herramientas de inteligencia artificial disponibles en 2026, cualquier emprendedor puede construir su propio software en cuestión de minutos.</p>
<h2>¿Qué es el desarrollo no-code con IA?</h2>
<p>El desarrollo no-code con IA combina la accesibilidad del no-code tradicional con el poder de los modelos de lenguaje avanzados. En vez de arrastrar y soltar bloques visuales, describes tu idea en lenguaje natural y la IA genera código real y funcional.</p>
<h2>Paso a paso: Cómo crear tu primera app sin programar</h2>
<ol>
<li><strong>Define tu idea</strong>: ¿Qué problema resuelve tu app? ¿Quién es tu usuario? Escríbelo en una o dos frases en español.</li>
<li><strong>Elige una plataforma</strong>: Para el mercado español, Maris AI es la opción más completa: en español, con backend incluido y código exportable.</li>
<li><strong>Describe tu app</strong>: Usa el chat de Maris AI para describir las funcionalidades que necesitas. Sé específico: "Una app de reservas para mi restaurante con sistema de turnos y notificaciones por email".</li>
<li><strong>Recibe tu app</strong>: En menos de 5 minutos, los 9 agentes de Maris AI generarán tu aplicación completa.</li>
<li><strong>Personaliza y despliega</strong>: Ajusta el diseño desde el chat, exporta el código a GitHub y despliega en Vercel con un clic.</li>
</ol>
<h2>¿Qué tipos de apps puedes crear sin programar?</h2>
<ul>
<li>CRM y gestión de clientes</li>
<li>Tiendas online con pasarela de pago</li>
<li>Plataformas de reservas y citas</li>
<li>Dashboards de analítica y métricas</li>
<li>Apps para restaurantes, clínicas, gimnasios</li>
<li>Marketplaces y directorios</li>
<li>Plataformas educativas y cursos online</li>
<li>SaaS con suscripciones y usuarios</li>
</ul>
<h2>¿Es el código generado por IA de calidad profesional?</h2>
<p>Sí. Maris AI genera código React + TypeScript + Tailwind + Express + MongoDB siguiendo las mejores prácticas de la industria. El código es moderno, escalable y 100% exportable a GitHub sin restricciones.</p>
<a href="https://www.marisai.es/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;">Empezar gratis — 65 créditos sin tarjeta</a>
</main>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(html(
    "Guía No-Code con IA para Emprendedores Españoles 2026 | Maris AI",
    "Guía completa para crear tu primera app sin programar usando IA. Paso a paso, en español, para emprendedores y autónomos en España.",
    `${BASE}/desarrollo-no-code-guia`,
    body
  ));
});

export default router;
