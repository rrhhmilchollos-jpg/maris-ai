
## Hallazgos en Google Ads — cuenta Maris AI 361-500-5084

La cuenta visible actualmente es **Maris AI 361-500-5084**, por lo que no se ha cambiado a otra cuenta. En la pantalla de configuración de objetivos de destino de la campaña se muestran varios objetivos activos, pero todos apuntan a rutas de `manoprotect.com` (`/sentinel-s`, `/sentinel-x`, `/sentinel-j`, `/gracias-compra-*`, `/gracias-suscripcion`, etc.). No aparece todavía un objetivo claro para `www.marisai.es/sign-up`, `www.marisai.es/onboarding` o el evento Google Ads `AW-18218229959/bd7tCPjYwbwcEMfBkO9D` asociado a **Registro**.

Google Ads también muestra una alerta superior indicando que los anuncios no se están publicando porque hay un saldo pendiente. No se ha pulsado `Solucionar`, no se han aplicado cambios de facturación ni se ha modificado la campaña sin confirmación del usuario.

En el código ya se corrigió el flujo para que el registro redirija a `/onboarding` y dispare la conversión `Registro` automáticamente al aterrizar en onboarding. El cambio está subido en el commit `7823671`.

## Estado operativo antes de revisar Arsys y URL exacta de Ads

En la pantalla de objetivos de destino de Google Ads se pausaron siete objetivos relacionados con `manoprotect.com`: `sentinel-s`, `sentinel-x`, `sentinel-j`, `gracias-compra-sentinel-j`, `gracias-compra-sentinel-s`, `gracias-suscripcion` y `sentinel-lock`. Queda visible un último objetivo activo `manoprotect.com/gracias-compra-lock`; la UI abre de forma inconsistente el editor en lugar del menú de pausa en algunos clics, por lo que no se debe guardar ningún cambio hasta completar la revisión de la campaña/URL exacta indicada por el usuario.

El intento de añadir `https://www.marisai.es/onboarding` desde esta pantalla no era correcto porque Google Ads lo anteponía al dominio base `manoprotect.com/`, confirmando que primero hay que cambiar la web base de la campaña o usar la configuración avanzada de conversiones/eventos para Maris AI.

## URL exacta indicada por el usuario

Se abrió la URL `https://ads.google.com/aw/recommendations?...campaignId=23909900064...`. La cuenta visible es `soportemarisai@gmail.com`, la campaña filtrada es **Maris AI A1**, y la recomendación destacada visible es **Termina de configurar el seguimiento de conversiones** con impacto `+93,5 %`. Esta es la página/campaña correcta indicada por el usuario. No se ha cambiado de cuenta.

La pantalla confirma que el problema principal de esta campaña concreta no es el panel simplificado anterior, sino la recomendación de medición: Google Ads detecta una acción de conversión creada pero todavía sin conversiones registradas/verificadas.
