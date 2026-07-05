# Maris AI — App híbrida Android (guía completa)

## Fase 1 — YA HECHA (en este commit)

- Capacitor instalado (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`)
- Proyecto nativo Android generado en `android/` (Gradle, manifest, todo lo
  necesario para compilar)
- `capacitor.config.ts`: `appId: es.marisai.app`, apunta a `dist/` (el mismo
  build de siempre)
- `.env.capacitor`: fija la URL del backend de forma absoluta
  (`VITE_API_URL=https://maris-ai-api-server-production-fbad.up.railway.app`)
  porque dentro de la app nativa no existe el proxy de Vercel que reescribe
  `/api/...` en la web
- Confirmado que el backend ya permite el origen `https://localhost` (el que
  usa Capacitor por defecto) — no hace falta tocar el CORS

## Lo que TÚ necesitas hacer (yo no tengo Android SDK ni un móvil aquí)

### Paso 1 — Instalar Android Studio

Descárgalo de https://developer.android.com/studio (gratis). Al abrirlo la
primera vez, te guía para instalar el Android SDK — acepta todo por defecto.

### Paso 2 — Clonar el repo y preparar el proyecto

```bash
git clone https://github.com/rrhhmilchollos-jpg/maris-ai.git
cd maris-ai/artifacts/appforge
pnpm install
```

### Paso 3 — Generar el icono real de la app

Ahora mismo la app usa el icono genérico de Capacitor. Para poner el logo
real de Maris AI:

```bash
pnpm add -D @capacitor/assets
```

Coloca tu logo en alta resolución (mínimo 1024×1024px, fondo transparente o
sólido) en `appforge/resources/icon.png`, y un splash screen en
`appforge/resources/splash.png` (2732×2732px recomendado), luego:

```bash
npx capacitor-assets generate --android
```

Esto genera automáticamente todos los tamaños que Android necesita.

### Paso 4 — Compilar y sincronizar

```bash
pnpm cap:sync
```

Esto construye la web con la URL de API correcta y copia el resultado
dentro del proyecto Android.

### Paso 5 — Abrir en Android Studio y probar

```bash
npx cap open android
```

Se abre Android Studio con el proyecto. Dale a ▶ (Run) para probarlo en un
emulador o en tu móvil conectado por USB (con "Depuración USB" activada en
Ajustes de desarrollador). **Prueba de verdad el flujo completo**: login,
generar una app, ver el preview, pagar — antes de publicar nada.

### Paso 6 — Generar la clave de firma (keystore)

**Esto es crítico y solo lo haces tú, una vez, y la guardas para siempre.**
Si la pierdes, no podrás volver a actualizar la app en Google Play jamás —
tendrías que publicarla como una app nueva.

En Android Studio: `Build` → `Generate Signed Bundle / APK` → `Android App
Bundle` → `Create new...`. Rellena los datos (te pedirá una contraseña —
guárdala en un gestor de contraseñas, no la pierdas) y guarda el archivo
`.keystore` en un sitio seguro **fuera del repositorio** (ya está excluido
en `.gitignore`, pero además haz una copia de seguridad tú mismo, por
ejemplo en un USB o en tu gestor de contraseñas).

### Paso 7 — Compilar el AAB firmado

Mismo asistente del paso 6, eligiendo tu keystore — genera un archivo
`.aab` (Android App Bundle), el formato que exige Google Play desde 2021
(ya no aceptan `.apk` directamente para publicaciones nuevas).

## Fase 3 — Publicar en Google Play (necesita tu cuenta)

### Paso 1 — Cuenta de Google Play Console

https://play.google.com/console/signup — pago único de 25$. Necesitas
verificar identidad (puede tardar hasta 48h la primera vez).

### Paso 2 — Crear la ficha de la app

Dentro de Play Console → "Crear app". Necesitarás:
- **Nombre**: Maris AI
- **Descripción corta y larga**: puedo ayudarte a redactarlas si quieres
- **Capturas de pantalla**: mínimo 2, recomendado 4-8, del móvil real
- **Icono**: 512×512px
- **Gráfico de la ficha**: 1024×500px
- **Política de privacidad**: URL pública — puedes reutilizar
  `https://www.marisai.es/legal/privacidad` si cubre bien el uso de datos
  dentro de la app (revísala, puede necesitar una sección específica de
  app móvil)

### Paso 3 — Cuestionario de clasificación de contenido

Preguntas sobre el contenido de la app (violencia, contenido para adultos,
etc.) — para Maris AI, casi todo "No" dado que es una herramienta de
generación de código.

### Paso 4 — Declaración de datos (Data Safety)

Google exige declarar qué datos recopilas y para qué (email, nombre, datos
de pago vía Stripe, etc.) — importante ser preciso aquí, Google revisa esto
activamente y puede rechazar la app si no coincide con el comportamiento
real.

### Paso 5 — Subir el AAB y enviar a revisión

Sube el `.aab` del Paso 7 de la Fase 2 en la sección "Producción" (o
"Prueba interna" primero, recomendado, para probar con pocos usuarios antes
del lanzamiento público). Google revisa en **1-7 días** normalmente para
apps nuevas.

## Notas importantes

- **Pagos dentro de la app**: si en algún momento permites que los clientes
  compren créditos DESDE la app de Android (no solo desde la web), Google
  Play exige usar su sistema de facturación (Google Play Billing) y se
  queda con una comisión (15-30%) — si los pagos siempre pasan por la web
  de Maris AI y la app solo abre esa web, esto no aplica, pero es una regla
  que Google vigila y puede rechazar la app si lo detecta mal implementado.
  Te recomiendo confirmarlo con cuidado antes de enviar a revisión.
- **App Bundle vs universal**: `.aab` permite que Google sirva versiones
  optimizadas por dispositivo — es lo normal, no hay que hacer nada extra.
