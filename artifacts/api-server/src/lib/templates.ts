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
