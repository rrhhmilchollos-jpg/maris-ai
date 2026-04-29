import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { generatedApps } from "@workspace/db/schema";

const router: IRouter = Router();

router.get("/__debug/bundle/:id", async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  const raw = req.params.id;
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db.select().from(generatedApps).where(eq(generatedApps.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ id: row.id, title: row.title, frontendCode: row.frontendCode, language: row.language });
});

export default router;
