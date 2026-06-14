/**
 * integrationPlaybooks.ts
 *
 * "Playbooks" de integraciones — patrones de código VERIFICADOS y correctos
 * para los servicios externos más comunes (pagos, email, almacenamiento de
 * imágenes, mapas). Se inyectan como contexto de referencia en los prompts
 * de los agentes (architect/designer/frontend/backend) cuando se detecta que
 * el proyecto los necesita, para que generen código consistente y correcto
 * en lugar de "desde cero" cada vez.
 *
 * Inspirado en el sistema de "Playbooks" de Emergent.sh (gap #3 de la
 * comparativa): configuraciones predefinidas y verificadas para Stripe,
 * email transaccional, almacenamiento de imágenes y mapas.
 */

export interface IntegrationPlaybook {
  /** Identificador corto, usado en logs */
  id: string;
  /** Nombre legible del servicio */
  name: string;
  /** Palabras clave (es/en) que activan este playbook si aparecen en el prompt */
  keywords: string[];
  /** Variables de entorno que requiere */
  envVars: string[];
  /** Paquete(s) npm a instalar */
  packages: string[];
  /** Bloque de referencia inyectado en el prompt del agente */
  snippet: string;
}

export const INTEGRATION_PLAYBOOKS: IntegrationPlaybook[] = [
  {
    id: "stripe-checkout",
    name: "Stripe Checkout (pagos)",
    keywords: [
      "stripe", "pago", "pagos", "pasarela", "checkout", "suscripcion", "suscripción",
      "cobrar", "tarjeta", "membresia", "membresía", "plan premium", "compra",
    ],
    envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    packages: ["stripe"],
    snippet: `### Playbook: Stripe Checkout (pagos)
Backend (Express) — crear sesión de pago:
\`\`\`ts
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

app.post("/api/checkout", async (req, res) => {
  const { priceId, successUrl, cancelUrl } = req.body;
  const session = await stripe.checkout.sessions.create({
    mode: "payment", // o "subscription" para recurrente
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  res.json({ url: session.url });
});
\`\`\`
Frontend — redirigir al checkout:
\`\`\`ts
const { url } = await apiFetch("/api/checkout", { method: "POST", body: JSON.stringify({ priceId, successUrl, cancelUrl }) });
window.location.href = url;
\`\`\`
Webhook (Express, raw body ANTES de express.json()):
\`\`\`ts
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"]!, process.env.STRIPE_WEBHOOK_SECRET!);
  if (event.type === "checkout.session.completed") { /* marcar pedido como pagado */ }
  res.json({ received: true });
});
\`\`\``,
  },
  {
    id: "resend-email",
    name: "Resend (email transaccional)",
    keywords: [
      "email", "correo", "notificacion por correo", "notificación por correo",
      "enviar email", "enviar correo", "newsletter", "confirmacion por email", "confirmación por email",
    ],
    envVars: ["RESEND_API_KEY"],
    packages: ["resend"],
    snippet: `### Playbook: Resend (email transaccional)
Backend (Express):
\`\`\`ts
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY!);

await resend.emails.send({
  from: "App <onboarding@resend.dev>", // cambiar por dominio verificado en producción
  to: [userEmail],
  subject: "Bienvenido",
  html: "<p>Gracias por registrarte.</p>",
});
\`\`\`
Usar siempre desde el backend — NUNCA expongas RESEND_API_KEY al cliente.`,
  },
  {
    id: "cloudinary-uploads",
    name: "Cloudinary (subida de imágenes)",
    keywords: [
      "subir imagen", "subir imagenes", "subir foto", "subir fotos", "galeria", "galería",
      "avatar", "logo upload", "imagen de perfil", "fotos de producto", "almacenamiento de imagenes", "almacenamiento de imágenes",
    ],
    envVars: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
    packages: ["cloudinary", "multer"],
    snippet: `### Playbook: Cloudinary (subida de imágenes)
Backend (Express + multer en memoria):
\`\`\`ts
import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage() });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const b64 = Buffer.from(req.file!.buffer).toString("base64");
  const result = await cloudinary.uploader.upload(\`data:\${req.file!.mimetype};base64,\${b64}\`, { folder: "uploads" });
  res.json({ url: result.secure_url });
});
\`\`\`
Guarda \`result.secure_url\` en MongoDB — nunca el archivo binario.`,
  },
  {
    id: "google-maps",
    name: "Google Maps (mapas y ubicaciones)",
    keywords: [
      "mapa", "mapas", "ubicacion", "ubicación", "localizacion", "localización",
      "direccion", "dirección", "geolocalizacion", "geolocalización", "puntos en el mapa", "sucursales",
    ],
    envVars: ["VITE_GOOGLE_MAPS_API_KEY"],
    packages: ["@react-google-maps/api"],
    snippet: `### Playbook: Google Maps (mapas)
Frontend (React):
\`\`\`tsx
import { GoogleMap, Marker, useLoadScript } from "@react-google-maps/api";

function MapView({ lat, lng }: { lat: number; lng: number }) {
  const { isLoaded } = useLoadScript({ googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY });
  if (!isLoaded) return <div>Cargando mapa…</div>;
  return (
    <GoogleMap center={{ lat, lng }} zoom={13} mapContainerStyle={{ width: "100%", height: "400px" }}>
      <Marker position={{ lat, lng }} />
    </GoogleMap>
  );
}
\`\`\`
La API key de Google Maps va en el FRONTEND (prefijo VITE_), restríngela por dominio en Google Cloud Console.`,
  },
  {
    id: "paypal-checkout",
    name: "PayPal Checkout (pagos)",
    keywords: ["paypal", "pago con paypal"],
    envVars: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
    packages: ["@paypal/checkout-server-sdk", "@paypal/react-paypal-js"],
    snippet: `### Playbook: PayPal Checkout (pagos)
Backend (Express) — crear y capturar orden:
\`\`\`ts
import paypal from "@paypal/checkout-server-sdk";
const env = new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID!, process.env.PAYPAL_CLIENT_SECRET!);
// Producción: new paypal.core.LiveEnvironment(...)
const client = new paypal.core.PayPalHttpClient(env);

app.post("/api/paypal/create-order", async (req, res) => {
  const request = new paypal.orders.OrdersCreateRequest();
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "EUR", value: req.body.amount } }],
  });
  const order = await client.execute(request);
  res.json({ id: order.result.id });
});

app.post("/api/paypal/capture/:orderId", async (req, res) => {
  const request = new paypal.orders.OrdersCaptureRequest(req.params.orderId);
  const capture = await client.execute(request);
  res.json(capture.result);
});
\`\`\`
Frontend — botón oficial:
\`\`\`tsx
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
<PayPalScriptProvider options={{ clientId: import.meta.env.VITE_PAYPAL_CLIENT_ID }}>
  <PayPalButtons
    createOrder={async () => (await apiFetch("/api/paypal/create-order", { method: "POST", body: JSON.stringify({ amount: "10.00" }) })).id}
    onApprove={async (data) => apiFetch(\`/api/paypal/capture/\${data.orderID}\`, { method: "POST" })}
  />
</PayPalScriptProvider>
\`\`\``,
  },
  {
    id: "whatsapp-twilio",
    name: "WhatsApp Business vía Twilio (notificaciones)",
    keywords: ["whatsapp", "mensaje de whatsapp", "notificacion por whatsapp", "avisar por whatsapp"],
    envVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_NUMBER"],
    packages: ["twilio"],
    snippet: `### Playbook: WhatsApp Business vía Twilio (notificaciones)
Backend (Express):
\`\`\`ts
import twilio from "twilio";
const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

await client.messages.create({
  from: \`whatsapp:\${process.env.TWILIO_WHATSAPP_NUMBER}\`, // sandbox: whatsapp:+14155238886
  to: \`whatsapp:\${userPhoneE164}\`, // formato +34XXXXXXXXX
  body: "Tu pedido #1234 ha sido confirmado.",
});
\`\`\`
En sandbox de Twilio, el destinatario debe enviar primero el código "join xxx-xxx" al número de sandbox.
En producción se requiere plantilla de mensaje aprobada por WhatsApp (Message Templates).`,
  },
  {
    id: "mercadopago-checkout",
    name: "Mercado Pago (pagos LatAm)",
    keywords: ["mercado pago", "mercadopago", "pago en argentina", "pago en mexico", "pago en méxico"],
    envVars: ["MERCADOPAGO_ACCESS_TOKEN"],
    packages: ["mercadopago"],
    snippet: `### Playbook: Mercado Pago Checkout Pro (pagos LatAm)
Backend (Express):
\`\`\`ts
import { MercadoPagoConfig, Preference } from "mercadopago";
const mpClient = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN! });

app.post("/api/mercadopago/preference", async (req, res) => {
  const preference = new Preference(mpClient);
  const result = await preference.create({
    body: {
      items: [{ title: req.body.title, quantity: 1, unit_price: req.body.price, currency_id: "ARS" }],
      back_urls: { success: req.body.successUrl, failure: req.body.failureUrl },
      auto_return: "approved",
    },
  });
  res.json({ init_point: result.init_point });
});
\`\`\`
Frontend: redirige a \`window.location.href = init_point\`. \`currency_id\` según país (ARS, MXN, COP, etc.).`,
  },
  {
    id: "google-calendar",
    name: "Google Calendar (citas y eventos)",
    keywords: ["calendario", "agenda de citas", "reservar cita", "google calendar", "sincronizar calendario"],
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    packages: ["googleapis"],
    snippet: `### Playbook: Google Calendar (citas y eventos)
Backend (Express), tras OAuth con refresh_token guardado del usuario:
\`\`\`ts
import { google } from "googleapis";
const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
oauth2Client.setCredentials({ refresh_token: userRefreshToken });
const calendar = google.calendar({ version: "v3", auth: oauth2Client });

await calendar.events.insert({
  calendarId: "primary",
  requestBody: {
    summary: "Cita: " + customerName,
    start: { dateTime: "2026-06-20T10:00:00", timeZone: "Europe/Madrid" },
    end: { dateTime: "2026-06-20T10:30:00", timeZone: "Europe/Madrid" },
  },
});
\`\`\`
Requiere flujo OAuth previo (scope \`https://www.googleapis.com/auth/calendar\`) para obtener el refresh_token del usuario.`,
  },
  {
    id: "openai-image-gen",
    name: "Generación de imágenes con IA (OpenAI)",
    keywords: ["generar imagen con ia", "logo con ia", "logos con ia", "crear logo", "crear un logo", "diseño de logo", "logo para mi", "imagen generada por ia", "dall-e", "generador de imagenes", "generador de logos"],
    envVars: ["OPENAI_API_KEY"],
    packages: ["openai"],
    snippet: `### Playbook: Generación de imágenes con IA (OpenAI)
Backend (Express):
\`\`\`ts
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

app.post("/api/generate-image", async (req, res) => {
  const result = await openai.images.generate({
    model: "dall-e-3",
    prompt: req.body.prompt,
    size: "1024x1024",
  });
  res.json({ url: result.data[0].url }); // URL temporal — descárgala y sube a Cloudinary/S3 si necesitas persistencia
});
\`\`\`
Las URLs de OpenAI expiran (~1h). Para guardarlas, descarga la imagen y sube a Cloudinary (ver playbook Cloudinary).`,
  },
  {
    id: "google-oauth-login",
    name: "Login social con Google (OAuth)",
    keywords: ["iniciar sesion con google", "iniciar sesión con google", "login con google", "google login", "social login", "cuenta de google", "registrarse con google", "registro con google", "autenticacion con google", "autenticación con google"],
    envVars: ["GOOGLE_CLIENT_ID"],
    packages: ["google-auth-library", "@react-oauth/google"],
    snippet: `### Playbook: Login social con Google (OAuth)
Frontend (React):
\`\`\`tsx
import { GoogleLogin } from "@react-oauth/google";
<GoogleLogin onSuccess={(cred) => apiFetch("/api/auth/google", { method: "POST", body: JSON.stringify({ credential: cred.credential }) })} />
\`\`\`
Backend (Express) — verifica el token:
\`\`\`ts
import { OAuth2Client } from "google-auth-library";
const oauthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.post("/api/auth/google", async (req, res) => {
  const ticket = await oauthClient.verifyIdToken({ idToken: req.body.credential, audience: process.env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload(); // { email, name, picture, sub }
  // buscar/crear usuario por payload.sub y emitir tu propia sesión/JWT
});
\`\`\`
Envuelve la app en \`<GoogleOAuthProvider clientId={...}>\` desde \`@react-oauth/google\`.`,
  },
  {
    id: "aws-s3-storage",
    name: "AWS S3 (almacenamiento de archivos)",
    keywords: ["aws s3", "amazon s3", "almacenamiento en la nube", "subir archivos grandes", "almacenamiento de archivos"],
    envVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_S3_BUCKET"],
    packages: ["@aws-sdk/client-s3", "multer"],
    snippet: `### Playbook: AWS S3 (almacenamiento de archivos)
Backend (Express + multer en memoria):
\`\`\`ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
const s3 = new S3Client({ region: process.env.AWS_REGION });

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const key = \`uploads/\${Date.now()}-\${req.file!.originalname}\`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: key,
    Body: req.file!.buffer,
    ContentType: req.file!.mimetype,
  }));
  res.json({ url: \`https://\${process.env.AWS_S3_BUCKET}.s3.\${process.env.AWS_REGION}.amazonaws.com/\${key}\` });
});
\`\`\`
Usa esto para archivos grandes (vídeos, PDFs); para imágenes de producto/avatares, Cloudinary suele ser más simple.`,
  },
  {
    id: "sendgrid-email",
    name: "SendGrid (email masivo / newsletter)",
    keywords: ["sendgrid", "envio masivo de emails", "newsletter masivo", "envío masivo de correos", "campañas de email"],
    envVars: ["SENDGRID_API_KEY"],
    packages: ["@sendgrid/mail"],
    snippet: `### Playbook: SendGrid (email masivo / newsletter)
Backend (Express):
\`\`\`ts
import sgMail from "@sendgrid/mail";
sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

await sgMail.send({
  to: userEmail,
  from: "noreply@tudominio.com", // remitente verificado en SendGrid (Sender Authentication)
  subject: "Novedades de esta semana",
  html: "<p>Contenido del newsletter…</p>",
});
\`\`\`
Para envíos a listas grandes, usa \`sgMail.send(arrayDeMensajes)\` (batch) y respeta los límites de tu plan.
Para email transaccional simple (confirmaciones, bienvenida), prefiere el playbook de Resend.`,
  },
  {
    id: "onesignal-push",
    name: "Notificaciones push (OneSignal)",
    keywords: ["notificaciones push", "notificacion push", "alertas push", "push notification", "avisos push"],
    envVars: ["ONESIGNAL_APP_ID", "ONESIGNAL_API_KEY"],
    packages: [],
    snippet: `### Playbook: Notificaciones push (OneSignal)
Backend (Express) — envía una notificación push vía REST API (sin SDK adicional):
\`\`\`ts
await fetch("https://onesignal.com/api/v1/notifications", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: \`Basic \${process.env.ONESIGNAL_API_KEY}\` },
  body: JSON.stringify({
    app_id: process.env.ONESIGNAL_APP_ID,
    included_segments: ["All"],
    headings: { es: "Nueva actualización" },
    contents: { es: "Tienes una notificación nueva" },
  }),
});
\`\`\`
Requiere integrar el SDK web de OneSignal en el frontend (script de inicialización) para que los navegadores se suscriban.`,
  },
  {
    id: "supabase-postgres",
    name: "Supabase (Postgres + Auth alternativos)",
    keywords: ["supabase", "base de datos postgres", "postgresql"],
    envVars: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    packages: ["@supabase/supabase-js"],
    snippet: `### Playbook: Supabase (Postgres + Auth alternativos a MongoDB/Clerk)
Backend (Express):
\`\`\`ts
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data, error } = await supabase.from("products").select("*").eq("category", "electronica");
if (error) throw error;
res.json(data);
\`\`\`
SOLO usar Supabase si el usuario lo pide explícitamente — el stack por defecto de Maris AI es MongoDB + Clerk
y cambiarlo afecta a toda la arquitectura del proyecto.`,
  },
];

/**
 * Detecta qué playbooks son relevantes para un prompt dado, buscando
 * coincidencias de palabras clave (case-insensitive, sin acentos).
 */
export function detectRelevantPlaybooks(prompt: string): IntegrationPlaybook[] {
  const normalized = prompt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita acentos

  return INTEGRATION_PLAYBOOKS.filter((pb) =>
    pb.keywords.some((kw) => {
      const kwNorm = kw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return normalized.includes(kwNorm);
    }),
  );
}

/**
 * Construye el bloque de texto con los playbooks relevantes para inyectar
 * en el contexto de los agentes. Devuelve "" si no aplica ninguno.
 */
export function buildPlaybooksContextBlock(prompt: string): string {
  const relevant = detectRelevantPlaybooks(prompt).slice(0, 5);
  if (relevant.length === 0) return "";

  const header = `[MARIS AI PLAYBOOKS — patrones de integración verificados]
Se han detectado ${relevant.length} integración(es) probable(s) para este proyecto.
Usa EXACTAMENTE estos patrones de código (paquetes npm, env vars, llamadas a la API)
salvo que el usuario pida explícitamente algo distinto — son correctos y están
verificados, evita reinventar la integración desde cero.
`;
  return [header, ...relevant.map((pb) => pb.snippet)].join("\n\n");
}
