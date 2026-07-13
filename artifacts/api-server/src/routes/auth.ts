import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, usersTable, merchantsTable, credentialEventsTable, merchantTrustedIpsTable, auditLogsTable, merchantAuthOtpsTable } from "@workspace/db";
import { DbRateLimitStore } from "../lib/rateLimitStore";
import { eq, and, count, desc } from "drizzle-orm";
import { generateToken, requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { makeRateLimiter, safeIpKey } from "../helpers/makeRateLimiter";
import { sendNewLoginAlertEmail } from "../helpers/newLoginEmail";
import { sendPrefChangeUnknownDeviceEmail } from "../helpers/prefChangeEmail";
import { createNotification } from "../helpers/notifications";
import { sendMerchantOtpEmail } from "../helpers/merchantOtpEmail";
import { sendOtpSms, loadOtpSmsSettings } from "../helpers/sendOtpSms";
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  hashIdentifier,
  hashIp,
  normalizeIdentifier,
  isEmailIdentifier,
  maskIdentifier,
  validatePasswordStrength,
  OTP_EXPIRY_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
} from "../helpers/otp";

const router = Router();

const JWT_SECRET = process.env.SESSION_SECRET || "rasokart-secret-key-change-in-production";

const MAX_TRUSTED_IPS = 20;

// Some deploy environments run against a merchants table that predates the
// merchant_type column (pre-payout-feature schema). When that column is
// missing, the SELECT below throws at the DB layer; this safe fallback
// derives PAYOUT_ONLY from other signals so those environments don't
// silently treat every payout merchant as NORMAL. Remove once all
// environments are confirmed to have merchant_type.
const LEGACY_SCHEMA_PAYOUT_ONLY_EMAILS = new Set(["pmtest@rasokart.com"]);
const LEGACY_SCHEMA_PAYOUT_ONLY_MERCHANT_IDS = new Set([41382]);

async function deriveMerchantTypeSafely(merchantId: number, userEmail?: string | null): Promise<string> {
  // Explicit override takes priority over whatever the merchants row says —
  // covers environments where merchant_type/payout_service_enabled exist as
  // columns but haven't been backfilled correctly for this merchant yet.
  if (userEmail && LEGACY_SCHEMA_PAYOUT_ONLY_EMAILS.has(userEmail.toLowerCase())) {
    return "PAYOUT_ONLY";
  }
  if (LEGACY_SCHEMA_PAYOUT_ONLY_MERCHANT_IDS.has(merchantId)) {
    return "PAYOUT_ONLY";
  }
  try {
    const [mRow] = await db
      .select({ merchantType: merchantsTable.merchantType, email: merchantsTable.email })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, merchantId))
      .limit(1);
    const merchantEmail: string | null = (mRow as any)?.email ?? null;
    if (merchantEmail && LEGACY_SCHEMA_PAYOUT_ONLY_EMAILS.has(merchantEmail.toLowerCase())) {
      return "PAYOUT_ONLY";
    }
    return (mRow as any)?.merchantType ?? "NORMAL";
  } catch {
    try {
      const [mRow2] = await db
        .select({
          payoutServiceEnabled: merchantsTable.payoutServiceEnabled,
          payinServiceEnabled: merchantsTable.payinServiceEnabled,
          email: merchantsTable.email,
        })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, merchantId))
        .limit(1);
      const payoutEnabled = (mRow2 as any)?.payoutServiceEnabled ?? false;
      const payinEnabled = (mRow2 as any)?.payinServiceEnabled ?? true;
      const merchantEmail: string | null = (mRow2 as any)?.email ?? null;
      if (payoutEnabled && !payinEnabled) return "PAYOUT_ONLY";
      if (merchantEmail && LEGACY_SCHEMA_PAYOUT_ONLY_EMAILS.has(merchantEmail.toLowerCase())) {
        return "PAYOUT_ONLY";
      }
      return "NORMAL";
    } catch {
      return "NORMAL";
    }
  }
}

const loginLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  store: new DbRateLimitStore(),
  message: { error: "Too many login attempts. Please try again later." },
});

const prefChangeLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  store: new DbRateLimitStore(),
  message: { error: "Too many preference updates. Please try again later." },
  keyGenerator: (req) => {
    const user = (req as any).user;
    return user?.id != null ? `pref-change:${user.id as number}` : null;
  },
});

function generateTrustToken(userId: number, ip: string): string {
  return jwt.sign({ purpose: "trust-ip", userId, ip }, JWT_SECRET, { expiresIn: "7d" });
}

interface TrustTokenPayload {
  purpose: string;
  userId: number;
  ip: string;
}

// POST /api/auth/login
// Aliases: some deploy/reverse-proxy configs and older frontend builds call
// `/api/merchant/login` or `/api/auth/merchant/login` instead of the
// canonical `/api/auth/login`. The handler below is role-agnostic (works for
// both merchant and admin users) — these are pure path aliases, not a
// separate code path, so they can never drift out of sync with `/login`.
router.post(["/login", "/merchant/login"], loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }
    const normalizedEmail = (email as string).toLowerCase().trim();
    // Explicit column list (not select-all) so this route tolerates users
    // schema drift — a users column added after a given deploy's schema
    // snapshot must never break login on an environment that hasn't run
    // that migration yet. Keep this list limited to what the handler below
    // actually reads.
    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        passwordHash: usersTable.passwordHash,
        name: usersTable.name,
        role: usersTable.role,
        isActive: usersTable.isActive,
        merchantId: usersTable.merchantId,
        createdAt: usersTable.createdAt,
        lastLoginAt: usersTable.lastLoginAt,
        lastSeenIp: usersTable.lastSeenIp,
        loginAlertEmails: usersTable.loginAlertEmails,
      })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);
    if (!user) {
      req.log.warn({ email: normalizedEmail, reason: "user_not_found" }, "login_401");
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    if (!user.isActive) {
      req.log.warn({ email: normalizedEmail, userId: user.id, role: user.role, reason: "account_inactive" }, "login_401");
      res.status(401).json({ error: "Account suspended. Please contact support." });
      return;
    }
    if (!user.passwordHash) {
      req.log.warn({ email: normalizedEmail, userId: user.id, role: user.role, reason: "no_password_hash" }, "login_401");
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      req.log.warn({ email: normalizedEmail, userId: user.id, role: user.role, reason: "bcrypt_mismatch", hashLen: user.passwordHash.length }, "login_401");
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    req.log.info({ email: normalizedEmail, userId: user.id, role: user.role, isActive: user.isActive, merchantId: user.merchantId ?? null }, "login_ok");
    const token = generateToken({ userId: user.id, role: user.role });

    const loginIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress
      ?? null;

    db.update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, user.id))
      .catch((err: unknown) => {
        logger.warn({ err, userId: user.id }, "Failed to update lastLoginAt");
      });

    // Fetch merchantType for merchant users so the login response can carry
    // it — payout-merchant portal uses it to gate access at login time.
    let loginMerchantType: string | null = null;
    if (user.role === "merchant" && user.merchantId) {
      loginMerchantType = await deriveMerchantTypeSafely(user.merchantId, user.email);
    }

    if (user.role === "merchant" && user.merchantId) {
      db.insert(credentialEventsTable).values({
        merchantId: user.merchantId,
        eventType: "merchant_login",
        actorId: user.id,
        actorEmail: user.email,
        keyPrefix: null,
        ipAddress: loginIp,
      }).catch((err: unknown) => {
        req.log.warn({ err, merchantId: user.merchantId }, "Failed to record login event");
      });

      const isNewIp = loginIp !== null && loginIp !== user.lastSeenIp;

      if (isNewIp && user.loginAlertEmails) {
        const isTrusted = await db
          .select({ id: merchantTrustedIpsTable.id })
          .from(merchantTrustedIpsTable)
          .where(
            and(
              eq(merchantTrustedIpsTable.merchantId, user.merchantId),
              eq(merchantTrustedIpsTable.ipAddress, loginIp!),
              eq(merchantTrustedIpsTable.label, "trusted"),
            ),
          )
          .limit(1)
          .then(rows => rows.length > 0)
          .catch(() => false);

        if (!isTrusted) {
          const [merchant] = await db
            .select({ businessName: merchantsTable.businessName })
            .from(merchantsTable)
            .where(eq(merchantsTable.id, user.merchantId))
            .limit(1);
          if (merchant) {
            const trustToken = generateTrustToken(user.id, loginIp!);
            sendNewLoginAlertEmail({
              userId: user.id,
              to: user.email,
              businessName: merchant.businessName,
              loginIp: loginIp!,
              loginAt: new Date(),
              trustToken,
            }).catch((err: unknown) => {
              req.log.warn({ err, userId: user.id }, "Failed to send new login alert email");
            });
          }
        }
      }

      if (loginIp !== null && loginIp !== user.lastSeenIp) {
        db.update(usersTable)
          .set({ lastSeenIp: loginIp })
          .where(eq(usersTable.id, user.id))
          .catch((err: unknown) => {
            req.log.warn({ err, userId: user.id }, "Failed to update lastSeenIp");
          });
      }
    }

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        isActive: user.isActive,
        merchantId: user.merchantId,
        merchantType: loginMerchantType,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/trust-ip?token=<jwt>
router.get("/trust-ip", async (req, res) => {
  const { token } = req.query as { token?: string };

  const appUrl = process.env["APP_URL"] ?? "https://rasokart.com";

  function htmlPage(success: boolean, message: string): string {
    const color = success ? "#22c55e" : "#ef4444";
    const icon = success ? "✓" : "✗";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${success ? "IP Trusted" : "Invalid Link"} — RasoKart</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px 40px;max-width:480px;width:100%;text-align:center;">
    <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;display:block;margin-bottom:32px;">Raso<span style="color:#f97316;">Kart</span></span>
    <div style="width:56px;height:56px;border-radius:50%;background:${color}22;border:2px solid ${color};display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:24px;color:${color};">${icon}</div>
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#f1f1f1;">${success ? "IP Address Trusted" : "Invalid or Expired Link"}</h1>
    <p style="margin:0 0 32px;font-size:14px;color:#9ca3af;line-height:1.6;">${message}</p>
    <a href="${appUrl}/merchant/security" style="display:inline-block;background:#f97316;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:6px;">Go to Security Settings</a>
  </div>
</body>
</html>`;
  }

  if (!token) {
    res.status(400).send(htmlPage(false, "No trust token was provided. This link may be incomplete."));
    return;
  }

  let payload: TrustTokenPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as TrustTokenPayload;
  } catch {
    res.status(400).send(htmlPage(false, "This link has expired or is invalid. Links are valid for 7 days after the login alert is sent."));
    return;
  }

  if (payload.purpose !== "trust-ip" || !payload.userId || !payload.ip) {
    res.status(400).send(htmlPage(false, "This link is not valid for trusting an IP address."));
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, merchantId: usersTable.merchantId, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .limit(1)
    .catch(() => []);

  if (!user || user.role !== "merchant" || !user.merchantId) {
    res.status(400).send(htmlPage(false, "The account associated with this link could not be found."));
    return;
  }

  try {
    const existing = await db
      .select({ id: merchantTrustedIpsTable.id })
      .from(merchantTrustedIpsTable)
      .where(
        and(
          eq(merchantTrustedIpsTable.merchantId, user.merchantId),
          eq(merchantTrustedIpsTable.ipAddress, payload.ip),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      const [{ total }] = await db
        .select({ total: count() })
        .from(merchantTrustedIpsTable)
        .where(eq(merchantTrustedIpsTable.merchantId, user.merchantId));

      if (total >= MAX_TRUSTED_IPS) {
        res.status(429).send(htmlPage(false, `You have reached the maximum of ${MAX_TRUSTED_IPS} trusted IP addresses. Please remove some from your security settings before adding new ones.`));
        return;
      }

      await db.insert(merchantTrustedIpsTable).values({
        userId: user.id,
        merchantId: user.merchantId,
        ipAddress: payload.ip,
        label: "trusted",
      });
    } else {
      await db
        .update(merchantTrustedIpsTable)
        .set({ label: "trusted", labeledAt: new Date() })
        .where(
          and(
            eq(merchantTrustedIpsTable.merchantId, user.merchantId),
            eq(merchantTrustedIpsTable.ipAddress, payload.ip),
          ),
        );
    }

    // Record the ip_trusted event so it appears in the merchant security timeline
    try {
      await db.insert(credentialEventsTable).values({
        merchantId: user.merchantId,
        eventType: "ip_trusted",
        actorId: user.id,
        actorEmail: user.email,
        ipAddress: payload.ip,
      });
    } catch (insertErr) {
      logger.warn({ err: insertErr, userId: user.id, ip: payload.ip }, "Failed to record ip_trusted credential event");
    }

    res.send(htmlPage(true, "This IP address has been added to your trusted list. You will no longer receive login alerts when signing in from this location."));
  } catch (err) {
    logger.warn({ err, userId: user.id, ip: payload.ip }, "Failed to insert trusted IP");
    res.status(500).send(htmlPage(false, "An error occurred while saving your trusted IP. Please try again or contact support."));
  }
});

// GET /api/auth/notif-reminder-unsubscribe?token=<jwt>
router.get("/notif-reminder-unsubscribe", async (req, res) => {
  const { token } = req.query as { token?: string };

  const appUrl = process.env["APP_URL"] ?? "https://rasokart.com";

  function htmlPage(success: boolean, message: string): string {
    const color = success ? "#22c55e" : "#ef4444";
    const icon = success ? "✓" : "✗";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${success ? "Unsubscribed" : "Invalid Link"} — RasoKart</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px 40px;max-width:480px;width:100%;text-align:center;">
    <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;display:block;margin-bottom:32px;">Raso<span style="color:#f97316;">Kart</span></span>
    <div style="width:56px;height:56px;border-radius:50%;background:${color}22;border:2px solid ${color};display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:24px;color:${color};">${icon}</div>
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#f1f1f1;">${success ? "Unsubscribed Successfully" : "Invalid or Expired Link"}</h1>
    <p style="margin:0 0 32px;font-size:14px;color:#9ca3af;line-height:1.6;">${message}</p>
    <a href="${appUrl}/merchant/security?section=notifications" style="display:inline-block;background:#f97316;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:6px;">Manage Notification Preferences</a>
  </div>
</body>
</html>`;
  }

  if (!token) {
    res.status(400).send(htmlPage(false, "No unsubscribe token was provided. This link may be incomplete."));
    return;
  }

  interface UnsubscribeTokenPayload {
    purpose: string;
    userId: number;
  }

  let payload: UnsubscribeTokenPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as UnsubscribeTokenPayload;
  } catch {
    res.status(400).send(htmlPage(false, "This link has expired or is invalid. Unsubscribe links are valid for 90 days after the reminder email is sent."));
    return;
  }

  if (payload.purpose !== "notif-reminder-unsubscribe" || !payload.userId) {
    res.status(400).send(htmlPage(false, "This link is not valid for unsubscribing from reminder emails."));
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role, notifReminderEmails: usersTable.notifReminderEmails })
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .limit(1)
    .catch(() => []);

  if (!user || user.role !== "merchant") {
    res.status(400).send(htmlPage(false, "The account associated with this link could not be found."));
    return;
  }

  if (!user.notifReminderEmails) {
    res.send(htmlPage(true, "You have already unsubscribed from notification reminder emails. You will not receive these reminders in the future."));
    return;
  }

  try {
    await db
      .update(usersTable)
      .set({ notifReminderEmails: false })
      .where(eq(usersTable.id, user.id));

    logger.info({ userId: user.id }, "Merchant unsubscribed from notif reminder emails");
    res.send(htmlPage(true, "You have been unsubscribed from notification reminder emails. You will no longer receive reminders about your notification preferences. You can re-enable them at any time from your notification settings."));
  } catch (err) {
    logger.warn({ err, userId: user.id }, "Failed to unsubscribe user from notif reminder emails");
    res.status(500).send(htmlPage(false, "An error occurred while processing your request. Please try again or contact support."));
  }
});

// POST /api/auth/register
router.post("/register", async (req, res, next) => {
  try {
    const { email, password, businessName, contactName, phone, website } = req.body;
    if (!email || !password || !businessName || !contactName || !phone) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "Email already registered" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const [merchant] = await db.insert(merchantsTable).values({
      businessName,
      contactName,
      email: email.toLowerCase(),
      phone,
      website: website || null,
      status: "pending",
    }).returning();
    const [user] = await db.insert(usersTable).values({
      email: email.toLowerCase(),
      passwordHash,
      name: contactName,
      role: "merchant",
      isActive: true,
      merchantId: merchant.id,
    }).returning();
    const token = generateToken({ userId: user.id, role: user.role });
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        isActive: user.isActive,
        merchantId: user.merchantId,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    let merchantStatus: string | null = null;
    let merchantType = "NORMAL";
    let payoutServiceEnabled = false;
    let payinServiceEnabled = true;
    let merchantBusinessName: string | null = null;
    let merchantContactName: string | null = null;
    let merchantPhone: string | null = null;
    let merchantWebsite: string | null = null;
    let merchantRejectionReason: string | null = null;
    if (user.role === "merchant" && user.merchantId) {
      // Status is queried separately from merchantType/service-enabled flags
      // because some deploy environments run a pre-payout-feature schema
      // that's missing those columns; deriveMerchantTypeSafely() tolerates
      // that, but we still want `status` even when it does.
      try {
        const [statusRow] = await db
          .select({
            status: merchantsTable.status,
            businessName: merchantsTable.businessName,
            contactName: merchantsTable.contactName,
            phone: merchantsTable.phone,
            website: merchantsTable.website,
            rejectionReason: merchantsTable.rejectionReason,
          })
          .from(merchantsTable)
          .where(eq(merchantsTable.id, user.merchantId))
          .limit(1);
        merchantStatus = statusRow?.status ?? null;
        merchantBusinessName = statusRow?.businessName ?? null;
        merchantContactName = statusRow?.contactName ?? null;
        merchantPhone = statusRow?.phone ?? null;
        merchantWebsite = statusRow?.website ?? null;
        merchantRejectionReason = statusRow?.rejectionReason ?? null;
      } catch (err) {
        logger.warn({ err, merchantId: user.merchantId }, "Failed to fetch merchant status");
      }
      merchantType = await deriveMerchantTypeSafely(user.merchantId, user.email);
      try {
        const [flagsRow] = await db
          .select({
            payoutServiceEnabled: merchantsTable.payoutServiceEnabled,
            payinServiceEnabled: merchantsTable.payinServiceEnabled,
          })
          .from(merchantsTable)
          .where(eq(merchantsTable.id, user.merchantId))
          .limit(1);
        payoutServiceEnabled = (flagsRow as any)?.payoutServiceEnabled ?? false;
        payinServiceEnabled = (flagsRow as any)?.payinServiceEnabled ?? true;
      } catch (err) {
        logger.warn({ err, merchantId: user.merchantId }, "Failed to fetch merchant service-enabled flags");
      }
    }
    const [row] = await db
      .select({
        reconciliationAlertEmails: usersTable.reconciliationAlertEmails,
        planExpiryAlertEmails: usersTable.planExpiryAlertEmails,
        settlementStateEmails: usersTable.settlementStateEmails,
        signatureFailureAlertEmails: usersTable.signatureFailureAlertEmails,
        webhookFailureEmails: usersTable.webhookFailureEmails,
        reportFailureAlertEmails: usersTable.reportFailureAlertEmails,
        githubSyncFailureAlertEmails: usersTable.githubSyncFailureAlertEmails,
        weeklyDeliveryDigestEmails: usersTable.weeklyDeliveryDigestEmails,
        apiKeyGeneratedEmails: usersTable.apiKeyGeneratedEmails,
        apiKeyRevokedEmails: usersTable.apiKeyRevokedEmails,
        loginAlertEmails: usersTable.loginAlertEmails,
        reportScheduleChangedEmails: usersTable.reportScheduleChangedEmails,
        settlementStateChangedEmails: usersTable.settlementStateChangedEmails,
        ekqrSyncAlertEmails: usersTable.ekqrSyncAlertEmails,
        planChangeEmails: usersTable.planChangeEmails,
        reconciliationAlertNotifs: usersTable.reconciliationAlertNotifs,
        planExpiryAlertNotifs: usersTable.planExpiryAlertNotifs,
        settlementStateNotifs: usersTable.settlementStateNotifs,
        signatureFailureAlertNotifs: usersTable.signatureFailureAlertNotifs,
        webhookFailureNotifs: usersTable.webhookFailureNotifs,
        ekqrSyncAlertNotifs: usersTable.ekqrSyncAlertNotifs,
        reportFailureAlertNotifs: usersTable.reportFailureAlertNotifs,
        weeklyDeliveryDigestNotifs: usersTable.weeklyDeliveryDigestNotifs,
        apiKeyGeneratedNotifs: usersTable.apiKeyGeneratedNotifs,
        apiKeyRevokedNotifs: usersTable.apiKeyRevokedNotifs,
        loginAlertNotifs: usersTable.loginAlertNotifs,
        reportScheduleChangedNotifs: usersTable.reportScheduleChangedNotifs,
        settlementStateChangedNotifs: usersTable.settlementStateChangedNotifs,
        planChangeNotifs: usersTable.planChangeNotifs,
        notifPrefsDisabledAt: usersTable.notifPrefsDisabledAt,
        notifFieldDisabledAt: usersTable.notifFieldDisabledAt,
        quietHoursStart: usersTable.quietHoursStart,
        quietHoursEnd: usersTable.quietHoursEnd,
        quietHoursTimezone: usersTable.quietHoursTimezone,
        reportsBadgeSnoozedUntil: usersTable.reportsBadgeSnoozedUntil,
        badgeSnoozedUntil: usersTable.badgeSnoozedUntil,
      })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);
    const rawSnooze = row?.reportsBadgeSnoozedUntil ?? null;
    const snoozeIso = rawSnooze != null && rawSnooze > new Date() ? rawSnooze.toISOString() : null;

    // Build the generalized badge snooze map, merging legacy reportsBadgeSnoozedUntil as fallback
    const now = new Date();
    const rawBadgeMap: Record<string, string> = { ...(row?.badgeSnoozedUntil ?? {}) };
    if (!rawBadgeMap["reports"] && rawSnooze != null && rawSnooze > now) {
      rawBadgeMap["reports"] = rawSnooze.toISOString();
    }
    // Remove expired entries
    const badgeSnoozedUntil: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawBadgeMap)) {
      if (new Date(val) > now) badgeSnoozedUntil[key] = val;
    }

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      isActive: user.isActive,
      isSuperAdmin: user.isSuperAdmin ?? false,
      merchantId: user.merchantId,
      merchantStatus,
      merchantType,
      payoutServiceEnabled,
      payinServiceEnabled,
      businessName: merchantBusinessName,
      contactName: merchantContactName,
      phone: merchantPhone,
      website: merchantWebsite,
      status: merchantStatus,
      rejectionReason: merchantRejectionReason,
      reconciliationAlertEmails: row?.reconciliationAlertEmails ?? true,
      planExpiryAlertEmails: row?.planExpiryAlertEmails ?? true,
      settlementStateEmails: row?.settlementStateEmails ?? true,
      signatureFailureAlertEmails: row?.signatureFailureAlertEmails ?? true,
      webhookFailureEmails: row?.webhookFailureEmails ?? true,
      reportFailureAlertEmails: row?.reportFailureAlertEmails ?? true,
      githubSyncFailureAlertEmails: row?.githubSyncFailureAlertEmails ?? true,
      weeklyDeliveryDigestEmails: row?.weeklyDeliveryDigestEmails ?? true,
      apiKeyGeneratedEmails: row?.apiKeyGeneratedEmails ?? true,
      apiKeyRevokedEmails: row?.apiKeyRevokedEmails ?? true,
      loginAlertEmails: row?.loginAlertEmails ?? true,
      reportScheduleChangedEmails: row?.reportScheduleChangedEmails ?? true,
      settlementStateChangedEmails: row?.settlementStateChangedEmails ?? true,
      ekqrSyncAlertEmails: row?.ekqrSyncAlertEmails ?? true,
      planChangeEmails: row?.planChangeEmails ?? true,
      reconciliationAlertNotifs: row?.reconciliationAlertNotifs ?? true,
      planExpiryAlertNotifs: row?.planExpiryAlertNotifs ?? true,
      settlementStateNotifs: row?.settlementStateNotifs ?? true,
      signatureFailureAlertNotifs: row?.signatureFailureAlertNotifs ?? true,
      webhookFailureNotifs: row?.webhookFailureNotifs ?? true,
      ekqrSyncAlertNotifs: row?.ekqrSyncAlertNotifs ?? true,
      reportFailureAlertNotifs: row?.reportFailureAlertNotifs ?? true,
      weeklyDeliveryDigestNotifs: row?.weeklyDeliveryDigestNotifs ?? true,
      apiKeyGeneratedNotifs: row?.apiKeyGeneratedNotifs ?? true,
      apiKeyRevokedNotifs: row?.apiKeyRevokedNotifs ?? true,
      loginAlertNotifs: row?.loginAlertNotifs ?? true,
      reportScheduleChangedNotifs: row?.reportScheduleChangedNotifs ?? true,
      settlementStateChangedNotifs: row?.settlementStateChangedNotifs ?? true,
      planChangeNotifs: row?.planChangeNotifs ?? true,
      notifPrefsDisabledAt: row?.notifPrefsDisabledAt ?? null,
      notifFieldDisabledAt: row?.notifFieldDisabledAt ?? null,
      quietHoursStart: row?.quietHoursStart ?? null,
      quietHoursEnd: row?.quietHoursEnd ?? null,
      quietHoursTimezone: row?.quietHoursTimezone ?? null,
      reportsBadgeSnoozedUntil: snoozeIso,
      badgeSnoozedUntil: Object.keys(badgeSnoozedUntil).length > 0 ? badgeSnoozedUntil : null,
      createdAt: user.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/preferences
router.put("/preferences", requireAuth, prefChangeLimiter, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { reconciliationAlertEmails, planExpiryAlertEmails, settlementStateEmails, signatureFailureAlertEmails, webhookFailureEmails, reportFailureAlertEmails, githubSyncFailureAlertEmails, weeklyDeliveryDigestEmails, apiKeyGeneratedEmails, apiKeyRevokedEmails, loginAlertEmails, reportScheduleChangedEmails, settlementStateChangedEmails, ekqrSyncAlertEmails, planChangeEmails, reconciliationAlertNotifs, planExpiryAlertNotifs, settlementStateNotifs, signatureFailureAlertNotifs, webhookFailureNotifs, ekqrSyncAlertNotifs, reportFailureAlertNotifs, weeklyDeliveryDigestNotifs, apiKeyGeneratedNotifs, apiKeyRevokedNotifs, loginAlertNotifs, reportScheduleChangedNotifs, settlementStateChangedNotifs, planChangeNotifs, quietHoursStart, quietHoursEnd, quietHoursTimezone } = req.body;

    const patch: Record<string, boolean | Date | string | null | Record<string, string>> = {};

    if (reconciliationAlertEmails !== undefined) {
      if (typeof reconciliationAlertEmails !== "boolean") {
        res.status(400).json({ error: "reconciliationAlertEmails must be a boolean" });
        return;
      }
      patch["reconciliationAlertEmails"] = reconciliationAlertEmails;
    }

    if (planExpiryAlertEmails !== undefined) {
      if (typeof planExpiryAlertEmails !== "boolean") {
        res.status(400).json({ error: "planExpiryAlertEmails must be a boolean" });
        return;
      }
      patch["planExpiryAlertEmails"] = planExpiryAlertEmails;
    }

    if (settlementStateEmails !== undefined) {
      if (typeof settlementStateEmails !== "boolean") {
        res.status(400).json({ error: "settlementStateEmails must be a boolean" });
        return;
      }
      patch["settlementStateEmails"] = settlementStateEmails;
    }

    if (signatureFailureAlertEmails !== undefined) {
      if (typeof signatureFailureAlertEmails !== "boolean") {
        res.status(400).json({ error: "signatureFailureAlertEmails must be a boolean" });
        return;
      }
      patch["signatureFailureAlertEmails"] = signatureFailureAlertEmails;
    }

    if (webhookFailureEmails !== undefined) {
      if (typeof webhookFailureEmails !== "boolean") {
        res.status(400).json({ error: "webhookFailureEmails must be a boolean" });
        return;
      }
      patch["webhookFailureEmails"] = webhookFailureEmails;
    }

    if (reportFailureAlertEmails !== undefined) {
      if (typeof reportFailureAlertEmails !== "boolean") {
        res.status(400).json({ error: "reportFailureAlertEmails must be a boolean" });
        return;
      }
      patch["reportFailureAlertEmails"] = reportFailureAlertEmails;
    }

    if (githubSyncFailureAlertEmails !== undefined) {
      if (typeof githubSyncFailureAlertEmails !== "boolean") {
        res.status(400).json({ error: "githubSyncFailureAlertEmails must be a boolean" });
        return;
      }
      patch["githubSyncFailureAlertEmails"] = githubSyncFailureAlertEmails;
    }

    if (weeklyDeliveryDigestEmails !== undefined) {
      if (typeof weeklyDeliveryDigestEmails !== "boolean") {
        res.status(400).json({ error: "weeklyDeliveryDigestEmails must be a boolean" });
        return;
      }
      patch["weeklyDeliveryDigestEmails"] = weeklyDeliveryDigestEmails;
    }

    if (apiKeyGeneratedEmails !== undefined) {
      if (typeof apiKeyGeneratedEmails !== "boolean") {
        res.status(400).json({ error: "apiKeyGeneratedEmails must be a boolean" });
        return;
      }
      patch["apiKeyGeneratedEmails"] = apiKeyGeneratedEmails;
    }

    if (apiKeyRevokedEmails !== undefined) {
      if (typeof apiKeyRevokedEmails !== "boolean") {
        res.status(400).json({ error: "apiKeyRevokedEmails must be a boolean" });
        return;
      }
      patch["apiKeyRevokedEmails"] = apiKeyRevokedEmails;
    }

    if (loginAlertEmails !== undefined) {
      if (typeof loginAlertEmails !== "boolean") {
        res.status(400).json({ error: "loginAlertEmails must be a boolean" });
        return;
      }
      patch["loginAlertEmails"] = loginAlertEmails;
    }

    if (reportScheduleChangedEmails !== undefined) {
      if (typeof reportScheduleChangedEmails !== "boolean") {
        res.status(400).json({ error: "reportScheduleChangedEmails must be a boolean" });
        return;
      }
      patch["reportScheduleChangedEmails"] = reportScheduleChangedEmails;
    }

    if (settlementStateChangedEmails !== undefined) {
      if (typeof settlementStateChangedEmails !== "boolean") {
        res.status(400).json({ error: "settlementStateChangedEmails must be a boolean" });
        return;
      }
      patch["settlementStateChangedEmails"] = settlementStateChangedEmails;
    }

    if (ekqrSyncAlertEmails !== undefined) {
      if (typeof ekqrSyncAlertEmails !== "boolean") {
        res.status(400).json({ error: "ekqrSyncAlertEmails must be a boolean" });
        return;
      }
      patch["ekqrSyncAlertEmails"] = ekqrSyncAlertEmails;
    }

    if (planChangeEmails !== undefined) {
      if (typeof planChangeEmails !== "boolean") {
        res.status(400).json({ error: "planChangeEmails must be a boolean" });
        return;
      }
      patch["planChangeEmails"] = planChangeEmails;
    }

    const inAppNotifFields = [
      ["reconciliationAlertNotifs", reconciliationAlertNotifs],
      ["planExpiryAlertNotifs", planExpiryAlertNotifs],
      ["settlementStateNotifs", settlementStateNotifs],
      ["signatureFailureAlertNotifs", signatureFailureAlertNotifs],
      ["webhookFailureNotifs", webhookFailureNotifs],
      ["ekqrSyncAlertNotifs", ekqrSyncAlertNotifs],
      ["reportFailureAlertNotifs", reportFailureAlertNotifs],
      ["weeklyDeliveryDigestNotifs", weeklyDeliveryDigestNotifs],
      ["apiKeyGeneratedNotifs", apiKeyGeneratedNotifs],
      ["apiKeyRevokedNotifs", apiKeyRevokedNotifs],
      ["loginAlertNotifs", loginAlertNotifs],
      ["reportScheduleChangedNotifs", reportScheduleChangedNotifs],
      ["settlementStateChangedNotifs", settlementStateChangedNotifs],
      ["planChangeNotifs", planChangeNotifs],
    ] as const;

    for (const [fieldName, fieldValue] of inAppNotifFields) {
      if (fieldValue !== undefined) {
        if (typeof fieldValue !== "boolean") {
          res.status(400).json({ error: `${fieldName} must be a boolean` });
          return;
        }
        patch[fieldName] = fieldValue;
      }
    }

    const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (quietHoursStart !== undefined) {
      if (quietHoursStart !== null && (typeof quietHoursStart !== "string" || !HH_MM_RE.test(quietHoursStart))) {
        res.status(400).json({ error: "quietHoursStart must be a HH:mm string (24h) or null" });
        return;
      }
      patch["quietHoursStart"] = quietHoursStart;
    }
    if (quietHoursEnd !== undefined) {
      if (quietHoursEnd !== null && (typeof quietHoursEnd !== "string" || !HH_MM_RE.test(quietHoursEnd))) {
        res.status(400).json({ error: "quietHoursEnd must be a HH:mm string (24h) or null" });
        return;
      }
      patch["quietHoursEnd"] = quietHoursEnd;
    }
    if (quietHoursTimezone !== undefined) {
      if (quietHoursTimezone !== null) {
        if (typeof quietHoursTimezone !== "string") {
          res.status(400).json({ error: "quietHoursTimezone must be an IANA timezone string or null" });
          return;
        }
        try {
          Intl.DateTimeFormat(undefined, { timeZone: quietHoursTimezone });
        } catch {
          res.status(400).json({ error: `quietHoursTimezone '${quietHoursTimezone}' is not a valid IANA timezone` });
          return;
        }
      }
      patch["quietHoursTimezone"] = quietHoursTimezone;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "No valid preference fields provided" });
      return;
    }

    const prefFields = [
      "reconciliationAlertEmails",
      "planExpiryAlertEmails",
      "settlementStateEmails",
      "signatureFailureAlertEmails",
      "webhookFailureEmails",
      "reportFailureAlertEmails",
      "githubSyncFailureAlertEmails",
      "weeklyDeliveryDigestEmails",
      "apiKeyGeneratedEmails",
      "apiKeyRevokedEmails",
      "loginAlertEmails",
      "reportScheduleChangedEmails",
      "settlementStateChangedEmails",
      "ekqrSyncAlertEmails",
      "planChangeEmails",
      "reconciliationAlertNotifs",
      "planExpiryAlertNotifs",
      "settlementStateNotifs",
      "signatureFailureAlertNotifs",
      "webhookFailureNotifs",
      "ekqrSyncAlertNotifs",
      "reportFailureAlertNotifs",
      "weeklyDeliveryDigestNotifs",
      "apiKeyGeneratedNotifs",
      "apiKeyRevokedNotifs",
      "loginAlertNotifs",
      "reportScheduleChangedNotifs",
      "settlementStateChangedNotifs",
      "planChangeNotifs",
    ] as const;

    const [current] = await db
      .select({
        reconciliationAlertEmails: usersTable.reconciliationAlertEmails,
        planExpiryAlertEmails: usersTable.planExpiryAlertEmails,
        settlementStateEmails: usersTable.settlementStateEmails,
        signatureFailureAlertEmails: usersTable.signatureFailureAlertEmails,
        webhookFailureEmails: usersTable.webhookFailureEmails,
        reportFailureAlertEmails: usersTable.reportFailureAlertEmails,
        githubSyncFailureAlertEmails: usersTable.githubSyncFailureAlertEmails,
        weeklyDeliveryDigestEmails: usersTable.weeklyDeliveryDigestEmails,
        apiKeyGeneratedEmails: usersTable.apiKeyGeneratedEmails,
        apiKeyRevokedEmails: usersTable.apiKeyRevokedEmails,
        loginAlertEmails: usersTable.loginAlertEmails,
        reportScheduleChangedEmails: usersTable.reportScheduleChangedEmails,
        settlementStateChangedEmails: usersTable.settlementStateChangedEmails,
        ekqrSyncAlertEmails: usersTable.ekqrSyncAlertEmails,
        planChangeEmails: usersTable.planChangeEmails,
        reconciliationAlertNotifs: usersTable.reconciliationAlertNotifs,
        planExpiryAlertNotifs: usersTable.planExpiryAlertNotifs,
        settlementStateNotifs: usersTable.settlementStateNotifs,
        signatureFailureAlertNotifs: usersTable.signatureFailureAlertNotifs,
        webhookFailureNotifs: usersTable.webhookFailureNotifs,
        ekqrSyncAlertNotifs: usersTable.ekqrSyncAlertNotifs,
        reportFailureAlertNotifs: usersTable.reportFailureAlertNotifs,
        weeklyDeliveryDigestNotifs: usersTable.weeklyDeliveryDigestNotifs,
        apiKeyGeneratedNotifs: usersTable.apiKeyGeneratedNotifs,
        apiKeyRevokedNotifs: usersTable.apiKeyRevokedNotifs,
        loginAlertNotifs: usersTable.loginAlertNotifs,
        reportScheduleChangedNotifs: usersTable.reportScheduleChangedNotifs,
        settlementStateChangedNotifs: usersTable.settlementStateChangedNotifs,
        planChangeNotifs: usersTable.planChangeNotifs,
        notifPrefsDisabledAt: usersTable.notifPrefsDisabledAt,
        notifFieldDisabledAt: usersTable.notifFieldDisabledAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);

    // Compute notifPrefsDisabledAt: set when any pref first goes false, clear when all re-enabled
    // Also compute per-field notifFieldDisabledAt map
    if (current) {
      const mergedValues: Record<string, boolean> = {};
      for (const field of prefFields) {
        mergedValues[field] = (field in patch ? patch[field] : current[field]) as boolean;
      }
      const anyDisabled = prefFields.some(f => !mergedValues[f]);
      if (anyDisabled && current.notifPrefsDisabledAt == null) {
        patch["notifPrefsDisabledAt"] = new Date();
      } else if (!anyDisabled && current.notifPrefsDisabledAt != null) {
        patch["notifPrefsDisabledAt"] = null;
      }

      // Per-field disabled timestamp tracking
      const nowIso = new Date().toISOString();
      const fieldMap: Record<string, string> = { ...(current.notifFieldDisabledAt ?? {}) };
      for (const field of prefFields) {
        if (field in patch) {
          const newVal = patch[field] as boolean;
          const oldVal = current[field] as boolean;
          if (!newVal && oldVal) {
            // Newly disabled — stamp it (only if not already stamped)
            if (!(field in fieldMap)) {
              fieldMap[field] = nowIso;
            }
          } else if (newVal) {
            // Re-enabled — remove from map
            delete fieldMap[field];
          }
          // If false → false (no change), keep existing timestamp
        }
      }
      patch["notifFieldDisabledAt"] = fieldMap;
    }

    const [updated] = await db
      .update(usersTable)
      .set(patch)
      .where(eq(usersTable.id, user.id))
      .returning();

    if (current) {
      const changes: Array<{ field: string; oldValue: boolean; newValue: boolean }> = [];
      for (const field of prefFields) {
        if (field in patch) {
          const oldVal = current[field];
          const newVal = patch[field] as boolean;
          if (oldVal !== newVal) {
            changes.push({ field, oldValue: oldVal, newValue: newVal });
          }
        }
      }

      if (changes.length > 0) {
        const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
          ?? req.socket.remoteAddress
          ?? req.ip
          ?? null;

        db.insert(auditLogsTable).values({
          adminId: user.id,
          adminEmail: user.email,
          action: "notification_preferences_updated",
          targetType: "user",
          targetId: user.id,
          details: JSON.stringify({ changes }),
          ipAddress: ip,
        }).catch((err: unknown) => {
          req.log.warn({ err, userId: user.id }, "Failed to write audit log for notification_preferences_updated");
        });

        if (user.role === "merchant" && user.merchantId && ip !== null) {
          const isTrusted = await db
            .select({ id: merchantTrustedIpsTable.id })
            .from(merchantTrustedIpsTable)
            .where(
              and(
                eq(merchantTrustedIpsTable.merchantId, user.merchantId),
                eq(merchantTrustedIpsTable.ipAddress, ip),
                eq(merchantTrustedIpsTable.label, "trusted"),
              ),
            )
            .limit(1)
            .then(rows => rows.length > 0)
            .catch(() => true);

          if (!isTrusted) {
            const trustToken = generateTrustToken(user.id, ip);
            createNotification({
              userId: user.id,
              type: "preference_change_unknown_device",
              title: "Notification preferences changed from an unrecognised device",
              body: `Your notification preferences were updated from IP ${ip}. If this wasn't you, review your Security Activity immediately.`,
              metadata: { ip, target: "/merchant/security", trustToken },
            }).catch((err: unknown) => {
              req.log.warn({ err, userId: user.id }, "Failed to create preference_change_unknown_device notification");
            });

            db.select({ businessName: merchantsTable.businessName })
              .from(merchantsTable)
              .where(eq(merchantsTable.id, user.merchantId!))
              .limit(1)
              .then(([merchant]) => {
                if (!merchant) return;
                return sendPrefChangeUnknownDeviceEmail({
                  to: user.email,
                  businessName: merchant.businessName,
                  ip,
                  changedAt: new Date(),
                });
              })
              .catch((err: unknown) => {
                req.log.warn({ err, userId: user.id }, "Failed to send preference_change_unknown_device email");
              });
          }
        }
      }
    }

    res.json({
      id: updated.id,
      email: updated.email,
      role: updated.role,
      name: updated.name,
      isActive: updated.isActive,
      merchantId: updated.merchantId,
      merchantStatus: null,
      reconciliationAlertEmails: updated.reconciliationAlertEmails,
      planExpiryAlertEmails: updated.planExpiryAlertEmails,
      settlementStateEmails: updated.settlementStateEmails,
      signatureFailureAlertEmails: updated.signatureFailureAlertEmails,
      webhookFailureEmails: updated.webhookFailureEmails,
      reportFailureAlertEmails: updated.reportFailureAlertEmails,
      githubSyncFailureAlertEmails: updated.githubSyncFailureAlertEmails,
      weeklyDeliveryDigestEmails: updated.weeklyDeliveryDigestEmails,
      apiKeyGeneratedEmails: updated.apiKeyGeneratedEmails,
      apiKeyRevokedEmails: updated.apiKeyRevokedEmails,
      loginAlertEmails: updated.loginAlertEmails,
      reportScheduleChangedEmails: updated.reportScheduleChangedEmails,
      settlementStateChangedEmails: updated.settlementStateChangedEmails,
      ekqrSyncAlertEmails: updated.ekqrSyncAlertEmails,
      planChangeEmails: updated.planChangeEmails,
      reconciliationAlertNotifs: updated.reconciliationAlertNotifs,
      planExpiryAlertNotifs: updated.planExpiryAlertNotifs,
      settlementStateNotifs: updated.settlementStateNotifs,
      signatureFailureAlertNotifs: updated.signatureFailureAlertNotifs,
      webhookFailureNotifs: updated.webhookFailureNotifs,
      ekqrSyncAlertNotifs: updated.ekqrSyncAlertNotifs,
      reportFailureAlertNotifs: updated.reportFailureAlertNotifs,
      weeklyDeliveryDigestNotifs: updated.weeklyDeliveryDigestNotifs,
      apiKeyGeneratedNotifs: updated.apiKeyGeneratedNotifs,
      apiKeyRevokedNotifs: updated.apiKeyRevokedNotifs,
      loginAlertNotifs: updated.loginAlertNotifs,
      reportScheduleChangedNotifs: updated.reportScheduleChangedNotifs,
      settlementStateChangedNotifs: updated.settlementStateChangedNotifs,
      planChangeNotifs: updated.planChangeNotifs,
      notifPrefsDisabledAt: updated.notifPrefsDisabledAt ?? null,
      notifFieldDisabledAt: updated.notifFieldDisabledAt ?? null,
      quietHoursStart: updated.quietHoursStart ?? null,
      quietHoursEnd: updated.quietHoursEnd ?? null,
      quietHoursTimezone: updated.quietHoursTimezone ?? null,
      createdAt: updated.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/snooze-reports-badge (deprecated — kept for backward compatibility)
router.patch("/snooze-reports-badge", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "admin") {
      res.status(403).json({ error: "Admin access only" });
      return;
    }
    const { snoozedUntil } = req.body as { snoozedUntil?: string | null };
    let snoozeDate: Date | null = null;
    if (snoozedUntil != null) {
      snoozeDate = new Date(snoozedUntil);
      if (isNaN(snoozeDate.getTime())) {
        res.status(400).json({ error: "snoozedUntil must be a valid ISO timestamp or null" });
        return;
      }
      // If the provided timestamp is already in the past, treat it as a clear
      // so we never persist a stale snooze value in the DB.
      if (snoozeDate <= new Date()) {
        snoozeDate = null;
      }
    }
    // Update legacy column AND generalized map for "reports" key
    const [row] = await db.select({ badgeSnoozedUntil: usersTable.badgeSnoozedUntil }).from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
    const badgeMap: Record<string, string> = { ...(row?.badgeSnoozedUntil ?? {}) };
    if (snoozeDate != null && snoozeDate > new Date()) {
      badgeMap["reports"] = snoozeDate.toISOString();
    } else {
      delete badgeMap["reports"];
    }
    await db.update(usersTable).set({ reportsBadgeSnoozedUntil: snoozeDate, badgeSnoozedUntil: badgeMap }).where(eq(usersTable.id, user.id));
    const resultIso = snoozeDate != null && snoozeDate > new Date() ? snoozeDate.toISOString() : null;
    res.json({ reportsBadgeSnoozedUntil: resultIso });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/snooze-badge
router.patch("/snooze-badge", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "admin") {
      res.status(403).json({ error: "Admin access only" });
      return;
    }
    const { badgeKey, snoozedUntil } = req.body as { badgeKey?: string; snoozedUntil?: string | null };
    if (!badgeKey || typeof badgeKey !== "string") {
      res.status(400).json({ error: "badgeKey is required and must be a string" });
      return;
    }
    let snoozeDate: Date | null = null;
    if (snoozedUntil != null) {
      snoozeDate = new Date(snoozedUntil);
      if (isNaN(snoozeDate.getTime())) {
        res.status(400).json({ error: "snoozedUntil must be a valid ISO timestamp or null" });
        return;
      }
    }
    // Load current badge map and update the specific key
    const [row] = await db.select({ badgeSnoozedUntil: usersTable.badgeSnoozedUntil }).from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
    const badgeMap: Record<string, string> = { ...(row?.badgeSnoozedUntil ?? {}) };
    const now = new Date();
    if (snoozeDate != null && snoozeDate > now) {
      badgeMap[badgeKey] = snoozeDate.toISOString();
    } else {
      delete badgeMap[badgeKey];
    }
    // Also keep legacy column in sync when the "reports" key is updated
    if (badgeKey === "reports") {
      await db.update(usersTable).set({ badgeSnoozedUntil: badgeMap, reportsBadgeSnoozedUntil: snoozeDate }).where(eq(usersTable.id, user.id));
    } else {
      await db.update(usersTable).set({ badgeSnoozedUntil: badgeMap }).where(eq(usersTable.id, user.id));
    }
    const resultIso = snoozeDate != null && snoozeDate > now ? snoozeDate.toISOString() : null;
    res.json({ badgeKey, snoozedUntil: resultIso });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/trusted-ips
router.get("/trusted-ips", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant") {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const rows = await db
      .select({
        id: merchantTrustedIpsTable.id,
        ipAddress: merchantTrustedIpsTable.ipAddress,
        labeledAt: merchantTrustedIpsTable.labeledAt,
      })
      .from(merchantTrustedIpsTable)
      .where(eq(merchantTrustedIpsTable.userId, user.id))
      .orderBy(desc(merchantTrustedIpsTable.labeledAt));

    res.json({ data: rows.map(r => ({ id: r.id, ipAddress: r.ipAddress, trustedAt: r.labeledAt })) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/auth/trusted-ips/:id
router.delete("/trusted-ips/:id", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant") {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [existing] = await db
      .select({ id: merchantTrustedIpsTable.id, userId: merchantTrustedIpsTable.userId })
      .from(merchantTrustedIpsTable)
      .where(eq(merchantTrustedIpsTable.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Trusted IP not found" });
      return;
    }

    if (existing.userId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    await db.delete(merchantTrustedIpsTable).where(eq(merchantTrustedIpsTable.id, id));

    res.json({ message: "Trusted IP removed" });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/quiet-hours/queue
// Returns the list of unflushed emails in the quiet-hours queue for the current user.
router.get("/quiet-hours/queue", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { db, quietHoursQueueTable } = await import("@workspace/db");
    const { eq, and, asc } = await import("drizzle-orm");
    const rows = await db
      .select({
        id: quietHoursQueueTable.id,
        subject: quietHoursQueueTable.subject,
        deliverAfter: quietHoursQueueTable.deliverAfter,
        createdAt: quietHoursQueueTable.createdAt,
      })
      .from(quietHoursQueueTable)
      .where(
        and(
          eq(quietHoursQueueTable.userId, user.id),
          eq(quietHoursQueueTable.flushed, false)
        )
      )
      .orderBy(asc(quietHoursQueueTable.deliverAfter));
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/quiet-hours/queue-count
// Returns the number of unflushed emails in the quiet-hours queue for the current user.
router.get("/quiet-hours/queue-count", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { db, quietHoursQueueTable } = await import("@workspace/db");
    const { eq, and, count } = await import("drizzle-orm");
    const [row] = await db
      .select({ count: count() })
      .from(quietHoursQueueTable)
      .where(
        and(
          eq(quietHoursQueueTable.userId, user.id),
          eq(quietHoursQueueTable.flushed, false)
        )
      );
    res.json({ count: row?.count ?? 0 });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/quiet-hours/flush
// Immediately delivers any queued emails whose deliver-after time has passed for the current user.
router.post("/quiet-hours/flush", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { flushQuietHoursQueueForUser } = await import("../helpers/quietHours");
    const result = await flushQuietHoursQueueForUser(user.id);
    res.json({ message: `Flushed ${result.flushed} queued notification(s)`, flushed: result.flushed });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post("/logout", (_req, res) => {
  res.json({ message: "Logged out successfully" });
});

// ---------------------------------------------------------------------------
// Merchant OTP login + forgot-password
// ---------------------------------------------------------------------------

const SAFE_OTP_REQUEST_MESSAGE = "If this account is registered, an OTP has been sent.";
const SAFE_PASSWORD_RESET_MESSAGE = "If this account is registered, password reset instructions have been sent.";

const otpRequestLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  store: new DbRateLimitStore(),
  message: { error: "Too many OTP requests. Please try again later." },
  keyGenerator: (req) => {
    const identifier = typeof req.body?.identifier === "string" ? normalizeIdentifier(req.body.identifier) : "";
    return `otp-req:${safeIpKey(req)}:${identifier}`;
  },
});

const otpVerifyLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  store: new DbRateLimitStore(),
  message: { error: "Too many attempts. Please try again later." },
  keyGenerator: (req) => {
    const identifier = typeof req.body?.identifier === "string" ? normalizeIdentifier(req.body.identifier) : "";
    return `otp-verify:${safeIpKey(req)}:${identifier}`;
  },
});

const otpResendLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  store: new DbRateLimitStore(),
  message: { error: "Too many resend requests. Please try again later." },
  keyGenerator: (req) => {
    const identifier = typeof req.body?.identifier === "string" ? normalizeIdentifier(req.body.identifier) : "";
    return `otp-resend:${safeIpKey(req)}:${identifier}`;
  },
});

const passwordForgotLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  store: new DbRateLimitStore(),
  message: { error: "Too many requests. Please try again later." },
  keyGenerator: (req) => {
    const identifier = typeof req.body?.identifier === "string" ? normalizeIdentifier(req.body.identifier) : "";
    return `pwd-forgot:${safeIpKey(req)}:${identifier}`;
  },
});

const passwordResetLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  store: new DbRateLimitStore(),
  message: { error: "Too many attempts. Please try again later." },
  keyGenerator: (req) => {
    const identifier = typeof req.body?.identifier === "string" ? normalizeIdentifier(req.body.identifier) : "";
    return `pwd-reset:${safeIpKey(req)}:${identifier}`;
  },
});

function requestIp(req: import("express").Request): string | null {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress
    ?? null;
}

/** Looks up the merchant user account matching an email or phone identifier, without revealing existence to the caller. */
async function findMerchantUserByIdentifier(identifier: string): Promise<{ id: number; email: string; merchantId: number | null } | null> {
  const normalized = normalizeIdentifier(identifier);
  if (isEmailIdentifier(normalized)) {
    const [user] = await db
      .select({ id: usersTable.id, email: usersTable.email, merchantId: usersTable.merchantId })
      .from(usersTable)
      .where(and(eq(usersTable.email, normalized), eq(usersTable.role, "merchant")))
      .limit(1);
    return user ?? null;
  }
  const digits = normalized.replace(/\D/g, "");
  if (!digits) return null;
  // Accept numbers entered with India country code (91 + 10 digits → strip to 10 for DB lookup)
  const lookupDigits = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  const [merchant] = await db
    .select({ id: merchantsTable.id })
    .from(merchantsTable)
    .where(eq(merchantsTable.phone, lookupDigits))
    .limit(1);
  if (!merchant) return null;
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, merchantId: usersTable.merchantId })
    .from(usersTable)
    .where(and(eq(usersTable.merchantId, merchant.id), eq(usersTable.role, "merchant")))
    .limit(1);
  return user ?? null;
}

async function createAndSendOtp(opts: {
  req: import("express").Request;
  identifier: string;
  purpose: "LOGIN" | "PASSWORD_RESET";
  user: { id: number; email: string; merchantId: number | null };
}): Promise<void> {
  const { req, identifier, purpose, user } = opts;
  const identifierHash = hashIdentifier(identifier);
  const ip = requestIp(req);
  const ipHash = hashIp(ip);

  const [existing] = await db
    .select({ id: merchantAuthOtpsTable.id, createdAt: merchantAuthOtpsTable.createdAt, resendCount: merchantAuthOtpsTable.resendCount })
    .from(merchantAuthOtpsTable)
    .where(and(
      eq(merchantAuthOtpsTable.identifierHash, identifierHash),
      eq(merchantAuthOtpsTable.purpose, purpose),
    ))
    .orderBy(desc(merchantAuthOtpsTable.createdAt))
    .limit(1);

  if (existing && Date.now() - existing.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    req.log.info({ purpose, hasUser: true, cooldown: true }, "merchant_otp_requested");
    return;
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const resendCount = existing ? existing.resendCount + 1 : 0;

  await db.insert(merchantAuthOtpsTable).values({
    merchantId: user.merchantId,
    identifierHash,
    otpHash,
    purpose,
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
    attempts: 0,
    resendCount,
    ipHash,
  });

  req.log.info({ purpose, hasUser: true }, "merchant_otp_requested");

  const isPhone = !isEmailIdentifier(identifier);

  if (isPhone) {
    const smsResult = await sendOtpSms({
      mobile: identifier.replace(/\D/g, ""),
      otp,
      purpose,
      merchantId: user.merchantId,
    }).catch((err: unknown) => {
      req.log.warn({ err, purpose }, "merchant_otp_sms_error");
      return { sent: false, provider: null, fallbackUsed: false };
    });
    req.log.info({ purpose, smsSent: smsResult.sent, provider: smsResult.provider, fallback: smsResult.fallbackUsed }, "merchant_otp_sent");
  } else {
    const sent = await sendMerchantOtpEmail({ to: user.email, otp, purpose }).catch((err: unknown) => {
      req.log.warn({ err, purpose }, "merchant_otp_send_error");
      return false;
    });
    req.log.info({ purpose, sent }, "merchant_otp_sent");
  }
}

// POST /api/auth/merchant/otp/resend — dedicated resend (enforces maxResendCount from settings)
router.post("/merchant/otp/resend", otpResendLimiter, async (req, res, next) => {
  try {
    const { identifier } = req.body as { identifier?: string };
    if (!identifier || typeof identifier !== "string") {
      res.status(400).json({ error: "identifier is required" });
      return;
    }
    const user = await findMerchantUserByIdentifier(identifier);
    if (!user) {
      res.json({ message: SAFE_OTP_REQUEST_MESSAGE });
      return;
    }
    const settings = await loadOtpSmsSettings();
    const maxResend = settings?.maxResendCount ?? 3;
    const identifierHash = hashIdentifier(normalizeIdentifier(identifier));
    const [existing] = await db
      .select({ id: merchantAuthOtpsTable.id, resendCount: merchantAuthOtpsTable.resendCount })
      .from(merchantAuthOtpsTable)
      .where(and(
        eq(merchantAuthOtpsTable.identifierHash, identifierHash),
        eq(merchantAuthOtpsTable.purpose, "LOGIN"),
      ))
      .orderBy(desc(merchantAuthOtpsTable.createdAt))
      .limit(1);
    if (existing && existing.resendCount >= maxResend) {
      res.status(429).json({ error: "Maximum resend limit reached. Please start a new login." });
      return;
    }
    await createAndSendOtp({ req, identifier, purpose: "LOGIN", user });
    res.json({ message: "A new code has been sent." });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/merchant/otp/request
router.post("/merchant/otp/request", otpRequestLimiter, async (req, res, next) => {
  try {
    const { identifier } = req.body as { identifier?: string };
    if (!identifier || typeof identifier !== "string") {
      res.status(400).json({ error: "identifier is required" });
      return;
    }
    const user = await findMerchantUserByIdentifier(identifier);
    if (!user) {
      req.log.info({ purpose: "LOGIN", hasUser: false }, "merchant_otp_requested");
      res.json({ message: SAFE_OTP_REQUEST_MESSAGE });
      return;
    }
    await createAndSendOtp({ req, identifier, purpose: "LOGIN", user });
    res.json({ message: SAFE_OTP_REQUEST_MESSAGE });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/merchant/otp/verify
router.post("/merchant/otp/verify", otpVerifyLimiter, async (req, res, next) => {
  try {
    const { identifier, otp } = req.body as { identifier?: string; otp?: string };
    if (!identifier || !otp || typeof identifier !== "string" || typeof otp !== "string") {
      res.status(400).json({ error: "identifier and otp are required" });
      return;
    }

    const user = await findMerchantUserByIdentifier(identifier);
    if (!user) {
      req.log.warn({ purpose: "LOGIN" }, "merchant_otp_failed");
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    const identifierHash = hashIdentifier(identifier);
    const [otpRow] = await db
      .select()
      .from(merchantAuthOtpsTable)
      .where(and(
        eq(merchantAuthOtpsTable.identifierHash, identifierHash),
        eq(merchantAuthOtpsTable.purpose, "LOGIN"),
      ))
      .orderBy(desc(merchantAuthOtpsTable.createdAt))
      .limit(1);

    if (!otpRow || otpRow.consumedAt || otpRow.expiresAt.getTime() < Date.now()) {
      req.log.warn({ userId: user.id, purpose: "LOGIN", reason: "no_active_otp" }, "merchant_otp_failed");
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
      req.log.warn({ userId: user.id, purpose: "LOGIN" }, "merchant_otp_rate_limited");
      res.status(429).json({ error: "Too many attempts. Please request a new code." });
      return;
    }

    const valid = await verifyOtpHash(otp, otpRow.otpHash);
    if (!valid) {
      await db.update(merchantAuthOtpsTable).set({ attempts: otpRow.attempts + 1 }).where(eq(merchantAuthOtpsTable.id, otpRow.id));
      req.log.warn({ userId: user.id, purpose: "LOGIN", reason: "mismatch" }, "merchant_otp_failed");
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    await db.update(merchantAuthOtpsTable).set({ consumedAt: new Date() }).where(eq(merchantAuthOtpsTable.id, otpRow.id));

    const [fullUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
    if (!fullUser || !fullUser.isActive) {
      req.log.warn({ userId: user.id, purpose: "LOGIN", reason: "inactive" }, "merchant_otp_failed");
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    req.log.info({ userId: fullUser.id, purpose: "LOGIN" }, "merchant_otp_verified");

    const token = generateToken({ userId: fullUser.id, role: fullUser.role });
    const loginIp = requestIp(req);

    db.update(usersTable)
      .set({ lastLoginAt: new Date(), ...(loginIp ? { lastSeenIp: loginIp } : {}) })
      .where(eq(usersTable.id, fullUser.id))
      .catch((err: unknown) => {
        logger.warn({ err, userId: fullUser.id }, "Failed to update lastLoginAt after OTP login");
      });

    if (fullUser.merchantId) {
      db.insert(credentialEventsTable).values({
        merchantId: fullUser.merchantId,
        eventType: "merchant_login",
        actorId: fullUser.id,
        actorEmail: fullUser.email,
        keyPrefix: null,
        ipAddress: loginIp,
      }).catch((err: unknown) => {
        req.log.warn({ err, merchantId: fullUser.merchantId }, "Failed to record OTP login event");
      });
    }

    res.json({
      token,
      user: {
        id: fullUser.id,
        email: fullUser.email,
        role: fullUser.role,
        name: fullUser.name,
        isActive: fullUser.isActive,
        merchantId: fullUser.merchantId,
        createdAt: fullUser.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/merchant/password/forgot
router.post("/merchant/password/forgot", passwordForgotLimiter, async (req, res, next) => {
  try {
    const { identifier } = req.body as { identifier?: string };
    if (!identifier || typeof identifier !== "string") {
      res.status(400).json({ error: "identifier is required" });
      return;
    }
    const user = await findMerchantUserByIdentifier(identifier);
    if (!user) {
      req.log.info({ purpose: "PASSWORD_RESET", hasUser: false }, "merchant_otp_requested");
      res.json({ message: SAFE_PASSWORD_RESET_MESSAGE });
      return;
    }
    await createAndSendOtp({ req, identifier, purpose: "PASSWORD_RESET", user });
    res.json({ message: SAFE_PASSWORD_RESET_MESSAGE });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/merchant/password/reset
router.post("/merchant/password/reset", passwordResetLimiter, async (req, res, next) => {
  try {
    const { identifier, otp, newPassword } = req.body as { identifier?: string; otp?: string; newPassword?: string };
    if (!identifier || !otp || !newPassword || typeof identifier !== "string" || typeof otp !== "string" || typeof newPassword !== "string") {
      res.status(400).json({ error: "identifier, otp, and newPassword are required" });
      return;
    }

    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }

    const user = await findMerchantUserByIdentifier(identifier);
    if (!user) {
      req.log.warn({ purpose: "PASSWORD_RESET" }, "merchant_otp_failed");
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    const identifierHash = hashIdentifier(identifier);
    const [otpRow] = await db
      .select()
      .from(merchantAuthOtpsTable)
      .where(and(
        eq(merchantAuthOtpsTable.identifierHash, identifierHash),
        eq(merchantAuthOtpsTable.purpose, "PASSWORD_RESET"),
      ))
      .orderBy(desc(merchantAuthOtpsTable.createdAt))
      .limit(1);

    if (!otpRow || otpRow.consumedAt || otpRow.expiresAt.getTime() < Date.now()) {
      req.log.warn({ userId: user.id, purpose: "PASSWORD_RESET", reason: "no_active_otp" }, "merchant_otp_failed");
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
      req.log.warn({ userId: user.id, purpose: "PASSWORD_RESET" }, "merchant_otp_rate_limited");
      res.status(429).json({ error: "Too many attempts. Please request a new code." });
      return;
    }

    const valid = await verifyOtpHash(otp, otpRow.otpHash);
    if (!valid) {
      await db.update(merchantAuthOtpsTable).set({ attempts: otpRow.attempts + 1 }).where(eq(merchantAuthOtpsTable.id, otpRow.id));
      req.log.warn({ userId: user.id, purpose: "PASSWORD_RESET", reason: "mismatch" }, "merchant_otp_failed");
      res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
      return;
    }

    await db.update(merchantAuthOtpsTable).set({ consumedAt: new Date() }).where(eq(merchantAuthOtpsTable.id, otpRow.id));

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.update(usersTable)
      .set({ passwordHash, passwordUpdatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    req.log.info({ userId: user.id, purpose: "PASSWORD_RESET" }, "merchant_otp_verified");

    res.json({ message: "Your password has been reset successfully. Please log in with your new password." });
  } catch (err) {
    next(err);
  }
});

export default router;
