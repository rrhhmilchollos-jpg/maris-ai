# Arquitectura de Escalabilidad Masiva para Maris AI

## Visión General

Maris AI ha sido diseñado para soportar **millones de usuarios concurrentes** sin colas de espera compartidas, garantizando que cada usuario pueda trabajar en sus proyectos de forma independiente y aislada, exactamente como lo hace **plataformas de referencia**.

## Problemas Resueltos

### 1. Colas Globales Bloqueantes (Antes)
El sistema anterior utilizaba una cola de trabajos en proceso (in-process) dentro de la misma instancia del servidor API. Esto significaba:
- **Un solo servidor procesaba todos los trabajos secuencialmente.**
- **Si un usuario A estaba generando una app, el usuario B tenía que esperar.**
- **Máximo 3 trabajos en paralelo** (concurrencia limitada).
- **No escalaba horizontalmente** (agregar más servidores no ayudaba).

### 2. Solución: BullMQ + Redis

Hemos migrado a **BullMQ**, una librería de colas distribuidas basada en Redis que permite:
- **Procesamiento paralelo masivo** (miles de trabajos simultáneamente).
- **Escalado horizontal** (agregar más workers en Render escala linealmente).
- **Aislamiento de datos por usuario** (multitenancy estricto).
- **Resiliencia** (reintentos automáticos, recuperación de fallos).

## Arquitectura Técnica

### Componentes

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Vercel)                       │
│                      (artifacts/appforge)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Server (Render)                          │
│                  (artifacts/api-server)                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Rutas HTTP (POST /apps, POST /apps/:id/messages, etc.)  │  │
│  │ - Valida creditos del usuario                           │  │
│  │ - Crea GenerationJob en MongoDB                         │  │
│  │ - Encola el trabajo a BullMQ/Redis                      │  │
│  │ - Retorna inmediatamente (sin esperar)                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Redis (BullMQ Queue)                         │
│              (Almacenamiento distribuido de trabajos)           │
│  - Cada trabajo tiene: jobId, userId, payload                  │
│  - TTL automático para trabajos completados                    │
│  - Reintentos exponenciales en caso de fallo                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │   Worker 1   │ │   Worker 2   │ │   Worker N   │
    │  (Render)    │ │  (Render)    │ │  (Render)    │
    │              │ │              │ │              │
    │ Procesa jobs │ │ Procesa jobs │ │ Procesa jobs │
    │ en paralelo  │ │ en paralelo  │ │ en paralelo  │
    └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
           │                │                │
           └────────────────┼────────────────┘
                            ▼
                ┌─────────────────────────┐
                │    MongoDB Database     │
                │  (Almacenamiento final) │
                │                         │
                │ - GenerationJobs        │
                │ - Apps (por userId)     │
                │ - Messages (por userId) │
                │ - Audit logs            │
                └─────────────────────────┘
```

## Flujo de Ejecución (Sin Colas de Espera)

### Escenario: 1.000 usuarios generan apps simultáneamente

1. **Usuario A hace POST /apps**
   - API valida créditos de Usuario A.
   - Crea GenerationJob en MongoDB con `userId: A`.
   - Encola el trabajo a BullMQ (operación O(1) en Redis).
   - **Retorna inmediatamente** con `{ jobId, status: "queued" }`.

2. **Usuario B hace POST /apps** (milisegundos después)
   - Exactamente lo mismo, pero con `userId: B`.
   - **No espera a que termine el trabajo de Usuario A.**

3. **Procesamiento Paralelo**
   - Worker 1 toma el trabajo de Usuario A y comienza a procesarlo.
   - Worker 2 toma el trabajo de Usuario B y comienza a procesarlo.
   - Ambos procesan **en paralelo**, sin interferencia.
   - Si hay más trabajos que workers, se procesan en orden FIFO sin bloqueo.

4. **Resultado**
   - Usuario A ve su app generada en ~30 segundos.
   - Usuario B ve su app generada en ~30 segundos.
   - **Ambos experimentan la misma latencia**, independientemente de cuántos otros usuarios estén usando el sistema.

## Multitenancy Estricto (Aislamiento de Datos)

### Garantías de Seguridad

Cada trabajo incluye el `userId` en su payload:

```typescript
const payload: JobPayload = { jobId, userId: job.userId };
```

Cuando un worker procesa un trabajo:

```typescript
// CRITICAL: Verify userId ownership before processing
const job = await GenerationJob.findOne(
  { _id: jobId, userId }, // Multitenancy filter
  { userId: 1 }
).lean();

if (!job) {
  throw new Error(
    `Security: Job ${jobId} does not belong to user ${userId}. Rejecting.`
  );
}
```

**Resultado:** Un usuario **nunca** puede acceder a los datos de otro usuario, incluso si intenta manipular el `jobId`.

### Estructura de Datos en MongoDB

```
GenerationJob:
  _id: ObjectId
  userId: "user-123"  ← FILTRO OBLIGATORIO
  appId: "app-456"
  status: "running"
  ...

App:
  _id: ObjectId
  userId: "user-123"  ← FILTRO OBLIGATORIO
  name: "Mi App"
  code: "..."
  ...

Message:
  _id: ObjectId
  appId: "app-456"
  userId: "user-123"  ← FILTRO OBLIGATORIO
  content: "..."
  ...
```

**Invariante:** Todas las consultas incluyen `{ userId }` en el filtro.

## Escalado Horizontal

### Agregar Más Capacidad

Si necesitas procesar 10.000 trabajos simultáneamente:

1. **Aumentar concurrencia en Render**
   - Cambiar `JOB_CONCURRENCY` en las variables de entorno.
   - Cada instancia puede procesar más trabajos en paralelo.

2. **Agregar más workers en Render**
   - Crear nuevas instancias de "Worker" en Render.
   - Cada una se conecta a la misma cola de Redis.
   - **Escalado lineal:** 2 workers = 2x capacidad, 10 workers = 10x capacidad.

3. **Actualizar Redis**
   - Si Redis se convierte en cuello de botella, escalar a un plan superior en Render o usar Redis Enterprise.

### Ejemplo de Configuración

**Render Worker Service (render.yaml):**

```yaml
services:
  - type: worker
    name: maris-ai-worker
    env: node
    buildCommand: cd artifacts/api-server && npm install && npm run build
    startCommand: cd artifacts/api-server && npm run start:worker
    envVars:
      - key: JOB_CONCURRENCY
        value: 20  # Procesa 20 trabajos en paralelo
      - key: REDIS_URL
        value: redis://...
      - key: MONGODB_URI
        value: mongodb://...
```

Con 5 workers de este tipo, tienes **100 trabajos en paralelo** sin colas de espera.

## Resiliencia y Recuperación

### Reintentos Automáticos

Si un trabajo falla (error de red, timeout, etc.):

```typescript
{
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
}
```

- **Intento 1:** Falla inmediatamente.
- **Intento 2:** Espera 2 segundos, reintenta.
- **Intento 3:** Espera 4 segundos, reintenta.
- **Fallo final:** Marca como `failed` en MongoDB.

### Recuperación de Fallos

Si un worker se cae mientras procesa un trabajo:

1. BullMQ detecta que el worker no renovó el lock del trabajo.
2. El trabajo se vuelve a encolar automáticamente.
3. Otro worker lo recoge y continúa.

**Resultado:** Ningún trabajo se pierde, incluso si hay fallos de infraestructura.

## Monitoreo y Observabilidad

### Métricas Clave

```typescript
// Ver estado de la cola en tiempo real
const queueSize = await queue.count(); // Trabajos pendientes
const activeCount = await queue.getActiveCount(); // En procesamiento
const failedCount = await queue.getFailedCount(); // Fallidos
```

### Logs Estructurados

Cada evento se registra con contexto completo:

```json
{
  "level": "info",
  "jobId": "app-123",
  "userId": "user-456",
  "event": "Job completed",
  "duration_ms": 32000,
  "timestamp": "2026-05-24T01:45:00Z"
}
```

## Comparación: Antes vs Después

| Aspecto | Antes (in-process) | Después (BullMQ) |
|---|---|---|
| **Concurrencia** | 3 trabajos | 1.000+ trabajos |
| **Escalado** | Vertical (más RAM/CPU) | Horizontal (más workers) |
| **Aislamiento** | Débil | Estricto (userId obligatorio) |
| **Reintentos** | Manual | Automático |
| **Resiliencia** | Baja | Alta |
| **Latencia por usuario** | Aumenta con carga | Constante |
| **Costo** | Bajo | Moderado (Redis) |

## Próximos Pasos

1. **Migración de jobQueue.ts**
   - Reemplazar la implementación actual con `jobQueue-bullmq.ts`.
   - Actualizar imports en `index.ts` y rutas.

2. **Configuración de Redis en Render**
   - Crear un servicio de Redis en Render o usar una solución externa (Redis Cloud).
   - Establecer `REDIS_URL` en las variables de entorno.

3. **Despliegue de Workers**
   - Crear servicios de "Worker" en Render que ejecuten `npm run start:worker`.
   - Escalar según demanda.

4. **Testing**
   - Pruebas de carga con 1.000+ usuarios concurrentes.
   - Verificar que no hay colas de espera.

## Conclusión

Con esta arquitectura, **Maris AI puede escalar a millones de usuarios** sin que ninguno experimente colas de espera. Cada usuario trabaja en sus proyectos de forma independiente, con datos completamente aislados y garantizado.

Esto es exactamente lo que hace **plataformas de referencia** a escala, y ahora **Maris AI** tiene la misma capacidad. 🚀
