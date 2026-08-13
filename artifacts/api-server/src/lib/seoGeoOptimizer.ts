export interface SeoGeoMetadata {
  title: string;
  description: string;
  keywords: string[];
  canonicalPath: string;
  locale: string;
  alternates: Array<{ locale: string; path: string }>;
  openGraph: { type: "website"; title: string; description: string; siteName: string };
  robots: { index: boolean; follow: boolean; maxSnippet: number };
  jsonLd: Record<string, unknown>;
  aiSummary: string;
  geo: { country: string; region: string; city: string; language: string; audience: string };
  generatedAt: string;
}

const STOP_WORDS = new Set(["para", "como", "desde", "este", "esta", "con", "una", "los", "las", "del", "por", "que", "app", "web"]);

function clean(value: string, max: number): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function terms(title: string, description: string, techStack: string[]): string[] {
  const raw = `${title} ${description} ${techStack.join(" ")}`.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const words = raw.split(/[^a-z0-9+#.-]+/).filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, 16);
}

export function buildSeoGeoMetadata(input: {
  title?: string;
  description?: string;
  techStack?: string[];
  publicSlug?: string;
  locale?: string;
  country?: string;
  region?: string;
  city?: string;
}): SeoGeoMetadata {
  const title = clean(input.title || "Proyecto creado con Maris AI", 60);
  const description = clean(input.description || `Aplicación creada con Maris AI: ${title}.`, 155);
  const slug = clean(input.publicSlug || "preview", 100).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const locale = input.locale || "es-ES";
  const country = input.country || "ES";
  const region = input.region || "España";
  const city = input.city || "Madrid";
  const keywords = terms(title, description, input.techStack || []);
  const canonicalPath = `/p/${slug}`;
  const generatedAt = new Date().toISOString();
  return {
    title,
    description,
    keywords,
    canonicalPath,
    locale,
    alternates: [
      { locale: "es-ES", path: canonicalPath },
      { locale: "en-US", path: canonicalPath },
    ],
    openGraph: { type: "website", title, description, siteName: "Maris AI" },
    robots: { index: Boolean(input.publicSlug), follow: true, maxSnippet: 160 },
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: title,
      description,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: locale,
      areaServed: { "@type": "Country", name: region },
      provider: { "@type": "Organization", name: "Maris AI", url: "https://www.marisai.es" },
      keywords: keywords.join(", "),
    },
    aiSummary: `${title}: ${description} Público principal: ${region}. Idioma: ${locale}.`,
    geo: { country, region, city, language: locale, audience: "usuarios y empresas en España" },
    generatedAt,
  };
}

export function seoHeadTags(meta: SeoGeoMetadata): string {
  const esc = (value: string) => value.replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] || char);
  const jsonLd = JSON.stringify(meta.jsonLd).replace(/</g, "\\u003c");
  return [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<meta name="keywords" content="${esc(meta.keywords.join(", "))}" />`,
    `<meta name="robots" content="${meta.robots.index ? "index" : "noindex"},${meta.robots.follow ? "follow" : "nofollow"},max-snippet:${meta.robots.maxSnippet}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(meta.openGraph.title)}" />`,
    `<meta property="og:description" content="${esc(meta.openGraph.description)}" />`,
    `<meta property="og:site_name" content="Maris AI" />`,
    `<meta name="geo.region" content="${esc(meta.geo.country)}" />`,
    `<meta name="geo.placename" content="${esc(meta.geo.city)}" />`,
    `<link rel="canonical" href="https://www.marisai.es${meta.canonicalPath}" />`,
    `<script type="application/ld+json">${jsonLd}</script>`,
    `<meta name="ai-content-summary" content="${esc(meta.aiSummary)}" />`,
  ].join("\n  ");
}
