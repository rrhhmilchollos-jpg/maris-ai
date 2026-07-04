/**
 * dynamicPinning.ts — Auto-pinning dinámico de dependencias del Preview/Deploy.
 *
 * Problema que resuelve: deployBundle.ts satisface los bare imports del bundle
 * generado por la IA vía un import map de esm.sh. La versión se resuelve así:
 *
 *   1. package.json del propio bundle (fuente de verdad si existe)
 *   2. DEFAULT_VERSIONS (mapa estático curado, smoke-tested a mano)
 *   3. …y antes de este módulo: "latest" sin garantía → causa real de
 *      previews colgados y apps rotas cuando la IA importa algo exótico.
 *
 * Este módulo sustituye el paso 3 por una resolución dinámica con garantías:
 *
 *   3a. Caché en memoria del proceso (cero latencia en el mismo worker)
 *   3b. Caché persistente en MongoDB (colección pinned_packages) — la primera
 *       app que usó el paquete ya pagó el coste; el resto resuelve al instante
 *   3c. registry.npmjs.org → versión dist-tags.latest EXACTA en este momento
 *   3d. Smoke test contra esm.sh (el CDN real del preview): si esm.sh no puede
 *       servir name@version, el pin se marca "failed" y el caller decide
 *       (normalmente: dejar el import sin versión y que esm.sh haga su
 *       mejor esfuerzo, exactamente el comportamiento anterior — nunca peor).
 *
 * Los pins "verified" son permanentes a propósito: pinear congela el
 * comportamiento para siempre, que es el objetivo (caso lucide-react@0.488).
 * Los "failed" se reintentan pasado FAILED_RETRY_MS por si fue un fallo
 * transitorio de red o un paquete recién publicado aún no propagado.
 *
 * Diseño fail-soft: si Mongo no está conectado o npm/esm.sh no responden,
 * ninguna promesa revienta el deploy — se devuelve null y el bundle sale
 * igual que salía antes de existir este módulo.
 */

import { PinnedPackage } from "@workspace/db/schema";

// ─── Configuración ───────────────────────────────────────────────────────────

const NPM_REGISTRY = "https://registry.npmjs.org";
const ESM_CDN = "https://esm.sh";

/** Timeout por petición externa. El deploy no debe quedarse colgado por un pin. */
const FETCH_TIMEOUT_MS = 8_000;

/** Un pin "failed" se reintenta pasado este tiempo (fallos transitorios). */
const FAILED_RETRY_MS = 60 * 60 * 1000; // 1 hora

/** Nombres de paquete npm válidos (evita pasar basura del bundler al registro). */
const VALID_NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

// ─── Caché en memoria (por proceso) ──────────────────────────────────────────

type MemEntry = { version: string | null; expiresAt: number };
const memCache = new Map<string, MemEntry>();
const MEM_TTL_VERIFIED = Infinity; // verificado = congelado para siempre
const MEM_TTL_FAILED = FAILED_RETRY_MS;

// ─── Utilidades ──────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Consulta registry.npmjs.org y devuelve la versión `latest` exacta, o null
 * si el paquete no existe (404 = alucinación de la IA) o la red falla.
 */
async function fetchLatestFromRegistry(name: string): Promise<string | null> {
  try {
    // Endpoint ligero: /<name>/latest devuelve solo el manifest de esa versión
    // (~KB) en lugar del packument completo (que para react son varios MB).
    const res = await fetchWithTimeout(
      `${NPM_REGISTRY}/${encodeURIComponent(name).replace("%40", "@").replace("%2F", "/")}/latest`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" && data.version ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Smoke test: ¿puede esm.sh (el CDN que usa el preview real) servir este
 * paquete a esta versión exacta? Un GET a la URL raíz del paquete fuerza a
 * esm.sh a construir el módulo; 2xx = servible. Es la misma comprobación que
 * hará el navegador del usuario, hecha por adelantado en el servidor.
 */
async function smokeTestEsmSh(
  name: string,
  version: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetchWithTimeout(
      `${ESM_CDN}/${name}@${version}?external=react,react-dom`,
      { method: "GET", redirect: "follow" },
    );
    // No necesitamos el cuerpo, solo saber que esm.sh lo construyó.
    // Cancelar el stream libera la conexión sin descargar el módulo entero.
    try { await res.body?.cancel(); } catch { /* ignorable */ }
    return { ok: res.ok, detail: `esm.sh HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `esm.sh unreachable: ${(err as Error).message}` };
  }
}

// ─── Persistencia (fail-soft si Mongo no está disponible) ────────────────────

async function readPin(name: string): Promise<{ version: string | null } | null> {
  try {
    const doc = await PinnedPackage.findOne({ name }).lean();
    if (!doc) return null;
    if (doc.status === "verified" && doc.version) {
      // hitCount es telemetría, no bloquea la resolución
      PinnedPackage.updateOne({ name }, { $inc: { hitCount: 1 } }).catch(() => {});
      return { version: doc.version };
    }
    // failed: respetar TTL de reintento
    const failedAt = doc.failedAt ? new Date(doc.failedAt).getTime() : 0;
    if (Date.now() - failedAt < FAILED_RETRY_MS) return { version: null };
    return null; // TTL vencido → reintentar resolución completa
  } catch {
    return null; // Mongo caído/no conectado → seguir sin caché persistente
  }
}

async function writePin(
  name: string,
  result: { version: string; detail: string } | { version: null; detail: string },
): Promise<void> {
  try {
    if (result.version) {
      await PinnedPackage.updateOne(
        { name },
        {
          $set: {
            version: result.version,
            status: "verified",
            smokeTestDetail: result.detail,
            verifiedAt: new Date(),
          },
          $setOnInsert: { hitCount: 0 },
        },
        { upsert: true },
      );
    } else {
      await PinnedPackage.updateOne(
        { name },
        {
          $set: {
            status: "failed",
            smokeTestDetail: result.detail,
            failedAt: new Date(),
          },
          $setOnInsert: { version: "", hitCount: 0 },
        },
        { upsert: true },
      );
    }
  } catch {
    /* fail-soft: sin Mongo el pin vive solo en la caché de memoria */
  }
}

// ─── Resolución de un paquete ────────────────────────────────────────────────

/** Deduplicación de resoluciones concurrentes del mismo paquete. */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Resuelve un paquete a una versión exacta verificada, o null si no se pudo
 * garantizar nada (el caller mantiene entonces el comportamiento clásico).
 */
export async function resolveDynamicPin(name: string): Promise<string | null> {
  if (!VALID_NPM_NAME.test(name)) return null;

  // 1. Memoria
  const mem = memCache.get(name);
  if (mem && mem.expiresAt > Date.now()) return mem.version;

  // Dedupe: N imports del mismo paquete en el mismo bundle → 1 resolución
  const existing = inFlight.get(name);
  if (existing) return existing;

  const task = (async (): Promise<string | null> => {
    // 2. MongoDB
    const cached = await readPin(name);
    if (cached) {
      memCache.set(name, {
        version: cached.version,
        expiresAt: cached.version ? MEM_TTL_VERIFIED : Date.now() + MEM_TTL_FAILED,
      });
      return cached.version;
    }

    // 3. Registro npm
    const latest = await fetchLatestFromRegistry(name);
    if (!latest) {
      const detail = "npm registry: not found or unreachable";
      memCache.set(name, { version: null, expiresAt: Date.now() + MEM_TTL_FAILED });
      await writePin(name, { version: null, detail });
      return null;
    }

    // 4. Smoke test contra el CDN real del preview
    const smoke = await smokeTestEsmSh(name, latest);
    if (!smoke.ok) {
      memCache.set(name, { version: null, expiresAt: Date.now() + MEM_TTL_FAILED });
      await writePin(name, { version: null, detail: smoke.detail });
      return null;
    }

    memCache.set(name, { version: latest, expiresAt: MEM_TTL_VERIFIED });
    await writePin(name, { version: latest, detail: smoke.detail });
    return latest;
  })();

  inFlight.set(name, task);
  try {
    return await task;
  } finally {
    inFlight.delete(name);
  }
}

/**
 * Resuelve varios paquetes en paralelo. Devuelve solo los que quedaron
 * pineados a una versión verificada — los demás simplemente no aparecen
 * en el mapa y el caller aplica su fallback de siempre.
 */
export async function resolveDynamicPins(
  names: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(names)];
  const out: Record<string, string> = {};
  await Promise.all(
    unique.map(async (name) => {
      const version = await resolveDynamicPin(name);
      if (version) out[name] = version;
    }),
  );
  return out;
}
