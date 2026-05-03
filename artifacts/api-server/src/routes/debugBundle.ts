import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB } from "../lib/db";
import { GeneratedApp } from "@workspace/db/schema";
import { requireAuth, requireAdmin } from "../lib/auth";

const router: IRouter = Router();

router.get(
  "/__debug/bundle/:id",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === "production") {
      res.status(404).type("text/plain").send("Not found");
      return;
    }

    const id = req.params.id;
    await connectDB();

    const row = await GeneratedApp.findById(id).lean();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json({
      id: row._id,
      title: row.title,
      frontendCode: row.frontendCode,
      language: row.language,
    });
  },
);

export default router;
