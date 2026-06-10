# Hallazgos de auditoría inicial

## marisai.es

La página pública `https://www.marisai.es/` carga, pero lo observado en navegador corresponde a una versión muy simplificada/estática de la landing, con enlaces básicos visibles: registro, noticias, comparativa, precios y legales. No aparece en esa vista pública un botón de GitHub porque el flujo GitHub está dentro del área de app/proyecto autenticada.

## Railway

La URL del servicio Railway proporcionada abre la interfaz de Railway, pero la vista visible queda prácticamente vacía/sin contenido de servicio y solo muestra un enlace de home, lo que indica que probablemente requiere sesión o carga protegida. No se ha realizado ninguna operación sensible ni cambio externo.

## Nota

Queda pendiente auditar la zona autenticada de Maris AI para comprobar el botón GitHub real y, si hace falta iniciar sesión o acceder a Railway/Anthropic, se debe pedir toma de control o confirmación antes de cambios sensibles.

## Anthropic / Claude Platform

La URL `https://platform.claude.com/dashboard` redirige a `https://platform.claude.com/login?returnTo=%2Fdashboard`. La sesión no está iniciada en el navegador actual. Se observa formulario de acceso con Google, email y SSO. No se ha realizado ningún cambio de saldo, límites, recarga, caché ni facturación porque requiere inicio de sesión y sería una operación sensible.

## Sospecha técnica del botón GitHub

El componente `GitHubButton` usa navegación directa a `/api/github/connect`. Esa navegación de navegador no puede adjuntar automáticamente el token Bearer de Clerk que sí adjunta `apiFetch`, por lo que una ruta protegida con `requireAuth` puede fallar antes de llegar a GitHub OAuth. Además, el push usa la ruta antigua `/api/github/push/:appId` mientras existe una ruta moderna `/api/apps/:id/github` basada en `pushAppToGitHub`. Esto explica que el botón pueda no conectar ni subir proyectos correctamente.

## marisai.es/pricing

La ruta `/pricing` carga primero el contenido SEO estático y después hidrata la SPA. Se observan CTAs: `Empieza gratis`, `Actualizar a Pro`, `Contactar con Ventas` y `Comienza con 50 créditos gratis`. Los CTAs visibles apuntan a `/sign-up` o `mailto:ventas@marisai.es`, lo cual es coherente para una página pública. También aparece el banner de cookies con botones `Solo necesarias`, `Aceptar todas` y cerrar.

No se observa en la página pública un botón GitHub porque ese botón pertenece al detalle de proyecto autenticado. La incidencia de GitHub debe corregirse en `GitHubButton` y rutas backend OAuth/push.
