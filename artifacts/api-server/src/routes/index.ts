import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import appsRouter from "./apps";
import imagesRouter from "./images";
import billingRouter from "./billing";
import billingLiveRouter from "./billing-live";
import adminRouter from "./admin";
import debugBundleRouter from "./debugBundle";
import uploadsRouter from "./uploads";
import jobsRouter from "./jobs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(debugBundleRouter);
// Mount images BEFORE apps so the public GET /apps/:appId/images/:imageId
// route is matched without `requireAuth` middleware kicking in from apps.ts.
router.use(imagesRouter);
router.use(appsRouter);
router.use(uploadsRouter);
router.use(jobsRouter);
router.use(billingRouter);
router.use(billingLiveRouter);
router.use(adminRouter);

export default router;
