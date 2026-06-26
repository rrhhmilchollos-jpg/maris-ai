import { Router, type IRouter, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isQueueReady } from "../lib/jobQueue";
import fs from 'fs';
import path from 'path';

const router: IRouter = Router();

function sendHealth(res: Response) {
  const data = HealthCheckResponse.parse({ status: "ok" });
  // Surface degraded queue state so operators see when generations would
  // fall back to in-process setImmediate (no restart resilience).
  const queueReady = isQueueReady();
  
  // Verificar si el Testing Agent está cargado y disponible
  // En producción (Railway): el build de esbuild genera un único bundle index.mjs,
  // por lo que el tester.ts queda embebido. Se verifica la existencia del bundle.
  // En desarrollo: se busca el archivo fuente src/lib/tester.ts
  const distBundle = path.join(process.cwd(), 'dist/index.mjs');
  const testerPathSrc = path.join(process.cwd(), 'src/lib/tester.ts');
  const testerExists = fs.existsSync(distBundle) || fs.existsSync(testerPathSrc);

  const memUsage = process.memoryUsage();
  
  // Scaling info — replica ID from Railway env
  const instanceId = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "single-instance";
  const concurrency = parseInt(process.env.JOB_CONCURRENCY || "10", 10);
  
  res.json({ 
    ...data, 
    queue: queueReady ? "ready" : "degraded",
    testing_agent: testerExists ? "active" : "missing",
    version: "2.2.0-scalable",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    instance: instanceId,
    concurrency,
    memory: {
      rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
    },
    scaling: {
      mode: process.env.RAILWAY_REPLICA_ID ? "multi-replica" : "single-instance",
      hint: "Aumenta réplicas en Railway Dashboard → Settings → Replicas para escalar horizontalmente",
      bullmq: queueReady ? "distributed-ready" : "in-process-fallback",
    }
  });
}

router.get("/healthz", (_req, res) => sendHealth(res));

// Render is configured with healthCheckPath: /api/health in render.yaml.
// Keep /healthz for backwards compatibility, but expose /health as the
// canonical deploy health endpoint so new releases are not marked unhealthy.
router.get("/health", (_req, res) => sendHealth(res));

export default router;
