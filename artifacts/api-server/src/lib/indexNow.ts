/**
 * indexNow.ts — Notifica a los motores de búsqueda de nuevas URLs al arrancar
 * IndexNow es el protocolo moderno soportado por Bing, DuckDuckGo, Yandex, Ecosia, etc.
 * Google no lo usa aún pero sí lo monitoriza.
 */

import { logger } from "./logger";

const INDEXNOW_KEY = "marisai9987e310506898d3";
const SITE = "https://www.marisai.es";

const URLS_TO_INDEX = [
  `${SITE}/`,
  `${SITE}/pricing`,
  `${SITE}/showcase`,
  `${SITE}/news`,
  `${SITE}/vs-emergent`,
  `${SITE}/vs-lovable`,
  `${SITE}/vs-bolt`,
  `${SITE}/vs-base44`,
  `${SITE}/que-es-vibe-coding`,
  `${SITE}/que-es-un-agente-de-ia`,
  `${SITE}/glosario`,
  `${SITE}/desarrollo-no-code-guia`,
  `${SITE}/landings/alternativa-bolt-new.html`,
  `${SITE}/landings/vibe-coding-espanol.html`,
  `${SITE}/landings/crear-app-madrid.html`,
  `${SITE}/landings/crear-app-barcelona.html`,
  `${SITE}/landings/crear-app-valencia.html`,
  `${SITE}/landings/crear-app-mexico.html`,
  `${SITE}/landings/app-para-restaurantes.html`,
  `${SITE}/landings/app-para-clinicas.html`,
];

export async function submitIndexNow(): Promise<void> {
  try {
    const payload = {
      host: "www.marisai.es",
      key: INDEXNOW_KEY,
      keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
      urlList: URLS_TO_INDEX,
    };

    // Enviar a Bing (comparte con DuckDuckGo, Ecosia, Seznam, Yandex)
    const bingRes = await fetch("https://www.bing.com/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });

    // Enviar a IndexNow.org (distribuye a múltiples motores)
    const inRes = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });

    logger.info(
      { bingStatus: bingRes.status, indexNowStatus: inRes.status, urls: URLS_TO_INDEX.length },
      "IndexNow: URLs enviadas a motores de búsqueda"
    );
  } catch (err: any) {
    // No crítico — si falla no afecta al servidor
    logger.warn({ err: err?.message }, "IndexNow: error al notificar motores (no crítico)");
  }
}
