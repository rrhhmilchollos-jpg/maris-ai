# Seguxat CRM — Backend

API en Express + MongoDB para el CRM de ventas de Seguxat: empleados con roles,
verificación en dos pasos con Google, pipeline de leads y cartera de clientes.

## 1. Configuración

```bash
cp .env.example .env
npm install
```

Rellena `.env` con los valores reales:

- **`MONGODB_URI`** — cadena de conexión a la base de datos de Seguxat
  (MongoDB Atlas o el cluster de Railway que ya usa Maris AI). Esta es la
  pieza que "enlaza" el CRM a las bases de datos reales de Seguxat: en
  cuanto pongas aquí la cadena correcta, todo lo demás (empleados, leads,
  clientes) se guarda en esa base de datos.
- **`JWT_SECRET`** — cualquier cadena aleatoria larga (`openssl rand -hex 32`).
- **`GOOGLE_CLIENT_ID`** — ID de cliente OAuth2 de un proyecto en
  [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
  (tipo "Aplicación web"). Necesario para la verificación en dos pasos.
- **`DIRECTOR_NAME` / `DIRECTOR_EMAIL` / `DIRECTOR_PASSWORD`** — tus datos
  como director. Solo se usan una vez, al ejecutar el script de seed (ver
  abajo). Después de ejecutarlo puedes borrarlos del `.env`.

## 2. Crear tu cuenta de director (Ivan)

```bash
npm run seed:director
```

Esto crea (o actualiza) tu cuenta con rol `director`: acceso total,
gestión de empleados, ves todo el pipeline y toda la cartera de clientes.

## 3. Verificación en dos pasos con Google

Flujo de inicio de sesión de cualquier empleado:

1. **Email + contraseña** → `POST /api/auth/login`
2. Si es la primera vez, el backend responde `step: "google-link-required"`:
   el empleado inicia sesión con Google y se vincula esa cuenta a su perfil
   (debe ser el mismo email).
3. En siguientes accesos, el backend responde `step: "google-verify"`: el
   empleado vuelve a verificarse con Google (segundo factor) y solo entonces
   se emite el token de sesión.

## 4. Dar de alta a un nuevo empleado (p. ej. la nueva incorporación)

Una vez tengas el backend corriendo y hayas iniciado sesión como director,
usa el panel **Empleados** del CRM (o directamente la API):

```
POST /api/employees
Authorization: Bearer <tu token de director>

{
  "name": "Nombre de la empleada",
  "email": "su-email@gmail.com",
  "password": "la-contraseña-que-quieras-asignarle",
  "role": "comercial",
  "zone": "Ruzafa / Eixample"
}
```

La contraseña se hashea (bcrypt) en el momento y nunca se guarda en texto
plano ni queda en el código fuente. Con esto la empleada ya puede:

1. Iniciar sesión con ese email + contraseña.
2. Vincular su cuenta de Google (paso 2, primera vez).
3. Operar en el CRM como empleada oficial de Seguxat, con permisos de
   `comercial` (su propio pipeline, agenda y clientes).

Si más adelante quiere cambiar su contraseña, tú (como director) puedes
restablecerla desde el mismo panel (`POST /api/employees/:id/reset-password`),
o se puede añadir un flujo de "cambiar mi contraseña" para el propio empleado.

## 5. Roles

| Rol | Permisos |
|---|---|
| `director` | Ve y modera todo el pipeline y la cartera. Crea, desactiva y cambia el rol de empleados. Restablece contraseñas. |
| `comercial` | Ve y gestiona solo los leads y clientes que tiene asignados, y su propia agenda. |

## 6. Desplegar y enlazar con Maris AI

- El backend está pensado para desplegarse en Railway (igual que el resto
  de servicios de Maris AI), apuntando a la misma base de datos MongoDB de
  Seguxat mediante `MONGODB_URI`.
- El frontend (`seguxat-crm.jsx`) debe configurarse con la URL pública de
  este backend (`API_BASE`) y desplegarse en Vercel.
- Una vez revisado, este código puede integrarse en el repositorio
  `rrhhmilchollos-jpg/maris-ai` como un nuevo proyecto cliente (p. ej. en
  `clients/seguxat-crm/`).
