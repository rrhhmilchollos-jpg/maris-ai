import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ══════════════════════════════════════════════════════════════════════
// Maris AI — Edge Middleware
// Detecta bots de Google, IA (ChatGPT, Perplexity, Claude, Gemini)
// y les sirve HTML estático con contenido real en lugar de la SPA vacía.
// Esto resuelve el Soft 404 y permite que los modelos de IA citen Maris AI.
// ══════════════════════════════════════════════════════════════════════

// User-agents de bots que necesitan HTML prerenderizado
const BOT_PATTERNS = [
  // Google
  "googlebot",
  "google-inspectiontool",
  "google-extended",
  "googleother",
  "apis-google",
  // Bing / Microsoft
  "bingbot",
  "bingpreview",
  "msnbot",
  // IA — ChatGPT / OpenAI
  "gptbot",
  "chatgpt-user",
  "oai-searchbot",
  // IA — Anthropic / Claude
  "claudebot",
  "anthropic-ai",
  // IA — Perplexity
  "perplexitybot",
  // IA — Google Gemini
  "google-extended",
  // IA — Meta
  "meta-externalagent",
  "meta-externalfetcher",
  // IA — Apple
  "applebot",
  // IA — Amazon
  "amazonbot",
  // IA — You.com
  "youbot",
  // SEO Tools
  "semrushbot",
  "ahrefsbot",
  "mj12bot",
  "dotbot",
  // Social previews
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "whatsapp",
  "telegrambot",
  "slackbot",
  "discordbot",
];

// Contenido por ruta — lo que Google e IAs verán
const ROUTE_CONTENT: Record<string, {
  title: string;
  description: string;
  h1: string;
  content: string;
  canonical: string;
}> = {
  "/": {
    title: "Maris AI — Crear App con IA sin Programar",
    description: "Crea tu app web con IA en menos de 5 minutos. 9 agentes generan código React, backend y base de datos. Gratis para emprendedores en España.",
    h1: "Crear app con IA sin programar — Maris AI España",
    canonical: "https://www.marisai.es/",
    content: `
      <h2>La plataforma de vibe coding en español para emprendedores</h2>
      <p>Maris AI es la plataforma española para crear aplicaciones web completas con inteligencia artificial sin saber programar. 9 agentes de IA especializados generan tu app en menos de 5 minutos.</p>
      <h2>¿Cómo funciona Maris AI?</h2>
      <ol>
        <li><strong>Describe tu app en español</strong> — escribe en lenguaje natural lo que quieres construir.</li>
        <li><strong>9 agentes IA trabajan en paralelo</strong> — Researcher, Architect, Designer, Frontend, Backend, Database, QA, DevOps y Optimizer.</li>
        <li><strong>App lista en menos de 5 minutos</strong> — React + TypeScript + Tailwind + Express + MongoDB. Código 100% tuyo.</li>
      </ol>
      <h2>Los 9 agentes de inteligencia artificial de Maris AI</h2>
      <ul>
        <li><strong>Researcher</strong> — Analiza tu idea y define los requisitos del proyecto.</li>
        <li><strong>Architect</strong> — Diseña la arquitectura técnica de la aplicación.</li>
        <li><strong>Designer</strong> — Crea el diseño visual y la experiencia de usuario.</li>
        <li><strong>Frontend Engineer</strong> — Genera el código React + TypeScript + Tailwind.</li>
        <li><strong>Backend Engineer</strong> — Desarrolla el servidor Express y los endpoints API.</li>
        <li><strong>Database</strong> — Diseña y configura la base de datos MongoDB.</li>
        <li><strong>QA</strong> — Verifica que el código funciona correctamente.</li>
        <li><strong>DevOps</strong> — Prepara el proyecto para despliegue en Vercel o Railway.</li>
        <li><strong>Optimizer</strong> — Optimiza el rendimiento y la calidad del código final.</li>
      </ul>
      <h2>Preguntas frecuentes</h2>
      <dl>
        <dt>¿Necesito saber programar para usar Maris AI?</dt>
        <dd>No. Solo describe tu idea en español y Maris AI genera el código completo.</dd>
        <dt>¿Cuánto cuesta Maris AI?</dt>
        <dd>65 créditos gratis al registrarte. Paquetes desde 20€ que nunca caducan.</dd>
        <dt>¿El código generado es mío?</dt>
        <dd>Sí, el código es 100% tuyo, exportable a GitHub sin restricciones.</dd>
        <dt>¿Qué es el vibe coding?</dt>
        <dd>El vibe coding es el paradigma donde describes tu idea en lenguaje natural y la IA genera todo el código. Maris AI es la plataforma de vibe coding líder en español.</dd>
      </dl>
      <nav>
        <a href="/pricing">Precios y créditos</a> |
        <a href="/showcase">Apps creadas con IA</a> |
        <a href="/vs-emergent">Maris AI vs competidores</a> |
        <a href="/vs-lovable">Maris AI vs Lovable</a> |
        <a href="/vs-bolt">Maris AI vs Bolt.new</a> |
        <a href="/que-es-vibe-coding">Qué es el vibe coding</a> |
        <a href="/que-es-un-agente-de-ia">Qué es un agente de IA</a> |
        <a href="/glosario">Glosario de inteligencia artificial</a> |
        <a href="/desarrollo-no-code-guia">Guía de desarrollo no-code</a>
      </nav>
    `,
  },
  "/vs-lovable": {
    title: "Maris AI vs Lovable — Alternativa en Español 2026",
    description: "Comparativa completa Maris AI vs Lovable. Backend incluido, en español, sin pagar Supabase aparte. La mejor alternativa a Lovable para emprendedores en España.",
    h1: "Maris AI vs Lovable — ¿Cuál es mejor para España?",
    canonical: "https://www.marisai.es/vs-lovable",
    content: `
      <h2>Maris AI vs Lovable: comparativa completa 2026</h2>
      <p>Lovable es la plataforma de vibe coding más popular en inglés con 8 millones de usuarios. Maris AI es la única alternativa completa en español con backend incluido para emprendedores.</p>
      <h2>Diferencias principales</h2>
      <ul>
        <li><strong>Idioma</strong>: Maris AI está 100% en español. Lovable solo en inglés.</li>
        <li><strong>Backend</strong>: Maris AI incluye Express + MongoDB. Lovable requiere Supabase aparte (+25€/mes).</li>
        <li><strong>Precio real</strong>: Maris AI desde 20€ todo incluido. Lovable Pro ($25) + Supabase ($25) = ~50€/mes.</li>
        <li><strong>Créditos</strong>: En Maris AI nunca caducan. En Lovable caducan a los 2 meses.</li>
        <li><strong>Agentes IA</strong>: Maris AI tiene 9 agentes especializados. Lovable tiene 1 agente general.</li>
        <li><strong>Soporte</strong>: Maris AI tiene soporte en español. Lovable solo en inglés.</li>
      </ul>
      <h2>¿Por qué elegir Maris AI sobre Lovable?</h2>
      <p>Si eres emprendedor en España o Latinoamérica, Maris AI es la mejor opción porque está completamente en español, incluye backend real sin coste adicional y ofrece soporte directo en español. Lovable es excelente pero requiere inglés y pagar servicios externos para tener una app de producción real.</p>
      <h2>Precios comparados</h2>
      <ul>
        <li>Maris AI: desde 20€ (backend + frontend incluido)</li>
        <li>Lovable Pro: 25$/mes (solo frontend)</li>
        <li>Lovable + Supabase para producción: ~50$/mes</li>
      </ul>
    `,
  },
  "/vs-bolt": {
    title: "Maris AI vs Bolt.new — Alternativa en Español 2026",
    description: "Comparativa Maris AI vs Bolt.new. Tokens predecibles, en español, backend incluido. La mejor alternativa a Bolt para emprendedores en España y LATAM.",
    h1: "Maris AI vs Bolt.new — Alternativa en español a Bolt",
    canonical: "https://www.marisai.es/vs-bolt",
    content: `
      <h2>Maris AI vs Bolt.new: comparativa 2026</h2>
      <p>Bolt.new es una herramienta potente de vibe coding pero está en inglés y usa tokens impredecibles. Maris AI es la alternativa en español con precios claros y backend incluido para emprendedores.</p>
      <h2>Diferencias clave</h2>
      <ul>
        <li><strong>Idioma</strong>: Maris AI 100% en español. Bolt.new solo en inglés.</li>
        <li><strong>Precios</strong>: Maris AI usa créditos fijos y predecibles. Bolt usa tokens que varían según complejidad del proyecto.</li>
        <li><strong>Backend</strong>: Maris AI incluye Express + MongoDB. Bolt tiene WebContainers limitados para producción.</li>
        <li><strong>Agentes</strong>: Maris AI tiene 9 agentes especializados en paralelo. Bolt tiene 1 agente general.</li>
        <li><strong>Caducidad</strong>: Créditos de Maris AI nunca caducan. Tokens de Bolt se reinician mensualmente en plan Free.</li>
      </ul>
      <h2>El problema de los tokens de Bolt</h2>
      <p>Bolt cobra tokens según la complejidad de cada petición y el tamaño del proyecto. Un proyecto con 50 archivos consume muchos más tokens por prompt que uno de 5 archivos. Esto hace imposible saber cuánto gastarás antes de empezar. Maris AI cobra créditos fijos por tipo de proyecto.</p>
      <h2>¿Cuál elegir?</h2>
      <p>Para emprendedores en España sin perfil técnico: Maris AI. Para developers globales con experiencia: Bolt puede ser una opción, pero los costes son impredecibles.</p>
    `,
  },
  "/vs-base44": {
    title: "Maris AI vs Base44 — Código tuyo vs Plataforma Cerrada 2026",
    description: "Comparativa Maris AI vs Base44. Código 100% exportable, sin vendor lock-in, en español. La alternativa a Base44 para emprendedores que quieren ser dueños de su código.",
    h1: "Maris AI vs Base44 — Tu código vs su plataforma",
    canonical: "https://www.marisai.es/vs-base44",
    content: `
      <h2>Maris AI vs Base44: comparativa 2026</h2>
      <p>Base44 genera apps rápido pero el código vive en su plataforma. Maris AI te da el código completo, exportable a GitHub, sin dependencia de ninguna plataforma.</p>
      <h2>Diferencias clave</h2>
      <ul>
        <li><strong>Propiedad del código</strong>: Maris AI código 100% tuyo exportable a GitHub. Base44 código cerrado en su plataforma.</li>
        <li><strong>Vendor lock-in</strong>: Maris AI sin dependencia. Base44 alta dependencia del proveedor.</li>
        <li><strong>Deploy</strong>: Maris AI en Vercel/Railway/AWS. Base44 solo su hosting.</li>
        <li><strong>Idioma</strong>: Maris AI 100% español. Base44 inglés con español parcial.</li>
        <li><strong>Coste largo plazo</strong>: Maris AI créditos sin caducar, 0€/mes hosting. Base44 suscripción mensual recurrente.</li>
      </ul>
      <h2>El riesgo del vendor lock-in con Base44</h2>
      <p>Si Base44 sube precios, tienes que pagar o perder tu app. Si cierran, tu app desaparece. Con Maris AI el código es tuyo — si Maris AI desaparece mañana, tu app sigue funcionando.</p>
    `,
  },
  "/vs-emergent": {
    title: "Maris AI vs Emergent vs Bolt vs Lovable — Comparativa 2026",
    description: "Compara Maris AI con Bolt.new, Lovable, Emergent y Cursor. La única plataforma de creación de apps con IA completamente en español para el mercado emprendedor.",
    h1: "Maris AI vs Bolt vs Lovable vs Emergent — Comparativa 2026",
    canonical: "https://www.marisai.es/vs-emergent",
    content: `
      <h2>Comparativa de plataformas de vibe coding 2026</h2>
      <p>Maris AI es la única plataforma de vibe coding completamente en español. Comparada con Bolt.new, Lovable y Emergent, ofrece backend incluido, soporte en español y precios predecibles para emprendedores en España y LATAM.</p>
      <h2>Tabla comparativa</h2>
      <ul>
        <li><strong>Maris AI</strong>: Español, 9 agentes IA, backend incluido, desde 20€</li>
        <li><strong>Lovable</strong>: Inglés, 1 agente, requiere Supabase, desde $25/mes</li>
        <li><strong>Bolt.new</strong>: Inglés, tokens impredecibles, desde $25/mes</li>
        <li><strong>Emergent</strong>: Inglés, tokens por uso, desde $30/mes</li>
      </ul>
    `,
  },
  "/pricing": {
    title: "Precios Maris AI — Créditos desde 20€, nunca caducan",
    description: "Precios transparentes de Maris AI. Créditos desde 20€ que nunca caducan. Cuanto más compras, más barato el crédito. 65 créditos gratis sin tarjeta.",
    h1: "Precios de Maris AI — Créditos flexibles para crear apps con IA",
    canonical: "https://www.marisai.es/pricing",
    content: `
      <h2>Planes y precios de Maris AI</h2>
      <p>Maris AI usa un sistema de créditos flexible. Los créditos nunca caducan y cuanto más compras, más barato el precio por crédito.</p>
      <h2>Packs de créditos disponibles</h2>
      <ul>
        <li><strong>Starter</strong>: 160 créditos por 20€ (0,125€/crédito)</li>
        <li><strong>Builder</strong>: 250 créditos por 37€ (0,148€/crédito)</li>
        <li><strong>Más Popular</strong>: 500 créditos por 70€ (0,140€/crédito)</li>
        <li><strong>Pro</strong>: 1.250 créditos por 162€ (0,130€/crédito)</li>
        <li><strong>Mejor Ahorro</strong>: 3.000 créditos por 360€ (0,120€/crédito)</li>
        <li><strong>Mejor Ahorro</strong>: 6.000 créditos por 660€ (0,110€/crédito)</li>
      </ul>
      <p>Regístrate gratis y recibe 65 créditos de bienvenida sin tarjeta de crédito.</p>
    `,
  },
  "/que-es-vibe-coding": {
    title: "Qué es el Vibe Coding — Guía Completa 2026",
    description: "El vibe coding es el nuevo paradigma donde describes tu idea en lenguaje natural y la IA genera el código. Guía completa sobre crear apps con IA en España.",
    h1: "Qué es el vibe coding — guía completa 2026",
    canonical: "https://www.marisai.es/que-es-vibe-coding",
    content: `
      <h2>Definición de vibe coding</h2>
      <p>El vibe coding es el paradigma de desarrollo de software donde describes lo que quieres construir en lenguaje natural y la inteligencia artificial genera el código completo. Fue acuñado por Andrej Karpathy, cofundador de OpenAI, y elegido Palabra del Año 2025 por Collins Dictionary.</p>
      <h2>¿Cómo funciona el vibe coding?</h2>
      <ol>
        <li>Describes tu app en lenguaje natural en español</li>
        <li>Los agentes de IA analizan tu descripción</li>
        <li>La IA genera el código frontend, backend y base de datos</li>
        <li>Recibes una app funcional lista para desplegar</li>
      </ol>
      <h2>Vibe coding en español con Maris AI</h2>
      <p>Maris AI es la plataforma de vibe coding líder en español. Con 9 agentes de IA especializados, puedes crear apps web completas en menos de 5 minutos sin saber programar.</p>
    `,
  },
  "/que-es-un-agente-de-ia": {
    title: "Qué es un Agente de IA — Guía para Emprendedores",
    description: "Un agente de IA es un sistema autónomo que analiza, razona y ejecuta tareas. Maris AI usa 9 agentes especializados para crear tu app completa en minutos.",
    h1: "Qué es un agente de inteligencia artificial",
    canonical: "https://www.marisai.es/que-es-un-agente-de-ia",
    content: `
      <h2>Definición de agente de IA</h2>
      <p>Un agente de inteligencia artificial es un sistema autónomo que percibe su entorno, razona sobre él y ejecuta acciones para alcanzar un objetivo específico. A diferencia de un chatbot simple, un agente puede planificar, tomar decisiones y ejecutar tareas complejas de forma independiente.</p>
      <h2>Los 9 agentes de IA de Maris AI</h2>
      <p>Maris AI utiliza 9 agentes especializados que trabajan en paralelo para crear tu aplicación web completa:</p>
      <ul>
        <li><strong>Researcher</strong>: Investiga referencias y define requisitos</li>
        <li><strong>Architect</strong>: Diseña la arquitectura técnica</li>
        <li><strong>Designer</strong>: Crea el sistema visual y UX</li>
        <li><strong>Frontend Engineer</strong>: Escribe React + TypeScript + Tailwind</li>
        <li><strong>Backend Engineer</strong>: Desarrolla la API con Express</li>
        <li><strong>Database</strong>: Configura MongoDB</li>
        <li><strong>QA</strong>: Verifica la calidad del código</li>
        <li><strong>DevOps</strong>: Prepara el despliegue</li>
        <li><strong>Optimizer</strong>: Optimiza el rendimiento final</li>
      </ul>
    `,
  },
  "/glosario": {
    title: "Glosario de Inteligencia Artificial — Maris AI",
    description: "Todos los términos de IA que necesitas como emprendedor. React, TypeScript, vibe coding, agentes, LLM y más explicados en español.",
    h1: "Glosario de inteligencia artificial para emprendedores",
    canonical: "https://www.marisai.es/glosario",
    content: `
      <h2>Términos clave de inteligencia artificial</h2>
      <dl>
        <dt>Vibe Coding</dt>
        <dd>Paradigma de desarrollo donde describes tu app en lenguaje natural y la IA genera el código. Palabra del Año 2025.</dd>
        <dt>Agente de IA</dt>
        <dd>Sistema autónomo que razona y ejecuta tareas complejas de forma independiente para alcanzar un objetivo.</dd>
        <dt>LLM (Large Language Model)</dt>
        <dd>Modelo de lenguaje de gran tamaño entrenado para entender y generar texto. Base de Claude, GPT y Gemini.</dd>
        <dt>React</dt>
        <dd>Librería JavaScript para crear interfaces de usuario, desarrollada por Meta. El estándar del frontend moderno.</dd>
        <dt>TypeScript</dt>
        <dd>Superset de JavaScript con tipado estático que reduce errores y mejora la mantenibilidad del código.</dd>
        <dt>MongoDB</dt>
        <dd>Base de datos NoSQL orientada a documentos, ideal para aplicaciones web modernas y escalables.</dd>
        <dt>API REST</dt>
        <dd>Interfaz de programación que permite la comunicación entre frontend y backend mediante HTTP.</dd>
        <dt>No-code / Low-code</dt>
        <dd>Herramientas que permiten crear aplicaciones sin escribir código o con mínimo código técnico.</dd>
      </dl>
    `,
  },
  "/desarrollo-no-code-guia": {
    title: "Guía No-Code con IA para Emprendedores Españoles 2026",
    description: "Guía completa para crear tu primera app sin programar usando IA. Paso a paso, en español, para emprendedores y autónomos.",
    h1: "Guía de desarrollo no-code con IA 2026",
    canonical: "https://www.marisai.es/desarrollo-no-code-guia",
    content: `
      <h2>Cómo crear una app sin programar en 2026</h2>
      <p>El desarrollo no-code con IA ha democratizado la creación de software. Hoy cualquier emprendedor puede crear una app web completa sin saber programar usando herramientas como Maris AI.</p>
      <h2>Guía paso a paso</h2>
      <ol>
        <li><strong>Define tu idea</strong>: Describe qué problema resuelve tu app y quién la usará.</li>
        <li><strong>Elige la plataforma</strong>: Para emprendedores en España, Maris AI es la opción en español con backend incluido.</li>
        <li><strong>Describe tu app en español</strong>: Escribe un prompt detallado con las funcionalidades que necesitas.</li>
        <li><strong>Genera tu app</strong>: Los 9 agentes de IA de Maris AI crean el código completo en menos de 5 minutos.</li>
        <li><strong>Personaliza y despliega</strong>: Exporta a GitHub y despliega en Vercel con un clic.</li>
      </ol>
      <h2>Ventajas del no-code con IA</h2>
      <ul>
        <li>Sin conocimientos técnicos necesarios</li>
        <li>De idea a MVP en minutos, no en meses</li>
        <li>Ahorro de 10.000-50.000€ en desarrollo</li>
        <li>Código 100% tuyo, sin dependencia de la plataforma</li>
      </ul>
    `,
  },
  "/showcase": {
    title: "Apps creadas con IA — Ejemplos Reales de Maris AI",
    description: "Descubre apps web reales creadas con Maris AI por emprendedores en España. Tiendas, CRMs, plataformas educativas generadas con inteligencia artificial.",
    h1: "Apps reales creadas con Maris AI",
    canonical: "https://www.marisai.es/showcase",
    content: `
      <h2>Ejemplos de apps creadas con Maris AI</h2>
      <p>Estos son ejemplos de aplicaciones web reales generadas por emprendedores usando los 9 agentes de IA de Maris AI:</p>
      <ul>
        <li>CRM para clínicas de fisioterapia con agenda y seguimiento de pacientes</li>
        <li>Tienda online con catálogo, carrito y pasarela de pago Stripe</li>
        <li>Dashboard de analytics con gráficas en tiempo real</li>
        <li>App de gestión de reservas para restaurantes</li>
        <li>Plataforma educativa con cursos y seguimiento de progreso</li>
        <li>Sistema de gestión de inventario con alertas automáticas</li>
      </ul>
    `,
  },
};

function isBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return BOT_PATTERNS.some(pattern => ua.includes(pattern));
}

function getRouteContent(pathname: string) {
  // Normalizar ruta
  const normalized = pathname.replace(/\/$/, "") || "/";
  return ROUTE_CONTENT[normalized] || ROUTE_CONTENT["/"];
}

function buildBotHTML(route: ReturnType<typeof getRouteContent>): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${route.title}</title>
  <meta name="description" content="${route.description}" />
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
  <link rel="canonical" href="${route.canonical}" />
  <meta property="og:title" content="${route.title}" />
  <meta property="og:description" content="${route.description}" />
  <meta property="og:url" content="${route.canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="es_ES" />
  <meta property="og:site_name" content="Maris AI" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${route.title}" />
  <meta name="twitter:description" content="${route.description}" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "${route.title}",
    "description": "${route.description}",
    "url": "${route.canonical}",
    "inLanguage": "es",
    "isPartOf": {
      "@type": "WebSite",
      "name": "Maris AI",
      "url": "https://www.marisai.es/"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Maris AI",
      "url": "https://www.marisai.es/",
      "logo": "https://www.marisai.es/logo.svg"
    }
  }
  </script>
</head>
<body>
  <main>
    <h1>${route.h1}</h1>
    ${route.content}
  </main>
</body>
</html>`;
}

export function middleware(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") || "";
  const { pathname } = request.nextUrl;

  // Solo actuar en rutas públicas — no interferir con API, assets o rutas privadas
  const isPublicRoute = !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next/") &&
    !pathname.startsWith("/assets/") &&
    !pathname.includes(".") && // no archivos estáticos
    !pathname.startsWith("/dashboard") &&
    !pathname.startsWith("/app/") &&
    !pathname.startsWith("/billing") &&
    !pathname.startsWith("/admin") &&
    !pathname.startsWith("/sign-in") &&
    !pathname.startsWith("/sign-up") &&
    !pathname.startsWith("/onboarding");

  if (isPublicRoute && isBot(userAgent)) {
    const routeContent = getRouteContent(pathname);
    const html = buildBotHTML(routeContent);

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        "X-Robots-Tag": "index, follow",
        "X-Bot-Prerender": "true",
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Aplicar a todas las rutas excepto archivos estáticos y API interna de Next
    "/((?!_next/static|_next/image|favicon|logo|manifest|robots|sitemap|BingSiteAuth|08180|opengraph|apple-touch).*)",
  ],
};
