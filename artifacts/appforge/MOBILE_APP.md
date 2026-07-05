# Maris AI — Publicar en Google Play con PWABuilder

## Lo que ya está preparado en el repo (hecho en este commit)

- **Iconos PNG reales** generados a partir de `logo.svg`, en los tamaños y
  propósitos que PWABuilder/Google Play exigen (antes solo había un SVG,
  que PWABuilder no procesa bien para el paquete Android):
  - `icon-192-any.png`, `icon-512-any.png` (fondo transparente)
  - `icon-512-maskable.png` (fondo sólido `#0a0a0f`, logo con margen de
    seguridad para que Android no lo recorte al aplicar la máscara circular/
    squircle del icono)
  - `apple-touch-icon.png` (180×180, fondo sólido — antes esta ruta estaba
    rota, `index.html` la referenciaba pero el archivo no existía)
- `manifest.json` actualizado para declarar estos iconos correctamente
- `public/.well-known/assetlinks.json` — plantilla lista, **te falta
  rellenar tu huella SHA-256 real** (instrucciones dentro del propio
  archivo, y en el Paso 3 de abajo)

## Paso 1 — Generar el paquete en PWABuilder

1. Ve a **https://www.pwabuilder.com**
2. Pega `https://www.marisai.es` y dale a analizar
3. PWABuilder leerá tu `manifest.json` — debería puntuar bien ahora que
   tiene iconos PNG reales. Si marca algo en amarillo/rojo, dímelo y lo
   revisamos
4. En la pestaña **Android**, genera el paquete. Te dará a elegir entre:
   - **Dejar que PWABuilder firme por ti** (más simple, pero la clave la
     gestiona su plataforma)
   - **Usar tu propia clave de firma** (recomendado si ya tienes o vas a
     tener más apps — más control, pero tú gestionas la clave y su backup)

## Paso 2 — Descargar y quedarte con la huella SHA-256

Al generar el paquete, PWABuilder te muestra (o incluye en un archivo
`assetlinks.json` de ejemplo dentro del ZIP descargado) la huella SHA-256
de la clave de firma usada. Cópiala — la necesitas para el paso 3.

Si prefieres generarla tú mismo a partir de tu propio keystore:
```bash
keytool -list -v -keystore tu-clave.keystore
```
Busca la línea `SHA256:` en la salida.

## Paso 3 — Completar assetlinks.json y desplegarlo

Abre `artifacts/appforge/public/.well-known/assetlinks.json` en el repo,
sustituye `TU_HUELLA_SHA256_AQUI` por la huella real (formato
`AA:BB:CC:...`), borra las claves `_COMENTARIO`/`_INSTRUCCIONES`, haz
commit y despliega.

**Verifica que funciona antes de subir nada a Google Play:**
```
https://www.marisai.es/.well-known/assetlinks.json
```
Debe devolver el JSON tal cual, con tu huella real. Si esto no está bien
ANTES de publicar, la app se abrirá con la barra de direcciones de Chrome
visible en vez de verse como una app nativa — o Google puede rechazarla.

## Paso 4 — Subir a Google Play Console

Mismo proceso que cualquier app Android:

1. Cuenta en https://play.google.com/console/signup (pago único 25$,
   verificación de identidad puede tardar hasta 48h la primera vez)
2. Crear la app, subir el `.aab` que te dio PWABuilder
3. Ficha de la tienda: descripción, capturas de pantalla (puedo ayudarte a
   redactar la descripción), icono 512×512 (ya tienes `icon-512-any.png`),
   gráfico de la ficha 1024×500
4. Política de privacidad: puedes reutilizar
   `https://www.marisai.es/legal/privacidad`
5. Cuestionario de clasificación de contenido y "Data Safety" (declarar qué
   datos recopilas — email, datos de pago vía Stripe, etc.)
6. Enviar a revisión — Google tarda normalmente 1-7 días en apps nuevas

## Aviso importante — Google Play Billing

Si en algún momento permites que los clientes compren créditos **desde
dentro de la app** (no solo desde la web), Google Play exige su propio
sistema de facturación (Google Play Billing) y se queda con comisión
(15-30%). Si los pagos de Maris AI siempre pasan por Stripe en la web y la
app solo abre esa misma web, esto normalmente no aplica — pero es una
política que Google vigila activamente y puede rechazar la app si lo
detecta mal implementado. Confírmalo con cuidado antes de enviar a
revisión.

## Alternativa ya preparada: Capacitor + Android Studio

Si en el futuro necesitas funciones nativas que un TWA no puede dar
(notificaciones push nativas, acceso a cámara/archivos del sistema, etc.),
ya hay un proyecto Capacitor completo y funcional en `android/` (ver
commit anterior) como alternativa — no hace falta usarlo ahora, pero está
listo si lo necesitas.
