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
  const relevant = detectRelevantPlaybooks(prompt);
  if (relevant.length === 0) return "";

  const header = `[MARIS AI PLAYBOOKS — patrones de integración verificados]
Se han detectado ${relevant.length} integración(es) probable(s) para este proyecto.
Usa EXACTAMENTE estos patrones de código (paquetes npm, env vars, llamadas a la API)
salvo que el usuario pida explícitamente algo distinto — son correctos y están
verificados, evita reinventar la integración desde cero.
`;
  return [header, ...relevant.map((pb) => pb.snippet)].join("\n\n");
}
