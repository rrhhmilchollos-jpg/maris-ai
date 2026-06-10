# Auditoría de producción Maris AI

## Botón GitHub

La sesión admin en `www.marisai.es` funciona correctamente (`rrhh.milchollos@gmail.com`, `isAdmin: true`). El endpoint autenticado `/api/github/status` responde `{ connected: false }`, por tanto el botón no podía subir proyectos porque la cuenta GitHub aún no estaba conectada.

El endpoint `/api/github/connect-url` sí devuelve una URL OAuth, pero con el cambio anterior apuntaba a `https://maris-ai-api-server-production-fbad.up.railway.app/api/github/callback`. Al abrirla, GitHub respondió **Invalid Redirect URI**, lo que confirma que el OAuth App de GitHub no tiene registrada la URL Railway como callback.

Se corrigió el código para volver a usar `https://api.marisai.es/api/github/callback` por defecto, que es el callback más probable/esperado por la OAuth App.

## Bloqueo pendiente para GitHub

`api.marisai.es` está configurado en Railway en el servicio `maris-ai-api-server`, pero Railway muestra estado **Waiting for DNS update**. El panel de Railway exige estos registros:

- `CNAME api -> qt3eg4mi.up.railway.app`
- `TXT _railway.api -> railway-verify=...`

DNS actual:

- `api.marisai.es CNAME -> qt3eg4mi.up.railway.app` existe.
- `_railway.api.marisai.es TXT` no existe.
- `https://api.marisai.es/api/health` falla por certificado: el certificado no cubre `api.marisai.es`.

Conclusión: el botón GitHub queda corregido en código, pero para que el OAuth funcione en vivo hay que añadir el TXT de verificación que Railway muestra para `api.marisai.es` y esperar a que Railway emita el certificado TLS. Sin ese TXT, GitHub puede aceptar la URL pero el callback puede fallar por SSL.

## Tickets y clientes

Desde sesión admin:

- `/api/admin/tickets` responde 200 y devuelve 3 tickets históricos. Los tickets llegan al panel admin.
- `/api/admin/users` responde 200 y devuelve 16 usuarios/clientes. Hay clientes recientes, por ejemplo registros del 2026-06-10.
- Se añadió notificación por email al propietario para nuevos tickets usando Resend si `RESEND_API_KEY` está configurado y fallback a logs si no lo está.

## Commits aplicados

- `d99fdf0`: `fix: github oauth callback and support ticket emails`
- `cab2d7a`: `fix: use api domain for github oauth redirect`
