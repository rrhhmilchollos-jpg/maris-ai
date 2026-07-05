/**
 * workflows.ts
 *
 * CRUD del editor visual de flujos (motor tipo n8n, privado por app
 * generada) + endpoint de ejecución manual para probar un flujo desde el
 * propio editor antes de activarlo en producción.
 *
 * GET    /api/apps/:appId/workflows           → listar flujos de una app
 * POST   /api/apps/:appId/workflows           → crear un flujo nuevo
 * GET    /api/apps/:appId/workflows/:id       → obtener un flujo concreto
 * PATCH  /api/apps/:appId/workflows/:id       → actualizar nodos/aristas/estado
 * DELETE /api/apps/:appId/workflows/:id       → eliminar un flujo
 * POST   /api/apps/:appId/workflows/:id/run   → ejecutar manualmente (modo prueba)
 * GET    /api/apps/:appId/workflows/:id/runs  → historial de ejecuciones (depuración visual)
 */
import { Router, type Request, type Response } from "express";
import { GeneratedApp, Workflow, WorkflowRun } from "@workspace/db/schema";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { executeWorkflow } from "../lib/workflowEngine";

const router = Router();

// req.params puede tipar valores como string | string[] (Express permite
// segmentos de ruta repetidos). Estos endpoints solo esperan un valor único
// por param nombrado, así que se normaliza aquí una sola vez en vez de
// dejar la ambigüedad de tipo viajando hasta cada función que lo consume.
function paramStr(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

async function getOwnedApp(appId: string, userId: string) {
  return GeneratedApp.findOne({ _id: appId, userId }).lean();
}

router.get("/apps/:appId/workflows", requireAuth, async (req: Request, res: Response) => {
  try {
    const appId = paramStr(req.params.appId);
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "No autenticado" });
    const appData = await getOwnedApp(appId, userId);
    if (!appData) return res.status(404).json({ error: "App no encontrada" });

    const workflows = await Workflow.find({ appId }).sort({ createdAt: -1 }).lean();
    return res.json({ workflows });
  } catch (err) {
    logger.error({ err }, "Error listing workflows");
    return res.status(500).json({ error: "Error interno" });
  }
});

router.post("/apps/:appId/workflows", requireAuth, async (req: Request, res: Response) => {
  try {
    const appId = paramStr(req.params.appId);
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "No autenticado" });
    const appData = await getOwnedApp(appId, userId);
    if (!appData) return res.status(404).json({ error: "App no encontrada" });

    const { name, description, triggerEventType } = req.body as { name?: string; description?: string; triggerEventType?: string };
    if (!name) return res.status(400).json({ error: "Falta el nombre del flujo" });

    const triggerNodeId = `trigger-${Date.now()}`;
    const workflow = await Workflow.create({
      appId,
      userId,
      name,
      description,
      triggerEventType,
      active: false,
      // Todo flujo nuevo arranca con su nodo de disparador ya colocado —
      // igual que n8n/Make crean automáticamente el nodo inicial al crear
      // un flujo nuevo, en vez de dejar al usuario un lienzo vacío sin saber
      // por dónde empezar.
      nodes: [{ id: triggerNodeId, type: "trigger", position: { x: 100, y: 200 }, data: { eventType: triggerEventType || "" } }],
      edges: [],
    });
    return res.status(201).json({ workflow });
  } catch (err) {
    logger.error({ err }, "Error creating workflow");
    return res.status(500).json({ error: "Error interno" });
  }
});

router.get("/apps/:appId/workflows/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const appId = paramStr(req.params.appId);
    const id = paramStr(req.params.id);
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "No autenticado" });
    const appData = await getOwnedApp(appId, userId);
    if (!appData) return res.status(404).json({ error: "App no encontrada" });

    const workflow = await Workflow.findOne({ _id: id, appId }).lean();
    if (!workflow) return res.status(404).json({ error: "Flujo no encontrado" });
    return res.json({ workflow });
  } catch (err) {
    logger.error({ err }, "Error fetching workflow");
    return res.status(500).json({ error: "Error interno" });
  }
});

router.patch("/apps/:appId/workflows/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const appId = paramStr(req.params.appId);
    const id = paramStr(req.params.id);
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "No autenticado" });
    const appData = await getOwnedApp(appId, userId);
    if (!appData) return res.status(404).json({ error: "App no encontrada" });

    const { name, description, nodes, edges, active, triggerEventType } = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (nodes !== undefined) update.nodes = nodes;
    if (edges !== undefined) update.edges = edges;
    if (active !== undefined) update.active = active;
    if (triggerEventType !== undefined) update.triggerEventType = triggerEventType;

    const workflow = await Workflow.findOneAndUpdate({ _id: id, appId }, update, { new: true }).lean();
    if (!workflow) return res.status(404).json({ error: "Flujo no encontrado" });
    return res.json({ workflow });
  } catch (err) {
    logger.error({ err }, "Error updating workflow");
    return res.status(500).json({ error: "Error interno" });
  }
});

router.delete("/apps/:appId/workflows/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const appId = paramStr(req.params.appId);
    const id = paramStr(req.params.id);
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "No autenticado" });
    const appData = await getOwnedApp(appId, userId);
    if (!appData) return res.status(404).json({ error: "App no encontrada" });

    await Workflow.deleteOne({ _id: id, appId });
    await WorkflowRun.deleteMany({ workflowId: id });
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Error deleting workflow");
    return res.status(500).json({ error: "Error interno" });
  }
});

router.post("/apps/:appId/workflows/:id/run", requireAuth, async (req: Request, res: Response) => {
  try {
    const appId = paramStr(req.params.appId);
    const id = paramStr(req.params.id);
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "No autenticado" });
    const appData = await getOwnedApp(appId, userId);
    if (!appData) return res.status(404).json({ error: "App no encontrada" });

    const workflow = await Workflow.findOne({ _id: id, appId }).lean();
    if (!workflow) return res.status(404).json({ error: "Flujo no encontrado" });

    // Ejecución manual de prueba: se fuerza temporalmente como si estuviera
    // activo si el usuario lo está probando desde el editor sin haberlo
    // activado todavía aún — igual que n8n permite "Execute workflow" sobre
    // un flujo en modo borrador. No modifica el campo `active` real en DB
    // más allá de la ventana de esta ejecución de prueba.
    const testPayload = (req.body as { payload?: unknown })?.payload ?? { test: true };
    if (!workflow.active) {
      await Workflow.updateOne({ _id: id }, { active: true });
      try {
        await executeWorkflow(id, testPayload);
      } finally {
        await Workflow.updateOne({ _id: id }, { active: false });
      }
    } else {
      await executeWorkflow(id, testPayload);
    }

    const lastRun = await WorkflowRun.findOne({ workflowId: id }).sort({ startedAt: -1 }).lean();
    return res.json({ run: lastRun });
  } catch (err) {
    logger.error({ err }, "Error running workflow");
    return res.status(500).json({ error: "Error interno al ejecutar el flujo" });
  }
});

router.get("/apps/:appId/workflows/:id/runs", requireAuth, async (req: Request, res: Response) => {
  try {
    const appId = paramStr(req.params.appId);
    const id = paramStr(req.params.id);
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "No autenticado" });
    const appData = await getOwnedApp(appId, userId);
    if (!appData) return res.status(404).json({ error: "App no encontrada" });

    const runs = await WorkflowRun.find({ workflowId: id, appId }).sort({ startedAt: -1 }).limit(50).lean();
    return res.json({ runs });
  } catch (err) {
    logger.error({ err }, "Error fetching workflow runs");
    return res.status(500).json({ error: "Error interno" });
  }
});

export default router;
