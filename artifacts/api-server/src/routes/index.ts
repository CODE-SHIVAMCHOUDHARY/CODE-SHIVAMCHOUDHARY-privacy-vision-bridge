import { Router, type IRouter } from "express";
import healthRouter from "./health";
import visualPerceptionRouter from "./visual-perception";

const router: IRouter = Router();

router.use(healthRouter);
router.use(visualPerceptionRouter);

export default router;
