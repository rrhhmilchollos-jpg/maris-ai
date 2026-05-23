# Guía de Despliegue para Maris AI

Esta guía detalla cómo desplegar el frontend de Maris AI en Vercel y el backend (API y Jobs) en Render, junto con las variables de entorno necesarias para cada plataforma.

## 1. Despliegue del Frontend en Vercel

El frontend de Maris AI (`artifacts/appforge`) se desplegará en Vercel. Ya he configurado el archivo `vercel.json` en la raíz de tu repositorio para facilitar este proceso.

### Configuración en Vercel

1.  **Importar Proyecto:** Conecta tu repositorio de GitHub (o el que uses) a Vercel. Vercel detectará automáticamente el archivo `vercel.json`.
2.  **Configuración de Build:** Asegúrate de que Vercel use la siguiente configuración (que ya está en `vercel.json`):
    *   **Root Directory:** `artifacts/appforge`
    *   **Build Command:** `npm install && npm run build`
    *   **Output Directory:** `dist`
3.  **Variables de Entorno (Vercel):**
    Debes configurar las siguientes variables de entorno en tu proyecto de Vercel. Estas son cruciales para que el frontend se comunique correctamente con el backend y los servicios externos.

    | Variable de Entorno | Descripción | Valor de Ejemplo |
    | :------------------ | :---------- | :--------------- |
    | `VITE_API_URL`      | URL base de tu API desplegada en Render. | `https://maris-ai-api-server.onrender.com/api` |
    | `VITE_CLERK_PUBLISHABLE_KEY` | Clave publicable de Clerk para la autenticación. | `pk_live_YOUR_CLERK_PUBLISHABLE_KEY` |
    | `VITE_FRONTEND_BASE_PATH` | Si tu frontend se sirve desde un subdirectorio (ej. `/app`), especifícalo aquí. | `/` (por defecto) |

## 2. Despliegue del Backend en Render

El backend de Maris AI (`artifacts/api-server`) se desplegará en Render. He creado el archivo `render.yaml` en la raíz de tu repositorio para una configuración automatizada.

### Configuración en Render

1.  **Crear un nuevo Blueprint:** En tu dashboard de Render, crea un nuevo servicio usando el archivo `render.yaml` de tu repositorio.
2.  **Configuración del Servicio Web:**
    *   **Name:** `maris-ai-api-server` (o el que prefieras)
    *   **Region:** `oregon` (o tu región preferida)
    *   **Branch:** `main` (o la rama que uses para despliegues)
    *   **Root Directory:** `artifacts/api-server`
    *   **Build Command:** `npm install && npm run build`
    *   **Start Command:** `npm run start`
    *   **Health Check Path:** `/api/health` (asegúrate de que este endpoint exista en tu API para que Render pueda verificar el estado del servicio)
3.  **Variables de Entorno (Render):**
    Estas variables deben configurarse en el dashboard de Render para tu servicio `maris-ai-api-server`. Algunas ya están definidas en `render.yaml` con `sync: false`, lo que significa que debes introducirlas manualmente en la interfaz de Render.

    | Variable de Entorno | Descripción | Valor de Ejemplo |
    | :------------------ | :---------- | :--------------- |
    | `NODE_ENV`          | Entorno de ejecución. | `production` |
    | `PORT`              | Puerto en el que la aplicación escuchará. Render usa `10000` por defecto. | `10000` |
    | `MONGODB_URI`       | Cadena de conexión a tu base de datos MongoDB. | `mongodb+srv://user:pass@cluster.mongodb.net/marisai?retryWrites=true&w=majority` |
    | `STRIPE_SECRET_KEY` | Clave secreta de Stripe. | `sk_live_YOUR_STRIPE_SECRET_KEY` |
    | `STRIPE_WEBHOOK_SECRET` | Secreto del webhook de Stripe. | `whsec_YOUR_STRIPE_WEBHOOK_SECRET` |
    | `STRIPE_PRICE_PRO`  | ID del precio de Stripe para el plan Pro. | `price_YOUR_PRO_PRICE_ID` |
    | `STRIPE_PRICE_TEAM` | ID del precio de Stripe para el plan Team. | `price_YOUR_TEAM_PRICE_ID` |
    | `CLERK_SECRET_KEY`  | Clave secreta de Clerk para la autenticación. | `sk_live_YOUR_CLERK_SECRET_KEY` |
    | `CLERK_WEBHOOK_SECRET` | Secreto del webhook de Clerk. | `whsec_YOUR_CLERK_WEBHOOK_SECRET` |
    | `OPENAI_API_KEY`    | Clave API de OpenAI. | `sk-YOUR_OPENAI_API_KEY` |
    | `GEMINI_API_KEY`    | Clave API de Google Gemini. | `YOUR_GEMINI_API_KEY` |
    | `FRONTEND_BASE_PATH` | Ruta base del frontend (debe coincidir con la de Vercel). | `/` |
    | `FRONTEND_URL`      | URL pública de tu frontend desplegado en Vercel. | `https://maris-ai-frontend.vercel.app` |
    | `WEBHOOK_SECRET`    | Secreto para webhooks internos (si los usas). | `YOUR_INTERNAL_WEBHOOK_SECRET` |
    | `REDIS_URL`         | URL de tu instancia de Redis (para BullMQ). | `redis://:password@host:port` |
    | `GITHUB_TOKEN`      | Token de GitHub si tu agente necesita interactuar con la API de GitHub. | `ghp_YOUR_GITHUB_TOKEN` |
    | `E2B_API_KEY`       | Clave API de E2B si usas su sandbox. | `YOUR_E2B_API_KEY` |

## 3. Despliegue de Jobs (Render)

Si tienes procesos en segundo plano (como el procesamiento de trabajos de generación de apps), puedes configurarlos como un servicio de Worker en Render, apuntando al mismo `api-server` pero con un comando de inicio diferente.

### Configuración de Worker en Render

1.  **Crear un nuevo Worker:** En tu dashboard de Render, crea un nuevo servicio de tipo `Worker`.
2.  **Configuración del Worker:**
    *   **Name:** `maris-ai-worker` (o el que prefieras)
    *   **Region:** `oregon` (o la misma que tu API)
    *   **Branch:** `main`
    *   **Root Directory:** `artifacts/api-server`
    *   **Build Command:** `npm install && npm run build`
    *   **Start Command:** `npm run start:worker` (o el comando específico para iniciar tus jobs/workers)
    *   **Variables de Entorno:** Las mismas que para el servicio web del API.

## Pasos Finales

1.  **Desplegar Vercel:** Una vez configurado, Vercel debería desplegar tu frontend automáticamente.
2.  **Desplegar Render:** Render desplegará tu API y tus Workers (si los configuras) usando el `render.yaml`.
3.  **Actualizar `VITE_API_URL` en Vercel:** Una vez que tu API esté desplegada en Render y tengas su URL pública, asegúrate de actualizar la variable de entorno `VITE_API_URL` en Vercel con la URL correcta de tu API de Render.

Con estos pasos, tu aplicación Maris AI debería estar completamente operativa en producción. ¡Avísame si tienes alguna otra pregunta o necesitas más ajustes!
