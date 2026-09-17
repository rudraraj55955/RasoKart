import { Router } from "express";
import { cashfreePayinWebhookHandler } from "./cashfreeWebhook";

const router = Router();

/**
 * POST /api/webhooks/payin
 *
 * `/cashfree` remains accepted as a legacy alias for provider configurations
 * saved before the canonical endpoint was established. Both paths delegate to
 * the same fail-closed Cashfree handler and current wallet accounting flow.
 */
router.post(["/", "/cashfree"], cashfreePayinWebhookHandler);

export default router;
