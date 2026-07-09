/**
 * Cliente de la API de Google Ads para el agente de marketing "Niko".
 *
 * Inicialización PEREZOSA (mismo patrón que ya usa el cliente de Gemini en
 * lib/integrations-gemini-ai/src/client.ts): el servidor arranca sin
 * problema aunque las credenciales todavía no estén puestas en Railway --
 * el error solo aparece cuando de verdad se intenta usar el agente, con un
 * mensaje claro de qué variable falta, no un crash silencioso al arrancar.
 *
 * Variables de entorno necesarias (ver la guía completa que le di al
 * usuario en el chat):
 *   GOOGLE_ADS_DEVELOPER_TOKEN   -- token de desarrollador de Google Ads
 *   GOOGLE_ADS_CLIENT_ID         -- OAuth2 Client ID (Google Cloud Console)
 *   GOOGLE_ADS_CLIENT_SECRET     -- OAuth2 Client Secret
 *   GOOGLE_ADS_REFRESH_TOKEN     -- token de refresco obtenido una vez vía
 *                                   el flujo OAuth2 (ver /admin/google-ads/oauth-url)
 *   GOOGLE_ADS_CUSTOMER_ID       -- ID de la cuenta de Google Ads (sin guiones), ej. "1234567890"
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID -- opcional, solo si se accede vía una cuenta MCC/manager
 */
import { GoogleAdsApi, type Customer } from "google-ads-api";
import { logger } from "./logger";

let client: GoogleAdsApi | null = null;
let customer: Customer | null = null;

export function isGoogleAdsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID
  );
}

/** Lista de variables que faltan, para mensajes de error claros en el panel de admin. */
export function missingGoogleAdsEnvVars(): string[] {
  const required = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID",
  ];
  return required.filter((k) => !process.env[k]);
}

export function getGoogleAdsCustomer(): Customer {
  if (customer) return customer;

  const missing = missingGoogleAdsEnvVars();
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno de Google Ads en Railway: ${missing.join(", ")}. ` +
        `Configúralas en el servicio maris-ai-api-server → Variables.`,
    );
  }

  client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  });

  customer = client.Customer({
    customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID!.replace(/-/g, ""),
    login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, ""),
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
  });

  logger.info("Google Ads: cliente inicializado correctamente");
  return customer;
}

/** URL para el flujo OAuth2 -- se usa una sola vez para obtener el refresh token inicial. */
export function buildGoogleAdsOAuthUrl(redirectUri: string): string {
  if (!process.env.GOOGLE_ADS_CLIENT_ID) {
    throw new Error("Falta GOOGLE_ADS_CLIENT_ID para generar la URL de autorización.");
  }
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
