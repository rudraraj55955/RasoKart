/**
 * Payout Merchant Self-Registration — POST /api/payout-merchant/register
 *
 * Public route (no auth required). Creates a payout merchant account
 * in `pending` / `REGISTERED` state. Payout access stays disabled until
 * KYC is verified and a Super Admin approves the account.
 *
 * Security:
 *  - Rate-limited per IP (10 requests / 15 min via DbRateLimitStore)
 *  - Self-registration can be toggled off via system_config key
 *    `payout_merchant_self_registration_enabled`
 *  - Duplicate email / phone / PAN blocked at application layer
 *  - PAN format validated (^[A-Z]{5}[0-9]{4}[A-Z]$)
 *  - Password: min 8 chars, 1 uppercase, 1 digit
 *  - Never auto-logs in after signup (no token returned)
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  db,
  merchantsTable,
  usersTable,
  systemConfigTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { makeRateLimiter, safeIpKey } from "../helpers/makeRateLimiter";
import { DbRateLimitStore } from "../lib/rateLimitStore";
import { logger } from "../lib/logger";

const router = Router();

const signupLimiter = makeRateLimiter({
  store: new DbRateLimitStore(),
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `payout_signup:${safeIpKey(req)}`,
  message: "Too many registration attempts. Please wait 15 minutes.",
});

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;
const VALID_BUSINESS_TYPES = new Set([
  "Individual", "Partnership", "PrivateLimited", "LLP", "OPC", "HUF", "Other",
]);

function validatePassword(pw: string): string | null {
  if (!pw || pw.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(pw)) return "Password must contain at least one uppercase letter";
  if (!/[0-9]/.test(pw)) return "Password must contain at least one number";
  return null;
}

router.post("/register", signupLimiter, async (req, res, next) => {
  try {
    // ── Check if self-registration is enabled (default: true) ───────────────
    const [configRow] = await db
      .select({ value: systemConfigTable.value })
      .from(systemConfigTable)
      .where(eq(systemConfigTable.key, "payout_merchant_self_registration_enabled"))
      .limit(1);

    const selfRegEnabled = configRow ? configRow.value !== "false" : true;
    if (!selfRegEnabled) {
      res.status(403).json({
        error: "Self-registration is currently disabled. Please contact support to register.",
      });
      return;
    }

    // ── Validate inputs ─────────────────────────────────────────────────────
    const {
      businessName,
      contactName,
      email,
      phone,
      password,
      businessType,
      panNumber,
      address,
      consentKyc,
      consentTerms,
    } = req.body as Record<string, unknown>;

    if (!businessName || typeof businessName !== "string" || businessName.trim().length < 2) {
      res.status(422).json({ error: "Business name must be at least 2 characters" }); return;
    }
    if (!contactName || typeof contactName !== "string" || contactName.trim().length < 2) {
      res.status(422).json({ error: "Contact name must be at least 2 characters" }); return;
    }
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(422).json({ error: "Invalid email address" }); return;
    }
    if (!phone || typeof phone !== "string" || !PHONE_RE.test(phone)) {
      res.status(422).json({ error: "Invalid phone number" }); return;
    }
    const pwError = validatePassword(typeof password === "string" ? password : "");
    if (pwError) { res.status(422).json({ error: pwError }); return; }
    if (!businessType || typeof businessType !== "string" || !VALID_BUSINESS_TYPES.has(businessType)) {
      res.status(422).json({ error: "Invalid business type" }); return;
    }
    const panUpper = typeof panNumber === "string" ? panNumber.toUpperCase() : "";
    if (!PAN_RE.test(panUpper)) {
      res.status(422).json({ error: "Invalid PAN number (expected format: ABCDE1234F)" }); return;
    }
    if (!address || typeof address !== "string" || address.trim().length < 10) {
      res.status(422).json({ error: "Please enter your full address (min 10 characters)" }); return;
    }
    if (!consentKyc || !consentTerms) {
      res.status(422).json({ error: "KYC and Terms consent are required" }); return;
    }

    const normalizedEmail = (email as string).trim().toLowerCase();

    // ── Check for duplicate email / phone ───────────────────────────────────
    const [existingByEmailOrPhone] = await db
      .select({ id: merchantsTable.id, email: merchantsTable.email })
      .from(merchantsTable)
      .where(or(
        eq(merchantsTable.email, normalizedEmail),
        eq(merchantsTable.phone, (phone as string).trim()),
      ))
      .limit(1);

    if (existingByEmailOrPhone) {
      if (existingByEmailOrPhone.email === normalizedEmail) {
        res.status(409).json({ error: "An account with this email already exists." }); return;
      }
      res.status(409).json({ error: "An account with this phone number already exists." }); return;
    }

    // ── Check for duplicate PAN ─────────────────────────────────────────────
    const [existingByPan] = await db
      .select({ id: merchantsTable.id })
      .from(merchantsTable)
      .where(eq((merchantsTable as any).panNumber, panUpper))
      .limit(1);

    if (existingByPan) {
      res.status(409).json({ error: "An account with this PAN number already exists." }); return;
    }

    const passwordHash = await bcrypt.hash(password as string, 12);

    // ── Create merchant record ───────────────────────────────────────────────
    const [merchant] = await db.insert(merchantsTable).values({
      businessName: (businessName as string).trim(),
      contactName: (contactName as string).trim(),
      email: normalizedEmail,
      phone: (phone as string).trim(),
      status: "pending",
      merchantType: "PAYOUT_ONLY",
      payoutServiceEnabled: false,
      payinServiceEnabled: false,
      collectionServiceEnabled: false,
      onboardingType: "PAYOUT_MERCHANT",
      registrationStage: "REGISTERED",
      businessType: businessType as string,
      panNumber: panUpper,
      website: (address as string).trim(),
    } as any).returning();

    // ── Create user record ───────────────────────────────────────────────────
    await db.insert(usersTable).values({
      email: normalizedEmail,
      passwordHash,
      role: "merchant",
      merchantId: merchant.id,
      name: (contactName as string).trim(),
      isActive: true,
    } as any);

    // ── Audit log (best-effort) ──────────────────────────────────────────────
    await db.insert(auditLogsTable).values({
      action: "payout_merchant_self_registered",
      targetType: "merchant",
      targetId: String(merchant.id),
      details: {
        businessName: (businessName as string).trim(),
        email: normalizedEmail,
        businessType,
        ip: safeIpKey(req),
      },
    } as any).catch(() => {});

    logger.info({ merchantId: merchant.id, email: normalizedEmail }, "payout_merchant_self_registered");

    res.status(201).json({
      ok: true,
      message: "Registration successful. Please log in and complete your KYC to activate payout access.",
    });
  } catch (err) { next(err); }
});

export default router;
