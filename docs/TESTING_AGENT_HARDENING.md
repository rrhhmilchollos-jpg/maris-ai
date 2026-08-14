# Hardening del Testing Agent

**Autor:** Manus AI  
**Fecha:** 14 de agosto de 2026  
**Código de referencia:** commit `578a061b`

## Propósito

El Testing Agent se mantiene como una **barrera de calidad** y no como un segundo generador de proyectos. Su función es detectar fallos reproducibles, aplicar correcciones pequeñas y verificables, y detenerse de forma segura cuando el diagnóstico requiere una revisión más amplia. Esta separación evita que una heurística ambigua, una infraestructura de pruebas incompleta o una respuesta de modelo truncada conviertan una edición de usuario en una reescritura masiva de la aplicación.

| Riesgo observado | Control implementado | Resultado esperado |
|---|---|---|
| Polling simultáneo de app, job, logs y mensajes | Política común de intervalos conservadores y backoff exponencial ante HTTP 429. | La sesión de un usuario no supera el rate limiter por consultas de estado normales. |
| Streams de logs cada 400 ms | Intervalo centralizado de 8 segundos, reintento único y sin reintento inmediato tras 429. | La consola conserva actualizaciones útiles sin generar cascadas de solicitudes. |
| Reparaciones repetidas o de duración indefinida | Máximo de dos ciclos en generación, uno en edición y presupuesto de 120 segundos. | Una app se preserva cuando no existe un parche seguro. |
| Patcher multiarchivo que reescribe un proyecto | Máximo absoluto de tres archivos por ciclo y solo como respaldo de un diagnóstico de tamaño reducido. | Se evitan reescrituras masivas, picos de tokens y regresiones por contexto truncado. |
| Chromium no instalado | Resultado `skipped`/`NO_CHROMIUM`, sin fallo de la app ni auto-fix. | Una limitación del entorno de validación no dispara generaciones adicionales. |
| Regresiones de safeguards | Suite `test:testing-agent-safety` y suite crítica existente. | Los límites, el backoff y la degradación segura quedan cubiertos por pruebas automáticas. |

## Política de validación

La validación de sintaxis y los chequeos deterministas se ejecutan dentro del flujo normal de generación. Las reparaciones de bajo riesgo pueden actuar sobre un diagnóstico pequeño, pero el agente deja de modificar la aplicación cuando excede los límites de número de problemas, archivos, ciclos o tiempo. En ese caso, registra la condición de calidad pendiente y conserva el bundle actual para que la revisión posterior sea explícita y reversible.

La validación visual es una capacidad complementaria. Solo debe evaluar una app cuando existe un navegador funcional en el entorno de validación. Si Chromium o Puppeteer no están disponibles, el resultado se marca como **omitido por infraestructura**; no se clasifica como pantalla en blanco, no reduce la puntuación de la aplicación y no activa rutas de autofix.

> La ausencia de una dependencia de validación nunca debe interpretarse como un defecto del código del cliente.

## Política de polling

La interfaz utiliza `job-polling.ts` como fuente única para los intervalos de seguimiento de generación. Las consultas de aplicación, estado de job, logs, mensajes y panel administrativo operan con frecuencias entre seis y doce segundos. Cuando una llamada devuelve HTTP 429, el siguiente intento se difiere con backoff exponencial y el cliente no realiza reintentos inmediatos.

| Recurso | Intervalo base |
|---|---:|
| Estado de aplicación | 8 s |
| Trabajo activo y detalle de job | 6 s |
| Logs de generación | 8 s |
| Mensajes de aplicación | 10 s |
| Trabajos administrativos | 10 s |
| Logs administrativos | 12 s |

## Operación y mantenimiento

El panel administrativo debe evitar reintentar trabajos fallidos de forma repetida. Los jobs históricos en fase `reviewing` que exceden el umbral operativo pueden limpiarse con la herramienta específica, sin tocar un job actual en fase `testing` o `generating`. La eliminación de trabajos, los reintentos forzados y la restauración de revisiones deben mantenerse como operaciones explícitas y auditables.

La validación visual completa sigue requiriendo aprovisionar Chromium en la imagen de ejecución o configurar un navegador remoto aprobado. Esa mejora es opcional para la disponibilidad de generación: mientras no esté configurada, el sistema continuará con validación estática y marcará el test visual como omitido.

## Comandos de verificación

```bash
pnpm --filter @workspace/appforge run typecheck
pnpm --filter @workspace/appforge run build
pnpm --filter @workspace/api-server run test:critical-fixes
pnpm --filter @workspace/api-server run test:testing-agent-safety
pnpm --filter @workspace/api-server run build
```

La publicación a producción debe usar la ruta de despliegue habitual de Maris AI para sus servicios de API y worker. El build de producción debe ejecutarse tanto para `artifacts/api-server` como para el worker, porque el Testing Agent y la cola viven en el backend y no solo en el frontend.
