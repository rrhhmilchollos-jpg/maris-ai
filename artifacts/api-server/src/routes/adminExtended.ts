/**
 * artifacts/api-server/src/routes/adminExtended.ts
 *
 * Endpoints adicionales requeridos por el nuevo admin-dashboard.tsx.
 * Montar en app.ts ANTES de las rutas genéricas:
 *
 *   import adminExtendedRouter from "./routes/adminExtended.js";
 *   app.use("/api/admin", requireAuth, requireAdmin, adminExtendedRouter);
 *
 * Los endpoints existentes en /api/admin/metrics ya están en routes/apps.ts;
 * estos los complementan con gestión de users, apps y cola de jobs.
 */

import { Router } from "express";
import { db } from "../lib/db.js";
import {
  users,
  generatedApps,
} from "@workspace/db/schema";
import { eq, desc, sql, ilike, or } from "drizzle-orm";

const router = Router();

// ─── GET /api/admin/users ────────────────────────────────────────────────────

router.get("/users", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        credits: users.credits,
        plan: users.plan,
        status: users.status,
        createdAt: users.createdAt,
        lastActiveAt: users.lastActiveAt,
        appsCount: sql<number>`(
          SELECT COUNT(*)::int FROM generated_apps
          WHERE user_id = ${users.id}
        )`,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(500);

    res.json(rows);
  } catch (err) {
    console.error("[admin/users GET]", err);
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

// ─── PATCH /api/admin/users/:id ──────────────────────────────────────────────

router.patch("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { credits, plan, status } = req.body as {
    credits?: number;
    plan?: string;
    status?: string;
  };

  const allowed: Record<string, unknown> = {};
  if (credits !== undefined) allowed.credits = Math.max(0, Number(credits));
  if (plan !== undefined) allowed.plan = plan;
  if (status !== undefined) allowed.status = status;

  if (Object.keys(allowed).length === 0) {
    return res.status(400).json({ error: "Nada que actualizar" });
  }

  try {
    const [updated] = await db
      .update(users)
      .set(allowed)
      .where(eq(users.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(updated);
  } catch (err) {
    console.error("[admin/users PATCH]", err);
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

// ─── GET /api/admin/apps ─────────────────────────────────────────────────────

router.get("/apps", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: generatedApps.id,
        title: generatedApps.title,
        kind: generatedApps.kind,
        status: generatedApps.status,
        publicSlug: generatedApps.publicSlug,
        creditsCost: generatedApps.creditsCost,
        createdAt: generatedApps.createdAt,
        userEmail: sql<string>`(
          SELECT email FROM users WHERE id = ${generatedApps.userId}
        )`,
      })
      .from(generatedApps)
      .orderBy(desc(generatedApps.createdAt))
      .limit(300);

    res.json(rows);
  } catch (err) {
    console.error("[admin/apps GET]", err);
    res.status(500).json({ error: "Error al obtener apps" });
  }
});

// ─── DELETE /api/admin/apps/:id ──────────────────────────────────────────────

router.delete("/apps/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [deleted] = await db
      .delete(generatedApps)
      .where(eq(generatedApps.id, id))
      .returning({ id: generatedApps.id });

    if (!deleted) return res.status(404).json({ error: "App no encontrada" });
    res.status(204).end();
  } catch (err) {
    console.error("[admin/apps DELETE]", err);
    res.status(500).json({ error: "Error al eliminar app" });
  }
});

// ─── GET /api/admin/jobs ─────────────────────────────────────────────────────
// Consulta la tabla interna de pg-boss para el estado de los jobs.

router.get("/jobs", async (req, res) => {
  try {
    // pg-boss usa el schema pgboss por defecto.
    // Si tienes un schema diferente, ajusta "pgboss.job".
    const rows = await db.execute(sql`
      SELECT
        j.id::text,
        j.data->>'appId'   AS "appId",
        j.data->>'userId'  AS "userId",
        j.state,
        j.started_on       AS "startedOn",
        j.completed_on     AS "completedOn",
        j.output::text     AS output,
        COALESCE(
          (SELECT title FROM generated_apps WHERE id = (j.data->>'appId')::text),
          'Sin título'
        )                  AS "appTitle",
        COALESCE(
          (SELECT email FROM users WHERE id = j.data->>'userId'),
          '—'
        )                  AS "userEmail"
      FROM pgboss.job j
      WHERE j.name = 'generate-app'
      ORDER BY j.created_on DESC
      LIMIT 100
    `);

    res.json(rows.rows);
  } catch (err) {
    // Si pg-boss no está disponible, devolvemos array vacío en vez de 500
    console.warn("[admin/jobs GET] pg-boss no disponible:", err);
    res.json([]);
  }
});

// ─── POST /api/admin/jobs/:id/retry ──────────────────────────────────────────

router.post("/jobs/:id/retry", async (req, res) => {
  const { id } = req.params;
  try {
    // Marcamos el job como 'created' para que el worker lo reintente.
    await db.execute(sql`
      UPDATE pgboss.job
      SET state = 'created',
          started_on = NULL,
          completed_on = NULL,
          output = NULL,
          retry_count = 0
      WHERE id = ${id}::uuid
        AND name = 'generate-app'
    `);
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin/jobs retry]", err);
    res.status(500).json({ error: "No se pudo reintentar el job" });
  }
});

export default router;
