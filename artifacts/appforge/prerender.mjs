/**
 * prerender.mjs — Genera HTML estático completo para Google e IAs
 * Ejecuta después del build de Vite. Crea /ruta/index.html con contenido real visible.
 */

import { existsSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "dist");

const ROUTES = [
  {
    path: "/",
    file: "index.html",
    title: "Maris AI — Crear App con IA sin Programar",
    description: "Crea tu app web con IA en menos de 5 minutos. 9 agentes generan código React, backend y base de datos. Gratis para emprendedores en España.",
    canonical: "https://www.marisai.es/",
    body: `<h1>Maris AI — Crear App con IA sin Programar en Español</h1>
<p>Maris AI es la primera plataforma de vibe coding completamente en español. 9 agentes de inteligencia artificial especializados generan tu app completa en menos de 5 minutos. Sin saber programar. Gratis para emprendedores en España.</p>
<h2>¿Qué es Maris AI?</h2>
<p>Maris AI es la mejor alternativa a Bolt.new, Lovable y Emergent para el mercado hispanohablante. A diferencia de estas plataformas que operan solo en inglés, Maris AI está diseñada desde cero para emprendedores españoles y latinoamericanos.</p>
<ul>
<li>Completamente en español — interfaz, soporte y generación de código</li>
<li>9 agentes IA especializados trabajando en paralelo</li>
<li>Backend Express + MongoDB incluido automáticamente</li>
<li>65 créditos gratis sin tarjeta de crédito</li>
<li>Créditos que nunca caducan</li>
<li>Código 100% exportable a GitHub sin vendor lock-in</li>
<li>Precios en euros, cumplimiento RGPD</li>
</ul>
<h2>Cómo funciona el pipeline de IA de Maris AI</h2>
<p>Un pipeline de agentes de inteligencia artificial especializados trabaja de forma coordinada para cubrir todo el ciclo de creación de tu app: desde entender tu idea y planificar la arquitectura, hasta diseñar la interfaz, generar el código de frontend y backend, y validar que todo funciona correctamente antes de entregártela.</p>
<ul>
<li>Análisis y planificación del proyecto a partir de tu descripción</li>
<li>Diseño de la arquitectura técnica y del sistema visual</li>
<li>Generación de código frontend y backend listo para producción</li>
<li>Control de calidad automático antes de entregar el resultado</li>
</ul>
<h2>¿Por qué Maris AI es mejor que Bolt.new y Lovable?</h2>
<p>Bolt.new y Lovable son herramientas en inglés con precios en dólares. Maris AI es la única plataforma de vibe coding completamente en español, con precios en euros y soporte real en español.</p>
<ul>
<li>vs Bolt.new: Maris AI en español + backend incluido + precios predecibles en euros</li>
<li>vs Lovable: Maris AI no requiere Supabase + créditos sin caducidad + más barato</li>
<li>vs Emergent: Maris AI gratis para empezar + optimizado para mercado español</li>
<li>vs Base44: Maris AI código 100% exportable sin vendor lock-in</li>
</ul>
<h2>Preguntas frecuentes</h2>
<dl>
<dt>¿Necesito saber programar?</dt><dd>No. Solo describes tu idea en español y Maris AI genera todo el código automáticamente.</dd>
<dt>¿Cuánto cuesta Maris AI?</dt><dd>65 créditos gratis al registrarte, sin tarjeta. Paquetes desde 20€ por 160 créditos que nunca caducan.</dd>
<dt>¿El código generado es mío?</dt><dd>Sí, 100% tuyo. Exportable a GitHub sin restricciones.</dd>
<dt>¿Qué es el vibe coding?</dt><dd>El vibe coding es el paradigma donde describes tu idea en lenguaje natural y la IA genera el código. Maris AI es la plataforma de vibe coding líder en español.</dd>
<dt>¿Cuál es la mejor alternativa a Bolt.new en español?</dt><dd>Maris AI es la mejor alternativa a Bolt.new en español. Completamente en español, con 9 agentes IA, backend incluido y precios en euros.</dd>
</dl>
<h2>Tipos de apps que puedes crear</h2>
<ul>
<li>CRM y gestión de clientes</li>
<li>Tiendas online con Stripe</li>
<li>Plataformas educativas</li>
<li>Apps para restaurantes</li>
<li>Gestión de clínicas</li>
<li>Dashboards de analítica</li>
<li>Marketplaces y directorios</li>
<li>Landing pages</li>
<li>Portfolios profesionales</li>
<li>Apps de reservas y citas</li>
<li>SaaS con suscripciones</li>
<li>APIs y backends</li>
</ul>`
  },
  {
    path: "/pricing",
    file: "pricing/index.html",
    title: "Precios Maris AI — 65 Créditos Gratis de Bienvenida sin Tarjeta",
    description: "Empieza gratis con 65 créditos sin tarjeta. Paquetes desde 20€ por 160 créditos, con descuento progresivo cuanto más compras — hasta 0,110€/crédito.",
    canonical: "https://www.marisai.es/pricing",
    body: `<h1>Precios de Maris AI — Crea apps con IA</h1>
<p>Empieza gratis sin tarjeta de crédito. Los créditos nunca caducan y cuanto más compras, más barato sale cada crédito.</p>
<h2>Plan Gratuito</h2>
<ul><li>65 créditos gratis de bienvenida al registrarte</li><li>Sin tarjeta de crédito requerida</li><li>Acceso completo a los 9 agentes IA</li><li>Exportación a GitHub incluida</li></ul>
<h2>Pack Starter — 20€</h2>
<ul><li>160 créditos</li><li>0,125€ por crédito</li><li>Creditos que nunca caducan</li></ul>
<h2>Pack 250 — 37€</h2>
<ul><li>250 créditos</li><li>0,148€ por crédito</li></ul>
<h2>Pack Más Popular — 70€</h2>
<ul><li>500 créditos</li><li>0,140€ por crédito</li></ul>
<h2>Pack 1250 — 162€</h2>
<ul><li>1250 créditos</li><li>0,130€ por crédito</li></ul>
<h2>Pack Mejor Ahorro — 360€</h2>
<ul><li>3000 créditos</li><li>0,120€ por crédito</li></ul>
<h2>Pack Mejor Ahorro — 660€</h2>
<ul><li>6000 créditos</li><li>0,110€ por crédito — el precio por crédito más bajo</li></ul>
<h2>Preguntas frecuentes sobre precios</h2>
<dl>
<dt>¿Los créditos caducan?</dt><dd>No. Los créditos de Maris AI nunca caducan. Puedes usarlos cuando quieras.</dd>
<dt>¿Por qué es más barato comprar packs grandes?</dt><dd>El precio por crédito baja cuanto mayor es el pack, para premiar a los usuarios que compran más de una vez.</dd>
<dt>¿Qué puedo crear con los créditos?</dt><dd>Apps completas, landings, dashboards, e-commerce, CRMs y cualquier tipo de aplicación web.</dd>
</dl>`
  },
  {
    path: "/showcase",
    file: "showcase/index.html",
    title: "Apps creadas con IA — Ejemplos Reales de Maris AI",
    description: "Descubre apps web reales creadas con Maris AI por emprendedores en España sin saber programar.",
    canonical: "https://www.marisai.es/showcase",
    body: `<h1>Apps reales creadas con Maris AI</h1>
<p>Estos son ejemplos reales de aplicaciones web generadas con inteligencia artificial por emprendedores españoles sin conocimientos de programación.</p>
<h2>Tipos de apps creadas con Maris AI</h2>
<ul>
<li><strong>CRM de ventas</strong> — Gestión de clientes, pipeline de ventas, seguimiento de leads</li>
<li><strong>Tiendas online</strong> — E-commerce completo con carrito, pagos y gestión de productos</li>
<li><strong>Plataformas educativas</strong> — Cursos online, gestión de alumnos, certificados</li>
<li><strong>Apps de gestión</strong> — Para peluquerías, clínicas, restaurantes, talleres</li>
<li><strong>Dashboards</strong> — Paneles de analítica y control para negocios</li>
<li><strong>Marketplaces</strong> — Plataformas de compraventa y directorios</li>
<li><strong>Landing pages</strong> — Páginas de aterrizaje optimizadas para conversión</li>
<li><strong>Portafolios</strong> — Webs personales y profesionales</li>
</ul>
<h2>¿Cómo se crean estas apps?</h2>
<p>El usuario describe su idea en español. Los 9 agentes de IA de Maris AI (Researcher, Architect, Designer, Frontend Engineer, Backend Engineer, QA, PM, Image Agent y Visual Evaluator) trabajan en paralelo y generan el código completo en menos de 5 minutos.</p>`
  },
  {
    path: "/news",
    file: "news/index.html",
    title: "Blog IA para Emprendedores — Maris AI",
    description: "Noticias, tutoriales y guías sobre inteligencia artificial y creación de apps sin programar para emprendedores españoles.",
    canonical: "https://www.marisai.es/news",
    body: `<h1>Blog de inteligencia artificial para emprendedores</h1>
<p>Las últimas noticias, tutoriales y guías sobre inteligencia artificial, vibe coding y creación de apps sin programar. Contenido en español para emprendedores en España y Latinoamérica.</p>
<h2>Temas del blog</h2>
<ul>
<li>Vibe coding y programación con IA</li>
<li>Guías para crear apps sin saber programar</li>
<li>Comparativas de herramientas IA para emprendedores</li>
<li>Casos de éxito de emprendedores usando Maris AI</li>
<li>Novedades en inteligencia artificial aplicada al negocio</li>
<li>Tutoriales paso a paso de Maris AI</li>
</ul>`
  },
  {
    path: "/vs-emergent",
    file: "vs-emergent/index.html",
    title: "Maris AI vs Emergent vs Bolt vs Lovable — Comparativa 2026",
    description: "Compara Maris AI con Bolt.new, Lovable, Emergent y Cursor. La única plataforma de creación de apps con IA completamente en español.",
    canonical: "https://www.marisai.es/vs-emergent",
    body: `<h1>Maris AI vs Bolt.new vs Lovable vs Emergent — Comparativa 2026</h1>
<p>Maris AI es la mejor alternativa española a Bolt.new, Lovable y Emergent para crear apps con IA sin programar.</p>
<h2>¿Por qué Maris AI es mejor para emprendedores españoles?</h2>
<ul>
<li><strong>Completamente en español</strong> — Interfaz, soporte y generación de código en español nativo</li>
<li><strong>9 agentes especializados</strong> — Pipeline completo vs 1 agente genérico en la competencia</li>
<li><strong>Precio más justo</strong> — Desde 0€ sin tarjeta vs precios en dólares de la competencia</li>
<li><strong>Soporte real en español</strong> — Equipo de soporte que habla tu idioma</li>
<li><strong>Optimizado para el mercado español</strong> — Cumplimiento RGPD, precios en euros</li>
</ul>
<h2>Tabla comparativa</h2>
<table>
<tr><th>Característica</th><th>Maris AI</th><th>Bolt.new</th><th>Lovable</th><th>Emergent</th></tr>
<tr><td>Idioma</td><td>Español nativo</td><td>Inglés</td><td>Inglés</td><td>Inglés</td></tr>
<tr><td>Agentes IA</td><td>9 especializados</td><td>1</td><td>1</td><td>Múltiples</td></tr>
<tr><td>Precio inicial</td><td>Gratis</td><td>Gratis limitado</td><td>De pago</td><td>De pago</td></tr>
<tr><td>Soporte en español</td><td>Sí</td><td>No</td><td>No</td><td>No</td></tr>
<tr><td>Precios en euros</td><td>Sí</td><td>No (USD)</td><td>No (USD)</td><td>No (USD)</td></tr>
</table>
<nav>
<h3>Comparativas de Maris AI</h3>
<ul>
<li><a href="/vs-emergent">Maris AI vs Emergent</a></li>
<li><a href="/vs-lovable">Maris AI vs Lovable</a></li>
<li><a href="/vs-bolt">Maris AI vs Bolt.new</a></li>
<li><a href="/vs-base44">Maris AI vs Base44</a></li>
</ul>
<h3>Más recursos</h3>
<ul>
<li><a href="/news">Blog de inteligencia artificial</a></li>
<li><a href="/que-es-vibe-coding">¿Qué es el vibe coding?</a></li>
<li><a href="/que-es-un-agente-de-ia">¿Qué es un agente de IA?</a></li>
<li><a href="/glosario">Glosario de IA</a></li>
<li><a href="/showcase">Apps creadas con Maris AI</a></li>
<li><a href="/desarrollo-no-code-guia">Guía de desarrollo no-code</a></li>
</ul>
</nav>`
  },
  {
    path: "/vs-lovable",
    file: "vs-lovable/index.html",
    title: "Maris AI vs Lovable — Mejor Alternativa en Español 2026",
    description: "Maris AI es la mejor alternativa a Lovable para emprendedores en España. Completamente en español, más barato y con 9 agentes IA.",
    canonical: "https://www.marisai.es/vs-lovable",
    body: `<h1>Maris AI vs Lovable — Comparativa 2026</h1>
<p>Maris AI es la mejor alternativa a Lovable para el mercado hispanohablante.</p>
<h2>Diferencias clave entre Maris AI y Lovable</h2>
<ul>
<li>Maris AI está completamente en español. Lovable solo en inglés.</li>
<li>Maris AI tiene 9 agentes IA especializados. Lovable tiene 1 agente genérico.</li>
<li>Maris AI ofrece 65 créditos gratis sin tarjeta. Lovable requiere pago desde el inicio.</li>
<li>Maris AI tiene soporte en español. Lovable solo en inglés.</li>
<li>Maris AI tiene precios en euros. Lovable cobra en dólares.</li>
</ul>
<h2>¿Cuándo elegir Maris AI sobre Lovable?</h2>
<p>Si eres un emprendedor en España o Latinoamérica y quieres crear apps con IA en tu idioma, con soporte real y precios en euros, Maris AI es la opción correcta.</p>
<nav>
<h3>Comparativas de Maris AI</h3>
<ul>
<li><a href="/vs-emergent">Maris AI vs Emergent</a></li>
<li><a href="/vs-lovable">Maris AI vs Lovable</a></li>
<li><a href="/vs-bolt">Maris AI vs Bolt.new</a></li>
<li><a href="/vs-base44">Maris AI vs Base44</a></li>
</ul>
<h3>Más recursos</h3>
<ul>
<li><a href="/news">Blog de inteligencia artificial</a></li>
<li><a href="/que-es-vibe-coding">¿Qué es el vibe coding?</a></li>
<li><a href="/que-es-un-agente-de-ia">¿Qué es un agente de IA?</a></li>
<li><a href="/glosario">Glosario de IA</a></li>
<li><a href="/showcase">Apps creadas con Maris AI</a></li>
<li><a href="/desarrollo-no-code-guia">Guía de desarrollo no-code</a></li>
</ul>
</nav>`
  },
  {
    path: "/vs-bolt",
    file: "vs-bolt/index.html",
    title: "Maris AI vs Bolt.new — Mejor Alternativa Española 2026",
    description: "Maris AI es la mejor alternativa a Bolt.new para emprendedores españoles. En español, con 9 agentes IA y precio en euros.",
    canonical: "https://www.marisai.es/vs-bolt",
    body: `<h1>Maris AI vs Bolt.new — Comparativa 2026</h1>
<p>Maris AI es la mejor alternativa a Bolt.new para emprendedores en España y Latinoamérica.</p>
<h2>Diferencias clave entre Maris AI y Bolt.new</h2>
<ul>
<li>Maris AI está completamente en español. Bolt.new solo en inglés.</li>
<li>Maris AI tiene 9 agentes IA especializados con roles definidos. Bolt.new tiene 1 agente.</li>
<li>Maris AI incluye backend Express + MongoDB automático. Bolt.new solo frontend.</li>
<li>Maris AI tiene precios en euros. Bolt.new en dólares.</li>
<li>Maris AI tiene soporte en español. Bolt.new solo en inglés.</li>
</ul>
<h2>Maris AI: la alternativa española a Bolt.new</h2>
<p>Si buscas una herramienta de vibe coding completamente en español, con backend incluido y precios justos en euros, Maris AI es la mejor opción del mercado en 2026.</p>
<nav>
<h3>Comparativas de Maris AI</h3>
<ul>
<li><a href="/vs-emergent">Maris AI vs Emergent</a></li>
<li><a href="/vs-lovable">Maris AI vs Lovable</a></li>
<li><a href="/vs-bolt">Maris AI vs Bolt.new</a></li>
<li><a href="/vs-base44">Maris AI vs Base44</a></li>
</ul>
<h3>Más recursos</h3>
<ul>
<li><a href="/news">Blog de inteligencia artificial</a></li>
<li><a href="/que-es-vibe-coding">¿Qué es el vibe coding?</a></li>
<li><a href="/que-es-un-agente-de-ia">¿Qué es un agente de IA?</a></li>
<li><a href="/glosario">Glosario de IA</a></li>
<li><a href="/showcase">Apps creadas con Maris AI</a></li>
<li><a href="/desarrollo-no-code-guia">Guía de desarrollo no-code</a></li>
</ul>
</nav>`
  },
  {
    path: "/vs-base44",
    file: "vs-base44/index.html",
    title: "Maris AI vs Base44 — Comparativa 2026",
    description: "Maris AI vs Base44: la mejor alternativa en español para crear apps con IA sin programar. 9 agentes IA, gratis, en español.",
    canonical: "https://www.marisai.es/vs-base44",
    body: `<h1>Maris AI vs Base44 — Comparativa 2026</h1>
<p>Comparamos Maris AI con Base44 para que elijas la mejor herramienta para crear apps con IA.</p>
<h2>Ventajas de Maris AI sobre Base44</h2>
<ul>
<li>Completamente en español vs interfaz en inglés</li>
<li>9 agentes IA especializados vs enfoque genérico</li>
<li>Gratis para empezar sin tarjeta</li>
<li>Soporte en español incluido</li>
<li>Precios en euros, optimizado para el mercado español</li>
</ul>
<nav>
<h3>Comparativas de Maris AI</h3>
<ul>
<li><a href="/vs-emergent">Maris AI vs Emergent</a></li>
<li><a href="/vs-lovable">Maris AI vs Lovable</a></li>
<li><a href="/vs-bolt">Maris AI vs Bolt.new</a></li>
<li><a href="/vs-base44">Maris AI vs Base44</a></li>
</ul>
<h3>Más recursos</h3>
<ul>
<li><a href="/news">Blog de inteligencia artificial</a></li>
<li><a href="/que-es-vibe-coding">¿Qué es el vibe coding?</a></li>
<li><a href="/que-es-un-agente-de-ia">¿Qué es un agente de IA?</a></li>
<li><a href="/glosario">Glosario de IA</a></li>
<li><a href="/showcase">Apps creadas con Maris AI</a></li>
<li><a href="/desarrollo-no-code-guia">Guía de desarrollo no-code</a></li>
</ul>
</nav>`
  },
  {
    path: "/que-es-vibe-coding",
    file: "que-es-vibe-coding/index.html",
    title: "Qué es el Vibe Coding — Guía Completa 2026",
    description: "El vibe coding es el nuevo paradigma donde describes tu idea y la IA genera el código. Guía completa en español.",
    canonical: "https://www.marisai.es/que-es-vibe-coding",
    body: `<h1>Qué es el Vibe Coding — Guía completa 2026</h1>
<p>El vibe coding es el nuevo paradigma de desarrollo de software donde describes tu idea en lenguaje natural y la inteligencia artificial genera el código completo automáticamente. No necesitas saber programar.</p>
<h2>Origen del término vibe coding</h2>
<p>El término fue acuñado por Andrej Karpathy en febrero de 2025. Describe el proceso de "programar con vibra" — donde el desarrollador guía la IA con descripciones naturales en lugar de escribir código línea por línea.</p>
<h2>¿Cómo funciona el vibe coding en la práctica?</h2>
<ol>
<li>Describes lo que quieres construir en lenguaje natural: "Quiero una app para gestionar mis clientes con calendario de citas"</li>
<li>La IA analiza tu descripción y planifica la arquitectura</li>
<li>Múltiples agentes especializados generan el código frontend, backend y base de datos</li>
<li>Recibes una aplicación funcional lista para usar y desplegar</li>
</ol>
<h2>Vibe coding en español con Maris AI</h2>
<p>Maris AI es la plataforma de vibe coding líder en español. A diferencia de Bolt.new, Lovable o Emergent que solo funcionan en inglés, Maris AI permite crear apps describiendo tu idea directamente en español.</p>
<h2>¿Necesito saber programar para hacer vibe coding?</h2>
<p>No. El vibe coding está diseñado precisamente para personas sin conocimientos técnicos. Los emprendedores, diseñadores, marketers y dueños de negocio pueden crear apps profesionales sin escribir una sola línea de código.</p>
<h2>Herramientas de vibe coding en 2026</h2>
<ul>
<li><strong>Maris AI</strong> — La única plataforma de vibe coding completamente en español. 9 agentes especializados.</li>
<li>Bolt.new — En inglés, para desarrolladores con conocimientos técnicos</li>
<li>Lovable — En inglés, orientado a startups anglosajonas</li>
<li>Emergent — En inglés, para proyectos más complejos</li>
<li>Cursor — IDE con IA, requiere conocimientos de programación</li>
</ul>
<nav>
<h3>Comparativas de Maris AI</h3>
<ul>
<li><a href="/vs-emergent">Maris AI vs Emergent</a></li>
<li><a href="/vs-lovable">Maris AI vs Lovable</a></li>
<li><a href="/vs-bolt">Maris AI vs Bolt.new</a></li>
<li><a href="/vs-base44">Maris AI vs Base44</a></li>
</ul>
<h3>Más recursos</h3>
<ul>
<li><a href="/news">Blog de inteligencia artificial</a></li>
<li><a href="/que-es-vibe-coding">¿Qué es el vibe coding?</a></li>
<li><a href="/que-es-un-agente-de-ia">¿Qué es un agente de IA?</a></li>
<li><a href="/glosario">Glosario de IA</a></li>
<li><a href="/showcase">Apps creadas con Maris AI</a></li>
<li><a href="/desarrollo-no-code-guia">Guía de desarrollo no-code</a></li>
</ul>
</nav>`
  },
  {
    path: "/que-es-un-agente-de-ia",
    file: "que-es-un-agente-de-ia/index.html",
    title: "Qué es un Agente de IA — Guía para Emprendedores",
    description: "Un agente de IA es un sistema autónomo que analiza, razona y ejecuta tareas. Maris AI usa 9 agentes especializados para crear tu app.",
    canonical: "https://www.marisai.es/que-es-un-agente-de-ia",
    body: `<h1>Qué es un agente de inteligencia artificial</h1>
<p>Un agente de IA es un sistema autónomo capaz de percibir su entorno, razonar sobre él y ejecutar acciones para alcanzar un objetivo específico sin intervención humana constante.</p>
<h2>Características de un agente de IA</h2>
<ul>
<li><strong>Autonomía</strong> — Toma decisiones sin supervisión humana continua</li>
<li><strong>Percepción</strong> — Lee y entiende el contexto y las instrucciones</li>
<li><strong>Razonamiento</strong> — Planifica cómo resolver el problema</li>
<li><strong>Acción</strong> — Ejecuta tareas concretas (escribir código, buscar información, etc.)</li>
<li><strong>Especialización</strong> — Cada agente tiene un rol y expertise específico</li>
</ul>
<h2>Los 9 agentes de IA de Maris AI</h2>
<ul>
<li><strong>Researcher</strong> — Investiga el mercado, analiza competidores y define requisitos del proyecto</li>
<li><strong>Architect</strong> — Diseña la arquitectura técnica, estructura de archivos y base de datos</li>
<li><strong>Designer</strong> — Crea el sistema visual: paleta de colores, tipografía, componentes UI</li>
<li><strong>Frontend Engineer</strong> — Genera el código React + TypeScript + Tailwind CSS</li>
<li><strong>Backend Engineer</strong> — Desarrolla la API REST con Express + Node.js + MongoDB</li>
<li><strong>QA Auditor</strong> — Revisa el código buscando errores, imports rotos y problemas de accesibilidad</li>
<li><strong>PM Agent</strong> — Valida que el resultado cumple exactamente lo que el usuario pidió</li>
<li><strong>Image Agent</strong> — Genera imágenes reales con IA para reemplazar placeholders</li>
<li><strong>Visual Evaluator</strong> — Analiza screenshots de la app y detecta problemas visuales</li>
</ul>
<h2>¿Por qué 9 agentes y no uno solo?</h2>
<p>Cada agente está optimizado para su tarea específica. Un agente de diseño tiene diferente "forma de pensar" que un agente de código backend. Al trabajar en pipeline, los 9 agentes producen un resultado mucho más completo y profesional que un único agente generalista.</p>
<nav>
<h3>Comparativas de Maris AI</h3>
<ul>
<li><a href="/vs-emergent">Maris AI vs Emergent</a></li>
<li><a href="/vs-lovable">Maris AI vs Lovable</a></li>
<li><a href="/vs-bolt">Maris AI vs Bolt.new</a></li>
<li><a href="/vs-base44">Maris AI vs Base44</a></li>
</ul>
<h3>Más recursos</h3>
<ul>
<li><a href="/news">Blog de inteligencia artificial</a></li>
<li><a href="/que-es-vibe-coding">¿Qué es el vibe coding?</a></li>
<li><a href="/que-es-un-agente-de-ia">¿Qué es un agente de IA?</a></li>
<li><a href="/glosario">Glosario de IA</a></li>
<li><a href="/showcase">Apps creadas con Maris AI</a></li>
<li><a href="/desarrollo-no-code-guia">Guía de desarrollo no-code</a></li>
</ul>
</nav>`
  },
  {
    path: "/glosario",
    file: "glosario/index.html",
    title: "Glosario de Inteligencia Artificial — Maris AI",
    description: "Todos los términos de IA que necesitas como emprendedor. React, TypeScript, vibe coding, agentes, LLM y más explicados en español.",
    canonical: "https://www.marisai.es/glosario",
    body: `<h1>Glosario de inteligencia artificial para emprendedores</h1>
<p>Definiciones claras de los términos más importantes de la inteligencia artificial y el desarrollo de apps, explicados en español para emprendedores sin conocimientos técnicos.</p>
<dl>
<dt>LLM (Large Language Model)</dt><dd>Modelo de lenguaje de gran escala como Claude, GPT-4 o Gemini. Son la tecnología base que usan los agentes de IA de Maris AI para generar código.</dd>
<dt>Vibe Coding</dt><dd>Paradigma de programación donde describes en lenguaje natural lo que quieres y la IA genera el código. Popularizado por Andrej Karpathy en 2025.</dd>
<dt>Agente de IA</dt><dd>Sistema autónomo de inteligencia artificial que tiene un rol específico y ejecuta tareas concretas. Maris AI usa 9 agentes especializados.</dd>
<dt>React</dt><dd>Biblioteca de JavaScript creada por Meta para crear interfaces de usuario. Maris AI genera el frontend con React + TypeScript.</dd>
<dt>TypeScript</dt><dd>Superset de JavaScript con tipado estático. Mejora la calidad y mantenibilidad del código generado por Maris AI.</dd>
<dt>Tailwind CSS</dt><dd>Framework de CSS utilitario que permite crear diseños responsivos sin escribir CSS personalizado.</dd>
<dt>MongoDB</dt><dd>Base de datos NoSQL orientada a documentos. Maris AI la usa para almacenar datos de las apps generadas.</dd>
<dt>Express</dt><dd>Framework de Node.js para crear APIs REST. Maris AI genera el backend con Express + TypeScript + MongoDB.</dd>
<dt>API REST</dt><dd>Interfaz de programación que permite la comunicación entre el frontend (lo que ve el usuario) y el backend (la lógica de negocio).</dd>
<dt>Deploy / Despliegue</dt><dd>Proceso de publicar una aplicación en internet para que sea accesible desde cualquier dispositivo.</dd>
<dt>Vercel</dt><dd>Plataforma de hosting preferida para desplegar el frontend de las apps generadas con Maris AI.</dd>
<dt>Railway</dt><dd>Plataforma cloud para desplegar el backend y la base de datos de las apps de Maris AI.</dd>
<dt>GitHub</dt><dd>Plataforma de control de versiones donde se guarda y comparte el código. Maris AI permite exportar directamente a GitHub.</dd>
<dt>Frontend</dt><dd>La parte visual de una aplicación que ve y usa el usuario. Generado con React + TypeScript + Tailwind.</dd>
<dt>Backend</dt><dd>La lógica de negocio y base de datos de una aplicación. Generado con Express + Node.js + MongoDB.</dd>
<dt>No-code</dt><dd>Enfoque de desarrollo que permite crear software sin escribir código. Maris AI lleva el no-code al siguiente nivel con IA.</dd>
<dt>Prompt</dt><dd>Instrucción en lenguaje natural que se le da a una IA. En Maris AI, el prompt es la descripción de tu app.</dd>
<dt>Token</dt><dd>Unidad de medida del texto procesado por un LLM. Equivale aproximadamente a 3/4 de una palabra en español.</dd>
<dt>RGPD</dt><dd>Reglamento General de Protección de Datos. Normativa europea que regula el tratamiento de datos personales. Maris AI cumple con el RGPD.</dd>
</dl>
<nav>
<h3>Comparativas de Maris AI</h3>
<ul>
<li><a href="/vs-emergent">Maris AI vs Emergent</a></li>
<li><a href="/vs-lovable">Maris AI vs Lovable</a></li>
<li><a href="/vs-bolt">Maris AI vs Bolt.new</a></li>
<li><a href="/vs-base44">Maris AI vs Base44</a></li>
</ul>
<h3>Más recursos</h3>
<ul>
<li><a href="/news">Blog de inteligencia artificial</a></li>
<li><a href="/que-es-vibe-coding">¿Qué es el vibe coding?</a></li>
<li><a href="/que-es-un-agente-de-ia">¿Qué es un agente de IA?</a></li>
<li><a href="/glosario">Glosario de IA</a></li>
<li><a href="/showcase">Apps creadas con Maris AI</a></li>
<li><a href="/desarrollo-no-code-guia">Guía de desarrollo no-code</a></li>
</ul>
</nav>`
  },
  {
    path: "/desarrollo-no-code-guia",
    file: "desarrollo-no-code-guia/index.html",
    title: "Guía No-Code con IA para Emprendedores Españoles 2026",
    description: "Guía completa para crear tu primera app sin programar usando IA. Paso a paso, en español, para emprendedores y autónomos.",
    canonical: "https://www.marisai.es/desarrollo-no-code-guia",
    body: `<h1>Guía de desarrollo no-code con IA para emprendedores 2026</h1>
<p>La guía definitiva para emprendedores españoles que quieren crear aplicaciones web sin saber programar usando inteligencia artificial.</p>
<h2>¿Qué es el desarrollo no-code?</h2>
<p>El desarrollo no-code permite crear software funcional y profesional sin escribir código de programación manualmente. Con herramientas de IA como Maris AI, describes lo que quieres en español y la plataforma genera el código automáticamente.</p>
<h2>Ventajas del no-code con IA para emprendedores</h2>
<ul>
<li><strong>Sin conocimientos técnicos</strong> — No necesitas saber React, TypeScript, MongoDB ni ningún lenguaje de programación</li>
<li><strong>Velocidad</strong> — Tu app lista en menos de 5 minutos vs semanas o meses de desarrollo tradicional</li>
<li><strong>Coste reducido</strong> — Evitas contratar desarrolladores que pueden costar 50-150€/hora</li>
<li><strong>Código real y exportable</strong> — A diferencia de otras herramientas no-code, Maris AI genera código real que puedes exportar</li>
<li><strong>Escalable</strong> — El código generado es profesional y puede escalar con tu negocio</li>
</ul>
<h2>Paso a paso: crea tu primera app sin programar</h2>
<ol>
<li><strong>Define tu idea</strong> — ¿Qué problema resuelve tu app? ¿Quién la usará? ¿Qué funcionalidades necesita?</li>
<li><strong>Regístrate en Maris AI</strong> — Crea tu cuenta gratis en marisai.es. Recibes 65 créditos sin tarjeta.</li>
<li><strong>Describe tu app</strong> — Escribe en español qué quieres construir. Cuanto más detallado, mejor resultado.</li>
<li><strong>Los 9 agentes trabajan</strong> — En menos de 5 minutos, el equipo de agentes IA genera tu app completa.</li>
<li><strong>Personaliza y despliega</strong> — Ajusta el diseño mediante chat y publica tu app en internet.</li>
</ol>
<h2>Tipos de apps que puedes crear sin programar</h2>
<ul>
<li>CRM y gestión de clientes</li>
<li>Tiendas online y e-commerce</li>
<li>Plataformas de reservas y citas</li>
<li>Apps para negocios locales (peluquerías, clínicas, talleres)</li>
<li>Dashboards y paneles de control</li>
<li>Marketplaces y directorios</li>
<li>Landing pages de alta conversión</li>
<li>Portfolios y webs corporativas</li>
</ul>
<h2>Maris AI vs otras herramientas no-code</h2>
<p>A diferencia de Webflow, Bubble o WordPress, Maris AI genera código React real que puedes exportar, modificar y alojar donde quieras. No quedas atrapado en la plataforma. El código es 100% tuyo.</p>
<nav>
<h3>Comparativas de Maris AI</h3>
<ul>
<li><a href="/vs-emergent">Maris AI vs Emergent</a></li>
<li><a href="/vs-lovable">Maris AI vs Lovable</a></li>
<li><a href="/vs-bolt">Maris AI vs Bolt.new</a></li>
<li><a href="/vs-base44">Maris AI vs Base44</a></li>
</ul>
<h3>Más recursos</h3>
<ul>
<li><a href="/news">Blog de inteligencia artificial</a></li>
<li><a href="/que-es-vibe-coding">¿Qué es el vibe coding?</a></li>
<li><a href="/que-es-un-agente-de-ia">¿Qué es un agente de IA?</a></li>
<li><a href="/glosario">Glosario de IA</a></li>
<li><a href="/showcase">Apps creadas con Maris AI</a></li>
<li><a href="/desarrollo-no-code-guia">Guía de desarrollo no-code</a></li>
</ul>
</nav>`
  },
  {
    path: "/legal/privacidad",
    file: "legal/privacidad/index.html",
    title: "Política de Privacidad — Maris AI",
    description: "Política de privacidad de Maris AI: qué datos recopilamos, cómo los usamos y tus derechos conforme al RGPD.",
    canonical: "https://www.marisai.es/legal/privacidad",
    body: `<h1>Política de Privacidad</h1>
<p>Última actualización: 28 de mayo de 2026</p>
<h2>1. Introducción</h2>
<p>En Maris AI respetamos la privacidad de nuestros usuarios. Esta Política de Privacidad explica cómo recopilamos, usamos, divulgamos y salvaguardamos tu información cuando visitas marisai.es y utilizas nuestros servicios.</p>
<h2>2. Información que Recopilamos</h2>
<p>Recopilamos información que nos proporcionas directamente: nombre, correo electrónico y contraseña (a través de Clerk), información de perfil y preferencias, descripciones de aplicaciones que deseas generar, información de facturación y pago, y comunicaciones de soporte.</p>
<h2>3. Cómo Usamos tu Información</h2>
<p>Utilizamos la información recopilada para proporcionar y mejorar nuestros servicios, procesar transacciones, enviar comunicaciones técnicas, responder consultas de soporte, cumplir obligaciones legales y prevenir fraude.</p>
<h2>4. Compartir tu Información</h2>
<p>No vendemos ni transferimos tu información personal a terceros sin tu consentimiento, salvo proveedores que nos asisten operativamente, obligación legal, o protección de derechos y seguridad.</p>
<h2>5. Tus Derechos</h2>
<p>Tienes derecho a acceder, rectificar y solicitar la eliminación de tu información personal, así como a oponerte a su procesamiento. Para ejercer estos derechos, contáctanos en privacidad@marisai.es.</p>
<h2>6. Contacto</h2>
<p>Maris AI Inc. — Email: privacidad@marisai.es — Sitio web: www.marisai.es</p>`
  },
  {
    path: "/legal/aviso-legal",
    file: "legal/aviso-legal/index.html",
    title: "Aviso Legal — Maris AI",
    description: "Aviso legal e información sobre el responsable del sitio web marisai.es conforme a la LSSI.",
    canonical: "https://www.marisai.es/legal/aviso-legal",
    body: `<h1>Aviso Legal</h1>
<p>Última actualización: 28 de mayo de 2026</p>
<h2>1. Información Legal</h2>
<p>Maris AI Inc. es una empresa constituida de conformidad con las leyes aplicables. El contenido de este sitio web está protegido por derechos de autor y otras leyes de propiedad intelectual.</p>
<h2>2. Uso Aceptable</h2>
<p>Al acceder y utilizar este sitio web aceptas no usarlo para fines ilegales, no infringir derechos de propiedad intelectual de terceros, no transmitir contenido obsceno u ofensivo, y no intentar acceder sin autorización a nuestros sistemas.</p>
<h2>3. Limitación de Responsabilidad</h2>
<p>Maris AI proporciona el sitio web y los servicios "tal como están", sin garantías de ningún tipo, en la máxima medida permitida por la ley.</p>
<h2>4. Propiedad Intelectual</h2>
<p>El contenido del sitio web está protegido por derechos de autor. Sin embargo, el código generado por nuestros servicios es 100% tuyo: puedes usarlo, modificarlo, distribuirlo y comercializarlo sin restricciones.</p>
<h2>5. Contacto</h2>
<p>Maris AI Inc. — Email: legal@marisai.es — Sitio web: www.marisai.es</p>`
  },
  {
    path: "/legal/cookies",
    file: "legal/cookies/index.html",
    title: "Política de Cookies — Maris AI",
    description: "Información sobre las cookies utilizadas en marisai.es: tipos de cookies, cómo gestionarlas y cookies de terceros.",
    canonical: "https://www.marisai.es/legal/cookies",
    body: `<h1>Política de Cookies</h1>
<p>Última actualización: 28 de mayo de 2026</p>
<h2>1. ¿Qué son las Cookies?</h2>
<p>Las cookies son pequeños archivos de texto que se almacenan en tu dispositivo cuando visitas un sitio web. Las usamos para mejorar tu experiencia, recordar tus preferencias y analizar el uso del sitio.</p>
<h2>2. Tipos de Cookies que Utilizamos</h2>
<p>Cookies esenciales (autenticación y seguridad), cookies de rendimiento (mejora de funcionalidad) y cookies de análisis (Google Analytics y similares, para entender el uso del sitio).</p>
<h2>3. Cómo Controlar las Cookies</h2>
<p>Puedes eliminar o bloquear cookies desde la configuración de tu navegador. Si lo haces, es posible que algunos servicios y funcionalidades del sitio no funcionen correctamente.</p>
<h2>4. Cookies de Terceros</h2>
<p>Nuestro sitio puede contener cookies de terceros, como Google Analytics. No tenemos control sobre estas cookies; te recomendamos revisar las políticas de privacidad de esos terceros.</p>
<h2>5. Contacto</h2>
<p>Maris AI Inc. — Email: privacy@marisai.es — Sitio web: www.marisai.es</p>`
  },
  {
    path: "/en",
    file: "en/index.html",
    title: "Maris AI — Build Apps with AI, No Coding Required",
    description: "Describe your idea and 9 specialized AI agents generate your complete app in under 5 minutes. No coding needed. Free for entrepreneurs worldwide.",
    canonical: "https://www.marisai.es/en",
    body: `<h1>Maris AI — Build Apps with AI, No Coding Required</h1>
<p>Maris AI is a vibe coding platform born in Spain, now open to entrepreneurs worldwide. 9 specialized AI agents generate your complete app in under 5 minutes — no coding skills needed.</p>
<h2>What is Maris AI?</h2>
<p>Maris AI is a strong alternative to Bolt.new, Lovable and Emergent. Support and the core interface are in Spanish, but anyone — Spanish or English speaking — can sign up and build with Maris AI today.</p>
<ul>
<li>9 specialized AI agents working in parallel</li>
<li>Express + MongoDB backend included automatically</li>
<li>78 free credits, no credit card required</li>
<li>Credits that never expire</li>
<li>100% exportable code to GitHub, no vendor lock-in</li>
<li>Euro pricing, GDPR compliant</li>
</ul>
<h2>The 9 Maris AI agents</h2>
<ol>
<li><strong>Researcher</strong> — Researches the market and defines project requirements</li>
<li><strong>Architect</strong> — Designs the complete technical architecture</li>
<li><strong>Designer</strong> — Creates the visual system, color palette and typography</li>
<li><strong>Frontend Engineer</strong> — Generates React + TypeScript + Tailwind CSS code</li>
<li><strong>Backend Engineer</strong> — Builds the REST API with Express + MongoDB</li>
<li><strong>QA Auditor</strong> — Reviews errors, accessibility and security</li>
<li><strong>PM Agent</strong> — Validates the result matches the original request</li>
<li><strong>Image Agent</strong> — Generates real AI images</li>
<li><strong>Visual Evaluator</strong> — Analyzes real screenshots with Claude Vision</li>
</ol>
<h2>Frequently asked questions</h2>
<dl>
<dt>Do I need coding skills?</dt><dd>No. You describe your idea and Maris AI generates all the code automatically.</dd>
<dt>How much does Maris AI cost?</dt><dd>78 free credits when you sign up, no credit card. Packages start at €20 for 160 credits that never expire.</dd>
<dt>Is the generated code mine?</dt><dd>Yes, 100% yours. Exportable to GitHub with no restrictions.</dd>
<dt>Is support available in English?</dt><dd>Support is primarily in Spanish, focused on the Spanish-speaking market — but anyone can sign up and use the platform regardless of language.</dd>
</dl>
<h2>Types of apps you can build</h2>
<ul>
<li>CRM and customer management</li>
<li>Online stores with Stripe</li>
<li>Educational platforms</li>
<li>Restaurant apps</li>
<li>Clinic management</li>
<li>Analytics dashboards</li>
<li>Marketplaces and directories</li>
<li>Landing pages</li>
<li>Professional portfolios</li>
<li>Booking and appointment apps</li>
<li>SaaS with subscriptions</li>
<li>APIs and backends</li>
</ul>`
  },
  {
    path: "/en/pricing",
    file: "en/pricing/index.html",
    title: "Maris AI Pricing — 65 Free Welcome Credits, No Credit Card",
    description: "Start free with 65 credits, no credit card. Packages from €20 for 160 credits, with progressive discounts the more you buy — down to €0.110/credit.",
    canonical: "https://www.marisai.es/en/pricing",
    body: `<h1>Maris AI Pricing — Build apps with AI</h1>
<p>Start free, no credit card required. Credits never expire, and the more you buy, the cheaper each credit gets.</p>
<h2>Free Plan</h2>
<ul><li>65 free welcome credits when you sign up</li><li>No credit card required</li><li>Full access to all 9 AI agents</li><li>GitHub export included</li></ul>
<h2>Starter Pack — €20</h2>
<ul><li>160 credits</li><li>€0.125 per credit</li><li>Credits that never expire</li></ul>
<h2>Pack 250 — €37</h2>
<ul><li>250 credits</li><li>€0.148 per credit</li></ul>
<h2>Most Popular — €70</h2>
<ul><li>500 credits</li><li>€0.140 per credit</li></ul>
<h2>Pack 1250 — €162</h2>
<ul><li>1250 credits</li><li>€0.130 per credit</li></ul>
<h2>Best Value — €360</h2>
<ul><li>3000 credits</li><li>€0.120 per credit</li></ul>
<h2>Best Value — €660</h2>
<ul><li>6000 credits</li><li>€0.110 per credit — the lowest price per credit</li></ul>
<h2>Pricing FAQ</h2>
<dl>
<dt>Do credits expire?</dt><dd>No. Maris AI credits never expire. Use them whenever you want.</dd>
<dt>Why are bigger packs cheaper?</dt><dd>The price per credit drops as pack size grows, to reward users who buy more.</dd>
<dt>What can I build with credits?</dt><dd>Complete apps, landing pages, dashboards, e-commerce, CRMs, and any type of web application.</dd>
</dl>`
  },
];

const HIDE_SCRIPT = `<script>
  (function() {
    var checkHide = function() {
      var seo = document.getElementById('seo-prerender');
      var root = document.getElementById('root');
      if (seo && root && root.children.length > 0) {
        seo.style.display = 'none';
      } else {
        setTimeout(checkHide, 150);
      }
    };
    setTimeout(checkHide, 100);
  })();
<\/script>`;

const baseHtml = (() => {
  let raw = readFileSync(join(DIST, "index.html"), "utf-8");
  // Si un deploy anterior ya dejó un bloque seo-prerender (de la ruta /)
  // incrustado en dist/index.html, hay que quitarlo del template base.
  // Sin esto, TODAS las páginas heredan el contenido visible de la home
  // (h1, párrafos, FAQs) además de su propio contenido — y Google las
  // clasifica como duplicados de la home → "soft 404".
  raw = raw.replace(/<div id="seo-prerender"[\s\S]*?<\/div>\s*<script>[\s\S]*?<\/script>\s*/g, "");
  return raw;
})();

// ─── Artículos de noticias (dinámicos, desde la API) ───────────────────────
// ENCONTRADO: sitemap.ts incluye /news/<slug> para cada artículo de la base
// de datos, pero el rewrite de vercel.json excluye explícitamente el prefijo
// "news" del fallback SPA (para que /news use el HTML prerenderizado real).
// Como aquí nunca se generaba ese HTML para los artículos individuales,
// cada URL /news/<slug> no tenía ni archivo estático ni rewrite que la
// sirviera -> 404 real para Googlebot. Resultado observado en Search
// Console: cada artículo enlazado en el sitemap quedaba sin indexar. Fix:
// generar aquí, en build time, el mismo tipo de HTML estático real que ya
// se genera para /pricing, /showcase, etc., uno por artículo publicado.
const API_BASE = process.env.VITE_API_URL || "https://maris-ai-api-server-production-fbad.up.railway.app";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchArticleRoutes() {
  try {
    const res = await fetch(`${API_BASE}/api/news`);
    if (!res.ok) throw new Error(`API respondió ${res.status}`);
    const articles = await res.json();
    if (!Array.isArray(articles)) return [];

    return articles.map((a) => {
      const bodyHtml = String(a.body || "")
        .split("\n\n")
        .filter((p) => p.trim().length > 0)
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("\n");

      return {
        path: `/news/${a.slug}`,
        file: `news/${a.slug}/index.html`,
        title: `${a.title} — Maris AI`,
        description: a.metaDescription || String(a.body || "").slice(0, 160),
        canonical: `https://www.marisai.es/news/${a.slug}`,
        body: `<h1>${escapeHtml(a.title)}</h1>\n${bodyHtml}\n<nav>\n<h3>Explora más</h3>\n<ul>\n<li><a href="/news">Volver al blog</a></li>\n<li><a href="/que-es-vibe-coding">¿Qué es el vibe coding?</a></li>\n<li><a href="/que-es-un-agente-de-ia">¿Qué es un agente de IA?</a></li>\n<li><a href="/glosario">Glosario de IA</a></li>\n<li><a href="/vs-emergent">Maris AI vs competidores</a></li>\n<li><a href="/showcase">Apps creadas con Maris AI</a></li>\n<li><a href="/desarrollo-no-code-guia">Guía de desarrollo no-code</a></li>\n</ul>\n</nav>`,
      };
    });
  } catch (err) {
    // Un fallo aquí (API caída durante el build, artículo mal formado, etc.)
    // NUNCA debe tirar abajo todo el build del frontend — se omiten los
    // artículos de esta ejecución y se generan en el siguiente deploy.
    console.warn(`⚠️  No se pudieron obtener artículos para prerender: ${err.message}`);
    return [];
  }
}

const articleRoutes = await fetchArticleRoutes();
if (articleRoutes.length > 0) {
  console.log(`📰 ${articleRoutes.length} artículos de noticias encontrados para prerender`);
}
ROUTES.push(...articleRoutes);

// Actualizar el body de /news con el listado real de artículos.
// Sin esto, la página prerenderizada tiene contenido genérico que Google
// clasifica como "soft 404" (página sin contenido real).
const newsRoute = ROUTES.find((r) => r.path === "/news");
if (newsRoute && articleRoutes.length > 0) {
  const articleListHtml = articleRoutes
    .map((a) => {
      const title = a.title.replace(/ — Maris AI$/, "");
      return `<li><a href="${a.canonical}">${escapeHtml(title)}</a> — ${escapeHtml(a.description.slice(0, 120))}</li>`;
    })
    .join("\n");
  newsRoute.body = `<h1>Blog de inteligencia artificial para emprendedores</h1>
<p>Las últimas noticias, tutoriales y guías sobre inteligencia artificial, vibe coding y creación de apps sin programar. Contenido en español para emprendedores en España y Latinoamérica.</p>
<h2>Últimos artículos</h2>
<ul>
${articleListHtml}
</ul>
<h2>Temas del blog</h2>
<ul>
<li><a href="/que-es-vibe-coding">Vibe coding y programación con IA</a></li>
<li><a href="/desarrollo-no-code-guia">Guías para crear apps sin saber programar</a></li>
<li><a href="/vs-emergent">Comparativas de herramientas IA para emprendedores</a></li>
<li><a href="/que-es-un-agente-de-ia">Agentes de inteligencia artificial</a></li>
<li><a href="/glosario">Glosario de IA</a></li>
<li><a href="/showcase">Apps creadas con Maris AI</a></li>
</ul>`;
  console.log(`📝 /news actualizado con ${articleRoutes.length} artículos en el listado`);
}

let success = 0;

for (const route of ROUTES) {
  try {
    const dir = join(DIST, dirname(route.file));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let html = baseHtml;

    // Update title
    const titlePattern = /<title>[^<]*<\/title>/;
    if (!titlePattern.test(html)) console.warn(`⚠️  ${route.path}: no se pudo actualizar <title> (patrón no encontrado)`);
    html = html.replace(titlePattern, `<title>${route.title}</title>`);

    // Update description
    const descPatternA = /(<meta name="description" content=")[^"]*(" \/>)/;
    const descPatternB = /(<meta name="description" content=")[^"]*("\s*\/>)/;
    if (!descPatternA.test(html) && !descPatternB.test(html)) {
      console.warn(`⚠️  ${route.path}: no se pudo actualizar <meta name="description"> (patrón no encontrado)`);
    }
    html = html.replace(descPatternA, `$1${route.description}$2`);
    html = html.replace(descPatternB, `$1${route.description}$2`);

    // Update canonical
    const canonicalPattern = /(<link rel="canonical" href=")[^"]*(" id="canonical-tag")/;
    if (!canonicalPattern.test(html)) console.warn(`⚠️  ${route.path}: no se pudo actualizar <link rel="canonical"> (patrón no encontrado)`);
    html = html.replace(canonicalPattern, `$1${route.canonical}$2`);

    // Update Open Graph and Twitter meta tags — CRÍTICO para indexación.
    // Sin esto, og:url/og:title/twitter:url siguen apuntando a la home en
    // todas las páginas prerenderizadas, lo que hace que Google interprete
    // cada página como duplicado de la home → "soft 404" en Search Console.
    const ogReplacements = [
      [/(<meta property="og:title" content=")[^"]*(")/,     `$1${route.title}$2`],
      [/(<meta property="og:description" content=")[^"]*(")/,`$1${route.description}$2`],
      [/(<meta property="og:url" content=")[^"]*(")/,       `$1${route.canonical}$2`],
      [/(<meta name="twitter:title" content=")[^"]*(")/,    `$1${route.title}$2`],
      [/(<meta name="twitter:description" content=")[^"]*(")/,`$1${route.description}$2`],
      [/(<meta name="twitter:url" content=")[^"]*(")/,      `$1${route.canonical}$2`],
      // twitter:title/description pueden estar con property= en vez de name=
      [/(<meta property="twitter:title" content=")[^"]*(")/,    `$1${route.title}$2`],
      [/(<meta property="twitter:description" content=")[^"]*(")/,`$1${route.description}$2`],
      [/(<meta property="twitter:url" content=")[^"]*(")/,      `$1${route.canonical}$2`],
    ];
    for (const [pattern, replacement] of ogReplacements) {
      html = html.replace(pattern, replacement);
    }

    // hreflang — SOLO entre páginas que tienen una contraparte real traducida.
    // No se añade hreflang especulativo a páginas sin traducción real: eso
    // le diría a Google que existe una versión que no existe, justo el tipo
    // de error de hreflang que penaliza confianza, no la falta del propio
    // hreflang.
    // Primero se elimina cualquier hreflang heredado del index.html base
    // (ej. el de la home, fijo en ese archivo) — cada ruta define el suyo
    // desde cero para evitar duplicados o pares incorrectos.
    html = html.replace(/<link rel="alternate" hreflang="[^"]*" href="[^"]*"\s*\/>\n?\s*/g, "");
    const HREFLANG_PAIRS = {
      "/": { en: "https://www.marisai.es/en", "x-default": "https://www.marisai.es/" },
      "/pricing": { en: "https://www.marisai.es/en/pricing", "x-default": "https://www.marisai.es/pricing" },
      "/en": { es: "https://www.marisai.es/", "x-default": "https://www.marisai.es/" },
      "/en/pricing": { es: "https://www.marisai.es/pricing", "x-default": "https://www.marisai.es/pricing" },
    };
    const hreflangEntry = HREFLANG_PAIRS[route.path];
    if (hreflangEntry) {
      const hreflangTags = Object.entries(hreflangEntry)
        .map(([lang, href]) => `<link rel="alternate" hreflang="${lang}" href="${href}" />`)
        .join("\n  ");
      html = html.replace(
        /(<link rel="canonical" href="[^"]*" id="canonical-tag" \/>)/,
        `$1\n  ${hreflangTags}`,
      );
    }

    // Eliminar esquemas JSON-LD específicos de la HOME en cualquier página
    // que no sea la home. CONFIRMADO contra la documentación oficial de
    // Google (developers.google.com/search/docs/appearance/structured-data/sd-policies):
    // "Don't mark up irrelevant or misleading content... unrelated to the
    // focus of a page" — antes de este fix, el FAQPage (8 preguntas sobre
    // Maris AI en general), HowTo (guía de uso) y Product (con reseñas)
    // se servían IDÉNTICOS en /legal/cookies, /legal/privacidad, etc.,
    // donde no tienen relación con el contenido real de la página. Esto es
    // justo el patrón que la documentación describe como elegible para
    // manual action de "spammy structured markup" — no solo peso extra.
    // Organization, WebSite y BreadcrumbList SÍ son universales (describen
    // el sitio en general, no un contenido específico) y se mantienen en
    // todas las páginas.
    if (route.path !== "/") {
      // El index.html base incluye un único <script type="application/ld+json">
      // con un @graph que contiene Person, SoftwareApplication, FAQPage, HowTo,
      // Organization, WebSite — todo sobre la HOME. La limpieza anterior intentaba
      // eliminar cada @type individualmente con regex, pero no funcionaba porque
      // todos están agrupados en un solo @graph dentro del mismo <script>.
      // Para las páginas no-home, eliminamos el bloque entero. Cada página tiene
      // su propio schema (BreadcrumbList) añadido por el inline script de index.html.
      html = html.replace(
        /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@graph":\[[\s\S]*?\]}<\/script>/,
        "",
      );
    }

    // NOTA: el bloque #seo-main (que antes vivía oculto fuera de pantalla en
    // index.html) se eliminó del código fuente. Su función — dar contenido
    // real a la home cuando no hay JS — la cubre ahora la propia entrada "/"
    // de este array ROUTES, con el mismo patrón visible-y-luego-oculto que
    // usa el resto de páginas (más abajo). Ya no hace falta ningún paso de
    // limpieza aquí.

    // Add visible SEO content + hide script
    // Usamos una regex que captura la etiqueta <div id="root" ...></div> completa,
    // sea cual sea el resto de atributos (role="main", clases, etc.), en vez de
    // buscar el string literal exacto '<div id="root"></div>'. Esto evita que el
    // prerender deje de funcionar silenciosamente si el div root cambia de atributos.
    const rootDivRegex = /<div id="root"[^>]*><\/div>/;
    if (!rootDivRegex.test(html)) {
      throw new Error(`No se encontró <div id="root">...</div> en dist/index.html — revisa si cambió el marcado`);
    }
    html = html.replace(
      rootDivRegex,
      (match) => `<div id="seo-prerender" style="font-family:Inter,system-ui,sans-serif;color:#e2e8f0;background:#0a0a0f;padding:2rem;max-width:900px;margin:0 auto;line-height:1.6;">
${route.body}
<p style="margin-top:2rem;color:#6366f1;font-size:0.875rem;">← <a href="https://www.marisai.es" style="color:#a855f7;text-decoration:none;">Maris AI — Crear apps con IA en español</a></p>
</div>
${HIDE_SCRIPT}
${match}`
    );

    writeFileSync(join(DIST, route.file), html, "utf-8");
    console.log(`✅ ${route.path} → ${route.file}`);
    success++;
  } catch (err) {
    console.error(`❌ ${route.path} → ${err.message}`);
  }
}

console.log(`\n📊 Prerender: ${success}/${ROUTES.length} páginas generadas`);

// ── Generar sitemap.xml estático ─────────────────────────────────────────────
// Antes se proxeaba a Railway en runtime, pero Clerk (auth middleware del
// backend) interceptaba la petición y devolvía un error JSON. Al generarlo
// aquí en build time: se sirve directamente desde la CDN de Vercel, sin
// dependencia de Railway ni de Clerk, y se actualiza en cada deploy.
const today = new Date().toISOString().split("T")[0];
const sitemapPages = [
  { url: "https://www.marisai.es/", priority: "1.0", changefreq: "daily" },
  { url: "https://www.marisai.es/news", priority: "0.9", changefreq: "daily" },
  { url: "https://www.marisai.es/pricing", priority: "0.8", changefreq: "weekly" },
  { url: "https://www.marisai.es/showcase", priority: "0.8", changefreq: "daily" },
  { url: "https://www.marisai.es/vs-emergent", priority: "0.8", changefreq: "monthly" },
  { url: "https://www.marisai.es/vs-lovable", priority: "0.8", changefreq: "monthly" },
  { url: "https://www.marisai.es/vs-bolt", priority: "0.8", changefreq: "monthly" },
  { url: "https://www.marisai.es/vs-base44", priority: "0.8", changefreq: "monthly" },
  { url: "https://www.marisai.es/que-es-vibe-coding", priority: "0.7", changefreq: "monthly" },
  { url: "https://www.marisai.es/que-es-un-agente-de-ia", priority: "0.7", changefreq: "monthly" },
  { url: "https://www.marisai.es/glosario", priority: "0.7", changefreq: "monthly" },
  { url: "https://www.marisai.es/desarrollo-no-code-guia", priority: "0.7", changefreq: "monthly" },
  { url: "https://www.marisai.es/legal/privacidad", priority: "0.4", changefreq: "yearly" },
  { url: "https://www.marisai.es/legal/aviso-legal", priority: "0.4", changefreq: "yearly" },
  { url: "https://www.marisai.es/legal/cookies", priority: "0.3", changefreq: "yearly" },
];

let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

for (const page of sitemapPages) {
  sitemap += `  <url>\n    <loc>${page.url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority}</priority>\n  </url>\n`;
}

// Añadir artículos (ya cargados arriba por fetchArticleRoutes)
for (const route of articleRoutes) {
  sitemap += `  <url>\n    <loc>${route.canonical}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>never</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
}

sitemap += `</urlset>`;

writeFileSync(join(DIST, "sitemap.xml"), sitemap, "utf-8");
console.log(`🗺️  sitemap.xml generado con ${sitemapPages.length + articleRoutes.length} URLs`);
