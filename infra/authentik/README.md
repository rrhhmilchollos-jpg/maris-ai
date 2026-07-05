# Authentik para Maris AI — Fase 1: entorno de pruebas local

**Estado actual: NO tocamos producción.** Clerk sigue siendo el sistema de
login real de marisai.es. Esto es un entorno aislado en tu máquina para
aprender a manejar Authentik y validar que hace todo lo que necesitas
*antes* de plantearnos migrar de verdad.

## Requisitos

- Docker Desktop instalado y **corriendo** (icono de la ballena activo)
- ~5 minutos

## Paso 1 — Generar los secretos

Abre una terminal (Mac: Terminal / Windows: PowerShell con Docker Desktop
activo) y ejecuta:

```bash
# Si estás en Mac/Linux:
openssl rand -base64 36   # cópialo → será tu PG_PASS
openssl rand -base64 60   # cópialo → será tu AUTHENTIK_SECRET_KEY
```

En Windows con PowerShell, si `openssl` no está disponible, usa esta
alternativa (da igual, solo necesitas dos cadenas largas y aleatorias):

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Ejecuta ese comando dos veces (una para cada clave que necesitas).

## Paso 2 — Configurar el .env

En esta carpeta (`infra/authentik/`):

```bash
cp .env.example .env
```

Abre `.env` con cualquier editor de texto y pega los dos valores que
generaste en el Paso 1 en `PG_PASS` y `AUTHENTIK_SECRET_KEY`.

## Paso 3 — Levantar Authentik

Desde esta misma carpeta (`infra/authentik/`):

```bash
docker compose pull
docker compose up -d
```

La primera vez tarda 1-2 minutos en descargar las imágenes. Comprueba que
los 4 servicios están sanos:

```bash
docker compose ps
```

Deberías ver `postgresql`, `redis`, `server` y `worker` en estado
`running`/`healthy`.

## Paso 4 — Acceder al panel

Abre en el navegador: **http://localhost:9000/if/flow/initial-setup/**

La primera vez te pedirá crear el usuario `akadmin` (administrador) con
tu email y una contraseña — este es TU acceso de administrador al sistema
de identidad, no un usuario de Maris AI.

## Paso 5 — Explorar (sin prisa)

Una vez dentro, en el menú de la izquierda:

- **Applications → Applications**: aquí crearás "Maris AI" como aplicación
  cuando lleguemos a la fase de conectar el login real
- **Directory → Users**: aquí vivirían tus usuarios (de momento vacío)
- **Customization → Branding**: aquí cambias logo/colores por los de
  Maris AI

## Cuándo pasar a la siguiente fase

Cuando hayas entrado al panel y le hayas echado un ojo tranquilo (sin
prisa, como pediste), dime y seguimos con:

**Fase 2**: crear la "Application" de Maris AI dentro de Authentik + un
proveedor OAuth2/OIDC, para que puedas ver cómo sería el flujo de login
real — todavía sin tocar el código de Maris AI ni Clerk.

**Fase 3**: recién ahí, con todo probado y entendido, hablamos de cómo
migrar el código real (`auth.ts`, `clerkWebhook.ts`, el frontend) y —
más importante — cómo migrar a los usuarios existentes sin que nadie se
quede fuera de su cuenta. Esa es la parte más delicada y la haremos con
mucho cuidado, probablemente con un periodo en el que ambos sistemas
convivan.

## Para parar todo (no borra nada)

```bash
docker compose stop
```

## Para borrar todo y empezar de cero

```bash
docker compose down -v
```
