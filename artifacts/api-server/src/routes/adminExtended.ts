/**
 * artifacts/api-server/src/routes/adminExtended.ts
 *
 * Endpoints del dashboard admin de Maris AI.
 * Usa SQL puro (sin imports de schema) para evitar conflictos de nombres.
 *
 * Montar en app.ts:
 *   import adminExtendedRouter from "./routes/adminExtended.js";
 *   app.use("/api/admin", adminExtendedRouter);
 */

import { Router } from "express";
import { db } from "../lib/db.js";
import { sql } from "drizzle-orm";

const router = Router();

// ─── GET /api/admin/users ────────────────────────────────────────────────────

router.get("/users", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        u.id,
        u.email,
        u.name,
        u.credits,
        COALESCE(u.plan, 'free')       AS plan,
        COALESCE(u.status, 'active')   AS status,
        u.created_at                   AS "createdAt",
        u.last_active_at               AS "lastActiveAt",
        (
          SELECT COUNT(*)::int
          FROM generated_apps
          WHERE user_id = u.id
        )                              AS "appsCount"
      FROM users u
      ORDER BY u.created_at DESC
      LIMIT 500
    `);
    res.json(result.rows);
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

  const parts: string[] = [];
  const values: unknown[] = [];

  if (credits !== undefined) {
    values.push(Math.max(0, Number(credits)));
    parts.push(`credits = $${values.length}`);
  }
  if (plan !== undefined) {
    values.push(plan);
    parts.push(`plan = $${values.length}`);
  }
  if (status !== undefined) {
    values.push(status);
    parts.push(`status = $${values.length}`);
  }

  if (parts.length === 0) {
    return res.status(400).json({ error: "Nada que actualizar" });
  }

  values.push(id);
  const setClause = parts.join(", ");
  const query = `
    UPDATE users
    SET ${setClause}
    WHERE id = $${values.length}
    RETURNING id, email, name, credits, plan, status
  `;

  try {
    // Usamos db.$client para queries parametrizadas dinámicas que drizzle
    // no puede construir estáticamente (SET dinámico).
    const result = await (db as any).$client.query(query, values);
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[admin/users PATCH]", err);
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
});

// ─── GET /api/admin/apps ─────────────────────────────────────────────────────

router.get("/apps", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        ga.id,
        ga.title,
        ga.kind,
        ga.status,
        ga.public_slug      AS "publicSlug",
        ga.credits_cost     AS "creditsCost",
        ga.created_at       AS "createdAt",
        (
          SELECT email FROM users WHERE id = ga.user_id
        )                   AS "userEmail"
      FROM generated_apps ga
      ORDER BY ga.created_at DESC
      LIMIT 300
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("[admin/apps GET]", err);
    res.status(500).json({ error: "Error al obtener apps" });
  }
});

// ─── DELETE /api/admin/apps/:id ──────────────────────────────────────────────

router.delete("/apps/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.execute(sql`
      DELETE FROM generated_apps
      WHERE id = ${id}
      RETURNING id
    `);
    if (!result.rows[0]) {
      return res.status(404).json({ error: "App no encontrada" });
    }
    res.status(204).end();
  } catch (err) {
    console.error("[admin/apps DELETE]", err);
    res.status(500).json({ error: "Error al eliminar app" });
  }
});

// ─── GET /api/admin/jobs ─────────────────────────────────────────────────────

router.get("/jobs", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        j.id::text,
        j.data->>'appId'    AS "appId",
        j.data->>'userId'   AS "userId",
        j.state,
        j.started_on        AS "startedOn",
        j.completed_on      AS "completedOn",
        j.output::text      AS output,
        COALESCE(
          (SELECT title FROM generated_apps WHERE id = j.data->>'appId'),
          'Sin título'
        )                   AS "appTitle",
        COALESCE(
          (SELECT email FROM users WHERE id = j.data->>'userId'),
          '—'
        )                   AS "userEmail"
      FROM pgboss.job j
      WHERE j.name = 'generate-app'
      ORDER BY j.created_on DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) {
    console.warn("[admin/jobs GET] pg-boss no disponible:", err);
    res.json([]);
  }
});

// ─── POST /api/admin/jobs/:id/retry ──────────────────────────────────────────

router.post("/jobs/:id/retry", async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute(sql`
      UPDATE pgboss.job
      SET
        state        = 'created',
        started_on   = NULL,
        completed_on = NULL,
        output       = NULL,
        retry_count  = 0
      WHERE id   = ${id}::uuid
        AND name = 'generate-app'
    `);
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin/jobs retry]", err);
    res.status(500).json({ error: "No se pudo reintentar el job" });
  }
});

export default router;
