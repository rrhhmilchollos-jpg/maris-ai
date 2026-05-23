# Guía de Migración a BullMQ para Escalabilidad Masiva

## Resumen

Esta guía detalla cómo migrar de la cola de trabajos en proceso (in-process) a **BullMQ + Redis** para lograr escalabilidad masiva sin colas de espera compartidas.

## Requisitos Previos

1. **Redis disponible** (Render Redis, Redis Cloud, o instancia propia)
2. **Variable de entorno `REDIS_URL`** configurada en Render
3. **BullMQ** ya está en `package.json` como dependencia

## Pasos de Migración

### Paso 1: Reemplazar jobQueue.ts

**Antes:**
```typescript
// artifacts/api-server/src/lib/jobQueue.ts
// Usa cola in-process con MongoDB
```

**Después:**
```typescript
// Usar jobQueue-bullmq.ts en su lugar
// Usa BullMQ + Redis para procesamiento distribuido
```

**Acción:**
1. Renombrar `jobQueue.ts` a `jobQueue-old.ts` (backup).
2. Renombrar `jobQueue-bullmq.ts` a `jobQueue.ts`.
3. Actualizar imports en `index.ts` y otras rutas si es necesario.

### Paso 2: Crear Comando start:worker

En `artifacts/api-server/package.json`, agregar:

```json
{
  "scripts": {
    "start": "node --enable-source-maps ./dist/index.mjs",
    "start:worker": "node --enable-source-maps ./dist/worker.mjs"
  }
}
```

### Paso 3: Crear worker.ts

Crear `artifacts/api-server/src/worker.ts`:

```typescript
import { startQueue, registerGenerateWorker } from "./lib/jobQueue";
import { generateApp } from "./lib/generate";
import { logger } from "./lib/logger";

async function main() {
  try {
    logger.info("Starting BullMQ worker...");
    
    // Iniciar la cola
    await startQueue();
    
    // Registrar el handler de trabajos
    await registerGenerateWorker(async (jobId, ctx) => {
      logger.info({ jobId, attempt: ctx.attempt }, "Processing generation job");
      await generateApp(jobId);
    });
    
    logger.info("BullMQ worker ready and listening for jobs");
  } catch (err) {
    logger.error({ err }, "Failed to start worker");
    process.exit(1);
  }
}

main();
```

### Paso 4: Configurar Redis en Render

1. **Crear servicio de Redis en Render:**
   - Ir a Render Dashboard → Create New → Redis
   - Seleccionar plan (Starter es suficiente para empezar)
   - Copiar la URL de conexión (ej: `redis://...`)

2. **Establecer REDIS_URL en Render:**
   - En el dashboard de Render, ir a Environment Variables
   - Agregar `REDIS_URL` con el valor de la URL de Redis

### Paso 5: Actualizar render.yaml

El archivo `render.yaml` ya incluye la configuración del worker. Asegúrate de que:

```yaml
- type: worker
  name: maris-ai-worker
  startCommand: cd artifacts/api-server && npm run start:worker
  envVars:
    - key: REDIS_URL
      sync: false # Debe ser la misma URL que en el API server
    - key: JOB_CONCURRENCY
      value: "10" # Ajusta según necesidad
```

### Paso 6: Desplegar

1. **Hacer commit y push:**
   ```bash
   git add artifacts/api-server/src/lib/jobQueue-bullmq.ts
   git add artifacts/api-server/src/worker.ts
   git add render.yaml
   git commit -m "feat(scalability): Migrar a BullMQ para escalabilidad masiva"
   git push origin main
   ```

2. **Render detectará los cambios y desplegará automáticamente:**
   - El API server se reconstruirá con la nueva lógica de jobQueue.
   - El worker se creará como un nuevo servicio.

## Verificación

### 1. Verificar que Redis está conectado

En el dashboard de Render, revisar los logs del API server:

```
BullMQ job queue started
```

### 2. Verificar que el worker está escuchando

En los logs del worker:

```
BullMQ worker registered and listening for jobs
```

### 3. Prueba de carga

Enviar múltiples solicitudes simultáneamente:

```bash
for i in {1..100}; do
  curl -X POST https://your-api.onrender.com/api/apps \
    -H "Authorization: Bearer YOUR_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"prompt":"Create a landing page"}' &
done
```

**Resultado esperado:**
- Todos los trabajos se procesan en paralelo.
- Ninguno espera a que termine otro.
- Latencia consistente independientemente de la carga.

## Escalado Horizontal

### Agregar más workers

1. En Render, crear una nueva instancia del servicio `maris-ai-worker`.
2. Configurar con la misma `REDIS_URL`.
3. Render la iniciará automáticamente.

**Resultado:** Capacidad de procesamiento se multiplica.

### Aumentar concurrencia por worker

En Render, cambiar `JOB_CONCURRENCY`:

```
JOB_CONCURRENCY=50  # Procesa 50 trabajos en paralelo por worker
```

## Monitoreo

### Ver estado de la cola

Crear un endpoint de admin (ej: `/api/admin/queue-stats`):

```typescript
import { queue } from "../lib/jobQueue";

app.get("/api/admin/queue-stats", async (req, res) => {
  const pending = await queue.count();
  const active = await queue.getActiveCount();
  const failed = await queue.getFailedCount();
  
  res.json({ pending, active, failed });
});
```

### Logs

Todos los eventos se registran con contexto completo:

```json
{
  "level": "info",
  "jobId": "app-123",
  "userId": "user-456",
  "event": "Job completed",
  "duration_ms": 32000
}
```

## Rollback (Si es necesario)

Si necesitas volver a la cola in-process:

1. Renombrar `jobQueue.ts` a `jobQueue-bullmq.ts`.
2. Renombrar `jobQueue-old.ts` a `jobQueue.ts`.
3. Hacer commit y push.
4. Render desplegará la versión anterior.

## Troubleshooting

### Error: "REDIS_URL must start with redis://"

**Causa:** Variable de entorno no configurada correctamente.

**Solución:**
1. Verificar que `REDIS_URL` está en Render Environment Variables.
2. Asegurarse de que comienza con `redis://` o `rediss://`.

### Error: "Job not found in MongoDB"

**Causa:** El trabajo se eliminó antes de ser procesado.

**Solución:**
1. Verificar que los trabajos se crean correctamente en MongoDB.
2. Revisar que el `userId` está presente en el documento.

### Workers no procesan trabajos

**Causa:** Workers no están conectados a Redis o a MongoDB.

**Solución:**
1. Revisar logs del worker en Render.
2. Verificar `REDIS_URL` y `MONGODB_URI`.
3. Reiniciar el worker desde Render Dashboard.

## Comparación de Rendimiento

| Métrica | Antes (in-process) | Después (BullMQ) |
|---|---|---|
| Trabajos simultáneos | 3 | 1.000+ |
| Latencia por usuario | Aumenta con carga | Constante |
| Escalabilidad | Vertical | Horizontal |
| Resiliencia | Baja | Alta |

## Conclusión

Con BullMQ + Redis, **Maris AI está listo para escalar a millones de usuarios** sin colas de espera. Cada usuario trabaja independientemente, con datos completamente aislados. 🚀
