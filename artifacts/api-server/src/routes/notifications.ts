import { Router } from "express";
import { db, notificationsTable, usersTable, merchantsTable, merchantPlansTable, plansTable } from "@workspace/db";
import { eq, and, desc, count, lt, gte, or, sql, isNull, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { createBulkNotifications, createNotification } from "../helpers/notifications";
import { runProviderLimitAlertScan } from "../helpers/providerLimitScheduler";
import { checkWebhookSecretRotation } from "../helpers/webhookSecretChecker";

const router = Router();
router.use(requireAuth);

function mapNotification(n: typeof notificationsTable.$inferSelect) {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    metadata: n.metadata,
    isRead: n.isRead,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

// GET /api/notifications
router.get("/", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { isRead, type, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [eq(notificationsTable.userId, user.id)];
    if (isRead === "true") conditions.push(eq(notificationsTable.isRead, true));
    if (isRead === "false") conditions.push(eq(notificationsTable.isRead, false));
    if (type) conditions.push(eq(notificationsTable.type, type));

    const where = and(...conditions);
    const [{ total }] = await db.select({ total: count() }).from(notificationsTable).where(where);
    const [{ unread }] = await db.select({ unread: count() }).from(notificationsTable)
      .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false)));

    const rows = await db.select().from(notificationsTable)
      .where(where)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    res.json({ data: rows.map(mapNotification), total, unread, page: pageNum, limit: limitNum });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/read-all
router.post("/read-all", async (req, res, next) => {
  try {
    const user = (req as any).user;
    await db.update(notificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false)));
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/broadcast (admin only)
router.post("/broadcast", requireAdmin, async (req, res, next) => {
  try {
    const { merchantId, title, body } = req.body;
    if (!title?.trim() || !body?.trim()) {
      res.status(400).json({ error: "title and body are required" });
      return;
    }

    // Fetch target users
    let targetUserIds: number[] = [];
    if (merchantId) {
      // Specific merchant
      const [merchant] = await db.select({ id: merchantsTable.id })
        .from(merchantsTable)
        .where(eq(merchantsTable.id, parseInt(merchantId)))
        .limit(1);
      if (!merchant) { res.status(404).json({ error: "Merchant not found" }); return; }
      const [user] = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.merchantId, parseInt(merchantId)))
        .limit(1);
      if (user) targetUserIds = [user.id];
    } else {
      // All merchants
      const users = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.role, "merchant"), eq(usersTable.isActive, true)));
      targetUserIds = users.map(u => u.id);
    }

    if (targetUserIds.length === 0) {
      res.json({ message: "No active merchants found", count: 0 });
      return;
    }

    await createBulkNotifications(targetUserIds.map(userId => ({
      userId,
      type: "system_notice" as const,
      title: title.trim(),
      body: body.trim(),
      metadata: { broadcastBy: (req as any).user.email },
    })));

    res.json({ message: `Notification sent to ${targetUserIds.length} merchant(s)`, count: targetUserIds.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/security-reminder (admin only)
// Sends a "set up your callback secret" in-app notification to each selected merchant
// that doesn't already have a callback secret configured. Merchants who already have
// a secret are silently skipped so the notification is never redundant.
router.post("/security-reminder", requireAdmin, async (req, res, next) => {
  try {
    const { merchantIds } = req.body as { merchantIds?: unknown };
    if (!Array.isArray(merchantIds) || merchantIds.length === 0) {
      res.status(400).json({ error: "merchantIds must be a non-empty array" });
      return;
    }
    const ids = merchantIds.map(Number).filter(n => !isNaN(n) && n > 0);
    if (ids.length === 0) {
      res.status(400).json({ error: "merchantIds must contain valid positive integers" });
      return;
    }

    // Only target merchants that genuinely lack a callback secret
    const targets = await db
      .select({ merchantId: merchantsTable.id, userId: usersTable.id, businessName: merchantsTable.businessName })
      .from(merchantsTable)
      .innerJoin(usersTable, eq(usersTable.merchantId, merchantsTable.id))
      .where(and(
        inArray(merchantsTable.id, ids),
        isNull(merchantsTable.callbackSecret),
      ));

    const skipped = ids.length - targets.length;

    if (targets.length === 0) {
      res.json({ message: "All selected merchants already have a callback secret configured", sent: 0, skipped });
      return;
    }

    await createBulkNotifications(targets.map(t => ({
      userId: t.userId,
      type: "system_notice" as const,
      title: "Action Required: Set Up Your Callback Secret",
      body: "Your account does not have a callback signing secret configured. Setting up a secret lets RasoKart sign every webhook payload so your server can verify authenticity. Go to Settings → Webhooks → Callback Secret to generate one.",
      metadata: { reminderType: "callback_secret_setup", sentBy: (req as any).user.email },
    })));

    res.json({
      message: `Security reminder sent to ${targets.length} merchant${targets.length !== 1 ? "s" : ""}`,
      sent: targets.length,
      skipped,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/check-expiry (admin triggered — creates plan_expiring / plan_expired notifications)
// Emits plan_expiring ONLY at exactly 7 days and 1 day before expiry.
// Idempotency key: one notification per (userId, type, targetDayKey) so running multiple times in a day is safe.
router.get("/check-expiry", requireAdmin, async (req, res, next) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

    // Helper: does a row expire within [windowStart, windowEnd)?
    function inWindow(expiresAt: Date, daysFromNow: number): boolean {
      const windowStart = new Date(now.getTime() + (daysFromNow - 0.5) * 24 * 60 * 60 * 1000);
      const windowEnd   = new Date(now.getTime() + (daysFromNow + 0.5) * 24 * 60 * 60 * 1000);
      return expiresAt >= windowStart && expiresAt < windowEnd;
    }

    // Fetch all active plans that haven't yet expired
    const activePlans = await db
      .select({
        userId: usersTable.id,
        merchantId: merchantsTable.id,
        planName: plansTable.name,
        expiresAt: merchantPlansTable.expiresAt,
      })
      .from(merchantPlansTable)
      .innerJoin(merchantsTable, eq(merchantPlansTable.merchantId, merchantsTable.id))
      .innerJoin(usersTable, eq(usersTable.merchantId, merchantsTable.id))
      .innerJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
      .where(and(
        eq(merchantPlansTable.status, "active"),
        gte(merchantPlansTable.expiresAt, now),
      ));

    // Fetch plans that just expired (within last 24h)
    const justExpired = await db
      .select({
        userId: usersTable.id,
        merchantId: merchantsTable.id,
        planName: plansTable.name,
        expiresAt: merchantPlansTable.expiresAt,
      })
      .from(merchantPlansTable)
      .innerJoin(merchantsTable, eq(merchantPlansTable.merchantId, merchantsTable.id))
      .innerJoin(usersTable, eq(usersTable.merchantId, merchantsTable.id))
      .innerJoin(plansTable, eq(merchantPlansTable.planId, plansTable.id))
      .where(and(
        eq(merchantPlansTable.status, "active"),
        lt(merchantPlansTable.expiresAt, now),
        gte(merchantPlansTable.expiresAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      ));

    const notifications: { userId: number; type: any; title: string; body: string; metadata?: any }[] = [];

    for (const row of activePlans) {
      if (!row.expiresAt || !row.userId) continue;
      // Only fire at exactly 7 days or 1 day (±12h window)
      const is7Day = inWindow(row.expiresAt, 7);
      const is1Day = inWindow(row.expiresAt, 1);
      if (!is7Day && !is1Day) continue;

      const daysLeft = is1Day ? 1 : 7;
      // Idempotency key: type + targetDay — prevent duplicate on same calendar day
      const dedupeKey = `plan_expiring_${daysLeft}d_${todayStr}`;
      const [existing] = await db.select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(and(
          eq(notificationsTable.userId, row.userId),
          eq(notificationsTable.type, "plan_expiring"),
          sql`${notificationsTable.metadata}->>'dedupeKey' = ${dedupeKey}`,
        ))
        .limit(1);
      if (existing) continue;

      notifications.push({
        userId: row.userId,
        type: "plan_expiring",
        title: daysLeft === 1 ? "Plan Expiring Tomorrow" : "Plan Expiring in 7 Days",
        body: `Your ${row.planName} plan expires on ${row.expiresAt.toLocaleDateString("en-IN")}. Contact support to renew before your access is interrupted.`,
        metadata: { planName: row.planName, expiresAt: row.expiresAt.toISOString(), daysLeft, dedupeKey },
      });
    }

    for (const row of justExpired) {
      if (!row.userId) continue;
      const dedupeKey = `plan_expired_${todayStr}`;
      const [existing] = await db.select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(and(
          eq(notificationsTable.userId, row.userId),
          eq(notificationsTable.type, "plan_expired"),
          sql`${notificationsTable.metadata}->>'dedupeKey' = ${dedupeKey}`,
        ))
        .limit(1);
      if (existing) continue;
      notifications.push({
        userId: row.userId,
        type: "plan_expired",
        title: "Plan Expired",
        body: `Your ${row.planName} plan has expired. Please contact your account manager to renew.`,
        metadata: { planName: row.planName, expiresAt: row.expiresAt?.toISOString(), dedupeKey },
      });
    }

    if (notifications.length > 0) {
      await createBulkNotifications(notifications);
    }

    // Also sweep provider limit resets for all active connections so this
    // endpoint can serve as a single "catch-up" trigger for admins.
    // The dedup indexes make this idempotent.
    await runProviderLimitAlertScan();

    res.json({ message: "Expiry check complete", notificationsSent: notifications.length, expiringCount: activePlans.length, expiredCount: justExpired.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/check-webhook-secrets (admin triggered)
// Scans all merchants with a callback secret set and fires rotation reminders:
//   75–89 days old → webhook_secret_rotation_reminder  (dedupe: once per ISO week)
//   90+ days old   → webhook_secret_rotation_overdue   (dedupe: once per calendar day)
router.get("/check-webhook-secrets", requireAdmin, async (req, res, next) => {
  try {
    const { reminderCount, overdueCount, notificationsSent } = await checkWebhookSecretRotation();
    res.json({
      message: "Webhook secret rotation check complete",
      notificationsSent,
      reminderCount,
      overdueCount,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/:id/read
router.post("/:id/read", async (req, res, next) => {
  try {
    const user = (req as any).user;
    const id = parseInt(req.params.id as string);
    const [updated] = await db.update(notificationsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, user.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Notification not found" }); return; }
    res.json(mapNotification(updated));
  } catch (err) {
    next(err);
  }
});

export default router;
