import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import merchantsRouter from "./merchants";
import transactionsRouter from "./transactions";
import withdrawalsRouter from "./withdrawals";
import apiKeysRouter from "./apiKeys";
import webhooksRouter from "./webhooks";
import callbacksRouter from "./callbacks";
import settlementsRouter from "./settlements";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/dashboard", dashboardRouter);
router.use("/merchants", merchantsRouter);
router.use("/transactions", transactionsRouter);
router.use("/withdrawals", withdrawalsRouter);
router.use("/api-keys", apiKeysRouter);
router.use("/webhooks", webhooksRouter);
router.use("/callbacks", callbacksRouter);
router.use("/settlements", settlementsRouter);
router.use("/users", usersRouter);

export default router;
