# Análisis del Sistema de Créditos: plataformas de referencia vs Maris AI

## Hallazgos en plataformas de referencia
Tras investigar el modelo de **plataformas de referencia**, he identificado los siguientes puntos clave sobre su sistema de créditos:

1.  **Modelo de Suscripción:**
    *   **Free:** 10 créditos/mes.
    *   **Standard ($20/mes):** 100 créditos/mes.
    *   **Pro ($200/mes):** 750 créditos/mes.
2.  **Mecánica de Consumo ("Burn Rate"):**
    *   Los créditos se consumen por **acción o prompt**.
    *   Un prompt simple puede costar entre **1 y 3 créditos**.
    *   Tareas complejas o errores que generan bucles de agentes pueden "quemar" créditos rápidamente (usuarios reportan gastar 50-100 créditos en un solo día de trabajo intenso).
    *   El despliegue tiene un coste fijo (aprox. 50 créditos/mes según reportes).
3.  **Transparencia:**
    *   El sistema descuenta créditos en tiempo real mientras el agente está "corriendo" (planificando, codificando o desplegando).
    *   No hay un límite de tokens explícito para el usuario, sino que el coste se traslada al crédito.

## Propuesta para Maris AI (Modelo Optimizado)
Para Maris AI, aplicaremos un modelo inspirado en plataformas de referencia pero **más justo y eficiente**, evitando la frustración de los usuarios por "quema" inesperada:

| Concepto | Coste Maris AI (Propuesto) | Notas |
| :--- | :--- | :--- |
| **Arranque de Proyecto** | 1 Crédito | Incluye planificación y arquitectura inicial. |
| **Sesión de Ingeniería** | 1 Crédito / hora | Consumo dinámico basado en tiempo de actividad del agente. |
| **Refinamientos/Chat** | 0.2 Créditos | Cambios menores o consultas al chat. |
| **Despliegue (Deploy)** | 5 Créditos | Coste único por versión estable desplegada. |
| **Límite de Tokens** | 128k (Máximo) | Sin cortes por longitud de respuesta. |

## Implementación Técnica
*   **Backend:** Modificar `chargeCredits` para soportar decimales (0.2) y añadir un sistema de "sesión activa" para no cobrar por cada mensaje si están en la misma hora de trabajo.
*   **Frontend:** Mostrar el "Burn Rate" en el GenerationStudio para que el usuario vea cómo se consumen sus créditos de forma transparente.
