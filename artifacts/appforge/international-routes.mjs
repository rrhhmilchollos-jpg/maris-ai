// ══════════════════════════════════════════════════════════════════════
// Maris AI — Rutas internacionales y páginas programáticas
// ══════════════════════════════════════════════════════════════════════
// Importado por prerender.mjs. Contiene:
// 1. Versiones en inglés de todas las páginas de contenido
// 2. Páginas programáticas por caso de uso (como Emergent /build/*)
// 3. Landing pages por mercado (LATAM, US, UK)
// ══════════════════════════════════════════════════════════════════════

const CROSS_LINKS_EN = `<nav>
<h3>Explore Maris AI</h3>
<ul>
<li><a href="/en">Home</a></li>
<li><a href="/en/pricing">Pricing</a></li>
<li><a href="/en/showcase">Apps built with AI</a></li>
<li><a href="/en/vs-bolt">Maris AI vs Bolt.new</a></li>
<li><a href="/en/vs-lovable">Maris AI vs Lovable</a></li>
<li><a href="/en/vs-emergent">Maris AI vs Emergent</a></li>
<li><a href="/en/build/crm">Build a CRM with AI</a></li>
<li><a href="/en/build/online-store">Build an online store with AI</a></li>
<li><a href="/en/build/booking-app">Build a booking app with AI</a></li>
<li><a href="/en/build/saas">Build a SaaS with AI</a></li>
<li><a href="/en/build/dashboard">Build a dashboard with AI</a></li>
<li><a href="/en/build/portfolio">Build a portfolio with AI</a></li>
</ul>
</nav>`;

const CROSS_LINKS_ES_BUILD = `<nav>
<h3>Más apps que puedes crear</h3>
<ul>
<li><a href="/crear/crm">Crear un CRM con IA</a></li>
<li><a href="/crear/tienda-online">Crear una tienda online con IA</a></li>
<li><a href="/crear/app-reservas">Crear una app de reservas con IA</a></li>
<li><a href="/crear/saas">Crear un SaaS con IA</a></li>
<li><a href="/crear/dashboard">Crear un dashboard con IA</a></li>
<li><a href="/crear/portfolio">Crear un portfolio con IA</a></li>
<li><a href="/crear/landing-page">Crear una landing page con IA</a></li>
<li><a href="/crear/app-restaurante">Crear una app para restaurante con IA</a></li>
</ul>
<ul>
<li><a href="/">Inicio</a></li>
<li><a href="/pricing">Precios</a></li>
<li><a href="/showcase">Ejemplos reales</a></li>
<li><a href="/news">Blog</a></li>
</ul>
</nav>`;

// ── English versions of all content pages ────────────────────────────

export const ENGLISH_ROUTES = [
  {
    path: "/en",
    file: "en/index.html",
    title: "Maris AI — Build Apps with AI, No Coding Required",
    description: "Describe your idea and 11 specialized AI agents generate your complete app in under 5 minutes. No coding needed. Free credits, no credit card.",
    canonical: "https://www.marisai.es/en",
    body: `<h1>Maris AI — Build Apps with AI, No Coding Required</h1>
<p>Maris AI is a vibe coding platform that lets anyone build complete web apps using AI. 11 specialized agents generate your frontend, backend, and database in under 5 minutes. No coding skills needed.</p>
<h2>Why choose Maris AI?</h2>
<ul>
<li><strong>11 specialized AI agents</strong> — Researcher, Architect, Designer, Frontend, Backend, API Integrator, QA, Testing, PM, Image, Visual Evaluator</li>
<li><strong>Complete stack generated</strong> — React + TypeScript + Tailwind + Express + MongoDB</li>
<li><strong>65 free credits</strong> to start, no credit card required</li>
<li><strong>Credits never expire</strong> — use them whenever you need</li>
<li><strong>100% exportable code</strong> — export to GitHub, no vendor lock-in</li>
<li><strong>Euro pricing, GDPR compliant</strong></li>
</ul>
<h2>How it works</h2>
<ol>
<li><strong>Describe your app</strong> — write what you want in plain language</li>
<li><strong>9 AI agents work in parallel</strong> — planning, coding, testing, optimizing</li>
<li><strong>App ready in minutes</strong> — complete with frontend, backend, database, and deployment</li>
</ol>
<h2>Better alternative to Bolt.new, Lovable & Emergent</h2>
<p>Unlike Bolt.new (no backend), Lovable (Supabase dependency), and Emergent (opaque credit costs), Maris AI includes a real Express + MongoDB backend, credits that never expire, and transparent pricing in euros.</p>
<h2>Types of apps you can build</h2>
<ul>
<li>CRM and customer management</li>
<li>Online stores with Stripe payments</li>
<li>Booking and appointment apps</li>
<li>SaaS platforms with subscriptions</li>
<li>Analytics dashboards</li>
<li>Marketplaces and directories</li>
<li>Restaurant management apps</li>
<li>Educational platforms</li>
<li>Professional portfolios</li>
<li>Landing pages</li>
</ul>
<h2>FAQ</h2>
<dl>
<dt>Do I need coding skills?</dt><dd>No. Describe your idea in plain language and Maris AI generates all the code.</dd>
<dt>How much does it cost?</dt><dd>65 free credits when you sign up, no credit card. Packages from €20 for 160 credits that never expire.</dd>
<dt>Is the code mine?</dt><dd>Yes, 100% yours. Export to GitHub anytime, no restrictions.</dd>
<dt>What's the best alternative to Bolt.new?</dt><dd>Maris AI includes a real backend, credits that never expire, and costs less per app than Bolt.new or Emergent.</dd>
</dl>
${CROSS_LINKS_EN}`
  },
  {
    path: "/en/pricing",
    file: "en/pricing/index.html",
    title: "Maris AI Pricing — 65 Free Credits, No Credit Card",
    description: "Start free with 65 credits. Packages from €20 for 160 credits with progressive discounts. Credits never expire. GDPR compliant.",
    canonical: "https://www.marisai.es/en/pricing",
    body: `<h1>Maris AI Pricing — Build apps with AI</h1>
<p>Start free, no credit card required. Credits never expire, and the more you buy, the cheaper each credit gets.</p>
<h2>Credit packages</h2>
<ul>
<li><strong>160 credits</strong> — €20 (€0.125/credit)</li>
<li><strong>250 credits</strong> — €37 (€0.148/credit)</li>
<li><strong>500 credits</strong> — €70 (€0.140/credit) — 20% bonus</li>
<li><strong>1,250 credits</strong> — €162 (€0.130/credit)</li>
<li><strong>3,000 credits</strong> — €360 (€0.120/credit) — 20% bonus</li>
<li><strong>6,000 credits</strong> — €660 (€0.110/credit) — 20% bonus</li>
</ul>
<h2>What can you build with credits?</h2>
<p>A typical app costs 3-10 credits depending on complexity. With 65 free credits you can build 6-20 complete apps.</p>
<h2>Compared to competitors</h2>
<ul>
<li>Emergent: $20/month for 100 credits that EXPIRE monthly — Maris AI credits never expire</li>
<li>Bolt.new: $20/month subscription — Maris AI has no monthly subscription</li>
<li>Lovable: Requires Supabase — Maris AI includes backend for free</li>
</ul>
${CROSS_LINKS_EN}`
  },
  {
    path: "/en/showcase",
    file: "en/showcase/index.html",
    title: "Apps Built with AI — Real Examples | Maris AI",
    description: "Discover real web apps built by entrepreneurs using Maris AI. CRMs, online stores, dashboards, booking apps — all created with AI, no coding.",
    canonical: "https://www.marisai.es/en/showcase",
    body: `<h1>Real apps built with Maris AI</h1>
<p>Explore apps created by real entrepreneurs using Maris AI's 9 AI agents. No coding required — from idea to working app in minutes.</p>
<h2>What kind of apps do people build?</h2>
<ul>
<li>Customer management systems (CRM)</li>
<li>Online stores with payment integration</li>
<li>Booking and appointment platforms</li>
<li>Analytics dashboards</li>
<li>Educational platforms</li>
<li>Restaurant management systems</li>
<li>Professional portfolios</li>
<li>SaaS products with subscriptions</li>
</ul>
<p><a href="/sign-up">Start building your app for free →</a></p>
${CROSS_LINKS_EN}`
  },
  {
    path: "/en/vs-bolt",
    file: "en/vs-bolt/index.html",
    title: "Maris AI vs Bolt.new — Complete Comparison 2026",
    description: "Compare Maris AI and Bolt.new. Backend included, credits that never expire, transparent pricing. See why entrepreneurs choose Maris AI.",
    canonical: "https://www.marisai.es/en/vs-bolt",
    body: `<h1>Maris AI vs Bolt.new — Which is better in 2026?</h1>
<p>Both platforms let you build apps with AI, but they differ in important ways.</p>
<h2>Key differences</h2>
<dl>
<dt>Backend</dt><dd>Maris AI includes Express + MongoDB backend automatically. Bolt.new generates frontend only — you need to set up your own backend.</dd>
<dt>Pricing model</dt><dd>Maris AI uses credits that never expire. Bolt.new charges a monthly subscription — unused credits are lost.</dd>
<dt>Cost per app</dt><dd>Maris AI: €0.11-0.13 per credit, apps cost 3-10 credits. Bolt.new: $20/month subscription regardless of usage.</dd>
<dt>Code ownership</dt><dd>Both let you export code. Maris AI exports to GitHub with one click.</dd>
<dt>AI agents</dt><dd>Maris AI uses 11 specialized agents (Researcher, Architect, Designer, Frontend, Backend, API Integrator, QA, Testing, PM, Image, Visual Evaluator). Bolt.new uses a single AI model.</dd>
</dl>
<h2>When to choose Maris AI</h2>
<ul>
<li>You need a complete app with backend and database</li>
<li>You don't want a monthly subscription</li>
<li>You want credits that never expire</li>
<li>You want multiple AI agents working in parallel</li>
</ul>
<nav><a href="/en/vs-lovable">Maris AI vs Lovable</a> | <a href="/en/vs-emergent">Maris AI vs Emergent</a> | <a href="/en/pricing">See pricing</a></nav>
${CROSS_LINKS_EN}`
  },
  {
    path: "/en/vs-lovable",
    file: "en/vs-lovable/index.html",
    title: "Maris AI vs Lovable — Complete Comparison 2026",
    description: "Compare Maris AI and Lovable. No Supabase dependency, credits that never expire, included backend. Full comparison for entrepreneurs.",
    canonical: "https://www.marisai.es/en/vs-lovable",
    body: `<h1>Maris AI vs Lovable — Which is better in 2026?</h1>
<p>Both are AI app builders, but they take different approaches to backend, pricing, and code ownership.</p>
<h2>Key differences</h2>
<dl>
<dt>Backend dependency</dt><dd>Lovable requires Supabase for any backend functionality. Maris AI includes Express + MongoDB — no third-party dependency.</dd>
<dt>Pricing</dt><dd>Lovable: $20/month subscription. Maris AI: pay-per-use credits that never expire, starting at €20 for 160 credits.</dd>
<dt>Credit expiration</dt><dd>Lovable credits reset monthly. Maris AI credits never expire.</dd>
<dt>AI architecture</dt><dd>Lovable uses a single model. Maris AI uses 11 specialized agents for different aspects of app development.</dd>
</dl>
<nav><a href="/en/vs-bolt">Maris AI vs Bolt.new</a> | <a href="/en/vs-emergent">Maris AI vs Emergent</a> | <a href="/en/pricing">See pricing</a></nav>
${CROSS_LINKS_EN}`
  },
  {
    path: "/en/vs-emergent",
    file: "en/vs-emergent/index.html",
    title: "Maris AI vs Emergent — Complete Comparison 2026",
    description: "Compare Maris AI and Emergent.sh. Transparent credit costs, credits that never expire, real backend included. Honest comparison.",
    canonical: "https://www.marisai.es/en/vs-emergent",
    body: `<h1>Maris AI vs Emergent — Which is better in 2026?</h1>
<p>Emergent is the largest vibe coding platform. Maris AI is a focused alternative with transparent pricing and credits that never expire.</p>
<h2>Key differences</h2>
<dl>
<dt>Credit transparency</dt><dd>Emergent doesn't show credit costs upfront — users report surprise charges. Maris AI shows exact credit costs for every action.</dd>
<dt>Credit expiration</dt><dd>Emergent monthly credits expire every billing cycle. Maris AI credits never expire.</dd>
<dt>Pricing</dt><dd>Emergent: $20/month for 100 credits (expire). Maris AI: €20 one-time for 160 credits (never expire). Maris AI is 3.2x more credits per dollar.</dd>
<dt>Backend</dt><dd>Both generate full-stack apps. Emergent uses their managed infrastructure. Maris AI generates Express + MongoDB code you fully own.</dd>
<dt>Mobile apps</dt><dd>Emergent supports mobile app generation. Maris AI currently focuses on web apps.</dd>
</dl>
<h2>When to choose Maris AI over Emergent</h2>
<ul>
<li>You want credits that never expire</li>
<li>You want transparent, predictable pricing</li>
<li>You want to fully own and self-host your code</li>
<li>You prefer GDPR-compliant European infrastructure</li>
</ul>
<nav><a href="/en/vs-bolt">Maris AI vs Bolt.new</a> | <a href="/en/vs-lovable">Maris AI vs Lovable</a> | <a href="/en/pricing">See pricing</a></nav>
${CROSS_LINKS_EN}`
  },
  {
    path: "/en/sign-up",
    file: "en/sign-up/index.html",
    title: "Sign Up Free — Maris AI",
    description: "Create your Maris AI account and start building apps with AI. 65 free credits, no credit card required. Sign up in 30 seconds.",
    canonical: "https://www.marisai.es/en/sign-up",
    body: `<h1>Sign up free — Start building with AI</h1>
<p>Create your account and build your first app in minutes. No coding skills required.</p>
<h2>What you get</h2>
<ul>
<li><strong>65 free credits</strong> — enough to build your first complete app</li>
<li><strong>No credit card required</strong></li>
<li><strong>11 specialized AI agents</strong> — frontend, backend, database, QA, and more</li>
<li><strong>Code is 100% yours</strong> — export to GitHub anytime</li>
<li><strong>Credits never expire</strong></li>
</ul>
<p><a href="/sign-up">Create your free account now →</a></p>
${CROSS_LINKS_EN}`
  },
];

// ── Programmatic use-case pages (English) ────────────────────────────
// Emergent has /build/app-builder, /build/subscription-website-builder, etc.
// Each targets a different keyword cluster.

export const USE_CASE_ROUTES_EN = [
  {
    path: "/en/build/crm",
    file: "en/build/crm/index.html",
    title: "Build a CRM with AI — No Coding Required | Maris AI",
    description: "Create a complete CRM system with AI in minutes. Customer management, lead tracking, sales pipeline — all generated automatically by Maris AI.",
    canonical: "https://www.marisai.es/en/build/crm",
    body: `<h1>Build a CRM with AI — No coding required</h1>
<p>Describe your customer management needs and Maris AI generates a complete CRM with contacts, leads, deals pipeline, activity tracking, and reporting dashboards.</p>
<h2>What Maris AI generates for your CRM</h2>
<ul>
<li>Contact and company management with search and filters</li>
<li>Lead tracking and sales pipeline visualization</li>
<li>Activity logging (calls, emails, meetings)</li>
<li>Deal management with custom stages</li>
<li>Reporting dashboards with charts</li>
<li>User roles and permissions</li>
<li>REST API backend with MongoDB</li>
</ul>
<h2>How to build your CRM</h2>
<ol>
<li>Sign up for free at Maris AI (65 credits, no credit card)</li>
<li>Describe your CRM: "Build me a CRM with contact management, deal pipeline, and reporting dashboard"</li>
<li>9 AI agents generate your complete app in minutes</li>
<li>Customize, deploy, or export the code to GitHub</li>
</ol>
<p><a href="/sign-up">Start building your CRM for free →</a></p>
${CROSS_LINKS_EN}`
  },
  {
    path: "/en/build/online-store",
    file: "en/build/online-store/index.html",
    title: "Build an Online Store with AI — Stripe Payments Included | Maris AI",
    description: "Create a complete e-commerce store with AI. Product catalog, shopping cart, Stripe checkout, order management — generated in minutes.",
    canonical: "https://www.marisai.es/en/build/online-store",
    body: `<h1>Build an online store with AI — Stripe payments included</h1>
<p>Describe your store and Maris AI creates a complete e-commerce platform with product catalog, shopping cart, Stripe checkout, and order management.</p>
<h2>What you get</h2>
<ul>
<li>Product catalog with categories, images, and search</li>
<li>Shopping cart and checkout flow</li>
<li>Stripe payment integration</li>
<li>Order management dashboard</li>
<li>Customer accounts and order history</li>
<li>Inventory tracking</li>
<li>Mobile-responsive design</li>
</ul>
<p><a href="/sign-up">Start building your store for free →</a></p>
${CROSS_LINKS_EN}`
  },
  {
    path: "/en/build/booking-app",
    file: "en/build/booking-app/index.html",
    title: "Build a Booking App with AI — Appointments & Reservations | Maris AI",
    description: "Create a booking and appointment system with AI. Calendar, availability, confirmations, reminders — all generated automatically.",
    canonical: "https://www.marisai.es/en/build/booking-app",
    body: `<h1>Build a booking app with AI</h1>
<p>Describe your scheduling needs and Maris AI generates a complete booking system with calendar, availability management, confirmations, and customer management.</p>
<h2>Perfect for</h2>
<ul>
<li>Restaurants and cafes</li>
<li>Hair salons and beauty studios</li>
<li>Medical clinics and therapists</li>
<li>Fitness studios and personal trainers</li>
<li>Consultants and freelancers</li>
<li>Event spaces and venues</li>
</ul>
<p><a href="/sign-up">Start building your booking app for free →</a></p>
${CROSS_LINKS_EN}`
  },
  {
    path: "/en/build/saas",
    file: "en/build/saas/index.html",
    title: "Build a SaaS with AI — Subscriptions, Auth & Dashboard | Maris AI",
    description: "Create a complete SaaS application with AI. User authentication, subscription billing, admin dashboard, API — generated in minutes.",
    canonical: "https://www.marisai.es/en/build/saas",
    body: `<h1>Build a SaaS with AI — Complete platform in minutes</h1>
<p>Describe your SaaS idea and Maris AI generates the complete platform: user authentication, subscription billing, admin dashboard, and API.</p>
<h2>What Maris AI generates</h2>
<ul>
<li>User registration and authentication</li>
<li>Subscription plans with Stripe billing</li>
<li>Admin dashboard with analytics</li>
<li>User dashboard with settings</li>
<li>REST API with rate limiting</li>
<li>Role-based access control</li>
<li>MongoDB database with proper schema</li>
</ul>
<p><a href="/sign-up">Start building your SaaS for free →</a></p>
${CROSS_LINKS_EN}`
  },
  {
    path: "/en/build/dashboard",
    file: "en/build/dashboard/index.html",
    title: "Build a Dashboard with AI — Analytics & Charts | Maris AI",
    description: "Create analytics dashboards with AI. Charts, tables, KPIs, filters — connected to your data, generated automatically.",
    canonical: "https://www.marisai.es/en/build/dashboard",
    body: `<h1>Build an analytics dashboard with AI</h1>
<p>Describe your data and KPIs and Maris AI generates a complete dashboard with interactive charts, tables, filters, and real-time updates.</p>
<h2>Dashboard features</h2>
<ul>
<li>Interactive charts (line, bar, pie, area)</li>
<li>Data tables with sorting and filtering</li>
<li>KPI cards with trend indicators</li>
<li>Date range selectors</li>
<li>Export to CSV/PDF</li>
<li>Responsive design for mobile</li>
</ul>
<p><a href="/sign-up">Start building your dashboard for free →</a></p>
${CROSS_LINKS_EN}`
  },
  {
    path: "/en/build/portfolio",
    file: "en/build/portfolio/index.html",
    title: "Build a Portfolio Website with AI — Professional & Modern | Maris AI",
    description: "Create a professional portfolio website with AI. Showcase your work, skills, and experience with a modern, responsive design.",
    canonical: "https://www.marisai.es/en/build/portfolio",
    body: `<h1>Build a portfolio website with AI</h1>
<p>Describe your profession and projects and Maris AI creates a stunning portfolio site with project galleries, about section, contact form, and animations.</p>
<p><a href="/sign-up">Start building your portfolio for free →</a></p>
${CROSS_LINKS_EN}`
  },
];

// ── Programmatic use-case pages (Spanish) ────────────────────────────

export const USE_CASE_ROUTES_ES = [
  {
    path: "/crear/crm",
    file: "crear/crm/index.html",
    title: "Crear un CRM con IA — Sin Programar | Maris AI",
    description: "Crea un sistema CRM completo con inteligencia artificial en minutos. Gestión de clientes, seguimiento de ventas, dashboard — generado automáticamente.",
    canonical: "https://www.marisai.es/crear/crm",
    body: `<h1>Crear un CRM con inteligencia artificial — sin programar</h1>
<p>Describe lo que necesitas y Maris AI genera un CRM completo con gestión de contactos, pipeline de ventas, registro de actividades y dashboards de reporting.</p>
<h2>Qué genera Maris AI para tu CRM</h2>
<ul>
<li>Gestión de contactos y empresas con búsqueda y filtros</li>
<li>Pipeline de ventas visual con etapas personalizables</li>
<li>Registro de actividades (llamadas, emails, reuniones)</li>
<li>Dashboard de reporting con gráficos</li>
<li>Roles de usuario y permisos</li>
<li>API REST con MongoDB</li>
</ul>
<p><a href="/sign-up">Empieza a crear tu CRM gratis →</a></p>
${CROSS_LINKS_ES_BUILD}`
  },
  {
    path: "/crear/tienda-online",
    file: "crear/tienda-online/index.html",
    title: "Crear Tienda Online con IA — Pagos con Stripe | Maris AI",
    description: "Crea una tienda online completa con IA. Catálogo de productos, carrito, checkout con Stripe, gestión de pedidos — en minutos.",
    canonical: "https://www.marisai.es/crear/tienda-online",
    body: `<h1>Crear una tienda online con inteligencia artificial</h1>
<p>Describe tu tienda y Maris AI crea una plataforma de e-commerce completa con catálogo, carrito, checkout con Stripe y gestión de pedidos.</p>
<p><a href="/sign-up">Empieza a crear tu tienda gratis →</a></p>
${CROSS_LINKS_ES_BUILD}`
  },
  {
    path: "/crear/app-reservas",
    file: "crear/app-reservas/index.html",
    title: "Crear App de Reservas con IA — Citas y Agenda | Maris AI",
    description: "Crea un sistema de reservas y citas con IA. Calendario, disponibilidad, confirmaciones, recordatorios — todo generado automáticamente.",
    canonical: "https://www.marisai.es/crear/app-reservas",
    body: `<h1>Crear una app de reservas con inteligencia artificial</h1>
<p>Ideal para restaurantes, peluquerías, clínicas, gimnasios, consultores y freelancers. Describe tu negocio y Maris AI genera el sistema completo.</p>
<p><a href="/sign-up">Empieza a crear tu app de reservas gratis →</a></p>
${CROSS_LINKS_ES_BUILD}`
  },
  {
    path: "/crear/saas",
    file: "crear/saas/index.html",
    title: "Crear un SaaS con IA — Suscripciones y Dashboard | Maris AI",
    description: "Crea una aplicación SaaS completa con IA. Autenticación, suscripciones con Stripe, dashboard admin, API — generado en minutos.",
    canonical: "https://www.marisai.es/crear/saas",
    body: `<h1>Crear un SaaS con inteligencia artificial</h1>
<p>Describe tu idea de SaaS y Maris AI genera la plataforma completa: autenticación, planes de suscripción con Stripe, dashboard admin y API.</p>
<p><a href="/sign-up">Empieza a crear tu SaaS gratis →</a></p>
${CROSS_LINKS_ES_BUILD}`
  },
  {
    path: "/crear/dashboard",
    file: "crear/dashboard/index.html",
    title: "Crear Dashboard con IA — Analítica y Gráficos | Maris AI",
    description: "Crea dashboards de analítica con IA. Gráficos interactivos, tablas, KPIs, filtros — conectado a tus datos, generado automáticamente.",
    canonical: "https://www.marisai.es/crear/dashboard",
    body: `<h1>Crear un dashboard de analítica con inteligencia artificial</h1>
<p>Describe tus datos y KPIs y Maris AI genera un dashboard completo con gráficos interactivos, tablas, filtros y actualización en tiempo real.</p>
<p><a href="/sign-up">Empieza a crear tu dashboard gratis →</a></p>
${CROSS_LINKS_ES_BUILD}`
  },
  {
    path: "/crear/portfolio",
    file: "crear/portfolio/index.html",
    title: "Crear Portfolio Web con IA — Profesional y Moderno | Maris AI",
    description: "Crea un portfolio web profesional con IA. Muestra tus proyectos, habilidades y experiencia con un diseño moderno y responsive.",
    canonical: "https://www.marisai.es/crear/portfolio",
    body: `<h1>Crear un portfolio web con inteligencia artificial</h1>
<p>Describe tu profesión y tus proyectos y Maris AI crea un portfolio impresionante con galería de proyectos, sección sobre ti, formulario de contacto y animaciones.</p>
<p><a href="/sign-up">Empieza a crear tu portfolio gratis →</a></p>
${CROSS_LINKS_ES_BUILD}`
  },
  {
    path: "/crear/landing-page",
    file: "crear/landing-page/index.html",
    title: "Crear Landing Page con IA — Conversión Optimizada | Maris AI",
    description: "Crea landing pages de alta conversión con IA. Hero, beneficios, testimonios, CTA, formulario — generado automáticamente en minutos.",
    canonical: "https://www.marisai.es/crear/landing-page",
    body: `<h1>Crear una landing page con inteligencia artificial</h1>
<p>Describe tu producto o servicio y Maris AI genera una landing page de alta conversión con hero section, beneficios, testimonios, pricing y formulario de contacto.</p>
<p><a href="/sign-up">Empieza a crear tu landing page gratis →</a></p>
${CROSS_LINKS_ES_BUILD}`
  },
  {
    path: "/crear/app-restaurante",
    file: "crear/app-restaurante/index.html",
    title: "Crear App para Restaurante con IA — Menú y Reservas | Maris AI",
    description: "Crea una app completa para tu restaurante con IA. Menú digital, sistema de reservas, pedidos online, gestión de mesas — en minutos.",
    canonical: "https://www.marisai.es/crear/app-restaurante",
    body: `<h1>Crear una app para restaurante con inteligencia artificial</h1>
<p>Describe tu restaurante y Maris AI genera una app completa con menú digital, sistema de reservas, pedidos online y gestión de mesas.</p>
<p><a href="/sign-up">Empieza a crear la app de tu restaurante gratis →</a></p>
${CROSS_LINKS_ES_BUILD}`
  },
];

// ── Hreflang mappings ────────────────────────────────────────────────

export const HREFLANG_MAP = {
  // ── Páginas en español: deben listar es (a sí misma), en (contraparte) y x-default ──
  "/": { es: "https://www.marisai.es/", en: "https://www.marisai.es/en", "x-default": "https://www.marisai.es/" },
  "/pricing": { es: "https://www.marisai.es/pricing", en: "https://www.marisai.es/en/pricing", "x-default": "https://www.marisai.es/pricing" },
  "/showcase": { es: "https://www.marisai.es/showcase", en: "https://www.marisai.es/en/showcase", "x-default": "https://www.marisai.es/showcase" },
  "/vs-emergent": { es: "https://www.marisai.es/vs-emergent", en: "https://www.marisai.es/en/vs-emergent", "x-default": "https://www.marisai.es/vs-emergent" },
  "/vs-lovable": { es: "https://www.marisai.es/vs-lovable", en: "https://www.marisai.es/en/vs-lovable", "x-default": "https://www.marisai.es/vs-lovable" },
  "/vs-bolt": { es: "https://www.marisai.es/vs-bolt", en: "https://www.marisai.es/en/vs-bolt", "x-default": "https://www.marisai.es/vs-bolt" },
  "/sign-up": { es: "https://www.marisai.es/sign-up", en: "https://www.marisai.es/en/sign-up", "x-default": "https://www.marisai.es/sign-up" },
  // ── Páginas en inglés: deben listar en (a sí misma), es (contraparte) y x-default ──
  "/en": { en: "https://www.marisai.es/en", es: "https://www.marisai.es/", "x-default": "https://www.marisai.es/" },
  "/en/pricing": { en: "https://www.marisai.es/en/pricing", es: "https://www.marisai.es/pricing", "x-default": "https://www.marisai.es/pricing" },
  "/en/showcase": { en: "https://www.marisai.es/en/showcase", es: "https://www.marisai.es/showcase", "x-default": "https://www.marisai.es/showcase" },
  "/en/vs-emergent": { en: "https://www.marisai.es/en/vs-emergent", es: "https://www.marisai.es/vs-emergent", "x-default": "https://www.marisai.es/vs-emergent" },
  "/en/vs-lovable": { en: "https://www.marisai.es/en/vs-lovable", es: "https://www.marisai.es/vs-lovable", "x-default": "https://www.marisai.es/vs-lovable" },
  "/en/vs-bolt": { en: "https://www.marisai.es/en/vs-bolt", es: "https://www.marisai.es/vs-bolt", "x-default": "https://www.marisai.es/vs-bolt" },
  "/en/sign-up": { en: "https://www.marisai.es/en/sign-up", es: "https://www.marisai.es/sign-up", "x-default": "https://www.marisai.es/sign-up" },
};
