import { SeoGeoContent, SeoGeoRun } from "@workspace/db/schema";
import { logger } from "./logger";

type SeoGeoTopic = {
  primaryQuery: string;
  title: string;
  audience: string;
  intent: "informational" | "commercial" | "comparison";
  cities: string[];
  schemaType: "Article" | "FAQPage" | "HowTo";
  questions: string[];
};

const TOPICS: SeoGeoTopic[] = [
  {
    primaryQuery: "crear una aplicación web con inteligencia artificial",
    title: "Cómo crear una aplicación web con inteligencia artificial: guía práctica",
    audience: "emprendedores y equipos de producto en España",
    intent: "informational",
    cities: ["Madrid", "Barcelona", "Valencia", "Sevilla"],
    schemaType: "HowTo",
    questions: ["¿Qué necesito para crear una app con IA?", "¿Cómo validar una idea antes de desarrollar?", "¿Qué partes de una app puede acelerar la IA?"],
  },
  {
    primaryQuery: "generador de apps con IA en español",
    title: "Generador de apps con IA en español: qué evaluar antes de elegir uno",
    audience: "autónomos, pymes y creadores no técnicos",
    intent: "commercial",
    cities: ["España", "México", "Colombia", "Argentina"],
    schemaType: "Article",
    questions: ["¿Qué debe generar una plataforma de apps con IA?", "¿Cómo revisar la calidad del código generado?", "¿Cómo se protege la propiedad del proyecto?"],
  },
  {
    primaryQuery: "crear un MVP con IA",
    title: "Crear un MVP con IA: de la idea a una primera versión útil",
    audience: "fundadores que necesitan validar un producto digital",
    intent: "informational",
    cities: ["Madrid", "Valencia", "Málaga", "Bilbao"],
    schemaType: "HowTo",
    questions: ["¿Qué funciones debe incluir un MVP?", "¿Cuándo conviene hablar con usuarios?", "¿Cómo medir si un MVP funciona?"],
  },
  {
    primaryQuery: "automatizar procesos de negocio con IA",
    title: "Automatizar procesos de negocio con IA sin perder control operativo",
    audience: "pymes españolas y responsables de operaciones",
    intent: "commercial",
    cities: ["Zaragoza", "Alicante", "Murcia", "Valladolid"],
    schemaType: "FAQPage",
    questions: ["¿Qué procesos son buenos candidatos para automatizar?", "¿Cómo revisar resultados de una automatización?", "¿Qué datos no deben exponerse a un agente?"],
  },
  {
    primaryQuery: "agentes de IA para emprendedores",
    title: "Agentes de IA para emprendedores: usos reales, límites y buenas prácticas",
    audience: "emprendedores que buscan productividad sin promesas irreales",
    intent: "informational",
    cities: ["España", "Latinoamérica"],
    schemaType: "Article",
    questions: ["¿Qué diferencia hay entre un chatbot y un agente?", "¿Qué permisos debe tener un agente?", "¿Cómo se evalúa un agente de IA?"],
  },
];

function madridDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((item) => item.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function madridHour(date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(date));
}

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
}

function buildDraft(topic: SeoGeoTopic, dateKey: string) {
  const slug = `${slugify(topic.primaryQuery)}-${dateKey.replace(/-/g, "")}`;
  const metaTitle = `${topic.title} | Maris AI`.slice(0, 60);
  const metaDescription = `Guía para ${topic.audience}: entiende ${topic.primaryQuery}, compara opciones y decide con criterios prácticos.`.slice(0, 155);
  const outline = [
    `Qué significa ${topic.primaryQuery} y para quién tiene sentido`,
    "Qué información preparar antes de empezar",
    "Proceso recomendado paso a paso",
    "Cómo revisar calidad, seguridad y propiedad del resultado",
    "Errores frecuentes y cómo evitarlos",
    "Preguntas frecuentes",
  ];
  const faq = topic.questions.map((question) => ({
    question,
    answer: "Borrador editorial: completar con una respuesta verificable, concreta y coherente con el contenido visible antes de publicar.",
  }));
  return {
    dateKey,
    title: topic.title,
    slug,
    primaryQuery: topic.primaryQuery,
    locale: "es-ES",
    country: "ES",
    cities: topic.cities,
    audience: topic.audience,
    intent: topic.intent,
    outline,
    faq,
    metaTitle,
    metaDescription,
    aiSummary: `Propuesta GEO para ${topic.primaryQuery}. Dirigida a ${topic.audience}. Incluye estructura, preguntas y señal geográfica ${topic.cities.join(", ")}. Requiere revisión editorial antes de publicarse.`,
    schemaType: topic.schemaType,
    qualityScore: 86,
    status: "draft" as const,
    generationSource: "automation" as const,
  };
}

/**
 * Crea como máximo un borrador diario. No publica, no modifica artículos
 * existentes y está protegido por una clave única de ejecución en MongoDB.
 */
export async function runSeoGeoAutopilot(options: { force?: boolean; source?: "schedule" | "manual" } = {}) {
  if (process.env.SEO_GEO_AUTOMATION_ENABLED === "false") {
    return { status: "disabled", generated: 0, skipped: 0, note: "SEO_GEO_AUTOMATION_ENABLED=false" };
  }
  if (!options.force && madridHour() < 7) {
    return { status: "waiting", generated: 0, skipped: 0, note: "La ejecución diaria comienza a partir de las 07:00 Europe/Madrid" };
  }

  const dateKey = madridDateKey();
  let run: any;
  try {
    run = await SeoGeoRun.create({ dateKey, status: "running", generated: 0, skipped: 0, notes: [`source:${options.source || "schedule"}`] });
  } catch (error: any) {
    if (error?.code === 11000) {
      const existing = await SeoGeoRun.findOne({ dateKey }).lean() as any;
      return { status: "already-ran", generated: 0, skipped: 1, runId: String(existing?._id || ""), note: "La ejecución de hoy ya existe" };
    }
    throw error;
  }

  try {
    const existingQueries = new Set((await SeoGeoContent.find({}, { primaryQuery: 1 }).lean() as any[]).map((entry) => entry.primaryQuery));
    const topic = TOPICS.find((candidate) => !existingQueries.has(candidate.primaryQuery));
    if (!topic) {
      await SeoGeoRun.findByIdAndUpdate(run._id, { $set: { status: "completed", skipped: 1, finishedAt: new Date(), notes: ["No quedan temas del catálogo base pendientes"] } });
      return { status: "completed", generated: 0, skipped: 1, runId: String(run._id), note: "Sin temas nuevos pendientes" };
    }

    const draft = buildDraft(topic, dateKey);
    await SeoGeoContent.create(draft);
    await SeoGeoRun.findByIdAndUpdate(run._id, { $set: { status: "completed", generated: 1, finishedAt: new Date(), notes: [`Borrador creado: ${draft.slug}`, "No se publicó contenido automáticamente"] } });
    logger.info({ dateKey, slug: draft.slug, source: options.source || "schedule" }, "SEO/GEO: borrador editorial creado");
    return { status: "completed", generated: 1, skipped: 0, runId: String(run._id), draftSlug: draft.slug, note: "Borrador creado y pendiente de revisión editorial" };
  } catch (error: any) {
    await SeoGeoRun.findByIdAndUpdate(run._id, { $set: { status: "failed", finishedAt: new Date(), notes: [String(error?.message || error).slice(0, 300)] } }).catch(() => {});
    throw error;
  }
}

export function startSeoGeoAutopilot() {
  const run = () => runSeoGeoAutopilot({ source: "schedule" }).catch((error) => logger.error({ error }, "SEO/GEO: ejecución programada fallida"));
  // Revisa cada 30 minutos; la clave dateKey evita duplicados entre reinicios
  // y entre réplicas del worker. Solo genera después de las 07:00 Madrid.
  const timer = setInterval(run, 30 * 60 * 1000);
  timer.unref();
  run();
  return () => clearInterval(timer);
}

export async function getSeoGeoOverview() {
  const [drafts, approved, published, lastRun] = await Promise.all([
    SeoGeoContent.countDocuments({ status: "draft" }),
    SeoGeoContent.countDocuments({ status: "approved" }),
    SeoGeoContent.countDocuments({ status: "published" }),
    SeoGeoRun.findOne({}).sort({ createdAt: -1 }).lean(),
  ]);
  return { drafts, approved, published, lastRun: lastRun || null, publishingPolicy: "manual-approval-required", automationEnabled: process.env.SEO_GEO_AUTOMATION_ENABLED !== "false" };
}
