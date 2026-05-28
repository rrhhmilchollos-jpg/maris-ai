cat > /app/artifacts/api-server/src/lib/onboardingAgent.ts << 'EOF'
/**
 * onboardingAgent.ts
 * Hace las 5 preguntas de onboarding antes de arrancar el pipeline.
 * Solo se activa en proyectos nuevos (sin `previous`).
 */

export interface OnboardingAnswers {
  appType: string;
  context: string;
  features: string;
  integrations: string;
  design: string;
}

export interface OnboardingQuestion {
  id: keyof OnboardingAnswers;
  step: number;
  total: number;
  question: string;
  placeholder: string;
  options?: string[];         // opciones de checkbox (multi-select)
  allowFreeText?: boolean;    // permite texto libre además de opciones
}

export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: "appType",
    step: 1,
    total: 5,
    question: "¿Qué tipo de aplicación es?",
    placeholder: "Describe el tipo de app...",
    options: [
      "Landing page / web informativa",
      "Plataforma SaaS / dashboard",
      "E-commerce / tienda online",
      "App de gestión / CRM",
      "Red social / comunidad",
      "Otra (especifica)",
    ],
    allowFreeText: true,
  },
  {
    id: "context",
    step: 2,
    total: 5,
    question: "¿Tienes contexto previo del proyecto? (descripción, documentos, branding, capturas, etc.) Si es así, compártelo.",
    placeholder: "Describe el contexto o escribe 'No' si empiezas desde cero...",
    allowFreeText: true,
  },
  {
    id: "features",
    step: 3,
    total: 5,
    question: "¿Qué funcionalidades quieres implementar en esta sesión? (ej: home page, autenticación, área de clientes, formulario de contacto...)",
    placeholder: "Lista las funcionalidades principales...",
    allowFreeText: true,
  },
  {
    id: "integrations",
    step: 4,
    total: 5,
    question: "¿Necesita alguna integración externa?",
    placeholder: "Describe las integraciones o escribe 'No'...",
    options: [
      "Pagos (Stripe / Redsys)",
      "IA (Claude / GPT)",
      "Email (Resend / SendGrid)",
      "Autenticación (Google Auth / Clerk)",
      "Mapas (Google Maps)",
      "Analytics (GA4 / Mixpanel)",
      "No necesita integraciones",
    ],
    allowFreeText: true,
  },
  {
    id: "design",
    step: 5,
    total: 5,
    question: "¿Tienes preferencias de diseño? (colores, tipografía, estilo, referencias visuales) o ¿prefieres que decida el agente de diseño?",
    placeholder: "Describe el estilo o escribe 'Que decida el agente'...",
    allowFreeText: true,
  },
];

/**
 * Construye el prompt enriquecido a partir del prompt original + respuestas del onboarding.
 */
export function buildEnrichedPrompt(
  originalPrompt: string,
  answers: OnboardingAnswers,
): string {
  const parts = [originalPrompt.trim()];

  if (answers.appType && answers.appType !== "Otra (especifica)") {
    parts.push(`[TIPO DE APP] ${answers.appType}`);
  }
  if (answers.context && answers.context.toLowerCase() !== "no") {
    parts.push(`[CONTEXTO DEL PROYECTO] ${answers.context}`);
  }
  if (answers.features) {
    parts.push(`[FUNCIONALIDADES REQUERIDAS] ${answers.features}`);
  }
  if (answers.integrations && answers.integrations !== "No necesita integraciones") {
    parts.push(`[INTEGRACIONES] ${answers.integrations}`);
  }
  if (answers.design && answers.design.toLowerCase() !== "que decida el agente") {
    parts.push(`[PREFERENCIAS DE DISEÑO] ${answers.design}`);
  }

  return parts.join("\n\n");
}

/**
 * Detecta si un prompt necesita onboarding (proyecto nuevo, suficiente longitud).
 */
export function needsOnboarding(prompt: string, hasExistingApp: boolean): boolean {
  if (hasExistingApp) return false;
  if (prompt.trim().length < 10) return false;
  // Si el prompt ya viene enriquecido con [TIPO DE APP], no repetir
  if (prompt.includes("[TIPO DE APP]")) return false;
  return true;
}
EOF
echo "OK onboardingAgent.ts"
