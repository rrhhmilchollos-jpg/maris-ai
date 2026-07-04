# PENDIENTES.md — Lo que queda por hacer (y solo puede hacerlo el dueño)

> Este archivo existe para que nada se quede a medias ni se olvide.
> Cuando completes un punto, márcalo con `[x]` y haz commit. Si un punto
> lleva más de un mes sin tocarse, pregúntate si sigue siendo necesario.

Última actualización: 2026-07-04

---

## 🔴 URGENTE — Seguridad

- [ ] **Revocar el token de GitHub filtrado** (`ghp_5a7s…`). Se pegó en un chat
  y sigue activo. GitHub → Settings → Developer settings → Personal access
  tokens (classic) → Delete. 30 segundos.

- [ ] **Configurar la clave de cifrado de conectores.** Sin ella, guardar
  credenciales de conectores devuelve error 503 a propósito (nunca se guardan
  secretos en texto plano).
  1. Genera la clave: `openssl rand -hex 32`
  2. Añádela como variable `CONNECTOR_ENCRYPTION_KEY` en Railway/Render
     (donde corre el api-server).
  3. NO la cambies después: si cambia, las credenciales ya guardadas quedan
     ilegibles y los usuarios tendrán que reconectar sus servicios.

---

## 🟡 Ya implementado — solo falta desplegarlo y probarlo

Todo esto está en el código (ramas fusionadas a `main`), pero conviene
verificarlo en producción una vez:

- [ ] **Auto-pinning dinámico** (`deployBundle.ts` + `dynamicPinning.ts`):
  generar una app que importe un paquete fuera del catálogo (p.ej. pedir
  "una tabla con @tanstack/react-table") y comprobar que en MongoDB aparece
  la colección `pinned_packages` con una entrada `verified`.
- [ ] **Guardado de conectores**: desde el panel de integraciones, conectar
  un servicio sencillo (p.ej. un webhook o Notion) y comprobar que aparece
  en la colección `connector_credentials` con `ciphertext` (nunca el token
  en claro).
- [ ] **Ejecución de acciones**: `POST /api/connectors/slack/actions/send-message`
  con `{ "params": { "text": "hola desde Maris" } }` y ver el mensaje en Slack.
- [ ] **Recompilar `lib/db` antes del api-server** en el pipeline de build
  (los modelos nuevos `PinnedPackage` y `ConnectorCredential` viven ahí).

---

## 🟠 Requiere crear credenciales en consolas externas (nadie puede hacerlo por ti)

### Google OAuth (para Google Sheets y Google Calendar)
Los conectores de Google están en el catálogo pero deshabilitados porque
necesitan OAuth2 (una API key suelta no sirve, lo dice el propio verificador).

- [ ] Crear proyecto en https://console.cloud.google.com
- [ ] Habilitar las APIs "Google Sheets API" y "Google Calendar API"
- [ ] Crear credencial "OAuth client ID" tipo Web, con redirect URI:
  `https://TU-DOMINIO/api/connectors/google/callback`
- [ ] Guardar `GOOGLE_OAUTH_CLIENT_ID` y `GOOGLE_OAUTH_CLIENT_SECRET` como
  variables de entorno del api-server
- [ ] Pedir a la IA (o al equipo) implementar el flujo: ruta
  `/api/connectors/google/authorize` → consent de Google → callback guarda
  el refresh_token cifrado en `connector_credentials` (la infraestructura de
  cifrado y almacenamiento YA existe, solo falta el baile OAuth) → añadir
  acciones `append-row` / `list-events` en `connectorActions.ts` siguiendo
  el patrón de las demás.

### Microsoft OAuth (SharePoint / OneDrive)
- [ ] Registrar app en https://entra.microsoft.com (App registrations)
- [ ] Permisos delegados: `Files.ReadWrite`, `Sites.ReadWrite.All`
- [ ] Guardar `MS_OAUTH_CLIENT_ID` y `MS_OAUTH_CLIENT_SECRET` en el entorno
- [ ] Mismo patrón que Google: authorize → callback → refresh_token cifrado
  → acciones en `connectorActions.ts` contra Microsoft Graph API.

### Login de un clic para las APPS GENERADAS ("Sign in with Google" en las apps de tus usuarios)
Esto es distinto del login de Maris AI (que ya funciona con Clerk). Es que
las apps que genera tu agente puedan ofrecer login real a SUS usuarios.

- [ ] Decidir el modelo: (a) cada app generada usa su propio proyecto de
  Clerk/Supabase Auth que configura el dueño de la app, o (b) Maris ofrece
  "Maris Auth" multi-tenant. La opción (a) es 10x más simple y es lo que
  hacen la mayoría de plataformas al principio.
- [ ] Si (a): añadir al prompt del agente una plantilla de integración de
  Clerk/Supabase Auth con las claves como variables de entorno del proyecto
  generado, y un paso en el panel de despliegue que pida esas claves.

---

## 🟢 Mejoras opcionales (cuando lo anterior esté rodando)

- [ ] Panel de administración de `pinned_packages` (ver qué paquetes exóticos
  pide la gente en realidad → decide qué conectores/librerías priorizar con
  datos, no intuición).
- [ ] Nodo "connector-action" en el editor de Workflows que llame a
  `executeConnectorAction()` (la función ya existe y está pensada para esto;
  el motor de ejecución de workflows del backend está por construir).
- [ ] Frontend del panel de integraciones: hoy verifica y guarda; añadir
  botón "probar acción" que llame a `POST /api/connectors/:id/actions/:actionId`.
- [ ] Zendesk como conector con acciones (el verificador se puede añadir en
  `mcpIntegrations.ts` y las acciones en `connectorActions.ts` siguiendo el
  patrón de Jira: subdominio + email + API token).

---

## Mapa de dónde está cada cosa

| Pieza | Archivo |
|---|---|
| Auto-pinning dinámico | `artifacts/api-server/src/lib/dynamicPinning.ts` |
| Enganche del pinning al preview | `artifacts/api-server/src/lib/deployBundle.ts` |
| Prompt restringido del agente | `artifacts/api-server/src/routes/apps.ts` (sección SYNTAX) |
| Cifrado de credenciales | `artifacts/api-server/src/lib/connectorCrypto.ts` |
| Gateway de acciones | `artifacts/api-server/src/lib/connectorActions.ts` |
| API REST de conectores | `artifacts/api-server/src/routes/connectors.ts` |
| Verificadores de conexión | `artifacts/api-server/src/routes/mcpIntegrations.ts` |
| Modelos Mongo (PinnedPackage, ConnectorCredential) | `lib/db/src/schema/index.ts` |
