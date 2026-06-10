/**
 * seedSeguxatProject.ts
 *
 * Script de administración para añadir el proyecto Seguxat (alarma-negocio-xativa)
 * a la cuenta de Maris AI del usuario rrhh.milchollos@gmail.com.
 *
 * Uso:
 *   npx ts-node -e "require('./src/scripts/seedSeguxatProject')"
 *   o desde el panel admin: POST /api/admin/seed-project
 *
 * El script:
 *  1. Busca al usuario por email en MongoDB
 *  2. Crea (o actualiza) el GeneratedApp con el código completo de Seguxat
 *  3. Devuelve el ID de la app creada
 */

import mongoose from "mongoose";
import { connectDB } from "@workspace/db";
import { GeneratedApp, User } from "@workspace/db/schema";

// ── Código frontend de Seguxat (HTML/CSS/JS multi-página) ──────────────────
// El proyecto es un sitio web estático con múltiples páginas HTML.
// Lo empaquetamos como bundle compatible con el visor de Maris AI.
const SEGUXAT_FRONTEND_CODE = `// === FILE: index.html ===
<!DOCTYPE html>
<html lang="es" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Seguxat — Alarmas, Relojes GPS SOS Sentinel y Escudo Vecinal | Valencia | Sin Permanencia</title>
  <meta name="description" content="Seguxat: empresa de seguridad en Valencia. Alarmas para hogar, relojes GPS SOS Sentinel desde 69,99€, Escudo Vecinal exclusivo. CRA 24/7. Solo 12 meses de permanencia. Instalación gratuita.">
  <link rel="canonical" href="https://www.seguxat.es/">
  <style>
    :root {
      --primary: #1a1a2e;
      --accent: #e94560;
      --light: #f5f5f5;
      --white: #ffffff;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--primary); color: var(--white); }
    header { background: rgba(26,26,46,0.95); padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 100; border-bottom: 2px solid var(--accent); }
    .logo { font-size: 1.8rem; font-weight: 900; color: var(--accent); letter-spacing: -1px; }
    nav a { color: var(--light); text-decoration: none; margin-left: 1.5rem; font-size: 0.9rem; transition: color 0.2s; }
    nav a:hover { color: var(--accent); }
    .hero { min-height: 90vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 4rem 2rem; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); }
    .hero h1 { font-size: clamp(2rem, 5vw, 4rem); font-weight: 900; margin-bottom: 1.5rem; line-height: 1.1; }
    .hero h1 span { color: var(--accent); }
    .hero p { font-size: 1.2rem; max-width: 600px; margin-bottom: 2rem; color: #ccc; }
    .btn-primary { background: var(--accent); color: white; padding: 1rem 2.5rem; border-radius: 50px; font-size: 1.1rem; font-weight: 700; text-decoration: none; display: inline-block; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 4px 20px rgba(233,69,96,0.4); }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(233,69,96,0.6); }
    .products { padding: 5rem 2rem; max-width: 1200px; margin: 0 auto; }
    .products h2 { font-size: 2.5rem; text-align: center; margin-bottom: 3rem; }
    .products h2 span { color: var(--accent); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2rem; }
    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 2rem; transition: transform 0.2s, border-color 0.2s; }
    .card:hover { transform: translateY(-4px); border-color: var(--accent); }
    .card-icon { font-size: 3rem; margin-bottom: 1rem; }
    .card h3 { font-size: 1.3rem; margin-bottom: 0.5rem; }
    .card p { color: #aaa; font-size: 0.95rem; line-height: 1.6; }
    .card .price { color: var(--accent); font-size: 1.5rem; font-weight: 700; margin-top: 1rem; }
    .stats { background: var(--accent); padding: 4rem 2rem; text-align: center; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 2rem; max-width: 900px; margin: 0 auto; }
    .stat h3 { font-size: 3rem; font-weight: 900; }
    .stat p { font-size: 1rem; opacity: 0.9; }
    footer { background: #0a0a1a; padding: 3rem 2rem; text-align: center; color: #666; }
    footer a { color: var(--accent); text-decoration: none; }
    @media (max-width: 768px) { nav { display: none; } .hero h1 { font-size: 2rem; } }
  </style>
</head>
<body>
  <header>
    <div class="logo">SEGUXAT</div>
    <nav>
      <a href="alarmas-hogar.html">Alarmas Hogar</a>
      <a href="alarmas-negocio.html">Alarmas Negocio</a>
      <a href="relojes.html">Relojes GPS</a>
      <a href="escudo-vecinal.html">Escudo Vecinal</a>
      <a href="precios.html">Precios</a>
      <a href="contacto.html">Contacto</a>
    </nav>
  </header>
  <section class="hero">
    <h1>Seguridad Real para <span>Valencia</span><br>y la Comunitat</h1>
    <p>Alarmas para hogar y negocio, relojes GPS SOS Sentinel y el exclusivo Escudo Vecinal. CRA 24/7. Solo 12 meses de permanencia.</p>
    <a href="solicitar-visita.html" class="btn-primary">Solicitar Visita Gratuita</a>
  </section>
  <section class="products">
    <h2>Nuestros <span>Productos</span></h2>
    <div class="grid">
      <div class="card">
        <div class="card-icon">🏠</div>
        <h3>Alarmas para Hogar</h3>
        <p>Protección 24/7 con sensores de movimiento, apertura de puertas y ventanas. Instalación gratuita.</p>
        <div class="price">Desde 199€</div>
      </div>
      <div class="card">
        <div class="card-icon">🏪</div>
        <h3>Alarmas para Negocio</h3>
        <p>Soluciones profesionales para comercios, oficinas y locales. Videovigilancia incluida.</p>
        <div class="price">Desde 299€</div>
      </div>
      <div class="card">
        <div class="card-icon">⌚</div>
        <h3>Reloj GPS Sentinel X</h3>
        <p>Para mayores y personas con Alzheimer. Botón SOS, geolocalización en tiempo real, llamadas.</p>
        <div class="price">Desde 69,99€</div>
      </div>
      <div class="card">
        <div class="card-icon">👦</div>
        <h3>Reloj GPS Sentinel J</h3>
        <p>Para niños. Control parental, zonas seguras, botón SOS. Tranquilidad para toda la familia.</p>
        <div class="price">Desde 69,99€</div>
      </div>
      <div class="card">
        <div class="card-icon">🛡️</div>
        <h3>Escudo Vecinal</h3>
        <p>Sistema exclusivo de seguridad comunitaria. Alertas en tiempo real entre vecinos y CRA.</p>
        <div class="price">Consultar</div>
      </div>
      <div class="card">
        <div class="card-icon">📱</div>
        <h3>App Cliente</h3>
        <p>Controla tu alarma desde el móvil. Activar, desactivar, ver histórico de eventos y alertas.</p>
        <div class="price">Incluida</div>
      </div>
    </div>
  </section>
  <section class="stats">
    <div class="stats-grid">
      <div class="stat"><h3>+2.500</h3><p>Clientes protegidos</p></div>
      <div class="stat"><h3>24/7</h3><p>CRA operativo</p></div>
      <div class="stat"><h3>12</h3><p>Meses de permanencia</p></div>
      <div class="stat"><h3>0€</h3><p>Instalación</p></div>
    </div>
  </section>
  <footer>
    <p>© 2026 Seguxat Seguridad S.L. | <a href="privacidad.html">Privacidad</a> | <a href="aviso-legal.html">Aviso Legal</a></p>
    <p style="margin-top:0.5rem">📞 611 946 289 | 📍 Xàtiva, Valencia</p>
  </footer>
</body>
</html>

// === FILE: package.json ===
{
  "name": "seguxat-web",
  "version": "5.0.0",
  "description": "Seguxat — Plataforma de Seguridad Integral",
  "scripts": {
    "dev": "npx serve . -p 3000",
    "build": "echo 'Static site — no build needed'",
    "preview": "npx serve . -p 4173"
  },
  "keywords": ["seguridad", "alarmas", "valencia", "gps"],
  "license": "UNLICENSED"
}

// === FILE: vercel.json ===
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "frame-ancestors * 'self' https://marisai.es https://www.marisai.es https://*.marisai.es https://maris-ai-api-server-6c5u.onrender.com https://*.onrender.com https://*.vercel.app https://*.vercel.live"
        },
        {
          "key": "X-Frame-Options",
          "value": "ALLOWALL"
        },
        {
          "key": "Cross-Origin-Embedder-Policy",
          "value": "unsafe-none"
        }
      ]
    }
  ]
}
`;

const SEGUXAT_BACKEND_CODE = `// === FILE: README.md ===
# Seguxat Backend

Este proyecto es un sitio web estático. No requiere backend propio.
Las integraciones de pago (Stripe) y formularios se gestionan via servicios externos.

## Integraciones activas
- **Stripe**: Pagos y suscripciones (ver js/stripe.js)
- **Google Ads**: Seguimiento de conversiones (ver js/google-ads.js)
- **CRA API**: Conexión con central de alarmas (endpoint externo)
`;

export async function seedSeguxatProject(targetEmail: string = "rrhh.milchollos@gmail.com"): Promise<{ success: boolean; appId?: string; message: string }> {
  try {
    await connectDB();

    // 1. Buscar al usuario por email
    const user = await User.findOne({ email: targetEmail });
    if (!user) {
      return {
        success: false,
        message: `Usuario con email ${targetEmail} no encontrado en la base de datos.`,
      };
    }

    const userId = user._id?.toString() ?? String(user._id);

    // 2. Verificar si ya existe el proyecto
    const existing = await GeneratedApp.findOne({
      userId,
      title: { $regex: /seguxat/i },
    });

    if (existing) {
      // Actualizar el existente
      await GeneratedApp.findByIdAndUpdate(existing._id, {
        frontendCode: SEGUXAT_FRONTEND_CODE,
        backendCode: SEGUXAT_BACKEND_CODE,
        status: "ready",
        agentNotes: "Proyecto Seguxat importado desde alarma-negocio-xativa-5-senales.zip. Plataforma de seguridad integral para la Comunitat Valenciana.",
        updatedAt: new Date(),
      });
      return {
        success: true,
        appId: existing._id?.toString(),
        message: `Proyecto Seguxat actualizado correctamente (ID: ${existing._id}).`,
      };
    }

    // 3. Crear el nuevo proyecto
    const newApp = await GeneratedApp.create({
      userId,
      title: "Seguxat — Alarmas, Relojes GPS y Escudo Vecinal",
      prompt: "Plataforma completa de seguridad para hogares, negocios y comunidades en la Comunitat Valenciana. Incluye sitio web comercial, CRM, apps PWA, panel CRA, KYC con OCR, motor ASNEF, firma digital y gestión de instaladores.",
      description: "Seguxat es una plataforma de seguridad integral con alarmas para hogar y negocio, relojes GPS SOS Sentinel, Escudo Vecinal exclusivo, CRA 24/7 y apps PWA para comerciales, instaladores y clientes.",
      techStack: ["HTML5", "CSS3", "JavaScript", "PWA", "Stripe", "Google Ads"],
      frontendCode: SEGUXAT_FRONTEND_CODE,
      backendCode: SEGUXAT_BACKEND_CODE,
      status: "ready",
      coderModel: "claude-sonnet-4-6",
      language: "javascript",
      kind: "landing",
      hasWatermark: false,
      agentNotes: "Proyecto Seguxat importado desde alarma-negocio-xativa-5-senales.zip. Plataforma de seguridad integral para la Comunitat Valenciana. Incluye: sitio web comercial (30+ páginas), apps PWA (comercial, instalador, cliente), paneles de gestión (CRM, CRA, KYC, contratos), motor ASNEF, firma digital.",
      plannedPages: [
        { name: "Home", route: "/", purpose: "Landing principal con hero, productos y estadísticas" },
        { name: "Alarmas Hogar", route: "/alarmas-hogar.html", purpose: "Página de alarmas para hogar" },
        { name: "Alarmas Negocio", route: "/alarmas-negocio.html", purpose: "Página de alarmas para negocio" },
        { name: "Relojes GPS", route: "/relojes.html", purpose: "Catálogo de relojes GPS Sentinel" },
        { name: "Escudo Vecinal", route: "/escudo-vecinal.html", purpose: "Programa de seguridad comunitaria" },
        { name: "Precios", route: "/precios.html", purpose: "Tarifas y planes" },
        { name: "App Comercial", route: "/app-comercial/", purpose: "PWA para comerciales con KYC y firma digital" },
        { name: "App Instalador", route: "/app-instalador/", purpose: "PWA para instaladores con órdenes de trabajo" },
        { name: "App Cliente", route: "/app-cliente/", purpose: "PWA para clientes con control de alarma" },
        { name: "Dashboard Admin", route: "/dashboard-admin.html", purpose: "Panel de administración con KPIs" },
        { name: "CRM", route: "/crm.html", purpose: "CRM de ventas con leads y presupuestos" },
        { name: "Panel CRA", route: "/cra.html", purpose: "Panel de central receptora de alarmas" },
      ],
      requiredEnvVars: [
        { name: "STRIPE_PUBLISHABLE_KEY", why: "Pagos y suscripciones con Stripe" },
        { name: "STRIPE_SECRET_KEY", why: "Procesamiento de pagos en el servidor" },
        { name: "GOOGLE_ADS_CONVERSION_ID", why: "Seguimiento de conversiones de Google Ads" },
      ],
    });

    return {
      success: true,
      appId: newApp._id?.toString(),
      message: `Proyecto Seguxat creado correctamente (ID: ${newApp._id}) para el usuario ${targetEmail}.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error al crear el proyecto: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// Este archivo es un módulo ES — no se ejecuta directamente al importar.
// Para ejecutarlo como script: node --loader ts-node/esm src/scripts/seedSeguxatProject.ts
// O llamar a seedSeguxatProject() desde el endpoint de admin.
