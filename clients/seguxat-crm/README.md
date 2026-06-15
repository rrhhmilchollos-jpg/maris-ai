# Seguxat — CRM de ventas

CRM de ventas para Seguxat (clon funcional del flujo comercial de Securitas Direct):
pipeline de leads, agenda, cartera de clientes, catálogo/presupuestos y equipo
comercial. Incluye backend propio con autenticación de empleados (email +
contraseña y verificación en dos pasos con Google) y roles (director / comercial).

## Estructura

- `backend/` — API Express + MongoDB. Ver `backend/README.md` para la puesta en
  marcha, el script de seed del director y cómo dar de alta empleados.
- `frontend/SeguxatCRM.jsx` — interfaz React (Tailwind, recharts, lucide-react).

## Despliegue y dominio (seguxat.es)

Pensado para vivir bajo el dominio de Seguxat, p. ej.:

- Frontend (Vercel) → `crm.seguxat.es`
- Backend (Railway) → `api.seguxat.es` (o ruta `/api` del mismo proyecto), con
  `MONGODB_URI` apuntando a la base de datos de Seguxat.

Pasos pendientes (requieren acceso a las cuentas de Seguxat, no disponibles
desde aquí):

1. **DNS (Arsys)**: añadir el/los subdominios (`crm`, `api`) apuntando a Vercel/Railway.
2. **MongoDB**: crear/usar la base de datos de Seguxat y poner su cadena de
   conexión en `backend/.env` como `MONGODB_URI`.
3. **Google OAuth (verificación en 2 pasos)**: crear un Client ID de OAuth2 en
   Google Cloud Console con "Authorized JavaScript origins" / "redirect URIs"
   apuntando a `https://crm.seguxat.es` (no reutilizar el de marisai.es sin
   añadir este origen, o el login con Google fallará). Poner ese Client ID en
   `backend/.env` (`GOOGLE_CLIENT_ID`) y en `frontend/SeguxatCRM.jsx`
   (`GOOGLE_CLIENT_ID`).
4. **Cuenta de director**: rellenar `DIRECTOR_*` en `.env` y ejecutar
   `npm run seed:director`.
5. **Alta de empleados**: desde el panel "Empleados" (solo visible para el
   director) dentro del propio CRM ya desplegado.
