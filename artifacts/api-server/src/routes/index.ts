import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import appsRouter from "./apps";
import imagesRouter from "./images";
import billingRouter from "./billing";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
// Mount images BEFORE apps so the public GET /apps/:appId/images/:imageId
// route is matched without `requireAuth` middleware kicking in from apps.ts.
router.use(imagesRouter);
router.use(appsRouter);
router.use(billingRouter);
router.use(adminRouter);

export default router;
