import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import appsRouter from "./apps";
import billingRouter from "./billing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(appsRouter);
router.use(billingRouter);

export default router;
