import { Router } from "express";
import { readFileSync } from "fs";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const STATUS_FILE = new URL("../../../.github-sync-status.json", import.meta.url).pathname;

router.get("/status", (req, res, next) => {
  try {
    let payload: Record<string, string>;
    try {
      const raw = readFileSync(STATUS_FILE, "utf-8");
      payload = JSON.parse(raw) as Record<string, string>;
    } catch {
      payload = { status: "never" };
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
