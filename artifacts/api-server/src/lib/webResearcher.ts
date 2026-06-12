// @ts-nocheck
/**
 * webResearcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo de búsqueda web real para el agente Investigador de Maris AI.
 *
 * Estrategia (en orden de preferencia):
 *  1. Serper API  (SERPER_API_KEY)  → Google Search JSON
 *  2. Brave Search API (BRAVE_API_KEY) → Brave Search JSON
 *  3. DuckDuckGo HTML scraping via Puppeteer (sin API key)
 *
 * Para cada resultado relevante, abre la página con Puppeteer y extrae
 * el texto limpio (sin scripts/estilos) para dárselo al LLM.
 */

// Puppeteer se importa de forma dinámica para no crashear Railway si no está instalado
import { execSync } from "child_process";
import pino from "pino";

const logger = pino({ name: "webResearcher" });

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
  text: string; // texto limpio extraído de la página
}

export interface WebResearchResult {
  query: string;
  results: SearchResult[];
  pages: PageContent[];
  source: "serper" | "brave" | "duckduckgo" | "none";
}

// ─── Helpers de Puppeteer ────────────────────────────────────────────────────

let cachedExec: string | null | undefined = undefined;

function chromiumPath(): string | null {
  if (cachedExec !== undefined) return cachedExec;
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv) { cachedExec = fromEnv; return fromEnv; }
  try {
    const out = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null", { encoding: "utf8" }).trim();
    cachedExec = out || null;
  } catch { cachedExec = null; }
  return cachedExec;
}

async function launchBrowser(): Promise<any | null> {
  const exec = chromiumPath();
  if (!exec) {
    logger.warn("webResearcher: Chromium no encontrado, scraping deshabilitado");
    return null;
  }
  try {
    const puppeteer = await import("puppeteer").catch(() => null);
    if (!puppeteer) {
      logger.warn("webResearcher: puppeteer no instalado, scraping deshabilitado");
      return null;
    }
    return await puppeteer.default.launch({
      headless: true,
      executablePath: exec,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-translate",
        "--mute-audio",
      ],
    });
  } catch (err) {
    logger.warn({ err }, "webResearcher: No se pudo lanzar Puppeteer");
    return null;
  }
}

/**
 * Extrae el texto limpio de una URL usando Puppeteer.
 * Elimina scripts, estilos, nav, footer, ads.
 * Máx 3000 caracteres para no saturar el contexto del LLM.
 */
async function scrapePageText(browser: Browser, url: string, timeoutMs = 12_000): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (compatible; MarisAI-Researcher/1.0; +https://marisai.es/bot)"
    );
    await page.setViewport({ width: 1280, height: 800 });
    // Bloquear recursos pesados para ir más rápido
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "media", "font", "stylesheet"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // Extraer texto limpio eliminando elementos no informativos
    // page.evaluate corre en el contexto del navegador (DOM disponible)
    const text = await page.evaluate((): string => {
      /* eslint-disable no-undef */
      const doc = (window as any).document as Document;
      // Eliminar elementos no útiles
      const selectors = [
        "script", "style", "noscript", "iframe", "nav", "footer",
        "header", "aside", ".cookie", ".ad", ".ads", ".advertisement",
        ".popup", ".modal", ".banner",
      ];
      selectors.forEach((sel) => {
        doc.querySelectorAll(sel).forEach((el: Element) => el.remove());
      });

      // Intentar extraer el contenido principal
      const mainEl: HTMLElement | null =
        (doc.querySelector("main") as HTMLElement) ||
        (doc.querySelector("article") as HTMLElement) ||
        (doc.querySelector(".content") as HTMLElement) ||
        (doc.querySelector("#content") as HTMLElement) ||
        (doc.querySelector(".main") as HTMLElement) ||
        doc.body;

      return mainEl ? ((mainEl as any).innerText || mainEl.textContent || "") : "";
      /* eslint-enable no-undef */
    });

    // Limpiar espacios múltiples y limitar longitud
    return text
      .replace(/\s{3,}/g, "\n\n")
      .replace(/\n{4,}/g, "\n\n")
      .trim()
      .slice(0, 3000);
  } catch (err) {
    logger.warn({ err, url }, "webResearcher: Error scrapeando página");
    return "";
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Proveedores de búsqueda ─────────────────────────────────────────────────

/**
 * Búsqueda con Serper API (Google Search).
 * Requiere SERPER_API_KEY en variables de entorno.
 */
async function searchWithSerper(query: string, num = 5): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num, gl: "es", hl: "es" }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "Serper API error");
      return [];
    }

    const data = await res.json() as any;
    const organic: any[] = data.organic || [];
    return organic.slice(0, num).map((r: any) => ({
      title: r.title || "",
      url: r.link || "",
      snippet: r.snippet || "",
    }));
  } catch (err) {
    logger.warn({ err }, "webResearcher: Serper search failed");
    return [];
  }
}

/**
 * Búsqueda con Brave Search API.
 * Requiere BRAVE_API_KEY en variables de entorno.
 */
async function searchWithBrave(query: string, num = 5): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return [];

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${num}&country=es&search_lang=es`;
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "Brave API error");
      return [];
    }

    const data = await res.json() as any;
    const webResults: any[] = data.web?.results || [];
    return webResults.slice(0, num).map((r: any) => ({
      title: r.title || "",
      url: r.url || "",
      snippet: r.description || "",
    }));
  } catch (err) {
    logger.warn({ err }, "webResearcher: Brave search failed");
    return [];
  }
}

/**
 * Búsqueda con DuckDuckGo usando Puppeteer (sin API key).
 * Fallback cuando no hay ninguna API key configurada.
 */
async function searchWithDuckDuckGo(browser: Browser, query: string, num = 5): Promise<SearchResult[]> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    );
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&kl=es-es`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });

    // Esperar a que aparezcan los resultados
    await page.waitForSelector("[data-result='web']", { timeout: 8_000 }).catch(() => {});

    const results = await page.evaluate((maxNum: number): Array<{title: string; url: string; snippet: string}> => {
      /* eslint-disable no-undef */
      const doc = (window as any).document as Document;
      const items = Array.from(doc.querySelectorAll("[data-result='web']")).slice(0, maxNum);
      return items.map((item: Element) => {
        const titleEl = item.querySelector("h2 a") || item.querySelector("a[data-testid='result-title-a']");
        const snippetEl = item.querySelector("[data-result='snippet']") || item.querySelector(".result__snippet");
        const title = titleEl?.textContent?.trim() || "";
        const url = (titleEl as any)?.href || "";
        const snippet = snippetEl?.textContent?.trim() || "";
        return { title, url, snippet };
      }).filter((r: {title: string; url: string; snippet: string}) => r.url && r.title);
      /* eslint-enable no-undef */
    }, num);

    return results as SearchResult[];
  } catch (err) {
    logger.warn({ err }, "webResearcher: DuckDuckGo search failed");
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Genera una query de búsqueda relevante a partir del prompt del usuario.
 */
function buildSearchQuery(prompt: string): string {
  // Si el prompt tiene URL, usar la URL como query
  const urlMatch = prompt.match(/https?:\/\/[^\s)]+/);
  if (urlMatch) return urlMatch[0];

  // Extraer las primeras palabras clave del prompt (máx 8 palabras)
  const cleaned = prompt
    .replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").slice(0, 10);
  return words.join(" ");
}

/**
 * Función principal: realiza búsqueda web real y extrae contenido de páginas.
 *
 * @param prompt - El prompt del usuario
 * @param maxPages - Número máximo de páginas a scrapear (default: 3)
 * @param timeoutMs - Timeout total para toda la investigación (default: 25s)
 */
export async function performWebResearch(
  prompt: string,
  maxPages = 3,
  timeoutMs = 25_000,
): Promise<WebResearchResult> {
  const query = buildSearchQuery(prompt);
  logger.info({ query }, "webResearcher: iniciando búsqueda web");

  const result: WebResearchResult = {
    query,
    results: [],
    pages: [],
    source: "none",
  };

  const browser = await launchBrowser();

  try {
    // 1. Intentar Serper (Google)
    let searchResults = await searchWithSerper(query);
    if (searchResults.length > 0) {
      result.source = "serper";
      result.results = searchResults;
      logger.info({ count: searchResults.length }, "webResearcher: resultados Serper (Google)");
    }

    // 2. Fallback a Brave
    if (result.results.length === 0) {
      searchResults = await searchWithBrave(query);
      if (searchResults.length > 0) {
        result.source = "brave";
        result.results = searchResults;
        logger.info({ count: searchResults.length }, "webResearcher: resultados Brave");
      }
    }

    // 3. Fallback a DuckDuckGo con Puppeteer
    if (result.results.length === 0 && browser) {
      searchResults = await searchWithDuckDuckGo(browser, query);
      if (searchResults.length > 0) {
        result.source = "duckduckgo";
        result.results = searchResults;
        logger.info({ count: searchResults.length }, "webResearcher: resultados DuckDuckGo");
      }
    }

    // 4. Si hay resultados, scrapear las primeras N páginas
    if (result.results.length > 0 && browser) {
      const pagesToScrape = result.results.slice(0, maxPages);
      const scrapePromises = pagesToScrape.map(async (sr) => {
        if (!sr.url) return null;
        try {
          const text = await scrapePageText(browser, sr.url, 12_000);
          if (text.length > 100) {
            return {
              url: sr.url,
              title: sr.title,
              text,
            } as PageContent;
          }
        } catch { /* ignorar errores individuales */ }
        return null;
      });

      const scraped = await Promise.allSettled(scrapePromises);
      result.pages = scraped
        .filter((r): r is PromiseFulfilledResult<PageContent | null> => r.status === "fulfilled" && r.value !== null)
        .map((r) => r.value as PageContent);

      logger.info({ pages: result.pages.length }, "webResearcher: páginas scrapeadas");
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  return result;
}

/**
 * Formatea el resultado de la investigación web en un bloque de texto
 * listo para inyectar en el prompt del LLM.
 */
export function formatWebResearchForLLM(research: WebResearchResult): string {
  if (research.results.length === 0 && research.pages.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push(`=== INVESTIGACIÓN WEB (${research.source.toUpperCase()}) ===`);
  lines.push(`Query: "${research.query}"`);
  lines.push("");

  if (research.results.length > 0) {
    lines.push("--- RESULTADOS DE BÚSQUEDA ---");
    research.results.slice(0, 5).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.title}`);
      lines.push(`   URL: ${r.url}`);
      if (r.snippet) lines.push(`   ${r.snippet}`);
      lines.push("");
    });
  }

  if (research.pages.length > 0) {
    lines.push("--- CONTENIDO DE PÁGINAS VISITADAS ---");
    research.pages.forEach((p, i) => {
      lines.push(`[Página ${i + 1}] ${p.title}`);
      lines.push(`URL: ${p.url}`);
      lines.push(p.text.slice(0, 2000));
      lines.push("");
    });
  }

  lines.push("=== FIN INVESTIGACIÓN WEB ===");
  return lines.join("\n");
}
