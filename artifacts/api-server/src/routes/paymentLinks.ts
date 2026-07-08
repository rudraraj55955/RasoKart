import { Router } from "express";
import { db, paymentLinksTable, merchantsTable, merchantConnectionsTable, transactionsTable, providerIntegrationsTable } from "@workspace/db";
import { eq, and, ilike, count, desc, gte, lte, or, sql, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { checkPlanLimit, rejectWithLimitError } from "../helpers/planLimits";
import { deriveVpa, buildUpiPayload, deriveUpiPayloadFromConnections } from "../helpers/upiPayload";
import { randomBytes } from "crypto";

function generateUtr(): string {
  return `MANUAL${Date.now()}${randomBytes(3).toString("hex").toUpperCase()}`;
}

const router = Router();

function generateSlug(): string {
  return randomBytes(6).toString("hex");
}

function buildUrl(slug: string, req: any): string {
  const host = req.headers["x-forwarded-host"] ?? req.headers["host"] ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  return `${proto}://${host}/pay/${slug}`;
}

function serializeLink(
  link: typeof paymentLinksTable.$inferSelect,
  merchantName: string | null | undefined,
  req: any,
  paymentCount: number = 0,
) {
  return {
    ...link,
    merchantName: merchantName ?? null,
    url: buildUrl(link.slug, req),
    expiresAt: link.expiresAt instanceof Date ? link.expiresAt.toISOString() : link.expiresAt,
    paymentCount,
    maxPayments: link.maxPayments ?? null,
  };
}

async function expireOldLinks() {
  await db.execute(sql`
    UPDATE payment_links SET status = 'expired'
    WHERE expires_at IS NOT NULL AND expires_at < NOW() AND status = 'active'
  `);
  await db.execute(sql`
    UPDATE payment_links SET status = 'expired'
    WHERE max_payments IS NOT NULL AND status = 'active'
      AND (SELECT COUNT(*) FROM transactions WHERE payment_link_id = payment_links.id) >= max_payments
  `);
}

// Public endpoint — no auth required — must be registered before requireAuth middleware
// GET /api/payment-links/public/:slug
router.get("/public/:slug", async (req, res) => {
  const slug = req.params["slug"] as string;

  const rows = await db.select({
    link: paymentLinksTable,
    merchantName: merchantsTable.businessName,
    logoUrl: merchantsTable.logoUrl,
    brandColor: merchantsTable.brandColor,
  })
    .from(paymentLinksTable)
    .leftJoin(merchantsTable, eq(paymentLinksTable.merchantId, merchantsTable.id))
    .where(eq(paymentLinksTable.slug, slug))
    .limit(1);

  if (!rows.length) { res.status(404).json({ error: "Payment link not found" }); return; }

  const { link, merchantName, logoUrl, brandColor } = rows[0];

  if (link.expiresAt && new Date() > link.expiresAt && link.status === "active") {
    await db.update(paymentLinksTable).set({ status: "expired" }).where(eq(paymentLinksTable.id, link.id));
    link.status = "expired";
  }

  if (link.maxPayments != null && link.status === "active") {
    const [{ total }] = await db.select({ total: count() }).from(transactionsTable)
      .where(eq(transactionsTable.paymentLinkId, link.id));
    if (total >= link.maxPayments) {
      await db.update(paymentLinksTable).set({ status: "expired" }).where(eq(paymentLinksTable.id, link.id));
      link.status = "expired";
    }
  }

  // If upiPayload was not saved at creation time (e.g. provider connected later),
  // derive it on-the-fly from the merchant's active connections.
  let upiPayload = link.upiPayload ?? null;
  if (!upiPayload) {
    const connections = await db.select({
      provider: merchantConnectionsTable.provider,
      credentials: merchantConnectionsTable.credentials,
      isActive: merchantConnectionsTable.isActive,
    })
      .from(merchantConnectionsTable)
      .where(and(
        eq(merchantConnectionsTable.merchantId, link.merchantId),
        eq(merchantConnectionsTable.isActive, true),
      ))
      .limit(10);

    if (connections.length > 0) {
      const derived = deriveUpiPayloadFromConnections(
        connections,
        merchantName ?? "Merchant",
        link.amount ?? null,
        link.title ?? null,
      );
      if (derived) {
        upiPayload = derived;
        // Persist so future requests skip the extra query
        await db.update(paymentLinksTable)
          .set({ upiPayload: derived })
          .where(eq(paymentLinksTable.id, link.id));
      }
    }
  }

  // Check for own_static_upi gateway (platform-managed UPI collection)
  let staticUpi: {
    upiId: string;
    qrImageUrl: string | null;
    accountHolder: string | null;
    instructions: string | null;
    providerKey: string;
  } | null = null;

  const staticUpiRows = await db
    .select({
      ownUpiId: providerIntegrationsTable.ownUpiId,
      ownQrImageUrl: providerIntegrationsTable.ownQrImageUrl,
      ownAccountHolder: providerIntegrationsTable.ownAccountHolder,
      ownInstructions: providerIntegrationsTable.ownInstructions,
      providerKey: providerIntegrationsTable.providerKey,
    })
    .from(providerIntegrationsTable)
    .where(
      and(
        eq(providerIntegrationsTable.collectionType, "own_static_upi"),
        eq(providerIntegrationsTable.isEnabled, true),
      ),
    )
    .limit(1);

  if (staticUpiRows.length > 0 && staticUpiRows[0].ownUpiId) {
    const r = staticUpiRows[0];
    staticUpi = {
      upiId: r.ownUpiId!,
      qrImageUrl: r.ownQrImageUrl ?? null,
      accountHolder: r.ownAccountHolder ?? null,
      instructions: r.ownInstructions ?? null,
      providerKey: r.providerKey,
    };
  }

  res.json({
    id: link.id,
    title: link.title,
    description: link.description ?? null,
    amount: link.amount ?? null,
    currency: link.currency,
    slug: link.slug,
    upiPayload,
    staticUpi,
    merchantName: merchantName ?? null,
    logoUrl: logoUrl ?? null,
    brandColor: brandColor ?? null,
    status: link.status,
    expiresAt: link.expiresAt instanceof Date ? link.expiresAt.toISOString() : link.expiresAt,
  });
});

// ── POST /api/payment-links/public/:slug/utr (no auth) ────────────────────────
// Customer submits a UTR after paying to the platform's static UPI.
router.post("/public/:slug/utr", async (req, res, next) => {
  try {
    const slug = req.params["slug"] as string;

    const rows = await db
      .select({ link: paymentLinksTable })
      .from(paymentLinksTable)
      .where(eq(paymentLinksTable.slug, slug))
      .limit(1);

    if (!rows.length) { res.status(404).json({ error: "Payment link not found" }); return; }
    const { link } = rows[0];
    if (link.status !== "active") { res.status(409).json({ error: "Payment link is not active" }); return; }

    const { utr, payerName, payerUpi, screenshotUrl, amount: bodyAmount } = req.body as {
      utr?: string;
      payerName?: string;
      payerUpi?: string;
      screenshotUrl?: string;
      amount?: string;
    };

    if (!utr || !utr.trim()) { res.status(400).json({ error: "UTR is required" }); return; }
    const utrClean = utr.trim().toUpperCase();

    // Determine amount: use link amount if fixed; require body amount otherwise
    let finalAmount: string;
    if (link.amount) {
      finalAmount = link.amount;
    } else if (bodyAmount && parseFloat(bodyAmount) > 0) {
      finalAmount = parseFloat(bodyAmount).toFixed(2);
    } else {
      res.status(400).json({ error: "Amount is required for open-amount payment links" }); return;
    }

    // Verify own_static_upi gateway is active
    const [staticGateway] = await db
      .select({ providerKey: providerIntegrationsTable.providerKey })
      .from(providerIntegrationsTable)
      .where(
        and(
          eq(providerIntegrationsTable.collectionType, "own_static_upi"),
          eq(providerIntegrationsTable.isEnabled, true),
        ),
      )
      .limit(1);

    if (!staticGateway) { res.status(409).json({ error: "Manual UPI collection is not currently available" }); return; }

    const metadata = JSON.stringify({
      payerName: payerName?.trim() || null,
      payerUpi: payerUpi?.trim() || null,
      screenshotUrl: screenshotUrl?.trim() || null,
      providerKey: staticGateway.providerKey,
    });

    try {
      const [txn] = await db.insert(transactionsTable).values({
        merchantId: link.merchantId,
        paymentLinkId: link.id,
        type: "deposit",
        status: "pending_verification",
        provider: "own_static_upi",
        amount: finalAmount,
        currency: "INR",
        utr: utrClean,
        metadata,
      }).returning();

      res.json({ message: "Payment submitted for verification. You will be notified once confirmed.", transactionId: txn.id });
    } catch (err: any) {
      if (err?.code === "23505") {
        res.status(409).json({ error: "This UTR has already been submitted. Please check with support if it's taking long." });
        return;
      }
      throw err;
    }
  } catch (err) { next(err); }
});

router.use(requireAuth);

// GET /api/payment-links
router.get("/", async (req, res) => {
  await expireOldLinks().catch(() => {});
  const user = (req as any).user;
  const { status, search, merchantId, merchantName, dateFrom, dateTo, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const merchantConditions = [];
  if (user.role !== "admin") conditions.push(eq(paymentLinksTable.merchantId, user.merchantId!));
  if (merchantId && user.role === "admin") conditions.push(eq(paymentLinksTable.merchantId, parseInt(merchantId)));
  if (status && status !== "all") conditions.push(eq(paymentLinksTable.status, status));
  if (dateFrom) conditions.push(gte(paymentLinksTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    conditions.push(lte(paymentLinksTable.createdAt, to));
  }
  if (search) {
    conditions.push(or(
      ilike(paymentLinksTable.title, `%${search}%`),
      ilike(paymentLinksTable.slug, `%${search}%`),
    )!);
  }
  if (merchantName && user.role === "admin") {
    merchantConditions.push(ilike(merchantsTable.businessName, `%${merchantName}%`));
  }

  const allConditions = [...conditions, ...merchantConditions];
  const where = allConditions.length > 0 ? and(...allConditions) : undefined;

  const countRows = await db.select({ total: count() })
    .from(paymentLinksTable)
    .leftJoin(merchantsTable, eq(paymentLinksTable.merchantId, merchantsTable.id))
    .where(where);
  const total = countRows[0].total;

  const rows = await db.select({
    link: paymentLinksTable,
    merchantName: merchantsTable.businessName,
    paymentCount: sql<number>`(SELECT COUNT(*) FROM transactions WHERE payment_link_id = ${paymentLinksTable.id})::int`,
  })
    .from(paymentLinksTable)
    .leftJoin(merchantsTable, eq(paymentLinksTable.merchantId, merchantsTable.id))
    .where(where)
    .limit(limitNum).offset(offset)
    .orderBy(desc(paymentLinksTable.createdAt));

  res.json({
    data: rows.map(r => serializeLink(r.link, r.merchantName, req, Number(r.paymentCount))),
    total, page: pageNum, limit: limitNum,
  });
});

// GET /api/payment-links/:id
router.get("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);

  const conds = [eq(paymentLinksTable.id, id)];
  if (user.role !== "admin") conds.push(eq(paymentLinksTable.merchantId, user.merchantId!));

  const rows = await db.select({
    link: paymentLinksTable,
    merchantName: merchantsTable.businessName,
    paymentCount: sql<number>`(SELECT COUNT(*) FROM transactions WHERE payment_link_id = ${paymentLinksTable.id})::int`,
  })
    .from(paymentLinksTable)
    .leftJoin(merchantsTable, eq(paymentLinksTable.merchantId, merchantsTable.id))
    .where(and(...conds))
    .limit(1);

  if (!rows.length) { res.status(404).json({ error: "Payment link not found" }); return; }
  res.json(serializeLink(rows[0].link, rows[0].merchantName, req, Number(rows[0].paymentCount)));
});

// POST /api/payment-links
router.post("/", async (req, res) => {
  const user = (req as any).user;
  const merchantId = user.merchantId!;
  const { title, description, amount, maxPayments, expiresAt, callbackUrl } = req.body;

  if (!title) { res.status(400).json({ error: "title is required" }); return; }

  const limitCheck = await checkPlanLimit(merchantId, "paymentLink", user.id);
  if (!limitCheck.allowed) { rejectWithLimitError(res, limitCheck.message!); return; }

  const connections = await db.select()
    .from(merchantConnectionsTable)
    .where(and(eq(merchantConnectionsTable.merchantId, merchantId), eq(merchantConnectionsTable.isActive, true)))
    .limit(10);

  const sorted = [...connections].sort(a => a.provider === "upi_id" ? -1 : 1);
  let vpa: string | null = null;
  for (const conn of sorted) {
    vpa = deriveVpa(conn.provider, conn.credentials ?? null);
    if (vpa) break;
  }

  const [merchant] = await db.select({ businessName: merchantsTable.businessName })
    .from(merchantsTable).where(eq(merchantsTable.id, merchantId)).limit(1);
  const merchantName = merchant?.businessName ?? "Merchant";

  const upiPayload = vpa ? buildUpiPayload(vpa, merchantName, amount ?? null, title ?? null) : null;

  let slug = generateSlug();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await db.select({ id: paymentLinksTable.id }).from(paymentLinksTable)
      .where(eq(paymentLinksTable.slug, slug)).limit(1);
    if (!existing.length) break;
    slug = generateSlug();
    attempts++;
  }

  const [row] = await db.insert(paymentLinksTable).values({
    merchantId,
    title,
    description: description ?? null,
    amount: amount ?? null,
    currency: "INR",
    slug,
    upiPayload,
    status: "active",
    maxPayments: maxPayments != null ? parseInt(maxPayments) : null,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    callbackUrl: callbackUrl ?? null,
  }).returning();

  res.status(201).json(serializeLink(row, merchantName, req, 0));
});

// PUT /api/payment-links/:id
router.put("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);
  const { title, description, amount, status, maxPayments, expiresAt, callbackUrl } = req.body;

  const update: Record<string, unknown> = {};
  if (title !== undefined) update.title = title;
  if (description !== undefined) update.description = description;
  if (amount !== undefined) update.amount = amount;
  if (status !== undefined) update.status = status;
  if (maxPayments !== undefined) update.maxPayments = maxPayments != null ? parseInt(maxPayments) : null;
  if (expiresAt !== undefined) update.expiresAt = expiresAt ? new Date(expiresAt) : null;
  if (callbackUrl !== undefined) update.callbackUrl = callbackUrl;

  const conds = [eq(paymentLinksTable.id, id)];
  if (user.role !== "admin") conds.push(eq(paymentLinksTable.merchantId, user.merchantId!));

  const [row] = await db.update(paymentLinksTable).set(update).where(and(...conds)).returning();
  if (!row) { res.status(404).json({ error: "Payment link not found" }); return; }

  const [pcRow] = await db.select({ total: count() }).from(transactionsTable)
    .where(eq(transactionsTable.paymentLinkId, id));
  res.json(serializeLink(row, null, req, pcRow?.total ?? 0));
});

// DELETE /api/payment-links/:id
router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params["id"] as string);
  const conds = [eq(paymentLinksTable.id, id)];
  if (user.role !== "admin") conds.push(eq(paymentLinksTable.merchantId, user.merchantId!));
  await db.delete(paymentLinksTable).where(and(...conds));
  res.json({ message: "Payment link deleted" });
});

export default router;
