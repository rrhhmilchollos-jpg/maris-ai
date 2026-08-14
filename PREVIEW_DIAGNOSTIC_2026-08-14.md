# Diagnóstico de preview de Aurevia — 14 de agosto de 2026

La ruta pública de preview `GET /api/apps/6a7d14f8bc6ca3bf2c88fdf6/preview` responde `200` con HTML de aproximadamente 97 KB, sin redirección. Sus cabeceras permiten el iframe de mismo origen (`frame-ancestors 'self'` y `X-Frame-Options: SAMEORIGIN`).

La captura aportada por el usuario muestra una preview cargada dentro de un panel muy estrecho y una petición anterior cancelada. Se publicó un ajuste responsivo de Aurevia para vistas de iframe menores de 390 px, con prevención de desbordamiento horizontal y cabecera compacta.

En la comprobación posterior dentro de `https://www.marisai.es/app/6a7d14f8bc6ca3bf2c88fdf6`, el shell de Maris AI mostró inicialmente el esqueleto de carga del detalle sin materializar el contenido de la app. Esto es una incidencia distinta de la ruta de preview, que sí continúa respondiendo correctamente; debe analizarse la carga del cliente de la página de detalle.
