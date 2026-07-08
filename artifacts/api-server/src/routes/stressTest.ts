/**
 * stressTest.ts
 *
 * Pruebas de carga reales contra el deploy en producción de una app del
 * usuario — cierra el hueco señalado externamente de "sin pruebas de
 * estrés automatizadas". Usa autocannon (librería npm pura, sin binarios
 * externos) para generar tráfico real y medir latencia/throughput/errores.
 *
 * LÍMITES DE SEGURIDAD DELIBERADOS (este endpoint NO debe poder convertirse
 * en una herramienta de ataque DDoS contra terceros):
 * - Solo contra apps DESPLEGADAS y de propiedad verificada del usuario que
 *   hace la petición — nunca contra una URL arbitraria que el usuario pase.
 * - Duración y conexiones acotadas a un máximo razonable, sin excepción.
 * - Coste en créditos, igual que cualquier otra operación de cómputo real
 *   de la plataforma — evita abuso por repetición gratuita.
 *
 * POST /api/apps/:appId/stress-test
 * Body: { durationSeconds?: number, connections?: number }
 */
import { Router, type Request, type Response } from "express";
import autocannon from "autocannon";
import { GeneratedApp } from "@workspace/db/schema";
import { requireAuth, isAdminEmail } from "../lib/auth";
import { logger } from "../lib/logger";
import { chargeCredits } from "../lib/credits";

const router = Router();

const MAX_DURATION_SECONDS = 15;
const MAX_CONNECTIONS = 20;
const STRESS_TEST_CREDIT_COST = 5;

router.post("/apps/:appId/stress-test", requireAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    // ENCONTRADO A PETICIÓN DEL USUARIO (mismo hallazgo que watermark.ts):
    // req.auth?.userId no existe en este proyecto -- requireAuth pone el
    // ID en req.userId directamente. Con el campo equivocado, este
    // endpoint devolvía siempre 401, y ademas isAdmin nunca se calculaba
    // correctamente tampoco.
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "No autenticado" });
    const isAdmin = isAdminEmail((req as any).dbUser?.email);

    const appData = await GeneratedApp.findOne({ _id: appId, userId }).lean();
    if (!appData) return res.status(404).json({ error: "App no encontrada" });

    // Solo contra el deploy real — nunca contra una URL que el usuario pase
    // por body. Esta restricción es deliberada y no debe relajarse: es lo
    // que evita que este endpoint se use para atacar dominios de terceros.
    const targetUrl = (appData as any).marisaiSubdomain
      ? `https://${(appData as any).marisaiSubdomain}.marisai.es`
      : (appData as any).customDomain && (appData as any).customDomainVerified
        ? `https://${(appData as any).customDomain}`
        : null;
    if (!targetUrl) {
      return res.status(400).json({ error: "Esta app todavía no está desplegada — despliega primero para poder probar su carga real." });
    }

    const { durationSeconds, connections } = (req.body as { durationSeconds?: number; connections?: number }) || {};
    const safeDuration = Math.min(Math.max(1, durationSeconds ?? 10), MAX_DURATION_SECONDS);
    const safeConnections = Math.min(Math.max(1, connections ?? 10), MAX_CONNECTIONS);

    const charge = await chargeCredits({
      userId,
      isAdmin,
      amount: STRESS_TEST_CREDIT_COST,
      description: `Prueba de estrés — ${appData.title}`,
    });
    if (!charge.ok) {
      return res.status(402).json({ error: "Créditos insuficientes para ejecutar una prueba de estrés." });
    }

    logger.info({ appId, targetUrl, safeDuration, safeConnections }, "Starting stress test");

    const result = await autocannon({
      url: targetUrl,
      connections: safeConnections,
      duration: safeDuration,
    });

    const errorRate = result.requests.total > 0 ? (result.errors + result.non2xx) / result.requests.total : 0;
    const verdict: "good" | "warning" | "critical" =
      errorRate > 0.1 ? "critical" : errorRate > 0.02 || result.latency.p99 > 3000 ? "warning" : "good";

    return res.json({
      targetUrl,
      durationSeconds: safeDuration,
      connections: safeConnections,
      requestsPerSecond: Math.round(result.requests.average),
      totalRequests: result.requests.total,
      latency: {
        averageMs: result.latency.average,
        p50Ms: result.latency.p50,
        p99Ms: result.latency.p99,
      },
      throughputMbps: Math.round((result.throughput.average / 1024 / 1024) * 100) / 100,
      errors: result.errors,
      non2xxResponses: result.non2xx,
      errorRatePercent: Math.round(errorRate * 10000) / 100,
      verdict,
      newCreditBalance: charge.newBalance,
    });
  } catch (err) {
    logger.error({ err }, "Error running stress test");
    return res.status(500).json({ error: "Error interno al ejecutar la prueba de estrés" });
  }
});

export default router;
