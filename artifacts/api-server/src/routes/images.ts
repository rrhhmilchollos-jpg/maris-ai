import { Router, type IRouter, type Request, type Response } from "express";
import { AppImage } from "@workspace/db/schema";

const router: IRouter = Router();

/**
 * Public binary route for AI-generated app images.
 *
 * No auth: the bundle that references these URLs is shown both in the
 * Sandpack preview (logged-in user) AND in the public `/p/<slug>` deploy
 * (anyone). Generated images are not user data — they're product output —
 * so a public URL is fine and is required for the public deploy to work.
 *
 * Cached aggressively (immutable) — rows are insert-only.
 */
router.get(
  "/apps/:appId/images/:imageId",
  async (req: Request, res: Response) => {
    const appId = req.params.appId;
    const imageId = req.params.imageId;

    const row = await AppImage.findOne({ _id: imageId, appId }).lean();
    if (!row) {
      res.status(404).json({ error: "Image not found" });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from((row as any).data, "base64");
    } catch {
      res.status(500).json({ error: "Corrupt image data" });
      return;
    }

    res.setHeader("Content-Type", (row as any).mimeType || "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Length", buffer.length.toString());
    // Public images are referenced from the Sandpack live-preview iframe,
    // which runs on a different origin (`*.csb.app`). Allow any origin to
    // load these as `<img>` / `fetch` so the preview doesn't show broken
    // images.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.status(200).end(buffer);
  },
);

export default router;
