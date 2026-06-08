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
  const testerPath = path.join(process.cwd(), 'src/lib/tester.ts');
  const testerExists = fs.existsSync(testerPath);

  res.json({ 
    ...data, 
    queue: queueReady ? "ready" : "degraded",
    testing_agent: testerExists ? "active" : "missing",
    version: "2.1.0-monitored"
  });
}

router.get("/healthz", (_req, res) => sendHealth(res));

// Render is configured with healthCheckPath: /api/health in render.yaml.
// Keep /healthz for backwards compatibility, but expose /health as the
// canonical deploy health endpoint so new releases are not marked unhealthy.
router.get("/health", (_req, res) => sendHealth(res));

export default router;
