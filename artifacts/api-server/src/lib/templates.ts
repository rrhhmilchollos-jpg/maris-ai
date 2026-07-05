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

import { buildPlaybooksContextBlock } from "./integrationPlaybooks";

/** Kept in sync with KIND_INTENTS / KIND_COSTS in routes/apps.ts. */
export type TemplateKind =
  | "fullstack"
  | "mobile"
  | "landing"
  | "game-2d"
  | "game-3d"
  | "hybrid-pwa"
  | "vue"
  | "svelte"
  | "nextjs"
  | "python-api"
  | "django";

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
    id: "vue-todo",
    name: "Lista de tareas (Vue 3)",
    description:
      "App de tareas con Vue 3 Composition API, vue-router y Pinia. Filtros por estado y persistencia en localStorage.",
    kind: "vue",
    icon: "ListTodo",
    seedPrompt:
      "Una app de gestión de tareas con Vue 3 (Composition API + <script setup lang=\"ts\">), Vite y vue-router. Vista principal con input para crear tareas, lista de tareas con checkbox, texto y botón eliminar. Filtros tabbed: Todas / Activas / Completadas. Contador de tareas pendientes. Vista secundaria '/stats' (vue-router) con número total, completadas y porcentaje. Estado global con Pinia (store de tasks). Persistencia automática en localStorage al cambiar el store. Tailwind para estilos, paleta verde menta, modo claro/oscuro toggleable.",
  },
  {
    id: "svelte-weather",
    name: "Dashboard del tiempo (SvelteKit)",
    description:
      "Dashboard meteorológico con SvelteKit, Svelte 5 runes, fetch desde API pública y gráficos.",
    kind: "svelte",
    icon: "CloudSun",
    seedPrompt:
      "Un dashboard del tiempo con SvelteKit y Svelte 5 (usa runes: $state, $derived, $effect — NUNCA $: legacy). File-based routing en src/routes/: '/' muestra ciudad actual con temperatura grande, sensación térmica, humedad, viento e icono; '/forecast' muestra previsión a 7 días en cards; '/cities' permite buscar y guardar ciudades favoritas en localStorage. Datos desde Open-Meteo (https://api.open-meteo.com — no requiere API key) usando load() functions en +page.ts. Cambio de unidades °C/°F con un store global. Tailwind para estilos, paleta azul cielo / amarillo sol, modo oscuro automático según hora local.",
  },
  {
    id: "nextjs-blog",
    name: "Blog con CMS (Next.js)",
    description:
      "Blog full-stack con Next.js App Router, Server Components, API routes y persistencia en memoria/JSON.",
    kind: "nextjs",
    icon: "Newspaper",
    seedPrompt:
      "Un blog full-stack con Next.js 14+ App Router (NO Pages Router) y TypeScript. Estructura: app/layout.tsx con header (logo + nav Inicio/Admin) y footer; app/page.tsx (Server Component) lista los posts publicados con título, extracto y fecha; app/posts/[slug]/page.tsx renderiza un post completo (Server Component, getPost(slug) async); app/admin/page.tsx (Client Component, 'use client') con formulario para crear/editar/eliminar posts. API routes en app/api/posts/route.ts (GET lista, POST crea) y app/api/posts/[slug]/route.ts (GET uno, PUT edita, DELETE borra). Persistencia en un array module-level (con disclaimer en el README de que se reinicia al redeploy — para producción enchufar Postgres/SQLite). Tailwind para estilos, tipografía serif para los posts, paleta crema y burdeos.",
  },
  // ─── IA / ML ────────────────────────────────────────────────────────────
  // Las apps generadas a partir de estas plantillas asumen que el usuario
  // pondrá su propia API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.) y
  // su DATABASE_URL como variables de entorno en Vercel tras el deploy.
  // El seed prompt deja claro al architect que TODAS las llamadas al LLM
  // van por una /api/* del backend generado para no exponer la key en el
  // cliente. Persistencia: usamos Postgres (pg) en vez de SQLite/sqlite3
  // porque Vercel serverless tiene FS efímero + binarios nativos restringidos
  // — Vercel Postgres / Neon / Supabase son la opción canónica. Para
  // ficheros subidos por el usuario (audio, imágenes), usamos @vercel/blob.
  {
    id: "ai-chatbot",
    name: "Chatbot conversacional con IA",
    description:
      "Asistente conversacional con historial, streaming y soporte para múltiples sesiones. Backend Express + frontend React.",
    kind: "fullstack",
    icon: "MessagesSquare",
    seedPrompt:
      "Una app de chatbot conversacional full-stack: frontend React + backend Express compatible con deploy a Vercel serverless. UI tipo ChatGPT con sidebar de conversaciones (cada una con título auto-generado del primer mensaje), área central de mensajes (markdown renderizado, bloques de código resaltados), input al pie con envío con Enter (Shift+Enter = salto de línea), botón 'Nueva conversación' y botón 'Borrar'. El backend expone POST /api/chat que recibe {sessionId, messages:[{role,content}]} y hace streaming de la respuesta del modelo (Server-Sent Events). Usa la SDK oficial 'openai' (npm install openai) leyendo OPENAI_API_KEY de process.env — NUNCA expongas la key al cliente. Persistencia en Postgres usando 'pg' (npm install pg) leyendo DATABASE_URL de env (compatible con Vercel Postgres / Neon / Supabase) — NO uses sqlite/better-sqlite3 (no funciona en serverless). Tablas: sessions(id serial pk, title text, created_at timestamptz default now()) y messages(id serial pk, session_id int references sessions(id) on delete cascade, role text, content text, created_at timestamptz default now()). Crea las tablas en el arranque con CREATE TABLE IF NOT EXISTS. README claro con DATABASE_URL + OPENAI_API_KEY como env vars. Diseño limpio, modo oscuro por defecto, paleta morado/cian.",
  },
  {
    id: "ai-image-gen",
    name: "Generador de imágenes IA",
    description:
      "Estudio de generación de imágenes con prompts, historial, descarga y galería. Backend protege la API key.",
    kind: "fullstack",
    icon: "ImagePlay",
    seedPrompt:
      "Un estudio web de generación de imágenes con IA: frontend React + backend Express compatible con Vercel serverless. UI dividida: panel izquierdo con textarea para el prompt, selector de tamaño (1024×1024 / 1792×1024 / 1024×1792 — los soportados por dall-e-3), selector de cantidad (1-4 imágenes) y botón 'Generar' con loading state; panel central muestra las imágenes generadas en grid; panel derecho con historial scrolleable de generaciones previas (prompt + thumbnails). Cada imagen tiene botón 'Descargar' y 'Variar' (envía el mismo prompt). Backend POST /api/generate-image que llama a la SDK 'openai' usando images.generate con dall-e-3 (lee OPENAI_API_KEY de process.env, NUNCA en el cliente), devuelve las URLs. Persistencia en Postgres usando 'pg' (DATABASE_URL de env, compatible con Vercel Postgres / Neon / Supabase) — NO uses sqlite. Tabla: generations(id serial pk, prompt text, size text, urls jsonb, created_at timestamptz default now()). Para que las imágenes sigan accesibles después de 1h (las URLs de OpenAI expiran), descarga cada imagen al recibirla y súbela a Vercel Blob con '@vercel/blob' (npm install @vercel/blob, lee BLOB_READ_WRITE_TOKEN de env); guarda en BD la URL pública del blob, no la URL temporal de OpenAI. CREATE TABLE IF NOT EXISTS al arranque. README explica las 3 env vars: OPENAI_API_KEY, DATABASE_URL, BLOB_READ_WRITE_TOKEN. Estética estudio creativo: fondo gris muy oscuro, acentos magenta y cian, tipografía mono.",
  },
  {
    id: "ai-doc-summarizer",
    name: "Resumidor de PDFs",
    description:
      "Sube un PDF y obtén un resumen ejecutivo, puntos clave y un chat para hacer preguntas sobre el documento.",
    kind: "fullstack",
    icon: "FileText",
    seedPrompt:
      "Una app full-stack de análisis de documentos PDF con IA: frontend React + backend Express compatible con Vercel serverless. Flow: el usuario arrastra un PDF (o lo selecciona), se sube al backend (multer en memoria con storage: multer.memoryStorage(), hasta 10MB porque Vercel limita el body), el backend extrae texto con 'pdf-parse' (npm install pdf-parse) directamente del Buffer en memoria sin tocar el FS, recorta a ~12k tokens si excede (split por palabras), y envía el texto a la API de chat para generar (a) un resumen ejecutivo de 5-8 frases, (b) una lista de 5-10 puntos clave en bullets y (c) 5 preguntas sugeridas que se podrían hacer sobre el documento. Mostrar todo en cards. Debajo, un chat conversacional donde el usuario puede preguntar cualquier cosa sobre el PDF: el backend POST /api/chat recibe {docId, question, history} y reenvía al modelo con el texto del PDF como contexto en el system prompt. Sidebar con lista de PDFs subidos. Persistencia en Postgres usando 'pg' (DATABASE_URL de env, compatible con Vercel Postgres / Neon / Supabase) — NO uses sqlite. Tablas: docs(id serial pk, filename text, text text, summary jsonb, created_at timestamptz default now()) y messages(id serial pk, doc_id int references docs(id) on delete cascade, role text, content text, created_at timestamptz default now()). Click en un doc lo abre. Usa SDK 'openai' con OPENAI_API_KEY de env (jamás en cliente). CREATE TABLE IF NOT EXISTS al arranque. README con instrucciones para OPENAI_API_KEY + DATABASE_URL y nota sobre el límite de 10MB y de tokens. Diseño profesional: fondo blanco, acentos azul corporativo, tipografía serif para textos largos.",
  },
  {
    id: "ai-code-assistant",
    name: "Asistente de código",
    description:
      "Editor de código con explicación, refactor, generación de tests y traducción entre lenguajes vía IA.",
    kind: "fullstack",
    icon: "Brain",
    seedPrompt:
      "Una app full-stack de asistente de programación: frontend React + backend Express compatible con Vercel serverless. UI tipo IDE simplificado: editor de código grande con Monaco Editor (paquete '@monaco-editor/react') con selector de lenguaje (JS/TS/Python/Go/Rust/Java) y resaltado de sintaxis. Cuatro botones de acción sobre el código actual: 'Explicar' (muestra explicación paso a paso en panel lateral), 'Refactorizar' (sugiere mejoras y muestra diff aceptable), 'Generar tests' (escribe tests unitarios para el código), 'Traducir a…' (selector de lenguaje destino, devuelve la versión traducida en otro panel). Cada acción llama a su endpoint POST /api/explain | /api/refactor | /api/test | /api/translate del backend, que usa SDK 'openai' con OPENAI_API_KEY de env (NUNCA en cliente) y un system prompt específico para cada acción. Persistencia en Postgres usando 'pg' (DATABASE_URL de env, compatible con Vercel Postgres / Neon / Supabase) — NO uses sqlite. Tabla: actions(id serial pk, kind text, language text, input text, output text, created_at timestamptz default now()) accesible desde un drawer lateral con el historial reciente. CREATE TABLE IF NOT EXISTS al arranque. README con OPENAI_API_KEY + DATABASE_URL como env vars. Estética dev tools: fondo casi negro, monospace, acentos verde fluorescente.",
  },
  {
    id: "ai-voice-notes",
    name: "Notas de voz con transcripción",
    description:
      "App mobile-first para grabar notas de voz, transcribirlas con Whisper y resumirlas automáticamente.",
    kind: "fullstack",
    icon: "Mic",
    seedPrompt:
      "Una app full-stack mobile-first (layout vertical centrado, controles grandes, max-width 480px) de notas de voz con transcripción IA: frontend React + backend Express compatible con Vercel serverless. Pantalla principal con un botón gigante circular en el centro: pulsar para grabar (MediaRecorder API con mimeType 'audio/webm'), pulsar de nuevo para parar; mientras graba muestra forma de onda animada y temporizador. Al parar, sube el blob WebM al backend POST /api/transcribe (multer con storage: multer.memoryStorage(), hasta 10MB porque Vercel limita el body) que llama a OpenAI audio.transcriptions.create con model='whisper-1' usando la SDK 'openai' (OPENAI_API_KEY en env, NUNCA en cliente). Devuelve el texto transcrito. Después llama automáticamente a POST /api/summarize que pide al modelo un título corto (3-5 palabras), un resumen de 2 frases y 3 acciones extraídas. Lista inferior de notas previas con título, fecha y duración; tap abre el detalle (texto completo, resumen, acciones, botón reproducir audio original). Persistencia en Postgres usando 'pg' (DATABASE_URL de env, compatible con Vercel Postgres / Neon / Supabase) — NO uses sqlite. Tabla: notes(id serial pk, title text, summary text, actions jsonb, transcript text, audio_url text, duration_sec int, created_at timestamptz default now()). El audio se sube a Vercel Blob con '@vercel/blob' (npm install @vercel/blob, BLOB_READ_WRITE_TOKEN en env) y se guarda solo la URL pública en BD — NO uses /uploads local porque Vercel tiene FS efímero. CREATE TABLE IF NOT EXISTS al arranque. README explica las 3 env vars: OPENAI_API_KEY, DATABASE_URL, BLOB_READ_WRITE_TOKEN. Diseño calmado: fondo crema o gris claro, botón de grabación rojo coral, modo oscuro toggleable.",
  },
  // ─── Backends en Python ─────────────────────────────────────────────────
  // Plantillas que generan código Python puro (no JS). En la previsualización
  // del navegador el bundle muestra una tarjeta informativa con instrucciones
  // — para correrlo, exporta a ZIP / GitHub o despliega a Vercel (que tiene
  // runtime @vercel/python para FastAPI). Persistencia con SQLite local en
  // dev. La Maris UI las marca con coste 2 créditos.
  {
    id: "fastapi-todo",
    name: "API REST en Python (FastAPI)",
    description:
      "Backend FastAPI con CRUD completo, validación pydantic y SQLite. Listo para correr con uvicorn o desplegar a Vercel serverless.",
    kind: "python-api",
    icon: "Webhook",
    seedPrompt:
      "Una API REST de tareas (todo list) en Python 3.11+ usando FastAPI 0.115 + uvicorn + SQLAlchemy 2.0 + pydantic v2 + SQLite. Estructura mínima: archivo principal `main.py` que define `app = FastAPI(title='Todo API', version='1.0.0')`, modelos pydantic `TodoCreate`, `TodoUpdate`, `TodoOut` con type hints estrictos, modelo SQLAlchemy `Todo(id int pk, title str, done bool default False, created_at datetime default now)` con declarative_base + Session local, motor sqlite `app.db` y `Base.metadata.create_all(engine)` al arranque. Endpoints completos: GET /health → {status:'ok'}; GET /todos → lista todos los todos; POST /todos (TodoCreate) → 201 con TodoOut creado; GET /todos/{id} → TodoOut o 404; PUT /todos/{id} (TodoUpdate parcial) → TodoOut actualizado o 404; DELETE /todos/{id} → 204 o 404. Habilita CORSMiddleware con `allow_origins=['*']` para que cualquier frontend pueda probar. Genera obligatoriamente: `requirements.txt` con `fastapi==0.115.5`, `uvicorn[standard]==0.32.1`, `sqlalchemy==2.0.36`, `pydantic==2.10.3`; un `README.md` con instrucciones `pip install -r requirements.txt` + `uvicorn main:app --reload --port 8000` + ejemplo curl para cada endpoint + sección 'Deploy a Vercel' explicando que el usuario debe crear un `api/index.py` que reexporta `app` y un `vercel.json` con `@vercel/python` (Maris lo añade automáticamente al desplegar). NO incluyas frontend HTML/JS — esto es backend puro. Todos los archivos van como Python plano usando el marcador `// === FILE: nombre.py` con el contenido literal.",
  },
  {
    id: "django-blog",
    name: "Blog con Django",
    description:
      "Blog full-stack server-rendered con Django 5: modelos, vistas, plantillas, admin y SQLite. Estructura estándar `manage.py`.",
    kind: "django",
    icon: "Library",
    seedPrompt:
      "Un blog full-stack en Python 3.11+ con Django 5.1 server-rendered (NO React, NO Vite, NO Tailwind del CDN — esto es Django plantillas puras). Layout estándar con `manage.py`, paquete `mysite/` (settings.py, urls.py, wsgi.py, asgi.py) y app `blog/` (models.py, views.py, urls.py, admin.py, templates/blog/). Modelos: `Post(title CharField, slug SlugField unique, body TextField, author CharField, published_at DateTimeField default now, is_published BooleanField default False)`. Migraciones iniciales NO se generan (el README explica `python manage.py makemigrations blog` + `python manage.py migrate`). Vistas: lista de posts publicados ordenados por `-published_at` en `/`, detalle por slug en `/posts/<slug>/`. Plantillas: `templates/blog/base.html` con header (logo 'Mi Blog' + nav Inicio/Admin) + bloque {% block content %} + footer; `list.html` muestra cards con título, autor, extracto (primeras 200 chars del body) y enlace 'Leer más'; `detail.html` muestra post completo con título grande, meta autor+fecha y body con saltos de línea preservados. Admin de Django registrado en `admin.py` con `list_display=['title','author','published_at','is_published']` y `prepopulated_fields={'slug':('title',)}`. CSS minimalista embebido en base.html (paleta crema y burdeos, tipografía serif para textos, max-width 720px centrado). `settings.py` con `DEBUG=True`, `ALLOWED_HOSTS=['*']`, `SECRET_KEY='change-me-in-production'` con comentario claro, `DATABASES` default sqlite3 'db.sqlite3', `INSTALLED_APPS` incluyendo 'blog'. URL config raíz incluye admin y blog. Genera obligatoriamente: `requirements.txt` con `django==5.1.4`; `README.md` con `pip install -r requirements.txt`, `python manage.py migrate`, `python manage.py createsuperuser`, `python manage.py runserver 0.0.0.0:8000`. NO incluyas frontend JS aparte. Todos los archivos como Python/HTML planos usando `// === FILE: ruta/archivo.ext` con el contenido literal.",
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
  {
    id: "restaurante-reservas",
    name: "Restaurante con reservas",
    description:
      "Web de restaurante con menú, reserva de mesa online y panel de gestión para el dueño.",
    kind: "fullstack",
    icon: "UtensilsCrossed",
    seedPrompt:
      "Una web para un restaurante de cocina mediterránea llamado 'Casa Mar'. Página de inicio con hero a pantalla completa (foto de ambiente + horario + botón 'Reservar mesa'), sección de menú organizada por categorías (entrantes, principales, postres, bebidas) con precio y descripción de cada plato, sección 'Nuestra historia' con foto del chef, galería de fotos del local y los platos, mapa de ubicación y datos de contacto. Página de reserva con formulario (fecha, hora, número de comensales, nombre, teléfono, comentarios) que valida disponibilidad contra las mesas ya reservadas ese turno y muestra confirmación. Panel de administración protegido con login para el dueño: listado de reservas del día/semana ordenadas por hora con estado (pendiente/confirmada/cancelada), gestión de mesas (número de mesas y capacidad de cada una), edición del menú (añadir/editar/quitar platos y precios), y estadísticas básicas (reservas por día, ocupación media). Diseño cálido y elegante, tipografía serif para títulos, paleta burdeos y dorado sobre fondo crema, fotos grandes.",
  },
  {
    id: "restaurante-delivery",
    name: "Restaurante con pedidos a domicilio",
    description:
      "Comida rápida/delivery con carta, carrito, checkout y panel de cocina para gestionar pedidos.",
    kind: "fullstack",
    icon: "Utensils",
    seedPrompt:
      "Una web de pedidos a domicilio para una hamburguesería llamada 'Rush Burger'. Página principal con carta organizada por categorías (hamburguesas, acompañamientos, bebidas, postres), cada producto con foto, descripción, precio y opciones personalizables (punto de la carne, extras, sin ingrediente X) mediante un modal al hacer clic. Carrito lateral persistente que muestra los productos añadidos, cantidad editable, y total en tiempo real. Checkout con datos de entrega (dirección, teléfono, notas), selección de método de pago (efectivo o tarjeta simulada), y pantalla de confirmación con número de pedido y tiempo estimado. Panel de cocina protegido con login: cola de pedidos entrantes en tiempo real organizados por estado (nuevo → en preparación → listo → entregado), con botones para cambiar de estado, y un histórico de pedidos del día con el total facturado. Diseño desenfadado y directo, colores vivos (rojo/amarillo/negro), tipografía bold, mobile-first porque la mayoría pedirá desde el móvil.",
  },
  {
    id: "clinica-citas",
    name: "Clínica con citas online",
    description:
      "Web de clínica/consulta con especialidades, reserva de cita y panel de agenda para el profesional.",
    kind: "fullstack",
    icon: "Stethoscope",
    seedPrompt:
      "Una web para una clínica dental llamada 'Sonrisa Clara'. Página de inicio con hero (foto de la clínica + CTA 'Pedir cita'), sección de especialidades/servicios (ortodoncia, implantes, blanqueamiento, revisión general) cada una con icono, descripción breve y precio orientativo, sección de profesionales del equipo con foto, nombre y especialidad, sección de opiniones de pacientes, y mapa de ubicación con horario de apertura. Página de reserva de cita con formulario (servicio deseado, profesional preferido, fecha, franja horaria disponible calculada según la agenda real, nombre, teléfono, email, si es primera visita) que confirma por pantalla y (simulado) por email. Panel de gestión protegido con login para el profesional: agenda semanal en formato calendario con las citas del día, ficha básica de cada paciente (nombre, teléfono, historial de citas pasadas), posibilidad de confirmar/cancelar/reprogramar citas, y bloqueo de horas no disponibles (vacaciones, comida). Diseño limpio y confiable, tonos azul/blanco/verde menta, mucho espacio en blanco, tipografía sans-serif clara.",
  },
  {
    id: "clinica-suscripcion",
    name: "Centro de fisioterapia con bonos",
    description:
      "Centro de salud/bienestar con venta de bonos de sesiones, reserva y seguimiento del cliente.",
    kind: "fullstack",
    icon: "HeartPulse",
    seedPrompt:
      "Una web para un centro de fisioterapia y bienestar llamado 'ReCore Fisio'. Página de inicio con servicios (fisioterapia deportiva, masaje terapéutico, rehabilitación, pilates), sección de bonos disponibles (sesión suelta, bono 5 sesiones con descuento, bono 10 sesiones con más descuento) con precio de cada uno, equipo de fisioterapeutas con especialidad, y testimonios de clientes. Página de compra de bono con selección del tipo de bono y checkout simulado. Área de cliente con login: bonos activos y sesiones restantes de cada uno, historial de sesiones pasadas, y calendario para reservar la próxima sesión eligiendo fisioterapeuta y franja horaria disponible. Panel de administración para el centro: listado de clientes con sus bonos activos y sesiones consumidas/restantes, agenda del día con todas las citas de todos los fisioterapeutas, y registro rápido de 'sesión completada' que descuenta automáticamente del bono del cliente. Diseño relajado y profesional, verdes y blancos, fotografía de bienestar, tipografía redondeada.",
  },
  {
    id: "inmobiliaria-catalogo",
    name: "Inmobiliaria con catálogo de propiedades",
    description:
      "Portal inmobiliario con búsqueda de propiedades, fichas detalladas y panel para gestionar el catálogo.",
    kind: "fullstack",
    icon: "Building2",
    seedPrompt:
      "Un portal inmobiliario llamado 'Vivenda Home' para una agencia local. Página de inicio con buscador destacado (tipo de operación: comprar/alquilar, zona, número de habitaciones, precio máximo) y listado de propiedades destacadas en tarjetas con foto principal, precio, m², habitaciones y zona. Página de resultados de búsqueda con filtros laterales (precio, m², habitaciones, tipo de inmueble, zona) y listado paginado de resultados. Ficha de propiedad individual con galería de fotos, descripción completa, características (m², habitaciones, baños, planta, ascensor, garaje, año de construcción), mapa de ubicación aproximada, precio, y formulario de contacto 'Solicitar visita' con nombre, teléfono y mensaje. Panel de gestión protegido con login para el agente: listado de todas las propiedades con estado (disponible/reservada/vendida), formulario de alta/edición de propiedad con subida de fotos y todos los campos, y listado de solicitudes de contacto recibidas con los datos del interesado y la propiedad de interés. Diseño sobrio y confiable, azul marino y blanco, tipografía elegante, fotos grandes de las propiedades.",
  },
  {
    id: "inmobiliaria-alquiler-vacacional",
    name: "Alquiler vacacional con reservas",
    description:
      "Web de alquiler vacacional/apartamentos turísticos con calendario de disponibilidad y reservas online.",
    kind: "fullstack",
    icon: "Palmtree",
    seedPrompt:
      "Una web de alquiler vacacional para varios apartamentos turísticos gestionados por un mismo propietario, marca 'Coastal Stays'. Página de inicio con listado de apartamentos disponibles en tarjetas (foto, nombre, capacidad, precio por noche, ubicación) y buscador por fechas y número de huéspedes. Ficha de cada apartamento con galería de fotos, descripción, servicios incluidos (wifi, aire acondicionado, cocina equipada, vistas al mar, etc.), calendario visual mostrando qué fechas están disponibles u ocupadas, selector de fechas de entrada/salida con cálculo automático del precio total según noches, y formulario de reserva (datos del huésped, número de personas) con confirmación. Panel de gestión protegido con login para el propietario: calendario global de todas las propiedades con las reservas marcadas, listado de reservas con datos de contacto del huésped y fechas, alta/edición de apartamentos (fotos, precio por noche, capacidad, servicios), y bloqueo manual de fechas (para mantenimiento o uso propio). Diseño luminoso y veraniego, azules y blancos, fotografía a pantalla completa, sensación de vacaciones.",
  },
  {
    id: "gimnasio-membresias",
    name: "Gimnasio con membresías",
    description:
      "Web de gimnasio con planes de suscripción, horario de clases y panel de gestión de socios.",
    kind: "fullstack",
    icon: "Dumbbell",
    seedPrompt:
      "Una web para un gimnasio llamado 'PowerZone Fitness'. Página de inicio con hero (foto del gimnasio + CTA 'Hazte socio'), sección de planes de membresía (básico, premium, familiar) con precio mensual y beneficios de cada uno, horario semanal de clases dirigidas (spinning, yoga, crossfit, zumba) con hora, instructor y aforo disponible, sección de instalaciones con fotos, y testimonios de socios. Página de alta de socio con selección de plan y checkout simulado. Área de socio con login: plan activo, historial de pagos, reserva de plaza en clases dirigidas (con aforo limitado), y código QR de acceso al gimnasio. Panel de administración: listado de socios con estado de la cuota (al día/pendiente), altas y bajas, gestión del horario de clases, y estadísticas de ocupación por clase. Diseño enérgico, negro y naranja/verde flúor, tipografía bold e impactante.",
  },
  {
    id: "peluqueria-barberia",
    name: "Peluquería / Barbería con citas",
    description:
      "Salón de belleza o barbería con catálogo de servicios, reserva de cita por profesional y panel de agenda.",
    kind: "fullstack",
    icon: "Scissors",
    seedPrompt:
      "Una web para una barbería llamada 'The Barber House'. Página de inicio con hero, catálogo de servicios (corte, arreglo de barba, afeitado clásico, combo corte+barba) con precio y duración de cada uno, perfil de cada barbero con foto, especialidad y galería de trabajos realizados, y ubicación con horario. Página de reserva: elegir servicio, elegir barbero (u 'cualquiera disponible'), ver huecos libres calculados según la agenda real de ese barbero ese día, rellenar nombre y teléfono, y confirmar. Área de cliente opcional con historial de citas pasadas y próxima cita. Panel de gestión para cada barbero/administrador: agenda del día con las citas, posibilidad de marcarlas como completadas o de cancelarlas, y añadir bloqueos de horario (descansos, vacaciones). Diseño masculino y con carácter, negro y marfil con acentos dorados, tipografía con estilo vintage/barbershop.",
  },
  {
    id: "veterinaria-mascotas",
    name: "Clínica veterinaria",
    description:
      "Veterinaria con servicios, reserva de cita para mascotas y ficha clínica básica por animal.",
    kind: "fullstack",
    icon: "PawPrint",
    seedPrompt:
      "Una web para una clínica veterinaria llamada 'VetCare Animal'. Página de inicio con servicios (consulta general, vacunación, cirugía, peluquería canina, urgencias 24h), equipo de veterinarios con especialidad, y testimonios de dueños de mascotas. Página de reserva de cita: datos del dueño, datos de la mascota (nombre, especie, raza, edad), motivo de la visita, fecha y hora disponible. Área de cliente con login: listado de sus mascotas registradas, y por cada una su ficha básica (vacunas puestas con fecha, peso registrado en cada visita, próximas revisiones), e historial de citas. Panel de gestión para el veterinario: agenda del día, ficha clínica completa de cada mascota que atiende (poder añadir una nueva entrada: diagnóstico, tratamiento, peso, próxima revisión recomendada), y listado de todos los pacientes (mascotas) registrados en la clínica. Diseño cercano y confiable, verde y blanco, iconografía de huellas y mascotas.",
  },
  {
    id: "autoescuela-clases",
    name: "Autoescuela",
    description:
      "Autoescuela con paquetes de clases, reserva de clases prácticas y seguimiento del progreso del alumno.",
    kind: "fullstack",
    icon: "Car",
    seedPrompt:
      "Una web para una autoescuela llamada 'Conduce Ya'. Página de inicio con los tipos de carnet que se pueden sacar (B, A2, A), paquetes de clases prácticas (10, 20, bono ilimitado) con precio, información sobre el examen teórico y práctico, y testimonios de alumnos aprobados. Página de matriculación con selección de tipo de carnet y paquete, checkout simulado. Área de alumno con login: horas de clase práctica consumidas y restantes de su bono, reserva de próxima clase práctica eligiendo profesor y franja horaria disponible, test de teórico online tipo examen (preguntas de opción múltiple con corrección automática al final) para practicar, y calendario con sus próximas clases. Panel de gestión para la autoescuela: listado de alumnos con horas consumidas/restantes de cada bono, agenda de clases prácticas de todos los profesores, y alta de nuevos alumnos. Diseño práctico y directo, azul y amarillo (señalización vial), iconografía de tráfico.",
  },
  {
    id: "taller-mecanico",
    name: "Taller mecánico",
    description:
      "Taller de coches con solicitud de cita para revisión/reparación y seguimiento del estado del vehículo.",
    kind: "fullstack",
    icon: "Wrench",
    seedPrompt:
      "Una web para un taller mecánico llamado 'AutoFix Taller'. Página de inicio con servicios (cambio de aceite, revisión pre-ITV, frenos, neumáticos, diagnosis electrónica, reparación general), presupuesto orientativo de cada servicio, y opiniones de clientes. Página de solicitud de cita: datos del vehículo (marca, modelo, matrícula, año), servicio deseado o descripción del problema, fecha preferida, datos de contacto. Área de cliente con login: sus vehículos registrados, y por cada uno el historial de intervenciones realizadas (fecha, qué se hizo, coste), y estado de la reparación en curso si tiene el coche en el taller ahora mismo (recibido → diagnosticando → reparando → listo para recoger). Panel de gestión para el taller: cola de vehículos actualmente en el taller con su estado editable, calendario de citas próximas, y ficha de cada cliente con sus vehículos e historial completo. Diseño industrial y robusto, gris oscuro y naranja, tipografía técnica.",
  },
  {
    id: "academia-clases-particulares",
    name: "Academia de clases particulares",
    description:
      "Academia/profesores particulares con catálogo de asignaturas, reserva de clases y seguimiento del alumno.",
    kind: "fullstack",
    icon: "GraduationCap",
    seedPrompt:
      "Una web para una academia de refuerzo escolar llamada 'Academia Progresa'. Página de inicio con asignaturas disponibles (matemáticas, física y química, inglés, lengua) por nivel educativo (primaria, ESO, bachillerato), modalidad (individual u online), precio por hora o bono de horas, y profesorado con su especialidad y experiencia. Página de matriculación con selección de asignatura, modalidad y bono de horas, checkout simulado. Área de alumno/padre con login: horas de bono restantes, reserva de próxima clase eligiendo profesor y horario disponible, y calendario de clases programadas. Panel de gestión para la academia: listado de alumnos matriculados con horas consumidas/restantes de cada bono, agenda de todos los profesores, y un espacio simple de seguimiento donde el profesor puede dejar una nota breve tras cada clase (progreso, deberes, temas a reforzar) visible para el padre/alumno. Diseño educativo y cercano, azul y amarillo suave, tipografía clara y legible.",
  },
  {
    id: "eventos-organizacion",
    name: "Organización de eventos/bodas",
    description:
      "Wedding planner / organización de eventos con catálogo de servicios, presupuesto y seguimiento del proyecto.",
    kind: "fullstack",
    icon: "PartyPopper",
    seedPrompt:
      "Una web para una organizadora de bodas y eventos llamada 'Momento Perfecto Eventos'. Página de inicio con tipos de evento que organizan (bodas, comuniones, eventos de empresa), paquetes de servicios (organización integral, coordinación del día, solo asesoramiento) con lo que incluye cada uno, galería de eventos anteriores con fotos, y testimonios de clientes. Página de solicitud de presupuesto con formulario (tipo de evento, fecha aproximada, número de invitados, presupuesto orientativo, datos de contacto) que envía la solicitud para que la organizadora responda. Área de cliente con login (para quien ya ha contratado): línea de tiempo del proyecto con las tareas y su estado (proveedor de catering confirmado, localización reservada, etc.), documentos compartidos, y mensajes con la organizadora. Panel de gestión para la organizadora: listado de solicitudes de presupuesto recibidas, proyectos activos con su línea de tiempo de tareas editable, y directorio de proveedores habituales (catering, fotografía, música) con contacto. Diseño elegante y romántico, tonos rosa palo/dorado sobre blanco, tipografía manuscrita para títulos.",
  },
  {
    id: "tienda-moda-boutique",
    name: "Boutique de moda",
    description:
      "Tienda de ropa online con catálogo por categorías, tallas/variantes, carrito y panel de gestión de stock.",
    kind: "fullstack",
    icon: "Shirt",
    seedPrompt:
      "Una tienda online de ropa llamada 'Loom Boutique'. Catálogo organizado por categorías (mujer, hombre, accesorios) y subcategorías, cada producto con varias fotos, selector de talla y color (cada combinación con su propio stock), precio, y descripción del material. Página de producto individual con galería ampliable, selector de variante, botón añadir al carrito, y productos relacionados. Carrito y checkout con datos de envío y pago simulado, resumen del pedido y confirmación. Cuenta de cliente con historial de pedidos y estado de envío (preparando/enviado/entregado). Panel de administración: gestión de productos (alta/edición con fotos, precio, variantes de talla/color y stock de cada una), listado de pedidos recibidos con posibilidad de cambiar su estado, y alerta de productos con poco stock. Diseño minimalista y editorial, blanco y negro con tipografía elegante, mucho espacio en blanco al estilo revista de moda.",
  },
  {
    id: "cafeteria-especialidad",
    name: "Cafetería de especialidad",
    description:
      "Cafetería con carta, pedido para recoger en tienda y programa de puntos de fidelidad.",
    kind: "fullstack",
    icon: "Coffee",
    seedPrompt:
      "Una web para una cafetería de especialidad llamada 'Grano y Ritual'. Página de inicio con la carta (cafés de especialidad, tés, repostería, tostas) organizada por categorías, foto y precio de cada producto, historia de la cafetería y origen de sus cafés, y ubicación con horario. Sistema de pedido para recoger en tienda: elegir productos, personalizar (tipo de leche, tamaño, azúcar), ver el total, y elegir franja horaria de recogida, con confirmación y número de pedido. Cuenta de cliente con login: puntos de fidelidad acumulados (1 punto por cada euro gastado, canjeables por productos gratis a partir de cierto umbral), e historial de pedidos. Panel de gestión: cola de pedidos entrantes por franja horaria para que el equipo los prepare a tiempo, gestión de la carta (añadir/editar productos y precios), y listado de clientes con sus puntos de fidelidad. Diseño cálido y artesanal, tonos tierra y crema, tipografía con carácter, fotografía de producto muy cuidada.",
  },
  {
    id: "agencia-viajes",
    name: "Agencia de viajes",
    description:
      "Agencia de viajes con catálogo de paquetes/destinos, solicitud de reserva y panel de gestión de viajes.",
    kind: "fullstack",
    icon: "Plane",
    seedPrompt:
      "Una web para una agencia de viajes llamada 'Horizonte Viajes'. Página de inicio con destinos/paquetes destacados en tarjetas (foto, destino, duración, precio desde, fechas disponibles), buscador por destino y fechas, y testimonios de viajeros. Ficha de paquete individual con galería de fotos, itinerario día a día, qué incluye (vuelos, hotel, excursiones, comidas) y qué no incluye, precio por persona según ocupación, y formulario de 'Solicitar reserva' con número de viajeros y datos de contacto. Área de cliente con login: sus reservas en curso con estado (solicitada/confirmada/pagada), documentación del viaje disponible para descarga cuando esté confirmado, y viajes pasados. Panel de gestión para la agencia: listado de solicitudes de reserva recibidas con posibilidad de confirmarlas, gestión del catálogo de paquetes (alta/edición con fotos, itinerario y precio), y listado de clientes con sus reservas históricas. Diseño inspirador y aventurero, azul cielo y blanco con acentos coral, fotografía de gran formato de paisajes.",
  },
];

/**
 * Professional generation blueprints used by backend agents as production-ready
 * starting points. Agents MUST read this file when planning a new product:
 * artifacts/api-server/src/lib/templates.ts
 *
 * These blueprints are deliberately broader than the public gallery templates.
 * They give Architect, Designer, Frontend, Backend, QA and Patcher a shared base
 * so a client never starts from a blank canvas; the client can then refine copy,
 * sections, business rules, palette, integrations and data model as needed.
 */
export interface AgentGenerationBlueprint {
  id: string;
  name: string;
  appliesToKinds: TemplateKind[];
  detectionKeywords: string[];
  productPattern: string;
  recommendedStructure: string[];
  starterFeatures: string[];
  editableByClient: string[];
  qualityChecklist: string[];
}

export const AGENT_GENERATION_BLUEPRINTS: AgentGenerationBlueprint[] = [
  {
    id: "premium-saas-dashboard",
    name: "SaaS dashboard profesional",
    appliesToKinds: ["fullstack", "nextjs"],
    detectionKeywords: ["saas", "dashboard", "panel", "crm", "analytics", "métricas", "admin", "gestión"],
    productPattern: "Aplicación SaaS con navegación lateral, onboarding, métricas, entidades editables, estados vacíos, filtros y acciones principales claras.",
    recommendedStructure: ["Auth/onboarding", "Dashboard", "Listado con filtros", "Detalle editable", "Ajustes", "Componentes compartidos", "API CRUD si procede"],
    starterFeatures: ["sidebar responsive", "tarjetas KPI", "tablas con búsqueda", "formularios con validación", "notificaciones toast", "estados loading/error/empty"],
    editableByClient: ["módulos del menú", "nombres de métricas", "roles", "campos de entidad", "colores de marca", "copys de onboarding"],
    qualityChecklist: ["cada métrica debe derivar de datos mock o reales", "ninguna tabla sin filtros", "cada acción crítica debe confirmar o dar feedback", "mobile-first con menú compacto"]
  },
  {
    id: "marketplace-commerce",
    name: "Marketplace / e-commerce completo",
    appliesToKinds: ["fullstack", "nextjs", "hybrid-pwa"],
    detectionKeywords: ["tienda", "ecommerce", "marketplace", "catálogo", "carrito", "checkout", "producto", "pedido", "reserva"],
    productPattern: "Experiencia comercial con catálogo explorable, búsqueda, filtros, detalle de producto/servicio, carrito o solicitud, checkout simulado y panel de gestión.",
    recommendedStructure: ["Home comercial", "Catálogo", "Detalle", "Carrito o reserva", "Checkout", "Cuenta/pedidos", "Admin de catálogo"],
    starterFeatures: ["filtros por categoría/precio", "favoritos", "galería", "reviews", "resumen de pedido", "badges de stock/estado"],
    editableByClient: ["categorías", "precios", "impuestos", "métodos de pago", "política de envío", "estilo visual"],
    qualityChecklist: ["productos realistas con imágenes y alt descriptivo", "checkout nunca debe pedir datos reales de pago", "carrito persistente", "empty state de catálogo"]
  },
  {
    id: "ai-product-studio",
    name: "Herramienta con IA protegida",
    appliesToKinds: ["fullstack", "nextjs"],
    detectionKeywords: ["ia", "ai", "chatbot", "openai", "generador", "resumidor", "agente", "transcribir", "imagen"],
    productPattern: "Producto IA con frontend pulido y backend que protege claves, soporta historial, streaming o progreso, y deja instrucciones de variables de entorno.",
    recommendedStructure: ["Panel de entrada", "Resultados", "Historial", "Ajustes de modelo", "API segura", "Persistencia", "README de env vars"],
    starterFeatures: ["prompt textarea", "acciones rápidas", "historial", "estado generando", "errores legibles", "límite de tokens/tamaño"],
    editableByClient: ["proveedor IA", "system prompt", "acciones", "tono", "límites", "campos guardados"],
    qualityChecklist: ["nunca exponer API keys en cliente", "todas las llamadas IA pasan por /api", "mostrar loading y errores", "README con variables obligatorias"]
  },
  {
    id: "booking-services",
    name: "Reservas y servicios locales",
    appliesToKinds: ["fullstack", "mobile", "hybrid-pwa"],
    detectionKeywords: ["citas", "reservas", "agenda", "servicios", "peluquería", "clínica", "restaurante", "turnos", "calendario"],
    productPattern: "Sistema de reservas con catálogo de servicios, calendario, disponibilidad, formulario de cliente, confirmación y panel para gestionar citas.",
    recommendedStructure: ["Landing", "Servicios", "Calendario", "Reserva", "Confirmación", "Mis citas", "Admin agenda"],
    starterFeatures: ["slots horarios", "selector de servicio", "resumen de reserva", "estado confirmado/pendiente", "recordatorios simulados"],
    editableByClient: ["horarios", "duraciones", "profesionales", "políticas de cancelación", "idioma de mensajes"],
    qualityChecklist: ["no permitir reservar sin servicio y horario", "calendario usable en móvil", "confirmación clara", "datos mock suficientes"]
  },
  {
    id: "learning-platform",
    name: "Academia / cursos online",
    appliesToKinds: ["fullstack", "mobile", "nextjs"],
    detectionKeywords: ["curso", "academia", "elearning", "formación", "lecciones", "estudiantes", "quiz", "clases"],
    productPattern: "Plataforma educativa con catálogo de cursos, lecciones, progreso, evaluaciones y panel de alumno/docente.",
    recommendedStructure: ["Catálogo", "Curso", "Lección", "Progreso", "Quiz", "Certificado simulado", "Admin contenidos"],
    starterFeatures: ["barra de progreso", "lecciones bloqueadas/desbloqueadas", "quiz interactivo", "notas", "marcadores"],
    editableByClient: ["temario", "niveles", "criterios de evaluación", "branding académico", "mensajes de feedback"],
    qualityChecklist: ["cada curso con módulos y duración", "quiz con resultado", "estado vacío de aprendizaje", "mobile-first para lecciones"]
  },
  {
    id: "content-community",
    name: "Comunidad / red social / contenidos",
    appliesToKinds: ["fullstack", "mobile", "hybrid-pwa"],
    detectionKeywords: ["red social", "comunidad", "foro", "posts", "feed", "comentarios", "mensajes", "perfiles"],
    productPattern: "Producto social con feed, perfiles, creación de contenido, comentarios, likes y moderación básica.",
    recommendedStructure: ["Feed", "Crear publicación", "Perfil", "Detalle de post", "Mensajes/notificaciones", "Moderación"],
    starterFeatures: ["composer", "reacciones", "comentarios", "búsqueda", "notificaciones mock", "privacidad básica"],
    editableByClient: ["tipos de contenido", "roles", "normas", "categorías", "tono de comunidad"],
    qualityChecklist: ["contenido mock no genérico", "empty states", "perfiles completos", "acciones con feedback"]
  },
  {
    id: "finance-operations",
    name: "Finanzas / operaciones",
    appliesToKinds: ["fullstack", "nextjs"],
    detectionKeywords: ["finanzas", "facturas", "presupuesto", "gastos", "contabilidad", "invoices", "pagos", "tesorería"],
    productPattern: "Herramienta operativa con registros, importes, estados, resúmenes, gráficos y exportación simulada.",
    recommendedStructure: ["Resumen financiero", "Ingresos/gastos", "Facturas", "Clientes/proveedores", "Reportes", "Ajustes"],
    starterFeatures: ["KPI cards", "gráficos", "filtros por fecha", "estado pagado/pendiente", "exportar CSV simulado"],
    editableByClient: ["moneda", "impuestos", "categorías", "plantillas de factura", "umbrales"],
    qualityChecklist: ["formato de moneda coherente", "datos agregados reales", "no prometer pagos reales", "tablas responsive"]
  },
  {
    id: "game-starter-kit",
    name: "Juego completo con loop jugable",
    appliesToKinds: ["game-2d", "game-3d"],
    detectionKeywords: ["juego", "game", "arcade", "runner", "3d", "2d", "phaser", "three", "pixi", "babylon"],
    productPattern: "Juego con menú, instrucciones, loop principal, puntuación, dificultad progresiva, game over y persistencia de récord.",
    recommendedStructure: ["Menú", "Escena de juego", "HUD", "Sistema de colisiones", "Game over", "Persistencia local", "Controles"],
    starterFeatures: ["score", "best score", "pausa", "reinicio", "dificultad incremental", "controles teclado/móvil si aplica"],
    editableByClient: ["personajes", "velocidad", "niveles", "paleta", "mecánica principal", "sonidos futuros"],
    qualityChecklist: ["debe ser jugable desde el primer render", "cleanup de canvas/engine", "sin assets externos obligatorios", "FPS estable"]
  }
];

function normalizeForTemplateSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function selectAgentGenerationBlueprint(prompt: string, kind?: string): AgentGenerationBlueprint {
  const normalizedPrompt = normalizeForTemplateSearch(prompt);
  const normalizedKind = (kind || "fullstack") as TemplateKind;
  const scored = AGENT_GENERATION_BLUEPRINTS.map((blueprint) => {
    const keywordScore = blueprint.detectionKeywords.reduce((score, keyword) => {
      return score + (normalizedPrompt.includes(normalizeForTemplateSearch(keyword)) ? 3 : 0);
    }, 0);
    const kindScore = blueprint.appliesToKinds.includes(normalizedKind) ? 4 : 0;
    return { blueprint, score: keywordScore + kindScore };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.blueprint ?? AGENT_GENERATION_BLUEPRINTS[0];
}

export interface TemplateContextOptions {
  prompt: string;
  kind?: string;
  detectedLocale?: string;
  detectedCountry?: string;
  uiLanguage?: string;
}

export function buildAgentTemplateContextBlock(options: TemplateContextOptions): string {
  const blueprint = selectAgentGenerationBlueprint(options.prompt, options.kind);
  const publicTemplateIds = TEMPLATES
    .filter((template) => template.kind === (options.kind as TemplateKind))
    .slice(0, 4)
    .map((template) => template.id)
    .join(", ") || "usar la plantilla pública más cercana del catálogo";

  const base = `[MARIS AI TEMPLATE BASE — OBLIGATORIO]
Archivo oficial de plantillas para los agentes: artifacts/api-server/src/lib/templates.ts
Plantilla profesional seleccionada: ${blueprint.name} (${blueprint.id})
Tipo solicitado: ${options.kind || "fullstack"}
Plantillas públicas relacionadas: ${publicTemplateIds}
Idioma de interfaz detectado por IP/cabeceras: ${options.uiLanguage || "es"}${options.detectedLocale ? ` (${options.detectedLocale})` : ""}${options.detectedCountry ? ` · país=${options.detectedCountry}` : ""}

Cómo deben usarla los agentes:
- Architect: NO empezar desde cero. Usa esta plantilla como esqueleto inicial y adapta páginas, modelos, componentes y backend al encargo exacto.
- Designer: toma la estructura base, pero personaliza marca, paleta, jerarquía visual y microinteracciones para que el resultado parezca premium, no genérico.
- Frontend: implementa la base completa con datos mock realistas, responsive, estados vacíos/loading/error y componentes editables por el cliente.
- Backend: si aplica, crea endpoints y modelos coherentes con la plantilla; evita stubs sin lógica cuando el producto requiere persistencia.
- QA/Patcher: valida contra el checklist de la plantilla y bloquea entregas incompletas.

Patrón de producto base: ${blueprint.productPattern}
Estructura recomendada: ${blueprint.recommendedStructure.join(" → ")}
Features iniciales: ${blueprint.starterFeatures.join("; ")}
Partes que el cliente debe poder modificar después: ${blueprint.editableByClient.join("; ")}
Checklist mínimo de calidad: ${blueprint.qualityChecklist.join("; ")}

Regla de calidad Maris AI: entregar una base lista para que el cliente empiece a editar, nunca una pantalla vacía, nunca una maqueta sin interacción y nunca una app que parezca generada con prisa.`;

  const playbooks = buildPlaybooksContextBlock(options.prompt);
  return playbooks ? `${base}\n\n${playbooks}` : base;
}

