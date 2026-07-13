import { Router } from "express";
import { db, withdrawalsTable, merchantsTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifySlipShareToken } from "../helpers/payoutSlipShare";
import { buildSlipData } from "./withdrawals";
import { buildPayoutSlipPdf } from "../helpers/payoutSlipPdf";
import { makeRateLimiter, safeIpKey } from "../helpers/makeRateLimiter";
import { ipKeyGenerator } from "express-rate-limit";
import { DbRateLimitStore } from "../lib/rateLimitStore";

const router = Router();

// Public verification endpoint is unauthenticated — rate-limit by real client IP.
// 20 requests per 5-minute window; generous for legitimate use, blocks scrapers.
//
// IP resolution strategy (Cloudflare → Nginx → Express):
//   CF-Connecting-IP is always set by Cloudflare to the real visitor IP and cannot
//   be injected or overridden by the client. We prefer it over req.ip, which behind
//   Cloudflare resolves to the Cloudflare edge node IP rather than the real client.
//   Outside Cloudflare (dev / direct-access) we fall back to safeIpKey(req.ip).
const verifyLimiter = makeRateLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  store: new DbRateLimitStore(),
  message: { error: "Too many verification requests. Please wait a few minutes and try again." },
  skipFailedRequests: false,
  keyGenerator: (req) => {
    const cf = req.headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf.trim()) return ipKeyGenerator(cf.trim());
    return safeIpKey(req);
  },
});

// GET /api/public/payout-slip/verify/:verificationToken — PUBLIC payout verification
// Returns limited, safe data for public verification. No auth required.
router.get("/verify/:verificationToken", verifyLimiter, async (req, res, next) => {
  try {
    const vToken = (req.params["verificationToken"] as string).toLowerCase().trim();
    if (!vToken || vToken.length < 8) {
      res.status(400).json({ error: "Invalid verification token" });
      return;
    }

    const [row] = await db
      .select({
        id:             withdrawalsTable.id,
        amount:         withdrawalsTable.amount,
        currency:       withdrawalsTable.currency,
        payoutMode:     withdrawalsTable.payoutMode,
        status:         withdrawalsTable.status,
        transferStatus: withdrawalsTable.transferStatus,
        utr:            withdrawalsTable.utr,
        createdAt:      withdrawalsTable.createdAt,
        completedAt:    withdrawalsTable.completedAt,
        bankAccount:    withdrawalsTable.bankAccount,
        upiId:          withdrawalsTable.upiId,
      })
      .from(withdrawalsTable)
      .where(eq(withdrawalsTable.slipVerificationToken, vToken))
      .limit(1);

    if (!row) {
      res.status(404).json({
        verified: false,
        error: "Payout not found. The verification code may be incorrect.",
      });
      return;
    }

    const acc = row.bankAccount ?? "";
    const maskedAccount = acc.length <= 4 ? "****" : "****" + acc.slice(-4);
    const upi = row.upiId;
    const maskedUpi = upi
      ? (() => {
          const at = upi.indexOf("@");
          if (at < 0) return upi.slice(0, 2) + "***";
          return upi.slice(0, 2) + "***" + upi.slice(at);
        })()
      : null;

    const fmtDate = (d: Date | null): string | null =>
      d
        ? d.toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "numeric", month: "long", year: "numeric",
            hour: "numeric", minute: "2-digit", hour12: true,
          }) + " IST"
        : null;

    let verifiedStatus: string;
    if (row.status === "rejected") verifiedStatus = "REJECTED";
    else if (row.transferStatus === "SUCCESS") verifiedStatus = "SUCCESS";
    else if (row.transferStatus === "FAILED" || row.transferStatus === "REVERSED") verifiedStatus = "FAILED";
    else verifiedStatus = "PROCESSING";

    const utrDisplay =
      verifiedStatus === "SUCCESS"
        ? (row.utr ?? "—")
        : verifiedStatus === "REJECTED" || verifiedStatus === "FAILED"
        ? "Not Generated"
        : "Awaiting Bank Confirmation";

    res.json({
      verified: true,
      transferId: `RK-PO-${String(row.id).padStart(6, "0")}`,
      amount: `INR ${Number(row.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
      destination: row.payoutMode === "UPI" ? maskedUpi : maskedAccount,
      payoutMode: row.payoutMode,
      requestedAt: fmtDate(row.createdAt),
      processedAt: fmtDate(row.completedAt ?? null),
      status: verifiedStatus,
      utr: utrDisplay,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/public/payout-slip/:token — read-only slip data from a signed share token
router.get("/:token", async (req, res, next) => {
  try {
    const token = req.params["token"] as string;

    let payload: ReturnType<typeof verifySlipShareToken>;
    try {
      payload = verifySlipShareToken(token);
    } catch {
      res.status(401).json({ error: "Slip link expired or invalid", code: "SLIP_LINK_EXPIRED" });
      return;
    }

    const { payoutId } = payload;

    const [row] = await db
      .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
      .from(withdrawalsTable)
      .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
      .where(eq(withdrawalsTable.id, payoutId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Payout not found" });
      return;
    }

    await db
      .insert(auditLogsTable)
      .values({
        adminId: 0,
        adminEmail: "public-link",
        action: "payout_slip_link_opened",
        targetType: "withdrawal",
        targetId: payoutId,
        details: JSON.stringify({ payoutId, via: "share_link", ip: req.ip }),
        ipAddress: req.ip ?? null,
      })
      .catch(() => {});

    res.json(await buildSlipData(row.withdrawal, row.merchantName ?? null));
  } catch (err) {
    next(err);
  }
});

// GET /api/public/payout-slip/:token/pdf — PDF download from signed share token
router.get("/:token/pdf", async (req, res, next) => {
  try {
    const token = req.params["token"] as string;

    let payload: ReturnType<typeof verifySlipShareToken>;
    try {
      payload = verifySlipShareToken(token);
    } catch {
      res.status(401).json({ error: "Slip link expired or invalid", code: "SLIP_LINK_EXPIRED" });
      return;
    }

    const { payoutId } = payload;

    const [row] = await db
      .select({ withdrawal: withdrawalsTable, merchantName: merchantsTable.businessName })
      .from(withdrawalsTable)
      .leftJoin(merchantsTable, eq(withdrawalsTable.merchantId, merchantsTable.id))
      .where(eq(withdrawalsTable.id, payoutId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Payout not found" });
      return;
    }

    const slip    = await buildSlipData(row.withdrawal, row.merchantName ?? null);
    const pdfBuf  = await buildPayoutSlipPdf(slip);
    const receipt = slip.receiptId;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="RasoKart-Payout-${receipt}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(pdfBuf);
  } catch (err) {
    next(err);
  }
});

export default router;
