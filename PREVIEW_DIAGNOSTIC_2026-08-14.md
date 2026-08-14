# Diagnóstico de preview de Aurevia — 14 de agosto de 2026

La ruta pública de preview `GET /api/apps/6a7d14f8bc6ca3bf2c88fdf6/preview` responde `200` con HTML de aproximadamente 97 KB, sin redirección. Sus cabeceras permiten el iframe de mismo origen (`frame-ancestors 'self'` y `X-Frame-Options: SAMEORIGIN`).

La captura aportada por el usuario muestra una preview cargada dentro de un panel muy estrecho y una petición anterior cancelada. Se publicó un ajuste responsivo de Aurevia para vistas de iframe menores de 390 px, con prevención de desbordamiento horizontal y cabecera compacta.

En la comprobación posterior dentro de `https://www.marisai.es/app/6a7d14f8bc6ca3bf2c88fdf6`, el shell de Maris AI mostró inicialmente el esqueleto de carga del detalle sin materializar el contenido de la app. Esto es una incidencia distinta de la ruta de preview, que sí continúa respondiendo correctamente; debe analizarse la carga del cliente de la página de detalle.

## Estado de Vercel observado

El panel de Vercel muestra como producción el commit `7b15ca8`, creado hace aproximadamente cuatro horas. También muestra un despliegue posterior asociado al cambio de recuperación de detalle como **obstruido** y con acción de cancelar, por lo que el frontend público aún no contiene ese cambio. El backend de Hetzner sí ha recibido la optimización de lectura y continúa sirviendo la ruta pública de preview.

El historial confirma que los commits recientes `28efd73` y `575427f` están bloqueados, igual que varios commits de Maris AI anteriores. La última producción lista sigue siendo `7b15ca8`; se debe inspeccionar el detalle del despliegue bloqueado antes de reintentar o promover ningún cambio.

El historial identifica el despliegue bloqueado más reciente como `maris-ai-frontend-bl81bprpb-rrhhmilchollos-jpgs-projects.vercel.app`, asociado al commit `575427f`. Se procede a abrir únicamente su detalle de lectura para obtener la causa.
