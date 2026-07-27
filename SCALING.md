# Escalabilidad de Maris AI — Guía de Infraestructura

## Arquitectura actual (escalable horizontalmente)

```
                    ┌──────────────────┐
   Users ──────────▶│  Vercel Edge CDN │
                    │  (Frontend SPA)  │
                    └────────┬─────────┘
                             │ API calls
                    ┌────────▼─────────┐
                    │  Coolify Load    │
                    │  Balancer        │
                    └────────┬─────────┘
                    ┌────────▼─────────────────────────┐
                    │     API Server Instances          │
                    │  Instance 1 │ Instance 2 │ ...N  │
                    │  (Express)  │ (Express)  │       │
                    └────────┬───────────┬──────────────┘
                             │           │
              ┌──────────────▼──┐   ┌───▼──────────────┐
              │  Redis (BullMQ) │   │  MongoDB Atlas   │
              │  Job Queue      │   │  (Persistence)   │
              │  Pub/Sub        │   │                  │
              └─────────────────┘   └──────────────────┘
```

## Cómo escalar

### Opción 1: Más réplicas en Coolify (horizontal)
Coolify Dashboard → tu servicio → Settings → Replicas → aumentar número

Con BullMQ + Redis cada réplica toma jobs del queue automáticamente.
No requiere cambios de código.

### Opción 2: Más concurrencia por instancia
Variable de entorno: JOB_CONCURRENCY=20 (default 10)
Aumenta trabajos paralelos por instancia.

### Opción 3: Workers dedicados
Separar el servidor HTTP de los workers de generación:
- Instancia A: solo servidor HTTP (responde requests)
- Instancia B+: solo workers BullMQ (procesan generaciones)

### Métricas a monitorizar
- Queue depth (jobs en espera)
- Job latency (tiempo hasta completar)
- Memory por instancia (generaciones son intensivas en RAM)
- Redis connections

## Costes estimados

| Carga | Instancias | Coste Coolify/mes |
|-------|------------|-------------------|
| Hasta 100 usuarios/día | 1 | ~$20 |
| Hasta 500 usuarios/día | 2 | ~$40 |
| Hasta 2000 usuarios/día | 4 | ~$80 |
| Hasta 10000 usuarios/día | 8+ | ~$200+ |

## Variables de entorno para producción

```env
JOB_CONCURRENCY=15          # Workers paralelos por instancia
REDIS_URL=redis://...       # Redis para BullMQ (obligatorio para multi-instancia)
MONGODB_URI=mongodb+srv://... # MongoDB Atlas (ya configurado)
MAX_GENERATION_TIMEOUT=300000 # 5 min máx por generación
NODE_ENV=production
```
