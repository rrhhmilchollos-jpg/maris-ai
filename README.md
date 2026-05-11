---
title: Maris AI Backend
emoji: 🚀
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Maris AI Backend
Servidor de inteligencia artificial para Maris AI, alojado gratuitamente en Hugging Face.
 
 
 
 


## Actualizaciones Recientes (11 de mayo de 2026)

### 1. Sistema de Créditos Gratuitos
- Se ha actualizado el sistema de bienvenida para asignar **70 créditos gratuitos** a todos los nuevos usuarios registrados (antes eran 3).
- El esquema de la base de datos se ha ajustado para reflejar este nuevo valor por defecto.
- El administrador propietario (`rrhh.milchollos@gmail.com`) mantiene su estatus de créditos ilimitados para pruebas y gestión.

### 2. Correcciones de API y Error 404
- **Endpoint de Logs:** Se ha implementado la ruta `GET /api/jobs/:id/logs` que faltaba en el servidor. Esto soluciona el error 404 que aparecía en la interfaz de usuario durante el proceso de generación de aplicaciones.
- **Normalización de Rutas:** Se han corregido inconsistencias en el montaje de rutas del servidor Express (`app.ts`) y se han alineado las exportaciones de los routers (`apps.ts`, `jobs.ts`) para asegurar que todos los endpoints del frontend funcionen correctamente.
- **Soporte de Generación:** Se ha verificado y estabilizado el flujo de generación de aplicaciones desde el dashboard.
