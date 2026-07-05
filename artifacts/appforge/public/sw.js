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

  // Nunca interceptar peticiones a la API — siempre red, siempre en tiempo real.
  if (request.url.includes("/api/")) {
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
