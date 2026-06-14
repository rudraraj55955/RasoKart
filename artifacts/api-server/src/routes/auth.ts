import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, usersTable, merchantsTable, credentialEventsTable, merchantTrustedIpsTable, auditLogsTable } from "@workspace/db";
import { dbRateLimitStore } from "../lib/rateLimitStore";
import { eq, and, count, desc } from "drizzle-orm";
import { generateToken, requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { makeRateLimiter } from "../helpers/makeRateLimiter";
import { sendNewLoginAlertEmail } from "../helpers/newLoginEmail";
import { createNotification } from "../helpers/notifications";

const router = Router();

const JWT_SECRET = process.env.SESSION_SECRET || "rasokart-secret-key-change-in-production";

const MAX_TRUSTED_IPS = 20;

const loginLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  store: dbRateLimitStore,
  message: { error: "Too many login attempts. Please try again later." },
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
router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    if (!user.isActive) {
      res.status(401).json({ error: "Account suspended. Please contact support." });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
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
    .select({ id: usersTable.id, merchantId: usersTable.merchantId, role: usersTable.role })
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

    res.send(htmlPage(true, "This IP address has been added to your trusted list. You will no longer receive login alerts when signing in from this location."));
  } catch (err) {
    logger.warn({ err, userId: user.id, ip: payload.ip }, "Failed to insert trusted IP");
    res.status(500).send(htmlPage(false, "An error occurred while saving your trusted IP. Please try again or contact support."));
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
    if (user.role === "merchant" && user.merchantId) {
      const [merchant] = await db.select({ status: merchantsTable.status }).from(merchantsTable).where(eq(merchantsTable.id, user.merchantId)).limit(1);
      merchantStatus = merchant?.status ?? null;
    }
    const [row] = await db
      .select({
        reconciliationAlertEmails: usersTable.reconciliationAlertEmails,
        planExpiryAlertEmails: usersTable.planExpiryAlertEmails,
        settlementStateEmails: usersTable.settlementStateEmails,
        signatureFailureAlertEmails: usersTable.signatureFailureAlertEmails,
        webhookFailureEmails: usersTable.webhookFailureEmails,
        reportFailureAlertEmails: usersTable.reportFailureAlertEmails,
        weeklyDeliveryDigestEmails: usersTable.weeklyDeliveryDigestEmails,
        apiKeyGeneratedEmails: usersTable.apiKeyGeneratedEmails,
        apiKeyRevokedEmails: usersTable.apiKeyRevokedEmails,
        loginAlertEmails: usersTable.loginAlertEmails,
        reportScheduleChangedEmails: usersTable.reportScheduleChangedEmails,
        settlementStateChangedEmails: usersTable.settlementStateChangedEmails,
        ekqrSyncAlertEmails: usersTable.ekqrSyncAlertEmails,
        planChangeEmails: usersTable.planChangeEmails,
        notifPrefsDisabledAt: usersTable.notifPrefsDisabledAt,
        quietHoursStart: usersTable.quietHoursStart,
        quietHoursEnd: usersTable.quietHoursEnd,
        quietHoursTimezone: usersTable.quietHoursTimezone,
      })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);
    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      isActive: user.isActive,
      merchantId: user.merchantId,
      merchantStatus,
      reconciliationAlertEmails: row?.reconciliationAlertEmails ?? true,
      planExpiryAlertEmails: row?.planExpiryAlertEmails ?? true,
      settlementStateEmails: row?.settlementStateEmails ?? true,
      signatureFailureAlertEmails: row?.signatureFailureAlertEmails ?? true,
      webhookFailureEmails: row?.webhookFailureEmails ?? true,
      reportFailureAlertEmails: row?.reportFailureAlertEmails ?? true,
      weeklyDeliveryDigestEmails: row?.weeklyDeliveryDigestEmails ?? true,
      apiKeyGeneratedEmails: row?.apiKeyGeneratedEmails ?? true,
      apiKeyRevokedEmails: row?.apiKeyRevokedEmails ?? true,
      loginAlertEmails: row?.loginAlertEmails ?? true,
      reportScheduleChangedEmails: row?.reportScheduleChangedEmails ?? true,
      settlementStateChangedEmails: row?.settlementStateChangedEmails ?? true,
      ekqrSyncAlertEmails: row?.ekqrSyncAlertEmails ?? true,
      planChangeEmails: row?.planChangeEmails ?? true,
      notifPrefsDisabledAt: row?.notifPrefsDisabledAt ?? null,
      quietHoursStart: row?.quietHoursStart ?? null,
      quietHoursEnd: row?.quietHoursEnd ?? null,
      quietHoursTimezone: row?.quietHoursTimezone ?? null,
      createdAt: user.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/preferences
router.put("/preferences", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { reconciliationAlertEmails, planExpiryAlertEmails, settlementStateEmails, signatureFailureAlertEmails, webhookFailureEmails, reportFailureAlertEmails, weeklyDeliveryDigestEmails, apiKeyGeneratedEmails, apiKeyRevokedEmails, loginAlertEmails, reportScheduleChangedEmails, settlementStateChangedEmails, ekqrSyncAlertEmails, planChangeEmails, quietHoursStart, quietHoursEnd, quietHoursTimezone } = req.body;

    const patch: Record<string, boolean | Date | string | null> = {};

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
      "weeklyDeliveryDigestEmails",
      "apiKeyGeneratedEmails",
      "apiKeyRevokedEmails",
      "loginAlertEmails",
      "reportScheduleChangedEmails",
      "settlementStateChangedEmails",
      "ekqrSyncAlertEmails",
      "planChangeEmails",
    ] as const;

    const [current] = await db
      .select({
        reconciliationAlertEmails: usersTable.reconciliationAlertEmails,
        planExpiryAlertEmails: usersTable.planExpiryAlertEmails,
        settlementStateEmails: usersTable.settlementStateEmails,
        signatureFailureAlertEmails: usersTable.signatureFailureAlertEmails,
        webhookFailureEmails: usersTable.webhookFailureEmails,
        reportFailureAlertEmails: usersTable.reportFailureAlertEmails,
        weeklyDeliveryDigestEmails: usersTable.weeklyDeliveryDigestEmails,
        apiKeyGeneratedEmails: usersTable.apiKeyGeneratedEmails,
        apiKeyRevokedEmails: usersTable.apiKeyRevokedEmails,
        loginAlertEmails: usersTable.loginAlertEmails,
        reportScheduleChangedEmails: usersTable.reportScheduleChangedEmails,
        settlementStateChangedEmails: usersTable.settlementStateChangedEmails,
        ekqrSyncAlertEmails: usersTable.ekqrSyncAlertEmails,
        planChangeEmails: usersTable.planChangeEmails,
        notifPrefsDisabledAt: usersTable.notifPrefsDisabledAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);

    // Compute notifPrefsDisabledAt: set when any pref first goes false, clear when all re-enabled
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
            createNotification({
              userId: user.id,
              type: "preference_change_unknown_device",
              title: "Notification preferences changed from an unrecognised device",
              body: `Your notification preferences were updated from IP ${ip}. If this wasn't you, review your Security Activity immediately.`,
              metadata: { ip, target: "/merchant/security" },
            }).catch((err: unknown) => {
              req.log.warn({ err, userId: user.id }, "Failed to create preference_change_unknown_device notification");
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
      weeklyDeliveryDigestEmails: updated.weeklyDeliveryDigestEmails,
      apiKeyGeneratedEmails: updated.apiKeyGeneratedEmails,
      apiKeyRevokedEmails: updated.apiKeyRevokedEmails,
      loginAlertEmails: updated.loginAlertEmails,
      reportScheduleChangedEmails: updated.reportScheduleChangedEmails,
      settlementStateChangedEmails: updated.settlementStateChangedEmails,
      ekqrSyncAlertEmails: updated.ekqrSyncAlertEmails,
      planChangeEmails: updated.planChangeEmails,
      notifPrefsDisabledAt: updated.notifPrefsDisabledAt ?? null,
      quietHoursStart: updated.quietHoursStart ?? null,
      quietHoursEnd: updated.quietHoursEnd ?? null,
      quietHoursTimezone: updated.quietHoursTimezone ?? null,
      createdAt: updated.createdAt,
    });
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

export default router;
