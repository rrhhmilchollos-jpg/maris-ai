/**
 * prerender.mjs — Genera HTML estático para Google e IAs
 * 
 * Ejecuta DESPUÉS del build de Vite.
 * Abre cada ruta pública con Puppeteer, espera que React renderice,
 * y guarda el HTML completo en dist/ para que Vercel lo sirva directamente.
 * 
 * Resultado: Google, Googlebot, Claude, GPT, Perplexity ven HTML completo
 * con todo el contenido sin esperar JavaScript.
 */

import { execSync } from "child_process";
import { existsSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "dist");

// Rutas públicas a prerender — las que Google e IAs indexan
const PUBLIC_ROUTES = [
  { path: "/", file: "index.html" },
  { path: "/pricing", file: "pricing/index.html" },
  { path: "/showcase", file: "showcase/index.html" },
  { path: "/news", file: "news/index.html" },
  { path: "/vs-emergent", file: "vs-emergent/index.html" },
  { path: "/vs-lovable", file: "vs-lovable/index.html" },
  { path: "/vs-bolt", file: "vs-bolt/index.html" },
  { path: "/que-es-vibe-coding", file: "que-es-vibe-coding/index.html" },
  { path: "/que-es-un-agente-de-ia", file: "que-es-un-agente-de-ia/index.html" },
  { path: "/glosario", file: "glosario/index.html" },
  { path: "/desarrollo-no-code-guia", file: "desarrollo-no-code-guia/index.html" },
];

// Contenido HTML estático por ruta — no necesita browser, es puro HTML
// Esto es lo que ven Google e IAs: el index.html enriquecido con el contenido
// visible de cada página
const STATIC_CONTENT = {
  "/pricing": {
    title: "Precios Maris AI — 50 Créditos Gratis sin Tarjeta",
    description: "Empieza gratis con 50 créditos sin tarjeta. Paquetes desde 20€ por 160 créditos que nunca caducan.",
    h1: "Precios de Maris AI — Planes y créditos",
    body: `<h1>Precios de Maris AI</h1>
      <h2>Plan Gratuito — 50 créditos al registrarte</h2>
      <ul><li>15 créditos gratis al registrarte</li><li>Sin tarjeta de crédito</li><li>Acceso a todos los agentes IA</li></ul>
      <h2>Pack Starter — 20€ por 160 créditos</h2>
      <h2>Pack Pro — 45€ por 400 créditos</h2>
      <h2>Pack Business — 80€ por 800 créditos</h2>
      <p>Los créditos de Maris AI nunca caducan. Puedes crear apps, landings, dashboards y más.</p>`,
  },
  "/showcase": {
    title: "Apps creadas con IA — Ejemplos Reales de Maris AI",
    description: "Descubre apps web reales creadas con Maris AI por emprendedores en España.",
    h1: "Apps reales creadas con Maris AI",
    body: `<h1>Apps creadas con inteligencia artificial</h1>
      <p>Estos son ejemplos reales de aplicaciones web creadas con Maris AI por emprendedores españoles sin saber programar.</p>
      <h2>Tipos de apps que puedes crear con Maris AI</h2>
      <ul>
        <li>CRM de ventas y gestión de clientes</li>
        <li>Tiendas online y e-commerce</li>
        <li>Plataformas educativas y cursos online</li>
        <li>Apps de gestión para negocios locales</li>
        <li>Dashboards y paneles de analítica</li>
        <li>Marketplaces y directorios</li>
      </ul>`,
  },
  "/vs-emergent": {
    title: "Maris AI vs Emergent vs Bolt vs Lovable — Comparativa 2026",
    description: "Compara Maris AI con Bolt.new, Lovable, Emergent y Cursor. La única plataforma de creación de apps con IA completamente en español.",
    h1: "Maris AI vs Bolt vs Lovable vs Emergent — Comparativa 2026",
    body: `<h1>Maris AI vs Bolt.new vs Lovable vs Emergent — Comparativa 2026</h1>
      <h2>¿Por qué Maris AI es mejor que Bolt.new para emprendedores españoles?</h2>
      <p>Maris AI es la única alternativa a Bolt.new completamente en español, con soporte en español y optimizada para el mercado hispanohablante.</p>
      <h2>Comparativa de características</h2>
      <table>
        <tr><th>Característica</th><th>Maris AI</th><th>Bolt.new</th><th>Lovable</th><th>Emergent</th></tr>
        <tr><td>Idioma</td><td>Español nativo</td><td>Inglés</td><td>Inglés</td><td>Inglés</td></tr>
        <tr><td>Agentes especializados</td><td>9 agentes</td><td>1 agente</td><td>1 agente</td><td>Múltiples</td></tr>
        <tr><td>Precio inicial</td><td>Gratis</td><td>Gratis limitado</td><td>De pago</td><td>De pago</td></tr>
        <tr><td>Soporte en español</td><td>Sí</td><td>No</td><td>No</td><td>No</td></tr>
      </table>`,
  },
  "/que-es-vibe-coding": {
    title: "Qué es el Vibe Coding — Guía Completa 2026",
    description: "El vibe coding es el nuevo paradigma donde describes tu idea y la IA genera el código.",
    h1: "Qué es el vibe coding — guía 2026",
    body: `<h1>Qué es el Vibe Coding — Guía completa 2026</h1>
      <p>El vibe coding es el nuevo paradigma de desarrollo de software donde describes tu idea en lenguaje natural y la inteligencia artificial genera el código completo automáticamente.</p>
      <h2>Origen del término vibe coding</h2>
      <p>El término fue acuñado por Andrej Karpathy en 2025 para describir el proceso de programar usando modelos de lenguaje como guía principal.</p>
      <h2>¿Cómo funciona el vibe coding en Maris AI?</h2>
      <ol>
        <li>Describes tu app en español en lenguaje natural</li>
        <li>9 agentes de IA analizan tu descripción</li>
        <li>Los agentes generan el código React + TypeScript + backend</li>
        <li>Recibes una app funcional en menos de 5 minutos</li>
      </ol>
      <h2>Vibe coding vs programación tradicional</h2>
      <p>Con el vibe coding no necesitas conocer React, TypeScript, Node.js ni bases de datos. La IA se encarga de toda la parte técnica.</p>`,
  },
  "/que-es-un-agente-de-ia": {
    title: "Qué es un Agente de IA — Guía para Emprendedores",
    description: "Un agente de IA es un sistema autónomo que analiza, razona y ejecuta tareas. Maris AI usa 9 agentes especializados.",
    h1: "Qué es un agente de inteligencia artificial",
    body: `<h1>Qué es un agente de inteligencia artificial</h1>
      <p>Un agente de IA es un sistema autónomo capaz de percibir su entorno, razonar sobre él y ejecutar acciones para alcanzar un objetivo específico.</p>
      <h2>Los 9 agentes de Maris AI</h2>
      <ul>
        <li><strong>Researcher</strong>: Investiga el mercado y define requisitos</li>
        <li><strong>Architect</strong>: Diseña la arquitectura técnica</li>
        <li><strong>Designer</strong>: Crea el sistema visual y UX</li>
        <li><strong>Frontend Engineer</strong>: Genera código React + TypeScript</li>
        <li><strong>Backend Engineer</strong>: Desarrolla la API y servidor</li>
        <li><strong>QA Auditor</strong>: Verifica calidad del código</li>
        <li><strong>PM Agent</strong>: Valida que cumple los requisitos</li>
        <li><strong>Image Agent</strong>: Genera imágenes con IA</li>
        <li><strong>Visual Evaluator</strong>: Analiza la UI generada</li>
      </ul>`,
  },
  "/glosario": {
    title: "Glosario de Inteligencia Artificial — Maris AI",
    description: "Todos los términos de IA que necesitas como emprendedor. React, TypeScript, vibe coding, agentes, LLM.",
    h1: "Glosario de inteligencia artificial para emprendedores",
    body: `<h1>Glosario de inteligencia artificial para emprendedores</h1>
      <dl>
        <dt>LLM (Large Language Model)</dt><dd>Modelo de lenguaje de gran escala como Claude, GPT-4 o Gemini que genera texto y código.</dd>
        <dt>Vibe Coding</dt><dd>Paradigma de programación donde describes en lenguaje natural y la IA genera el código.</dd>
        <dt>Agente de IA</dt><dd>Sistema autónomo que realiza tareas específicas sin intervención humana constante.</dd>
        <dt>React</dt><dd>Biblioteca de JavaScript para crear interfaces de usuario, usada por Maris AI para el frontend.</dd>
        <dt>TypeScript</dt><dd>Superset de JavaScript con tipado estático que mejora la calidad del código.</dd>
        <dt>MongoDB</dt><dd>Base de datos NoSQL usada por Maris AI para almacenar los datos de las apps.</dd>
        <dt>API REST</dt><dd>Interfaz de programación que permite la comunicación entre frontend y backend.</dd>
        <dt>Deploy</dt><dd>Proceso de publicar una aplicación en internet para que sea accesible.</dd>
      </dl>`,
  },
  "/desarrollo-no-code-guia": {
    title: "Guía No-Code con IA para Emprendedores Españoles 2026",
    description: "Guía completa para crear tu primera app sin programar usando IA. Paso a paso, en español.",
    h1: "Guía de desarrollo no-code con IA 2026",
    body: `<h1>Guía de desarrollo no-code con IA para emprendedores 2026</h1>
      <p>Esta guía te enseña cómo crear aplicaciones web completas sin saber programar, usando inteligencia artificial como Maris AI.</p>
      <h2>¿Qué es el desarrollo no-code?</h2>
      <p>El desarrollo no-code permite crear software funcional sin escribir código manualmente.</p>
      <h2>Paso 1: Define tu idea</h2>
      <p>Describe qué problema resuelve tu app, quién la usará y qué funcionalidades necesita.</p>
      <h2>Paso 2: Usa Maris AI para generar el código</h2>
      <p>Escribe tu descripción en Maris AI y los 9 agentes generarán tu app en menos de 5 minutos.</p>
      <h2>Paso 3: Personaliza y despliega</h2>
      <p>Ajusta el diseño, conecta tu dominio y publica tu app en internet.</p>`,
  },
  "/news": {
    title: "Blog IA para Emprendedores — Maris AI",
    description: "Noticias, tutoriales y guías sobre inteligencia artificial y creación de apps sin programar.",
    h1: "Blog de inteligencia artificial para emprendedores",
    body: `<h1>Blog de inteligencia artificial para emprendedores</h1>
      <p>Las últimas noticias, tutoriales y guías sobre inteligencia artificial, vibe coding y creación de apps sin programar para emprendedores en España y Latinoamérica.</p>`,
  },
  "/vs-lovable": {
    title: "Maris AI vs Lovable — Alternativa en Español 2026",
    description: "Compara Maris AI con Lovable. La mejor alternativa en español para crear apps con IA.",
    h1: "Maris AI vs Lovable — Comparativa 2026",
    body: `<h1>Maris AI vs Lovable — Comparativa 2026</h1>
      <p>Maris AI es la mejor alternativa a Lovable para emprendedores en España y Latinoamérica. A diferencia de Lovable, Maris AI está completamente en español.</p>`,
  },
  "/vs-bolt": {
    title: "Maris AI vs Bolt.new — Alternativa en Español 2026",
    description: "Compara Maris AI con Bolt.new. La mejor alternativa española para crear apps con IA sin programar.",
    h1: "Maris AI vs Bolt.new — Comparativa 2026",
    body: `<h1>Maris AI vs Bolt.new — Comparativa 2026</h1>
      <p>Maris AI es la mejor alternativa a Bolt.new para el mercado hispanohablante. Completamente en español, con soporte real y 9 agentes especializados.</p>`,
  },
};

// Leer el index.html base generado por Vite
const baseHtml = readFileSync(join(DIST, "index.html"), "utf-8");

let success = 0;
let failed = 0;

for (const route of PUBLIC_ROUTES) {
  if (route.path === "/") {
    console.log(`✅ / → index.html (ya existe)`);
    success++;
    continue;
  }

  const staticData = STATIC_CONTENT[route.path];
  if (!staticData) {
    console.log(`⏭️  ${route.path} → sin contenido estático definido`);
    continue;
  }

  try {
    // Crear directorio
    const dir = join(DIST, dirname(route.file));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Generar HTML enriquecido — el index.html base + contenido visible
    let html = baseHtml;

    // Actualizar title
    html = html.replace(
      /<title>[^<]*<\/title>/,
      `<title>${staticData.title}</title>`
    );

    // Actualizar description
    html = html.replace(
      /(<meta name="description" content=")[^"]*(")/,
      `$1${staticData.description}$2`
    );

    // Actualizar canonical
    html = html.replace(
      /(<link rel="canonical" href=")[^"]*(" id="canonical-tag")/,
      `$1https://www.marisai.es${route.path}$2`
    );

    // Añadir contenido visible ANTES de #root para que Google lo lea
    // sin ejecutar JavaScript
    html = html.replace(
      '<div id="root"></div>',
      `<div id="seo-content" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;" aria-hidden="true">
        ${staticData.body}
      </div>
      <div id="root"></div>`
    );

    writeFileSync(join(DIST, route.file), html, "utf-8");
    console.log(`✅ ${route.path} → ${route.file}`);
    success++;
  } catch (err) {
    console.error(`❌ ${route.path} → ${err.message}`);
    failed++;
  }
}

console.log(`\n📊 Prerender completo: ${success} OK, ${failed} errores`);
