# Diseño del Sistema de Créditos de Maris AI

## 1. Contexto y Objetivos

El objetivo es rediseñar el sistema de créditos de Maris AI inspirándose en el modelo de `plataformas de referencia`. Se requiere un enfoque dual:
1. **Usuarios Free (Prueba):** 10 créditos que rinden de forma generosa. Permiten generar 1 app y hacer hasta 20 modificaciones.
2. **Usuarios Paid (Verificados por Stripe):** Los créditos se queman de forma rápida y realista (estilo plataformas de referencia), donde cada acción compleja cuesta más créditos.

## 2. Análisis del Código Actual

En el archivo `artifacts/api-server/src/routes/apps.ts` ya existen comentarios y variables que apuntan a esta lógica, pero no están completamente integrados con la constante `KIND_COSTS` para los usuarios de pago.

```typescript
// Líneas 1874-1875 (Creación de App)
const isPaid = !!req.dbUser?.isPremium;
const cost = isPaid ? 10 : 6; 

// Líneas 2033-2034 (Modificación/Mensaje)
const isPaid = !!req.dbUser?.isPremium;
const cost = isPaid ? 2 : 0.2;
```

## 3. Nuevo Diseño de Costes

Para alinear el sistema con el modelo de plataformas de referencia (donde las acciones complejas cuestan más y se queman rápido), la lógica debe ser:

### 3.1. Usuarios Free (Prueba Generosa)
- **Generar App:** Coste fijo de **6 créditos**. (Sobran 4 de los 10 iniciales).
- **Modificación (Mensaje/Refinamiento):** Coste fijo de **0.2 créditos**. (Con 4 créditos se pueden hacer 20 modificaciones).
- **Reintentar App:** Coste fijo de **6 créditos**.

### 3.2. Usuarios Paid (Quema Rápida Estilo plataformas de referencia)
- **Generar App:** El coste debe basarse en la complejidad del proyecto, utilizando la tabla `KIND_COSTS` ya definida, multiplicada por un factor de quema rápida.
  - Coste base = `KIND_COSTS[kind || "fullstack"] || 3`
  - Coste final Paid = `Coste base * 10` (ej. fullstack = 30 créditos, landing = 10 créditos).
- **Modificación (Mensaje/Refinamiento):** Las iteraciones también queman créditos rápidamente.
  - Coste final Paid = **5 créditos** por modificación (o proporcional a la complejidad).
- **Reintentar App:** Mismo coste que generar la app.

## 4. Cambios Requeridos en el Código

1. **En `artifacts/api-server/src/routes/apps.ts`:**
   - Modificar la ruta `POST /apps` (Generar App) para calcular el coste según `isPaid` y `KIND_COSTS`.
   - Modificar la ruta `POST /apps/:id/messages` (Modificación) para calcular el coste según `isPaid`.
   - Modificar la ruta `POST /apps/:id/retry` (Reintentar) para usar la misma lógica que Generar App.

2. **Verificación de `isPremium`:**
   - La propiedad `isPremium` se define en el modelo `User` y se actualiza mediante los webhooks de Stripe. Ya está implementado en `artifacts/api-server/src/routes/me.ts` y en el webhook, pero en `req.dbUser` de los middlewares podría no estar calculado dinámicamente si solo se basa en el campo de la base de datos.
   - En `lib/auth.ts`, `ensureUser` no actualiza `isPremium` dinámicamente, solo lee el campo. Debemos asegurarnos de que `isPaid` se evalúe correctamente como `!!req.dbUser?.isPremium || (req.dbUser?.plan && req.dbUser?.plan !== "free")`.

## 5. Implementación Propuesta

```typescript
// En POST /apps
const isPaid = !!req.dbUser?.isPremium || (req.dbUser?.plan && req.dbUser?.plan !== "free");
const baseCost = KIND_COSTS[kind || "fullstack"] || 3;
// Free: 6 fijos. Paid: baseCost * 10 (ej. 30 créditos para fullstack)
const cost = isPaid ? (baseCost * 10) : 6;

// En POST /apps/:id/messages
const isPaid = !!req.dbUser?.isPremium || (req.dbUser?.plan && req.dbUser?.plan !== "free");
// Free: 0.2 fijos. Paid: 5 créditos por refinamiento
const cost = isPaid ? 5 : 0.2;

// En POST /apps/:id/retry
const isPaid = !!req.dbUser?.isPremium || (req.dbUser?.plan && req.dbUser?.plan !== "free");
const baseCost = KIND_COSTS[app.kind || "fullstack"] || 3;
const cost = isPaid ? (baseCost * 10) : 6;
```
