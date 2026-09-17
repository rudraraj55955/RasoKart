import { Router } from "express";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { emailDeliveryEventsTable, emailDeliveryLogsTable } from "@workspace/db/schema";
import { requireAdmin, requireAuth, requirePermission } from "../middlewares/auth";
import { PERMISSIONS } from "../permissions";

const router = Router();
router.use(requireAuth, requireAdmin, requirePermission(PERMISSIONS.ADMIN_EMAIL_DELIVERY));

const ALLOWED_STATUSES = new Set(["accepted", "delivered", "bounced", "failed"]);

router.get("/:id/events", async (req, res, next) => {
  try {
    const deliveryLogId = Number.parseInt(req.params["id"] as string, 10);
    if (!Number.isSafeInteger(deliveryLogId) || deliveryLogId <= 0) {
      res.status(400).json({ error: "Invalid delivery log ID" });
      return;
    }

    const events = await db
      .select({
        id: emailDeliveryEventsTable.id,
        provider: emailDeliveryEventsTable.provider,
        providerMessageId: emailDeliveryEventsTable.providerMessageId,
        providerEventId: emailDeliveryEventsTable.providerEventId,
        status: emailDeliveryEventsTable.status,
        failureSummary: emailDeliveryEventsTable.failureSummary,
        receivedAt: emailDeliveryEventsTable.receivedAt,
      })
      .from(emailDeliveryEventsTable)
      .where(eq(emailDeliveryEventsTable.deliveryLogId, deliveryLogId))
      .orderBy(desc(emailDeliveryEventsTable.receivedAt), desc(emailDeliveryEventsTable.id));

    const user = (req as any).user;
    db.insert(auditLogsTable)
      .values({
        adminId: user.id,
        adminEmail: user.email,
        action: "password_reset_email_delivery_events_viewed",
        targetType: "email_delivery",
        targetId: deliveryLogId,
        details: JSON.stringify({ eventCount: events.length }),
        ipAddress: req.ip ?? null,
      })
      .catch((err: unknown) => req.log.warn({ err }, "password_reset_delivery_events_view_audit_failed"));

    res.json({ events });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const {
      page = "1",
      limit = "50",
      status,
      provider,
      dateFrom,
      dateTo,
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;
    const conditions = [];

    if (status && ALLOWED_STATUSES.has(status)) {
      conditions.push(eq(emailDeliveryLogsTable.status, status));
    }
    if (provider) conditions.push(eq(emailDeliveryLogsTable.provider, provider.slice(0, 80)));
    if (dateFrom) {
      const parsed = new Date(dateFrom);
      if (!Number.isNaN(parsed.getTime())) conditions.push(gte(emailDeliveryLogsTable.createdAt, parsed));
    }
    if (dateTo) {
      const parsed = new Date(dateTo);
      if (!Number.isNaN(parsed.getTime())) conditions.push(lte(emailDeliveryLogsTable.createdAt, parsed));
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: emailDeliveryLogsTable.id,
          purpose: emailDeliveryLogsTable.purpose,
          provider: emailDeliveryLogsTable.provider,
          status: emailDeliveryLogsTable.status,
          providerMessageId: emailDeliveryLogsTable.providerMessageId,
          errorReason: emailDeliveryLogsTable.errorReason,
          createdAt: emailDeliveryLogsTable.createdAt,
          updatedAt: emailDeliveryLogsTable.updatedAt,
          lastEventAt: emailDeliveryLogsTable.lastEventAt,
        })
        .from(emailDeliveryLogsTable)
        .where(where)
        .orderBy(desc(emailDeliveryLogsTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db.select({ total: count() }).from(emailDeliveryLogsTable).where(where),
    ]);

    const user = (req as any).user;
    db.insert(auditLogsTable)
      .values({
        adminId: user.id,
        adminEmail: user.email,
        action: "password_reset_email_delivery_viewed",
        targetType: "email_delivery",
        targetId: null,
        details: JSON.stringify({ page: pageNum, limit: limitNum, status: status ?? null, provider: provider ?? null }),
        ipAddress: req.ip ?? null,
      })
      .catch((err: unknown) => req.log.warn({ err }, "password_reset_delivery_view_audit_failed"));

    res.json({
      logs: rows,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    next(err);
  }
});

export default router;