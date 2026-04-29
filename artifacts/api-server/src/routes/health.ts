import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isQueueReady } from "../lib/jobQueue";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  // Surface degraded queue state so operators see when generations would
  // fall back to in-process setImmediate (no restart resilience).
  const queueReady = isQueueReady();
  res.json({ ...data, queue: queueReady ? "ready" : "degraded" });
});

export default router;
