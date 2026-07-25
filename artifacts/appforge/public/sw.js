// Service Worker mínimo para Maris AI — pensado para ser SEGURO antes que
// agresivo. Maris AI cambia constantemente (varios despliegues al día);
// un service worker que cachee de más podría servir a un cliente una
// versión vieja de la app o, peor, datos de la API desactualizados.
//
// Estrategia: "network-first" para todo. Se intenta red primero siempre;
// solo se usa la caché como respaldo si la red falla (verdadero offline).
// Las peticiones a /api/ NUNCA se cachean — los datos de créditos, apps
// generadas, etc. tienen que ser siempre en tiempo real.

const CACHE_NAME = "marisai-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Limpiar cachés de versiones anteriores del service worker
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // ENCONTRADO a petición del usuario (crash real en consola: "Failed to
  // execute 'put' on 'Cache': Request scheme 'chrome-extension' is
  // unsupported"): algunas extensiones del navegador inyectan content
  // scripts que hacen fetch() con esquemas que la Cache API no admite
  // (chrome-extension://, moz-extension://, etc.). Como este listener
  // intercepta CUALQUIER fetch dentro de su scope -- incluidos los de
  // extensiones de terceros, no solo los de la propia app -- hay que
  // filtrar por esquema http/https ANTES de intentar cachear nada.
  if (!request.url.startsWith("http://") && !request.url.startsWith("https://")) {
    return;
  }

  // Nunca interceptar peticiones a la API — siempre red, siempre en tiempo real.
  if (request.url.includes("/api/")) {
    return;
  }

  // ENCONTRADO: el SW volvía a hacer fetch() de recursos de terceros
  // (ej. imágenes de Unsplash en la landing), y ese re-fetch desde dentro
  // del Service Worker pasa a regirse por la directiva connect-src de la
  // CSP en vez de img-src — y connect-src no tiene por qué listar cada CDN
  // de imágenes que se use. Un Service Worker no debería interceptar nada
  // fuera de su propio origen: se deja pasar tal cual, sin cachear, y el
  // navegador lo gestiona con las reglas normales de img-src (que si
  // admite https: en general).
  if (new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Solo GET tiene sentido cachear (POST/PUT/DELETE nunca).
  if (request.method !== "GET") {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Guardar copia en caché solo si la respuesta es válida (200 OK, mismo origen)
        if (response && response.status === 200 && response.type === "basic") {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Sin red de verdad: intentar servir desde caché como último recurso
        return caches.match(request).then((cached) => {
          return cached || Response.error();
        });
      })
  );
});
