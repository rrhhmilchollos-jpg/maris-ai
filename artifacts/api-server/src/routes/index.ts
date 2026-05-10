import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import appsRouter from "./apps";
import imagesRouter from "./images";
import billingRouter from "./billing";
import adminRouter from "./admin";
import adminExtendedRouter from "./adminExtended";
import debugBundleRouter from "./debugBundle";
import uploadsRouter from "./uploads";
import jobsRouter from "./jobs";
import { TEMPLATES } from "../lib/templates";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(debugBundleRouter);
router.use(imagesRouter);
router.use(jobsRouter);
router.use(appsRouter);
router.use(uploadsRouter);
router.use(billingRouter);
router.use(adminRouter);
router.use("/admin", adminExtendedRouter);

// Templates endpoint
router.get("/templates", (_req, res) => {
  res.json({ templates: TEMPLATES });
});

export default router;
