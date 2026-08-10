/**
 * Dev-only test-support routes — mounted at /api/dev ONLY when
 * NODE_ENV !== "production".  Every handler re-checks NODE_ENV as a
 * defence-in-depth guard even if the router is somehow reached in production.
 *
 * Routes:
 *   GET  /api/dev/otp             — consume the captured plaintext OTP
 *   POST /api/dev/otp/expire      — force-expire the latest OTP row (expired OTP test)
 *   POST /api/dev/otp/reset-cooldown — age the latest OTP row to bypass 60-sec cooldown
 *
 * DO NOT import or mount this file in any production entry-point path.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db, merchantAuthOtpsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { hashIdentifier } from "../helpers/otp";
import { consumeDevOtp } from "../lib/devOtpStore";

const router = Router();

// Double-guard: refuse every request if somehow reached in production.
function devOnly(_req: Request, res: Response, next: NextFunction): void {
  if (process.env["NODE_ENV"] === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}
router.use(devOnly);

// ── GET /api/dev/otp?email=x&purpose=y ──────────────────────────────────────
// Consumes (read + delete) the in-memory OTP captured at generate-time.
// Returns 404 if none is present (e.g. send-otp was not called first).
router.get("/otp", (req: Request, res: Response): void => {
  const rawEmail = req.query["email"];
  const purpose = req.query["purpose"];
  if (typeof rawEmail !== "string" || !rawEmail || typeof purpose !== "string" || !purpose) {
    res.status(400).json({ error: "email and purpose query params are required" });
    return;
  }
  const hash = hashIdentifier(rawEmail.toLowerCase().trim());
  const otp = consumeDevOtp(hash, purpose);
  if (!otp) {
    res.status(404).json({
      error: "No OTP found for this email/purpose. Call the send-OTP endpoint first.",
    });
    return;
  }
  res.json({ otp });
});

// ── POST /api/dev/otp/expire { email, purpose } ─────────────────────────────
// Sets the latest OTP row's expires_at to 1 second in the past so that the
// verify endpoint rejects it as expired.  Used by the "expired OTP → 400" test.
router.post("/otp/expire", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, purpose } = req.body as { email?: string; purpose?: string };
    if (!email || !purpose) {
      res.status(400).json({ error: "email and purpose body fields are required" });
      return;
    }
    const hash = hashIdentifier(email.toLowerCase().trim());

    const [row] = await db
      .select({ id: merchantAuthOtpsTable.id })
      .from(merchantAuthOtpsTable)
      .where(and(
        eq(merchantAuthOtpsTable.identifierHash, hash),
        eq(merchantAuthOtpsTable.purpose, purpose),
      ))
      .orderBy(desc(merchantAuthOtpsTable.createdAt))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "No OTP row found for this email/purpose" });
      return;
    }

    await db
      .update(merchantAuthOtpsTable)
      .set({ expiresAt: new Date(Date.now() - 2_000) })
      .where(eq(merchantAuthOtpsTable.id, row.id));

    res.json({ ok: true, expiredId: row.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/dev/otp/reset-cooldown { email, purpose } ─────────────────────
// Ages the latest OTP row's created_at by 2 minutes so the 60-second resend
// cooldown is bypassed on the very next send-OTP request.
router.post("/otp/reset-cooldown", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, purpose } = req.body as { email?: string; purpose?: string };
    if (!email || !purpose) {
      res.status(400).json({ error: "email and purpose body fields are required" });
      return;
    }
    const hash = hashIdentifier(email.toLowerCase().trim());

    const [row] = await db
      .select({ id: merchantAuthOtpsTable.id })
      .from(merchantAuthOtpsTable)
      .where(and(
        eq(merchantAuthOtpsTable.identifierHash, hash),
        eq(merchantAuthOtpsTable.purpose, purpose),
      ))
      .orderBy(desc(merchantAuthOtpsTable.createdAt))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "No OTP row found" });
      return;
    }

    await db
      .update(merchantAuthOtpsTable)
      .set({ createdAt: new Date(Date.now() - 2 * 60 * 1000) })
      .where(eq(merchantAuthOtpsTable.id, row.id));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export { router as devHelperRouter };
