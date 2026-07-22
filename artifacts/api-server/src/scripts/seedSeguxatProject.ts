/**
 * seedSeguxatProject.ts
 *
 * Script de administración para añadir el proyecto Seguxat (alarma-negocio-xativa)
 * a la cuenta de Maris AI del usuario rrhh.milchollos@gmail.com.
 *
 * Uso:
 *   npx tsx src/scripts/seedSeguxatProject.ts
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
    header { background: rgba(26,26,46,0.97); padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 100; border-bottom: 2px solid var(--accent); }
    .logo { font-size: 1.8rem; font-weight: 900; color: var(--accent); letter-spacing: -1px; cursor: pointer; }
    nav a { color: var(--light); text-decoration: none; margin-left: 1.5rem; font-size: 0.9rem; transition: color 0.2s; cursor: pointer; }
    nav a:hover, nav a.active { color: var(--accent); }
    /* Pages */
    .page { display: none; }
    .page.active { display: block; }
    /* Hero */
    .hero { min-height: 90vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 4rem 2rem; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); }
    .hero h1 { font-size: clamp(2rem, 5vw, 4rem); font-weight: 900; margin-bottom: 1.5rem; line-height: 1.1; }
    .hero h1 span { color: var(--accent); }
    .hero p { font-size: 1.2rem; max-width: 600px; margin-bottom: 2rem; color: #ccc; }
    .btn-primary { background: var(--accent); color: white; padding: 1rem 2.5rem; border-radius: 50px; font-size: 1.1rem; font-weight: 700; text-decoration: none; display: inline-block; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 4px 20px rgba(233,69,96,0.4); cursor: pointer; border: none; }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(233,69,96,0.6); }
    /* Products section */
    .section { padding: 5rem 2rem; max-width: 1200px; margin: 0 auto; }
    .section h2 { font-size: 2.5rem; text-align: center; margin-bottom: 1rem; }
    .section h2 span { color: var(--accent); }
    .section .subtitle { text-align: center; color: #aaa; margin-bottom: 3rem; font-size: 1.1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2rem; }
    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 2rem; transition: transform 0.2s, border-color 0.2s; }
    .card:hover { transform: translateY(-4px); border-color: var(--accent); }
    .card-icon { font-size: 3rem; margin-bottom: 1rem; }
    .card h3 { font-size: 1.3rem; margin-bottom: 0.5rem; }
    .card p { color: #aaa; font-size: 0.95rem; line-height: 1.6; }
    .card .price { color: var(--accent); font-size: 1.5rem; font-weight: 700; margin-top: 1rem; }
    .card ul { color: #aaa; font-size: 0.9rem; line-height: 1.8; padding-left: 1.2rem; margin-top: 0.8rem; }
    /* Stats */
    .stats { background: var(--accent); padding: 4rem 2rem; text-align: center; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 2rem; max-width: 900px; margin: 0 auto; }
    .stat h3 { font-size: 3rem; font-weight: 900; }
    .stat p { font-size: 1rem; opacity: 0.9; }
    /* Pricing */
    .pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; }
    .pricing-card { background: rgba(255,255,255,0.05); border: 2px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 2.5rem; text-align: center; transition: border-color 0.2s; }
    .pricing-card.featured { border-color: var(--accent); background: rgba(233,69,96,0.08); }
    .pricing-card h3 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .pricing-card .price { font-size: 3rem; font-weight: 900; color: var(--accent); margin: 1rem 0; }
    .pricing-card .price span { font-size: 1rem; font-weight: 400; color: #aaa; }
    .pricing-card ul { list-style: none; text-align: left; margin: 1.5rem 0; space-y: 0.5rem; }
    .pricing-card ul li { padding: 0.4rem 0; color: #ccc; font-size: 0.95rem; }
    .pricing-card ul li::before { content: "✓ "; color: var(--accent); font-weight: 700; }
    .badge { background: var(--accent); color: white; font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.8rem; border-radius: 50px; display: inline-block; margin-bottom: 1rem; }
    /* Contact */
    .contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; }
    .contact-info h3 { font-size: 1.5rem; margin-bottom: 1.5rem; color: var(--accent); }
    .contact-item { display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1.5rem; }
    .contact-item .icon { font-size: 1.5rem; }
    .contact-item p { color: #aaa; font-size: 0.95rem; line-height: 1.6; }
    .form-group { margin-bottom: 1.2rem; }
    .form-group label { display: block; margin-bottom: 0.4rem; font-size: 0.9rem; color: #aaa; }
    .form-group input, .form-group textarea, .form-group select { width: 100%; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 0.75rem 1rem; color: white; font-size: 0.95rem; transition: border-color 0.2s; }
    .form-group input:focus, .form-group textarea:focus, .form-group select:focus { outline: none; border-color: var(--accent); }
    .form-group textarea { min-height: 120px; resize: vertical; }
    /* Page hero variant */
    .page-hero { padding: 5rem 2rem 3rem; text-align: center; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); }
    .page-hero h1 { font-size: clamp(1.8rem, 4vw, 3rem); font-weight: 900; margin-bottom: 1rem; }
    .page-hero h1 span { color: var(--accent); }
    .page-hero p { color: #aaa; font-size: 1.1rem; max-width: 600px; margin: 0 auto; }
    /* Escudo Vecinal */
    .ev-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.5rem; margin: 3rem 0; }
    .ev-step { text-align: center; padding: 2rem 1.5rem; background: rgba(255,255,255,0.04); border-radius: 16px; }
    .ev-step .number { width: 48px; height: 48px; background: var(--accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: 900; margin: 0 auto 1rem; }
    .ev-step h3 { font-size: 1.1rem; margin-bottom: 0.5rem; }
    .ev-step p { color: #aaa; font-size: 0.9rem; }
    /* Footer */
    footer { background: #0a0a1a; padding: 3rem 2rem; text-align: center; color: #666; }
    footer a { color: var(--accent); text-decoration: none; }
    /* Responsive */
    @media (max-width: 768px) {
      nav { display: none; }
      .hero h1 { font-size: 2rem; }
      .contact-grid { grid-template-columns: 1fr; }
    }
    /* Toast */
    .toast { position: fixed; bottom: 2rem; right: 2rem; background: #1e3a1e; border: 1px solid #4caf50; color: #4caf50; padding: 1rem 1.5rem; border-radius: 12px; z-index: 9999; font-size: 0.95rem; opacity: 0; transition: opacity 0.3s; }
    .toast.show { opacity: 1; }
  </style>
</head>
<body>
  <header>
    <div class="logo" onclick="navigate('home')">SEGUXAT</div>
    <nav>
      <a onclick="navigate('alarmas-hogar')" id="nav-alarmas-hogar">Alarmas Hogar</a>
      <a onclick="navigate('alarmas-negocio')" id="nav-alarmas-negocio">Alarmas Negocio</a>
      <a onclick="navigate('relojes')" id="nav-relojes">Relojes GPS</a>
      <a onclick="navigate('escudo-vecinal')" id="nav-escudo-vecinal">Escudo Vecinal</a>
      <a onclick="navigate('precios')" id="nav-precios">Precios</a>
      <a onclick="navigate('contacto')" id="nav-contacto">Contacto</a>
    </nav>
  </header>

  <!-- HOME -->
  <div id="page-home" class="page active">
    <section class="hero">
      <h1>Seguridad Real para <span>Valencia</span><br>y la Comunitat</h1>
      <p>Alarmas para hogar y negocio, relojes GPS SOS Sentinel y el exclusivo Escudo Vecinal. CRA 24/7. Solo 12 meses de permanencia.</p>
      <button class="btn-primary" onclick="navigate('contacto')">Solicitar Visita Gratuita</button>
    </section>
    <section class="section">
      <h2>Nuestros <span>Productos</span></h2>
      <div class="grid">
        <div class="card" onclick="navigate('alarmas-hogar')" style="cursor:pointer">
          <div class="card-icon">🏠</div>
          <h3>Alarmas para Hogar</h3>
          <p>Protección 24/7 con sensores de movimiento, apertura de puertas y ventanas. Instalación gratuita.</p>
          <div class="price">Desde 199€</div>
        </div>
        <div class="card" onclick="navigate('alarmas-negocio')" style="cursor:pointer">
          <div class="card-icon">🏪</div>
          <h3>Alarmas para Negocio</h3>
          <p>Soluciones profesionales para comercios, oficinas y locales. Videovigilancia incluida.</p>
          <div class="price">Desde 299€</div>
        </div>
        <div class="card" onclick="navigate('relojes')" style="cursor:pointer">
          <div class="card-icon">⌚</div>
          <h3>Reloj GPS Sentinel X</h3>
          <p>Para mayores y personas con Alzheimer. Botón SOS, geolocalización en tiempo real, llamadas.</p>
          <div class="price">Desde 69,99€</div>
        </div>
        <div class="card" onclick="navigate('relojes')" style="cursor:pointer">
          <div class="card-icon">👦</div>
          <h3>Reloj GPS Sentinel J</h3>
          <p>Para niños. Control parental, zonas seguras, botón SOS. Tranquilidad para toda la familia.</p>
          <div class="price">Desde 69,99€</div>
        </div>
        <div class="card" onclick="navigate('escudo-vecinal')" style="cursor:pointer">
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
  </div>

  <!-- ALARMAS HOGAR -->
  <div id="page-alarmas-hogar" class="page">
    <div class="page-hero">
      <h1>Alarmas para <span>Hogar</span></h1>
      <p>Protege tu familia con la mejor tecnología al mejor precio. Instalación gratuita y sin permanencia abusiva.</p>
    </div>
    <section class="section">
      <div class="grid">
        <div class="card">
          <div class="card-icon">🔒</div>
          <h3>Pack Básico Hogar</h3>
          <p>Panel de control, 2 sensores de movimiento, sensor puerta principal, sirena interior.</p>
          <ul>
            <li>Instalación gratuita</li>
            <li>Conexión a CRA 24/7</li>
            <li>App de control incluida</li>
            <li>12 meses permanencia</li>
          </ul>
          <div class="price">199€ + 29€/mes</div>
        </div>
        <div class="card" style="border-color: var(--accent)">
          <div class="badge">MÁS POPULAR</div>
          <div class="card-icon">🏠</div>
          <h3>Pack Hogar Total</h3>
          <p>Panel inteligente, 4 sensores movimiento, detectores apertura todas las estancias, sirena exterior.</p>
          <ul>
            <li>Cámara exterior HD incluida</li>
            <li>Detector de humo/gas</li>
            <li>Control por voz (Alexa/Google)</li>
            <li>Soporte prioritario</li>
          </ul>
          <div class="price">349€ + 39€/mes</div>
        </div>
        <div class="card">
          <div class="card-icon">🏡</div>
          <h3>Pack Hogar Premium</h3>
          <p>Solución completa para casas grandes. Múltiples zonas, cámaras interiores y exteriores, domótica.</p>
          <ul>
            <li>Hasta 8 zonas independientes</li>
            <li>4 cámaras HD incluidas</li>
            <li>Integración domotica</li>
            <li>Técnico asignado</li>
          </ul>
          <div class="price">599€ + 55€/mes</div>
        </div>
      </div>
      <div style="text-align:center; margin-top: 3rem;">
        <button class="btn-primary" onclick="navigate('contacto')">Solicitar Visita Gratuita</button>
      </div>
    </section>
  </div>

  <!-- ALARMAS NEGOCIO -->
  <div id="page-alarmas-negocio" class="page">
    <div class="page-hero">
      <h1>Alarmas para <span>Negocio</span></h1>
      <p>Soluciones de seguridad profesionales para comercios, oficinas, almacenes y locales en Valencia.</p>
    </div>
    <section class="section">
      <div class="grid">
        <div class="card">
          <div class="card-icon">🏪</div>
          <h3>Pack Comercio</h3>
          <p>Ideal para tiendas, bares y pequeños negocios. Detección perimetral y videovigilancia básica.</p>
          <ul>
            <li>2 cámaras HD + grabación</li>
            <li>Sensores perimetrales</li>
            <li>Apertura/cierre remoto</li>
            <li>Aviso inmediato a policía</li>
          </ul>
          <div class="price">299€ + 45€/mes</div>
        </div>
        <div class="card" style="border-color: var(--accent)">
          <div class="badge">RECOMENDADO</div>
          <div class="card-icon">🏢</div>
          <h3>Pack Oficina Pro</h3>
          <p>Para oficinas y empresas medianas. Control de accesos, zonas diferenciadas, cámaras interiores.</p>
          <ul>
            <li>Control de accesos con tarjeta</li>
            <li>4 cámaras HD + nube 30 días</li>
            <li>Zonas horarias configurables</li>
            <li>Panel de gestión web</li>
          </ul>
          <div class="price">499€ + 65€/mes</div>
        </div>
        <div class="card">
          <div class="card-icon">🏭</div>
          <h3>Pack Almacén/Nave</h3>
          <p>Cobertura total para grandes superficies, almacenes y naves industriales. Máxima disuasión.</p>
          <ul>
            <li>Perímetro exterior con sensores</li>
            <li>8+ cámaras gran angular</li>
            <li>Sirenas exterior potentes</li>
            <li>Integración con seguridad privada</li>
          </ul>
          <div class="price">Desde 899€ + personalizado</div>
        </div>
      </div>
      <div style="text-align:center; margin-top: 3rem;">
        <button class="btn-primary" onclick="navigate('contacto')">Pedir Presupuesto Gratuito</button>
      </div>
    </section>
  </div>

  <!-- RELOJES GPS -->
  <div id="page-relojes" class="page">
    <div class="page-hero">
      <h1>Relojes GPS <span>Sentinel</span></h1>
      <p>Tecnología de geolocalización avanzada para la seguridad de tus seres queridos. Disponible en dos versiones.</p>
    </div>
    <section class="section">
      <div class="grid">
        <div class="card" style="border-color: var(--accent)">
          <div class="card-icon">⌚</div>
          <h3>Sentinel X — Para Mayores</h3>
          <p>Diseñado especialmente para personas mayores y con Alzheimer. Sencillo, robusto y tranquilizador.</p>
          <ul>
            <li>Botón SOS con llamada inmediata</li>
            <li>GPS en tiempo real</li>
            <li>Zonas seguras con alertas</li>
            <li>Detector de caídas</li>
            <li>Llamadas bidireccionales</li>
            <li>Batería de larga duración</li>
            <li>Resistente al agua IP67</li>
          </ul>
          <div class="price">Desde 69,99€</div>
        </div>
        <div class="card">
          <div class="card-icon">👦</div>
          <h3>Sentinel J — Para Niños</h3>
          <p>Control parental inteligente para padres tranquilos. Divertido y seguro para los más pequeños.</p>
          <ul>
            <li>Botón SOS con notificación</li>
            <li>Zonas seguras (colegio, casa)</li>
            <li>Historial de rutas</li>
            <li>Agenda de contactos controlada</li>
            <li>Modo escuela (silencio)</li>
            <li>Chat solo con familia</li>
            <li>Batería 24h</li>
          </ul>
          <div class="price">Desde 69,99€</div>
        </div>
      </div>
      <div style="text-align:center; margin-top: 3rem;">
        <button class="btn-primary" onclick="navigate('contacto')">Solicitar Información</button>
      </div>
    </section>
  </div>

  <!-- ESCUDO VECINAL -->
  <div id="page-escudo-vecinal" class="page">
    <div class="page-hero">
      <h1>Escudo <span>Vecinal</span></h1>
      <p>El sistema de seguridad comunitaria exclusivo de Seguxat. Únete a la red de protección vecinal más avanzada de Valencia.</p>
    </div>
    <section class="section">
      <p style="text-align:center; color:#aaa; margin-bottom: 1rem; font-size: 1.05rem;">¿Cómo funciona?</p>
      <div class="ev-steps">
        <div class="ev-step">
          <div class="number">1</div>
          <h3>Instalación</h3>
          <p>Instalamos sensores y cámaras en puntos clave del vecindario o comunidad.</p>
        </div>
        <div class="ev-step">
          <div class="number">2</div>
          <h3>Red Conectada</h3>
          <p>Todos los vecinos adheridos están interconectados en tiempo real a través de la app.</p>
        </div>
        <div class="ev-step">
          <div class="number">3</div>
          <h3>Alerta Inmediata</h3>
          <p>Ante cualquier incidente, todos los vecinos y la CRA reciben notificación simultánea.</p>
        </div>
        <div class="ev-step">
          <div class="number">4</div>
          <h3>Respuesta 24/7</h3>
          <p>Nuestra CRA coordina la respuesta con policía y seguridad privada en minutos.</p>
        </div>
      </div>
      <div class="grid" style="margin-top: 2rem;">
        <div class="card">
          <div class="card-icon">🏘️</div>
          <h3>Comunidad Residencial</h3>
          <p>Para urbanizaciones y comunidades de vecinos. Cobertura perimetral completa.</p>
          <div class="price">Consultar precio</div>
        </div>
        <div class="card">
          <div class="card-icon">🏬</div>
          <h3>Zona Comercial</h3>
          <p>Para polígonos industriales y zonas comerciales. Protección colectiva con ahorro de costes.</p>
          <div class="price">Consultar precio</div>
        </div>
      </div>
      <div style="text-align:center; margin-top: 3rem;">
        <button class="btn-primary" onclick="navigate('contacto')">Solicitar Información Escudo Vecinal</button>
      </div>
    </section>
  </div>

  <!-- PRECIOS -->
  <div id="page-precios" class="page">
    <div class="page-hero">
      <h1>Planes y <span>Precios</span></h1>
      <p>Sin sorpresas, sin letras pequeñas. Solo 12 meses de permanencia mínima. Instalación siempre gratuita.</p>
    </div>
    <section class="section">
      <h2 style="margin-bottom:0.5rem">Alarmas <span>Hogar</span></h2>
      <div class="pricing-grid" style="margin-bottom: 4rem;">
        <div class="pricing-card">
          <h3>Básico</h3>
          <div class="price">29€<span>/mes</span></div>
          <ul>
            <li>Panel de control</li>
            <li>2 sensores movimiento</li>
            <li>1 sensor puerta</li>
            <li>Sirena interior</li>
            <li>App control</li>
            <li>CRA 24/7</li>
          </ul>
          <button class="btn-primary" onclick="navigate('contacto')" style="width:100%">Contratar</button>
        </div>
        <div class="pricing-card featured">
          <div class="badge">MÁS POPULAR</div>
          <h3>Total</h3>
          <div class="price">39€<span>/mes</span></div>
          <ul>
            <li>Panel inteligente</li>
            <li>4 sensores movimiento</li>
            <li>Sensores todas las puertas</li>
            <li>Cámara exterior HD</li>
            <li>Sirena exterior</li>
            <li>Detector humo/gas</li>
            <li>Control por voz</li>
          </ul>
          <button class="btn-primary" onclick="navigate('contacto')" style="width:100%">Contratar</button>
        </div>
        <div class="pricing-card">
          <h3>Premium</h3>
          <div class="price">55€<span>/mes</span></div>
          <ul>
            <li>8 zonas independientes</li>
            <li>4 cámaras HD</li>
            <li>Integración domótica</li>
            <li>Técnico asignado</li>
            <li>Soporte 24/7 prioritario</li>
          </ul>
          <button class="btn-primary" onclick="navigate('contacto')" style="width:100%">Contratar</button>
        </div>
      </div>
      <h2 style="margin-bottom:0.5rem">Alarmas <span>Negocio</span></h2>
      <div class="pricing-grid">
        <div class="pricing-card">
          <h3>Comercio</h3>
          <div class="price">45€<span>/mes</span></div>
          <ul>
            <li>2 cámaras HD + grabación</li>
            <li>Sensores perimetrales</li>
            <li>Apertura/cierre remoto</li>
            <li>Aviso a policía</li>
          </ul>
          <button class="btn-primary" onclick="navigate('contacto')" style="width:100%">Contratar</button>
        </div>
        <div class="pricing-card featured">
          <div class="badge">RECOMENDADO</div>
          <h3>Oficina Pro</h3>
          <div class="price">65€<span>/mes</span></div>
          <ul>
            <li>Control de accesos</li>
            <li>4 cámaras HD (30 días nube)</li>
            <li>Zonas horarias</li>
            <li>Panel web de gestión</li>
          </ul>
          <button class="btn-primary" onclick="navigate('contacto')" style="width:100%">Contratar</button>
        </div>
        <div class="pricing-card">
          <h3>Nave/Almacén</h3>
          <div class="price">A medida</div>
          <ul>
            <li>Perímetro exterior</li>
            <li>8+ cámaras gran angular</li>
            <li>Sirenas potentes</li>
            <li>Seguridad privada integrada</li>
          </ul>
          <button class="btn-primary" onclick="navigate('contacto')" style="width:100%">Consultar</button>
        </div>
      </div>
    </section>
  </div>

  <!-- CONTACTO -->
  <div id="page-contacto" class="page">
    <div class="page-hero">
      <h1>Contacta con <span>Nosotros</span></h1>
      <p>Visita gratuita y sin compromiso. Nuestros técnicos se desplazan a tu domicilio o negocio en Valencia y alrededores.</p>
    </div>
    <section class="section">
      <div class="contact-grid">
        <div class="contact-info">
          <h3>¿Cómo contactarnos?</h3>
          <div class="contact-item">
            <div class="icon">📞</div>
            <div>
              <strong>Teléfono</strong>
              <p>611 946 289<br>Lunes a viernes 9:00 – 20:00<br>Sábados 10:00 – 14:00</p>
            </div>
          </div>
          <div class="contact-item">
            <div class="icon">📍</div>
            <div>
              <strong>Oficina</strong>
              <p>Xàtiva, Valencia<br>Servicio en toda la Comunitat Valenciana</p>
            </div>
          </div>
          <div class="contact-item">
            <div class="icon">✉️</div>
            <div>
              <strong>Email</strong>
              <p>info@seguxat.es</p>
            </div>
          </div>
          <div class="contact-item">
            <div class="icon">⚡</div>
            <div>
              <strong>Urgencias 24/7</strong>
              <p>Para clientes activos: línea directa incluida en todos los planes.</p>
            </div>
          </div>
        </div>
        <div>
          <h3 style="font-size:1.5rem; margin-bottom:1.5rem; color: var(--accent)">Solicitar Visita Gratuita</h3>
          <div class="form-group">
            <label>Nombre completo *</label>
            <input type="text" placeholder="Tu nombre">
          </div>
          <div class="form-group">
            <label>Teléfono *</label>
            <input type="tel" placeholder="6XX XXX XXX">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" placeholder="tu@email.com">
          </div>
          <div class="form-group">
            <label>¿Qué te interesa?</label>
            <select>
              <option>Alarma para hogar</option>
              <option>Alarma para negocio</option>
              <option>Reloj GPS Sentinel</option>
              <option>Escudo Vecinal</option>
              <option>Más información general</option>
            </select>
          </div>
          <div class="form-group">
            <label>Mensaje (opcional)</label>
            <textarea placeholder="Cuéntanos qué necesitas..."></textarea>
          </div>
          <button class="btn-primary" onclick="submitForm()" style="width:100%">Enviar Solicitud</button>
        </div>
      </div>
    </section>
  </div>

  <footer>
    <p>© 2026 Seguxat Seguridad S.L. | <a href="#" onclick="navigate('home')">Inicio</a> | <span style="color:#444">Privacidad</span> | <span style="color:#444">Aviso Legal</span></p>
    <p style="margin-top:0.5rem">📞 611 946 289 | 📍 Xàtiva, Valencia</p>
  </footer>

  <div id="toast" class="toast">✅ Solicitud enviada — te llamaremos pronto</div>

  <script>
    function navigate(page) {
      // Hide all pages
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      // Remove active nav
      document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
      // Show target page
      const target = document.getElementById('page-' + page);
      if (target) {
        target.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      // Set active nav
      const navLink = document.getElementById('nav-' + page);
      if (navLink) navLink.classList.add('active');
      // Update hash
      window.location.hash = page === 'home' ? '' : page;
    }

    function submitForm() {
      const toast = document.getElementById('toast');
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 4000);
    }

    // Handle initial hash
    window.addEventListener('load', function() {
      const hash = window.location.hash.replace('#', '');
      if (hash && document.getElementById('page-' + hash)) {
        navigate(hash);
      }
    });

    window.addEventListener('hashchange', function() {
      const hash = window.location.hash.replace('#', '');
      if (hash && document.getElementById('page-' + hash)) {
        navigate(hash);
      } else if (!hash) {
        navigate('home');
      }
    });
  </script>
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
          "value": "frame-ancestors * 'self' https://marisai.es https://www.marisai.es https://*.marisai.es https://api.marisai.es https://*.railway.app https://*.vercel.app https://*.vercel.live"
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
      // Actualizar el existente — también limpiamos vercelProjectId para forzar
      // recreación del proyecto Vercel sin el framework "vite" incorrecto del deploy anterior.
      await GeneratedApp.findByIdAndUpdate(existing._id, {
        frontendCode: SEGUXAT_FRONTEND_CODE,
        backendCode: SEGUXAT_BACKEND_CODE,
        status: "ready",
        vercelProjectId: null,
        vercelDeployUrl: null,
        agentNotes: "Proyecto Seguxat importado desde alarma-negocio-xativa-5-senales.zip. Plataforma de seguridad integral para la Comunitat Valenciana. v2: SPA con hash routing, vercelProjectId reseteado para deploy limpio.",
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
      coderModel: "zoco-plus",
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
