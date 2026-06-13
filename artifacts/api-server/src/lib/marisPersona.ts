/**
 * marisPersona.ts — Voz y personalidad unificada de Maris AI
 *
 * Todos los mensajes conversacionales del sistema pasan por aquí.
 * Objetivo: que Maris AI suene como un compañero técnico brillante,
 * cercano, directo y útil — no como un bot genérico.
 *
 * Inspirado en Emergent.sh: tono humano, respuestas concretas,
 * nunca frío ni corporativo, siempre orientado a la acción.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";

const MARIS_PERSONA = `Eres Maris, la IA de Maris AI — una plataforma española de generación de apps con IA.

PERSONALIDAD:
- Cercana, directa y técnicamente brillante. Como ese amigo que es un crack del desarrollo y siempre te ayuda.
- Nunca robótica, nunca corporativa. Hablas en español natural, como una persona real.
- Entusiasta con los proyectos del usuario — te importa que su app quede bien.
- Honesta: si algo no se puede hacer fácil, lo dices; pero siempre con una alternativa.
- Concisa: máximo 3-4 frases por respuesta a menos que el usuario pida más detalle.

CÓMO RESPONDES:
- Preguntas simples → respuesta directa, máximo 2-3 frases.
- Problemas técnicos → explica brevemente qué pasó y qué vas a hacer (o qué debe hacer el usuario).
- Dudas sobre la app → responde en el contexto de su proyecto específico, usando el nombre de la app.
- Sugerencias → ofrécelas de forma concreta, nunca como lista de marketing.
- Errores → reconócelos sin dramatizar. "Vaya, eso no debería pasar. Déjame..." es mejor que "Lo sentimos mucho".

NUNCA:
- Nunca digas "¡Hola! Soy Maris AI, tu asistente de..." — ya te conocen.
- Nunca uses lenguaje corporativo: "proceder a", "ejecutar la acción de", "de conformidad con".
- Nunca respondas con bullet points a preguntas conversacionales simples.
- Nunca termines con "¿Hay algo más en lo que pueda ayudarte?" — es redundante.
- Nunca menciones ENGINE_DEV, ENGINE_EXEC, tokens, créditos internos ni tecnicismos de sistema.

EJEMPLOS DE TONO:

Usuario: "no funciona el login"
❌ MAL: "Para resolver el problema con el módulo de autenticación, procederé a revisar el código fuente del componente de login e implementar las correcciones necesarias."
✅ BIEN: "Voy a revisar el login ahora mismo. Suele ser un problema con el flujo de estado o los tokens — en un momento te lo dejo funcionando."

Usuario: "¿puedes añadir un modo oscuro?"
❌ MAL: "Claro, puedo añadir la funcionalidad de modo oscuro a tu aplicación. Para ello implementaré..."
✅ BIEN: "Sí, añado el modo oscuro. Lo haré con CSS variables para que el cambio sea suave y se recuerde entre sesiones."

Usuario: "qué hace esta app exactamente?"
❌ MAL: "Esta aplicación es una herramienta de gestión que permite a los usuarios..."
✅ BIEN: "[Nombre de la app] es tu [descripción breve]. Tienes [X] páginas principales: [lista concisa]."`;

/**
 * Genera una respuesta conversacional con la personalidad de Maris.
 * Úsala para ENGINE_INFO, saludos, preguntas sobre la app, etc.
 */
export async function generateMarisReply(opts: {
  userMessage: string;
  appTitle?: string;
  appDescription?: string;
  recentMessages?: { role: string; content: string }[];
  context?: string; // Contexto adicional (estado del job, páginas, etc.)
}): Promise<string> {
  const { userMessage, appTitle, appDescription, recentMessages = [], context } = opts;

  const appContext = appTitle
    ? `App del usuario: "${appTitle}"${appDescription ? ` — ${appDescription.slice(0, 150)}` : ""}`
    : "";

  const historyBlock = recentMessages.length > 0
    ? `\nConversación reciente:\n${recentMessages.slice(-6).map(m => `${m.role === "user" ? "Usuario" : "Maris"}: ${m.content.slice(0, 200)}`).join("\n")}`
    : "";

  const contextBlock = context ? `\nContexto: ${context}` : "";

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: MARIS_PERSONA,
      messages: [{
        role: "user",
        content: `${appContext}${historyBlock}${contextBlock}\n\nMensaje del usuario: "${userMessage}"\n\nResponde como Maris. Máximo 3-4 frases. En español. Sin saludos, sin despedidas.`,
      }],
    });
    return (response.content[0] as any).text?.trim() ?? fallbackReply(userMessage, appTitle);
  } catch (err) {
    logger.warn({ err }, "marisPersona: generateMarisReply failed");
    return fallbackReply(userMessage, appTitle);
  }
}

/**
 * Respuesta de fallback cuando la IA no está disponible.
 */
function fallbackReply(message: string, appTitle?: string): string {
  const app = appTitle ? `**${appTitle}**` : "tu app";
  const m = message.toLowerCase();
  if (/hola|hello|hey|buenas/.test(m)) return `¡Hola! Dime qué quieres cambiar en ${app} y me pongo a ello.`;
  if (/gracias|thank/.test(m)) return `¡De nada! Si necesitas más cambios en ${app}, aquí estoy.`;
  if (/qué hace|what does|para qué/.test(m)) return `${app} es tu proyecto actual. Dime qué quieres saber o cambiar.`;
  if (/error|fallo|roto|bug/.test(m)) return `Entendido, voy a revisar el problema en ${app}. Dame un segundo.`;
  return `Entendido. Para hacer cambios en ${app}, dime qué quieres modificar y lo hago ahora.`;
}

/**
 * Genera el mensaje que aparece en el chat después de que los agentes
 * terminan de actualizar/generar una app. Más rico que el antiguo buildAppUpdatedConsoleReply.
 */
export async function generateUpdateCompleteMessage(opts: {
  userRequest: string;  // Qué pidió el usuario
  appTitle: string;
  filesChanged: number;
  hasBackend: boolean;
  creditsRemaining?: number;
}): Promise<string> {
  const { userRequest, appTitle, filesChanged, hasBackend, creditsRemaining } = opts;

  const clean = userRequest
    .replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/i, "")
    .replace(/\[ADMIN[^\]]*\]/g, "")
    .trim()
    .slice(0, 200);

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 250,
      system: MARIS_PERSONA,
      messages: [{
        role: "user",
        content: `El usuario pidió: "${clean}"
App: "${appTitle}"
Archivos modificados: ${filesChanged}${hasBackend ? " (incluye backend)" : ""}

Genera un mensaje de confirmación de 1-2 frases que:
1. Confirme que se hizo lo que pidió (sin repetir la petición verbatim)
2. Mencione algo específico y útil (qué refrescar, qué probar, qué tener en cuenta)
Sin emojis al principio. Sin "¡Listo!" genérico. Directo y concreto.`,
      }],
    });
    const text = (response.content[0] as any).text?.trim() ?? "";
    if (!text) throw new Error("empty");

    const creditsLine = typeof creditsRemaining === "number" && creditsRemaining < 10
      ? `\n\n_Créditos restantes: ${creditsRemaining}. Considera recargar para seguir._`
      : "";

    return text + creditsLine;
  } catch {
    // Fallback sencillo y mejor que el actual
    const actions: Record<string, string> = {
      login: "Prueba el flujo completo en el preview — entra con un usuario de prueba.",
      pago: "Verifica con una tarjeta de test de Stripe (4242 4242 4242 4242).",
      diseño: "Refresca el preview para ver los cambios visuales.",
      color: "Los colores se aplican globalmente — refresca para verlos.",
      página: "La nueva página ya tiene su ruta activa en el menú.",
      formulario: "El formulario valida en tiempo real — pruébalo con datos reales.",
    };
    const hint = Object.entries(actions).find(([k]) => clean.toLowerCase().includes(k))?.[1]
      ?? "Refresca el preview para ver los cambios.";
    return `Hecho. ${hint}`;
  }
}

/**
 * Mensaje cuando el Arquitecto termina el plan inicial.
 */
export function buildPlanReadyMessage(opts: {
  appTitle: string;
  pages: string[];
  hasBackend: boolean;
}): string {
  const { appTitle, pages, hasBackend } = opts;
  const pageList = pages.slice(0, 4).join(", ");
  const more = pages.length > 4 ? ` y ${pages.length - 4} más` : "";
  const backend = hasBackend ? " con backend incluido" : "";
  return `Plan listo para **${appTitle}**${backend}. Páginas: ${pageList}${more}. Los agentes ya están construyendo — te aviso cuando esté lista para ver.`;
}

/**
 * Mensaje cuando un job falla y se notifica al usuario.
 */
export function buildJobFailedMessage(appTitle: string, willRetry: boolean): string {
  if (willRetry) {
    return `Hubo un problema generando **${appTitle}**, pero el sistema ya está reintentando automáticamente. No tienes que hacer nada.`;
  }
  return `La generación de **${appTitle}** falló. Puedes intentarlo de nuevo — si el problema persiste, abre un ticket de soporte y lo revisamos.`;
}
