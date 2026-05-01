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
