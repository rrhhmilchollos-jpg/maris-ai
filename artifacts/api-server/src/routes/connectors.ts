/**
 * connectors.ts — API REST del ecosistema de conectores (estilo Emergent).
 *
 * Completa el círculo que empezó mcpIntegrations.ts (que solo VERIFICABA
 * credenciales sin guardarlas): aquí las credenciales se guardan cifradas
 * (AES-256-GCM → connector_credentials) y las acciones se ejecutan
 * server-side vía el gateway (lib/connectorActions.ts). El frontend — y
 * sobre todo las apps generadas por la IA — nunca tocan un secreto.
 *
 * Endpoints (todos bajo /api, todos con requireAuth):
 *   GET    /connectors                        → catálogo de acciones disponibles
 *   GET    /connectors/credentials            → conectores conectados del usuario (sin secretos)
 *   POST   /connectors/:id/credentials        → verificar + cifrar + guardar { values, label? }
 *   DELETE /connectors/:id/credentials        → desconectar
 *   POST   /connectors/:id/actions/:actionId  → ejecutar acción { params }
 */

import { Router, type Request, type Response, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { ConnectorCredential } from "@workspace/db/schema";
import { VERIFIERS } from "./mcpIntegrations";
import {
  encryptCredentials,
  encryptionConfigured,
  EncryptionKeyMissingError,
} from "../lib/connectorCrypto";
import { actionCatalog, executeConnectorAction } from "../lib/connectorActions";

const router: IRouter = Router();

// ─── Catálogo ────────────────────────────────────────────────────────────────

router.get("/connectors", requireAuth, (_req: Request, res: Response) => {
  res.json({
    encryptionConfigured: encryptionConfigured(),
    connectors: Object.keys(VERIFIERS),
    actions: actionCatalog(),
  });
});

// ─── Credenciales del usuario (solo metadata, jamás los secretos) ────────────

router.get("/connectors/credentials", requireAuth, async (req: Request, res: Response) => {
  try {
    const docs = await ConnectorCredential.find({ userId: req.userId })
      .select("connectorId label verified verifiedAt lastUsedAt createdAt")
      .lean();
    res.json({ credentials: docs });
  } catch (err) {
    logger.error({ err }, "Error listing connector credentials");
    res.status(500).json({ error: "Error interno listando conectores." });
  }
});

// ─── Guardar (verificar → cifrar → upsert) ───────────────────────────────────

router.post("/connectors/:id/credentials", requireAuth, async (req: Request, res: Response) => {
  try {
    const connectorId = req.params.id;
    const { values, label } = req.body as { values?: Record<string, string>; label?: string };
    const verifier = VERIFIERS[connectorId as keyof typeof VERIFIERS];
    if (!verifier) return res.status(400).json({ ok: false, message: `Conector desconocido: ${connectorId}` });
    if (!values || typeof values !== "object" || Object.keys(values).length === 0) {
      return res.status(400).json({ ok: false, message: "Faltan las credenciales (values)." });
    }
    // Sanidad básica: solo strings, tamaño acotado (un token no mide 100KB).
    for (const [k, v] of Object.entries(values)) {
      if (typeof v !== "string" || v.length > 8_192 || k.length > 128) {
        return res.status(400).json({ ok: false, message: `Credencial inválida: ${k}` });
      }
    }

    // 1. Verificación REAL contra el servicio (mismo motor que /mcp/test)
    const verification = await verifier(values);
    if (!verification.ok) return res.status(400).json(verification);

    // 2. Cifrar y guardar (falla claro si no hay clave de cifrado configurada)
    const blob = encryptCredentials(values);
    await ConnectorCredential.updateOne(
      { userId: req.userId, connectorId },
      {
        $set: {
          ...blob,
          label: typeof label === "string" ? label.slice(0, 120) : undefined,
          verified: true,
          verifiedAt: new Date(),
        },
      },
      { upsert: true },
    );
    return res.json({ ok: true, message: `${verification.message} Credenciales guardadas cifradas.` });
  } catch (err) {
    if (err instanceof EncryptionKeyMissingError) {
      return res.status(503).json({ ok: false, message: err.message });
    }
    logger.error({ err }, "Error saving connector credentials");
    return res.status(500).json({ ok: false, message: "Error interno guardando el conector." });
  }
});

// ─── Desconectar ─────────────────────────────────────────────────────────────

router.delete("/connectors/:id/credentials", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await ConnectorCredential.deleteOne({ userId: req.userId, connectorId: req.params.id });
    res.json({ ok: true, deleted: result.deletedCount > 0 });
  } catch (err) {
    logger.error({ err }, "Error deleting connector credentials");
    res.status(500).json({ ok: false, message: "Error interno desconectando el servicio." });
  }
});

// ─── Ejecutar acción ─────────────────────────────────────────────────────────

router.post("/connectors/:id/actions/:actionId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { params } = req.body as { params?: Record<string, unknown> };
    const result = await executeConnectorAction(
      String(req.userId),
      String(req.params.id),
      String(req.params.actionId),
      params ?? {},
    );
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    logger.error({ err }, "Error executing connector action");
    return res.status(500).json({ ok: false, message: "Error interno ejecutando la acción." });
  }
});

export default router;
