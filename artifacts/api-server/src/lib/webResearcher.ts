// @ts-nocheck
/**
 * webResearcher.ts
 * Búsqueda web silenciosa para el researcher de Maris AI.
 * Sin Puppeteer — funciona en Railway sin Chromium.
 */

import pino from "pino";

const logger = pino({ name: "webResearcher" });

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface PageContent {
  url: string;
  title: string;
  text: string;
}

export interface WebResearchResult {
  query: string;
  results: SearchResult[];
  pages: PageContent[];
  source: "serper" | "brave" | "duckduckgo" | "none";
}

// ─── Scraping ligero sin Puppeteer ────────────────────────────────────────────

/**
 * Extrae texto limpio de una URL usando fetch + regex simple.
 * Sin Puppeteer — funciona en Railway sin Chromium.
 */
async function scrapePageText(url: string, timeoutMs = 8_000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MarisAI-Researcher/1.0; +https://marisai.es/bot)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return "";
    const html = await res.text();
    // Eliminar scripts, estilos, nav, footer
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s{3,}/g, "\n")
      .trim();
    return clean.slice(0, 3000);
  } catch {
    return "";
  }
}

// ─── Proveedores de búsqueda ─────────────────────────────────────────────────

async function searchWithSerper(query: string, num = 5): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num, gl: "es", hl: "es" }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.organic || []).slice(0, num).map((r: any) => ({
      title: r.title || "", url: r.link || "", snippet: r.snippet || "",
    }));
  } catch { return []; }
}

async function searchWithBrave(query: string, num = 5): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${num}&country=es&search_lang=es`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.web?.results || []).slice(0, num).map((r: any) => ({
      title: r.title || "", url: r.url || "", snippet: r.description || "",
    }));
  } catch { return []; }
}

/**
 * DuckDuckGo sin API key — usa el endpoint HTML público de DDG.
 * No requiere Puppeteer, funciona en Railway.
 */
async function searchWithDuckDuckGo(query: string, num = 5): Promise<SearchResult[]> {
  try {
    // DDG HTML endpoint
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=es-es`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html",
        "Accept-Language": "es-ES,es;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Extraer resultados del HTML con regex
    const results: SearchResult[] = [];
    // Patrón para links de resultados DDG
    const linkPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    const links: Array<{url: string; title: string}> = [];
    let m: RegExpExecArray | null;
    while ((m = linkPattern.exec(html)) !== null && links.length < num) {
      const rawUrl = m[1];
      const title = m[2].replace(/<[^>]+>/g, "").trim();
      // DDG usa redirect URLs — extraer la URL real
      const uddg = rawUrl.match(/uddg=([^&]+)/);
      const realUrl = uddg ? decodeURIComponent(uddg[1]) : rawUrl;
      if (realUrl.startsWith("http") && title) {
        links.push({ url: realUrl, title });
      }
    }

    const snippets: string[] = [];
    while ((m = snippetPattern.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
    }

    for (let i = 0; i < links.length; i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || "",
      });
    }

    logger.info({ count: results.length, query }, "webResearcher: DuckDuckGo results");
    return results;
  } catch (err) {
    logger.warn({ err }, "webResearcher: DuckDuckGo HTML failed");
    return [];
  }
}

// ─── Función principal ────────────────────────────────────────────────────────

function buildSearchQuery(prompt: string): string {
  const urlMatch = prompt.match(/https?:\/\/[^\s)]+/);
  if (urlMatch) return urlMatch[0];
  // Para apps, buscar "app gestión X" o "plataforma X" para encontrar referencias
  const cleaned = prompt
    .replace(/\[MARIS AI REQUEST LOCALE\][^\n]*\n?/, "")
    .replace(/crea\s+una?\s+/i, "")
    .replace(/app\s+web\s+para\s+/i, "")
    .replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").slice(0, 8);
  return `app web ${words.join(" ")} ejemplo diseño`;
}

export async function performWebResearch(
  prompt: string,
  maxPages = 2,
  timeoutMs = 20_000,
): Promise<WebResearchResult> {
  const query = buildSearchQuery(prompt);
  logger.info({ query }, "webResearcher: iniciando búsqueda");

  const result: WebResearchResult = { query, results: [], pages: [], source: "none" };

  // 1. Serper (Google)
  result.results = await searchWithSerper(query);
  if (result.results.length > 0) {
    result.source = "serper";
    logger.info({ count: result.results.length }, "webResearcher: Serper OK");
  }

  // 2. Brave
  if (result.results.length === 0) {
    result.results = await searchWithBrave(query);
    if (result.results.length > 0) {
      result.source = "brave";
      logger.info({ count: result.results.length }, "webResearcher: Brave OK");
    }
  }

  // 3. DuckDuckGo HTML (sin API key, sin Puppeteer)
  if (result.results.length === 0) {
    result.results = await searchWithDuckDuckGo(query);
    if (result.results.length > 0) {
      result.source = "duckduckgo";
      logger.info({ count: result.results.length }, "webResearcher: DuckDuckGo OK");
    }
  }

  // 4. Scraping de las primeras N páginas con fetch simple
  if (result.results.length > 0) {
    const toScrape = result.results.slice(0, maxPages);
    const scraped = await Promise.allSettled(
      toScrape.map(async (sr) => {
        if (!sr.url || !sr.url.startsWith("http")) return null;
        const text = await scrapePageText(sr.url, 7_000);
        if (text.length > 200) return { url: sr.url, title: sr.title, text } as PageContent;
        return null;
      })
    );
    result.pages = scraped
      .filter((r): r is PromiseFulfilledResult<PageContent> => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value);
    logger.info({ pages: result.pages.length }, "webResearcher: páginas scrapeadas");
  }

  return result;
}

export function formatWebResearchForLLM(research: WebResearchResult): string {
  if (research.results.length === 0 && research.pages.length === 0) return "";

  const lines: string[] = [];
  lines.push(`=== REFERENCIAS WEB (${research.source.toUpperCase()}) ===`);
  lines.push(`Query: "${research.query}"`);
  lines.push("");

  if (research.results.length > 0) {
    lines.push("--- SITIOS DE REFERENCIA ---");
    research.results.slice(0, 5).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.title}`);
      lines.push(`   URL: ${r.url}`);
      if (r.snippet) lines.push(`   ${r.snippet}`);
      lines.push("");
    });
  }

  if (research.pages.length > 0) {
    lines.push("--- CONTENIDO EXTRAÍDO ---");
    research.pages.forEach((p, i) => {
      lines.push(`[Referencia ${i + 1}] ${p.title}`);
      lines.push(`URL: ${p.url}`);
      lines.push(p.text.slice(0, 2000));
      lines.push("");
    });
  }

  lines.push("=== FIN REFERENCIAS ===");
  return lines.join("\n");
}
