/**
 * Curated starter templates exposed via GET /api/templates. Each template is
 * a (kind + seed prompt) pair the user can click to bootstrap a new app.
 *
 * The kind drives the architect's INTENT directive (and the credit cost),
 * exactly the same way the kind tabs already do — templates are NOT a new
 * generation pipeline, they're just curated presets that pre-fill the
 * prompt textarea and select the right kind. The user can still edit the
 * prompt before submitting.
 *
 * The icon is a lucide-react icon name (string). The frontend maps it to a
 * concrete component in the templates gallery; sending strings keeps this
 * file framework-agnostic.
 */

/** Kept in sync with KIND_INTENTS / KIND_COSTS in routes/apps.ts. */
export type TemplateKind =
  | "fullstack"
  | "mobile"
  | "landing"
  | "game-2d"
  | "game-3d"
  | "hybrid-pwa";

export interface AppTemplate {
  id: string;
  name: string;
  description: string;
  kind: TemplateKind;
  seedPrompt: string;
  /** lucide-react icon name. */
  icon: string;
}

export const TEMPLATES: AppTemplate[] = [
  {
    id: "saas-dashboard",
    name: "Dashboard SaaS",
    description:
      "Panel de gestión con tablero, autenticación y métricas. Perfecto para arrancar una herramienta interna.",
    kind: "fullstack",
    icon: "LayoutDashboard",
    seedPrompt:
      "Un dashboard SaaS de gestión de tareas en equipo con tablero kanban (arrastrar y soltar tarjetas entre columnas Pendiente / En curso / Hecho), creación y edición de tareas con título, descripción, etiquetas y persona asignada, vista de equipo con avatares, panel de métricas con gráficos de tareas completadas por semana, y autenticación con email + contraseña. Diseño limpio, modo oscuro por defecto, paleta azul/morado.",
  },
  {
    id: "landing-saas",
    name: "Landing de producto",
    description:
      "Landing page de marketing de una sola página con hero, features, testimonios, pricing y CTA final.",
    kind: "landing",
    icon: "Rocket",
    seedPrompt:
      "Una landing page para una herramienta SaaS de productividad llamada FocusFlow. Hero con titular impactante y CTA, sección de 4 features con iconos, sección 'Cómo funciona' en 3 pasos, prueba social con 3 testimonios, pricing con 3 planes (gratis / pro / equipo), FAQ acordeón, y CTA final + footer. Estilo moderno, mucho espacio en blanco, gradientes suaves, paleta azul oscuro.",
  },
  {
    id: "tienda-online",
    name: "Tienda online",
    description:
      "E-commerce básico con catálogo, carrito, checkout y panel admin para gestionar productos.",
    kind: "fullstack",
    icon: "ShoppingBag",
    seedPrompt:
      "Una tienda online de ropa con catálogo de productos (foto, nombre, precio, stock), filtros por categoría y rango de precio, ficha de producto con galería y selector de talla, carrito persistente, checkout con datos de envío y método de pago (simulado), confirmación de pedido por email (simulado), panel admin para crear/editar/eliminar productos y ver pedidos. Diseño elegante, paleta beige/negro.",
  },
  {
    id: "habit-tracker",
    name: "App móvil de hábitos",
    description:
      "App mobile-first para seguir hábitos diarios con racha, calendario y recordatorios.",
    kind: "mobile",
    icon: "Smartphone",
    seedPrompt:
      "Una app móvil de seguimiento de hábitos diarios. Pantalla principal con la lista de hábitos del día, cada uno con su racha actual y un botón grande para marcar 'hecho'. Pantalla de calendario mensual con codificación de colores por hábito completado/parcial/no hecho. Pantalla de creación de hábito con nombre, icono, frecuencia (diario / X veces por semana) y horario de recordatorio. Estadísticas con gráfico de adherencia de las últimas 4 semanas. Diseño minimalista, modo oscuro, paleta verde menta.",
  },
  {
    id: "snake-2d",
    name: "Juego arcade 2D",
    description:
      "Juego tipo Snake en HTML5 Canvas con controles, dificultad creciente y tabla de records.",
    kind: "game-2d",
    icon: "Gamepad2",
    seedPrompt:
      "Un juego arcade tipo Snake en HTML5 Canvas. Controles WASD y flechas, la serpiente come comida que aparece en posiciones aleatorias, crece y la velocidad aumenta cada 5 puntos. Pantalla de menú con título, instrucciones y botón 'Empezar'. Pantalla de game over con puntuación final, mejor record (en localStorage) y botón 'Reintentar'. HUD durante el juego con puntuación actual y record. Estética retro pixel art, paleta verde fosforescente sobre negro.",
  },
  {
    id: "phaser-platformer",
    name: "Plataformas 2D (Phaser)",
    description:
      "Juego de plataformas con física, sprites animados, enemigos y monedas usando Phaser 3.",
    kind: "game-2d",
    icon: "Joystick",
    seedPrompt:
      "Un juego de plataformas 2D usando Phaser 3 (paquete 'phaser' en npm) montado dentro de un componente React que crea la instancia Phaser.Game en useEffect y la destruye en cleanup. Una sola escena con: personaje principal con física Arcade (gravedad, salto, colisiones), 3 plataformas estáticas a distintas alturas, 5 monedas que se recogen al tocarlas (suman 10 puntos cada una), 1 enemigo que patrulla horizontalmente y mata al jugador al contacto (vuelve al menú), controles flechas para mover y barra espaciadora para saltar. HUD con puntuación arriba a la izquierda. Pantalla de menú con título 'Aventura Pixel' y botón 'Jugar'. Pantalla de game over con puntuación final y botón 'Reintentar'. Sprites generados con formas de colores planos (rectángulos y círculos creados con this.add.graphics) — no hace falta cargar assets externos. Paleta verde menta y rosa coral sobre fondo azul cielo.",
  },
  {
    id: "three-runner",
    name: "Runner 3D (Three.js)",
    description:
      "Juego 3D infinito tipo runner con cámara en tercera persona, obstáculos y monedas usando React Three Fiber.",
    kind: "game-3d",
    icon: "Box",
    seedPrompt:
      "Un juego 3D infinito tipo runner usando three + @react-three/fiber + @react-three/drei. Vista en tercera persona desde detrás del personaje (un cubo de color), que avanza automáticamente por un pasillo plano que se extiende al infinito. Controles: flecha izquierda y derecha para cambiar entre 3 carriles. El suelo es un PlaneGeometry con un patrón a cuadros (textura procedural). Aparecen obstáculos (cubos rojos) en posiciones aleatorias en uno de los 3 carriles cada cierto tiempo: si el jugador colisiona, game over. También aparecen monedas (esferas amarillas que rotan) que al recogerse suman 10 puntos. La velocidad aumenta gradualmente con el tiempo. Iluminación con ambientLight + directionalLight. HUD HTML superpuesto con puntuación actual y mejor record (localStorage). Pantalla de menú con título 'Cosmic Runner', controles explicados y botón 'Empezar'. Pantalla de game over con puntuación final y 'Reintentar'. Paleta espacial: fondo azul oscuro con estrellas, personaje cian fluorescente.",
  },
  {
    id: "kaplay-arcade",
    name: "Arcade rápido (Kaplay)",
    description:
      "Juego arcade 2D con sintaxis declarativa de Kaplay. Ideal para shooters y juegos sencillos con física simple.",
    kind: "game-2d",
    icon: "Cat",
    seedPrompt:
      "Un juego arcade 2D usando la librería 'kaplay' (npm install kaplay) montado dentro de un componente React. Inicializa kaplay() en useEffect apuntando a un <canvas ref={...}/>; en cleanup llama a destroyAll() y k.quit(). Mecánica: una nave triangular en la parte inferior controlada con flechas izquierda/derecha y barra espaciadora para disparar láseres hacia arriba. Enemigos cuadrados rojos descienden desde arriba en oleadas; al recibir un láser explotan (suman 10 puntos), si tocan al jugador o llegan abajo, game over. Cada 100 puntos sube la velocidad y la frecuencia de oleadas. Usa add([rect/circle/pos/area/body/...]) para entidades, onKeyPress/onKeyDown para input, onUpdate para lógica, onCollide para colisiones. HUD con score y record. Pantalla de menú y de game over con scenes ('menu', 'game', 'gameover') y go(). Estética neón retro: fondo negro, jugador cian, enemigos magenta, láseres amarillos.",
  },
  {
    id: "pixi-rain",
    name: "Catch Game (PixiJS)",
    description:
      "Juego de atrapar objetos que caen con renderizado WebGL de PixiJS. Cientos de partículas a 60 FPS sin esfuerzo.",
    kind: "game-2d",
    icon: "Zap",
    seedPrompt:
      "Un juego 2D de atrapar objetos usando la librería 'pixi.js' v8 (npm install pixi.js) — usa APIs actuales de v8, NO la sintaxis legacy v7. Componente React: en useEffect crea `const app = new PIXI.Application()` y luego `await app.init({ resizeTo: window, background: 0x1a0033, antialias: true })`; cuando esté listo inyecta `app.canvas` (en v8 es .canvas, no .view) en un <div ref>. En cleanup llama a `app.destroy(true, { children: true, texture: true })`. Mecánica: una cesta (PIXI.Graphics con .rect().fill()) en la parte inferior controlada con mousemove y flechas izquierda/derecha. Desde arriba caen tres tipos de objetos generados aleatoriamente cada ~500ms: estrellas amarillas (+10), gemas azules (+25) y bombas grises (-1 vida, empiezas con 3). Usa `app.ticker.add((ticker) => ...)` (v8 pasa Ticker, no delta number) para mover los objetos hacia abajo y detectar colisiones AABB con la cesta. Para los muchos objetos cayendo usa contenedores PIXI.Container normales (en v8 ParticleContainer cambió de API). HUD HTML superpuesto con score, vidas restantes y mejor record (localStorage). Pantallas de menú y game over como overlays React condicionales. Paleta cálida: fondo púrpura oscuro, cesta marrón, partículas brillantes.",
  },
  {
    id: "r3f-physics",
    name: "Demo física 3D (R3F + Rapier)",
    description:
      "Escena 3D interactiva con física realista usando React Three Fiber, drei y Rapier. Apila cajas, derríbalas, gana puntos.",
    kind: "game-3d",
    icon: "Atom",
    seedPrompt:
      "Un mini juego 3D de física usando 'three' + '@react-three/fiber' + '@react-three/drei' + '@react-three/rapier'. Escena con un suelo (RigidBody type='fixed' con CuboidCollider), una torre de 8 cajas apiladas (cada una RigidBody dinámico con masa) y una cámara orbital (OrbitControls de drei). El usuario hace clic en cualquier punto del suelo: aparece una bola roja (RigidBody dinámico con esfera) que se lanza desde la posición de la cámara hacia el punto clicado con applyImpulse. Cada caja que cae fuera de un radio de 5m del centro suma 10 puntos (detecta con onCollisionEnter del suelo + posición y). Iluminación: ambientLight + directionalLight con sombras (castShadow), Environment de drei con preset='city'. HUD HTML superpuesto con puntuación actual, número de cajas restantes y botón 'Reset' que reinicia la escena. Pantalla de bienvenida con título 'Knock Down' e instrucciones, botón 'Empezar'. Paleta industrial: cajas de madera, suelo de cemento, bola roja brillante.",
  },
  {
    id: "babylon-explorer",
    name: "Mundo 3D (Babylon.js)",
    description:
      "Mundo 3D explorable en primera persona con Babylon.js. WASD para moverte, ratón para mirar, recoge cristales.",
    kind: "game-3d",
    icon: "Globe",
    seedPrompt:
      "Un mundo 3D explorable en primera persona usando la librería '@babylonjs/core' (npm install @babylonjs/core). Componente React que crea new BABYLON.Engine(canvas, true) y new BABYLON.Scene en useEffect; en cleanup llama a engine.dispose(). Cámara FreeCamera con controles WASD (camera.attachControl(canvas, true)) y ratón para mirar (PointerLock). Escena: un terreno plano (Ground) de 100x100 con textura procedural, 5 árboles (cilindro marrón + esfera verde), 10 cristales flotantes (PolyhedronBuilder de tipo octaedro) en posiciones aleatorias que rotan continuamente con scene.onBeforeRenderObservable. Cuando el jugador se acerca a menos de 2m de un cristal, este desaparece (mesh.dispose()) y suma 50 puntos. Iluminación: HemisphericLight + DirectionalLight con shadowGenerator. Skybox con createDefaultSkybox. HUD HTML superpuesto con cristales recogidos, total restantes y mensaje '¡Has explorado todo!' al recoger los 10. Botón inicial 'Click para empezar' que activa pointerLock. Paleta natural: cielo azul, terreno verde, cristales púrpura brillante.",
  },
  {
    id: "notas-pwa",
    name: "App de notas (PWA)",
    description:
      "App instalable de notas con sincronización offline, etiquetas y búsqueda.",
    kind: "hybrid-pwa",
    icon: "Notebook",
    seedPrompt:
      "Una app instalable (PWA) de notas personales con funcionamiento offline. Lista de notas en una columna, editor de markdown a la derecha (en móvil se conmutan). Crear, editar y eliminar notas. Sistema de etiquetas (cada nota puede tener varias etiquetas de colores). Búsqueda por texto y filtro por etiqueta. Persistencia en IndexedDB para offline. Manifest + service worker para instalación. Bottom navigation en móvil con 3 secciones: Notas, Etiquetas, Ajustes. Modo oscuro por defecto, paleta amarillo papel sobre gris oscuro.",
  },
];
