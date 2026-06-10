# Hallazgos DNS para seguxat.es en Arsys/Vercel

## Qué dice la documentación revisada

La documentación de terceros que describe el panel de Arsys no usa `@` como valor principal para el dominio raíz. En Arsys, el campo suele llamarse **Entrada DNS** y la documentación indica que debe contener el dominio o subdominio completo. En ejemplos de Arsys, para un registro de `www` se escribe `www.midominio.com`, y para el dominio sin `www` se edita la fila del dominio sin `www`. Por tanto, cuando Vercel muestra `A @ → 76.76.21.21`, en Arsys es más seguro traducirlo como:

- **Tipo:** A
- **Entrada DNS / Host / Nombre:** `seguxat.es` o dejarlo vacío si el panel lo permite para raíz
- **Valor:** `76.76.21.21`

Para `www`, en Arsys puede ser necesario escribir `www.seguxat.es` si no acepta solo `www`.

## Estado DNS actual comprobado

El dominio `seguxat.es` usa nameservers de Cloudflare:

- `cameron.ns.cloudflare.com`
- `khloe.ns.cloudflare.com`

Actualmente `seguxat.es` no devuelve registro A ni AAAA público, mientras que `www.seguxat.es` devuelve IPs de Cloudflare (`104.21.61.36` y `172.67.205.199`) y no un CNAME directo a Vercel.

## Conclusión práctica

Si los nameservers siguen siendo Cloudflare, cambiar registros en Arsys no tendrá efecto sobre la zona DNS activa. Hay dos opciones válidas:

1. Mantener Cloudflare como DNS activo y crear allí:
   - `A` para raíz (`@` en Cloudflare) → `76.76.21.21`
   - `CNAME` para `www` → `cname.vercel-dns.com`
   - Proxy en modo **DNS only** si Vercel requiere verificación directa.

2. Cambiar los nameservers en Arsys para que Arsys vuelva a gestionar la zona DNS y entonces crear:
   - `A` con Entrada DNS `seguxat.es` o campo vacío → `76.76.21.21`
   - `CNAME` con Entrada DNS `www.seguxat.es` o `www` → `cname.vercel-dns.com`

## Cambios hechos en Maris AI

Se ha corregido el modal de DNS para no indicar `@` como valor obligatorio en Arsys. Ahora la guía dice que en Arsys se debe usar el dominio completo o dejar el campo vacío si el panel lo permite.
