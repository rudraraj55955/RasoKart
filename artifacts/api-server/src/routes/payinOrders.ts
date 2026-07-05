import { Router } from "express";
import { db, cashfreePaymentOrdersTable, providerIntegrationsTable, PAYIN_ORDER_STATUS } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { cashfreeCreateOrder, cashfreeGetOrder } from "../helpers/cashfree";
import { decryptSecret } from "../helpers/cryptoUtils";
import { requireAuth } from "../middlewares/auth";
import { loadPayinConfig } from "../helpers/payinConfig";
import { ensurePayinOrdersSchemaGuard } from "../helpers/payinSchemaGuard";
import { getMerchantDailyPaidTotal } from "../helpers/payinDailyLimit";
import { insertPayinOrderWithFallback } from "../helpers/payinOrderInsert";
import { selectProvider, recordRoutingResult } from "../helpers/smartRouter";
import { createCustomGatewayOrder } from "../helpers/customGatewayClient";

const router = Router();

// providerKey values reserved for the built-in Cashfree payin flow — a smart
// routing rule using one of these just re-selects the existing hardcoded path.
const CASHFREE_PROVIDER_KEYS = new Set(["cashfree_payin", "cashfree"]);

// ─────────────────────────────────────────────────────────────────────────────
// White-label merchant Payin routes (RasoKart UPI Deposit).
// No "Cashfree", cf_order_id, payment_session_id, or raw provider payloads are
// ever exposed here — only RasoKart-branded fields.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/merchant/payin/status
 * White-label: whether RasoKart UPI deposits are available to this merchant.
 */
router.get("/payin/status", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }
    const cfg = await loadPayinConfig();
    res.json({
      enabled: cfg.enabled && cfg.upiEnabled && cfg.merchantPayinEnabled,
      minAmount: cfg.minAmount,
      maxAmount: cfg.maxAmount,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/merchant/payin/orders
 * Creates a RasoKart UPI deposit order. Enforces admin-configured min/max/daily limits.
 * Response never includes cf_order_id, payment_session_id, or raw provider fields.
 */
router.post("/payin/orders", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const merchantId: number | undefined = user?.merchantId;

  // Generic, safe response used for every failure path below — never leaks
  // raw SQL/DB errors, provider responses, or internal identifiers.
  const genericFailure = () => {
    res.status(500).json({ error: "Deposit order could not be created. Please try again." });
  };

  try {
    if (user.role !== "merchant" || !merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }

    req.log.info({ event: "payin_deposit_create_started", merchantId }, "payin_deposit_create_started");

    req.log.info({ event: "payin_schema_guard_started", merchantId }, "payin_schema_guard_started");
    try {
      await ensurePayinOrdersSchemaGuard();
      req.log.info({ event: "payin_schema_guard_success", merchantId }, "payin_schema_guard_success");
    } catch (guardErr) {
      req.log.error({ event: "payin_schema_guard_failed", merchantId }, "payin_schema_guard_failed");
      genericFailure();
      return;
    }

    const { amount, customerPhone, customerName, customerEmail } = req.body as {
      amount?: number;
      customerPhone?: string;
      customerName?: string;
      customerEmail?: string;
    };

    const depositAmount = Number(amount);
    if (!amount || isNaN(depositAmount) || depositAmount <= 0) {
      res.status(400).json({ error: "Valid amount is required" });
      return;
    }
    if (!customerPhone) {
      res.status(400).json({ error: "Customer phone is required" });
      return;
    }

    const cfg = await loadPayinConfig();
    if (!cfg.enabled || !cfg.upiEnabled || !cfg.merchantPayinEnabled) {
      res.status(400).json({ error: "UPI deposits are not available right now. Please try again later." });
      return;
    }
    if (depositAmount < cfg.minAmount || depositAmount > cfg.maxAmount) {
      res.status(400).json({ error: `Amount must be between ₹${cfg.minAmount} and ₹${cfg.maxAmount}` });
      return;
    }

    // Daily limit check — sum of this merchant's PAID payin orders "today".
    // Uses paid_at when present; older rows from before paid_at was populated
    // fall back to created_at so the query never crashes or silently under/
    // over-counts on a partially-migrated table. COALESCE(SUM(...), 0) plus
    // the `?? 0` below guarantees a safe numeric result even when zero rows
    // match (fresh merchant, empty table, etc) — this must never throw.
    req.log.info({ event: "payin_daily_limit_check_started", merchantId }, "payin_daily_limit_check_started");
    let dailyTotal: number;
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      dailyTotal = await getMerchantDailyPaidTotal(merchantId, startOfDay);
      req.log.info({ event: "payin_daily_limit_check_success", merchantId, dailyTotal }, "payin_daily_limit_check_success");
    } catch (limitErr) {
      req.log.error({ event: "payin_daily_limit_check_failed", merchantId }, "payin_daily_limit_check_failed");
      genericFailure();
      return;
    }

    if (dailyTotal + depositAmount > cfg.dailyLimit) {
      res.status(400).json({ error: "Daily deposit limit reached. Please try again tomorrow or contact support." });
      return;
    }

    // ── Smart routing: if an enabled routing config/rule points at an
    // admin-added custom gateway, dispatch there instead of the hardcoded
    // Cashfree path. No decision, or a decision naming the reserved
    // cashfree_payin/cashfree key, falls straight through to Cashfree below —
    // this keeps existing behavior unchanged for merchants with no rules set up.
    req.log.info({ event: "payin_smart_routing_select_started", merchantId }, "payin_smart_routing_select_started");
    const routingDecision = await selectProvider(
      { merchantId, amount: depositAmount, paymentMode: "upi", logger: req.log },
    ).catch((routingErr) => {
      req.log.warn({ event: "payin_smart_routing_select_failed", merchantId }, "payin_smart_routing_select_failed");
      return null;
    });

    if (routingDecision && !CASHFREE_PROVIDER_KEYS.has(routingDecision.providerKey)) {
      const [integration] = await db.select().from(providerIntegrationsTable)
        .where(and(
          eq(providerIntegrationsTable.providerKey, routingDecision.providerKey),
          eq(providerIntegrationsTable.isEnabled, true),
        )).limit(1);

      if (integration) {
        const publicOrderId = `RKPAYIN_${merchantId}_${Date.now()}`;
        const startedAt = Date.now();
        const gatewayResult = await createCustomGatewayOrder(integration, {
          publicOrderId,
          amount: depositAmount,
          currency: "INR",
          customerPhone,
          customerEmail: customerEmail ?? null,
          customerName: customerName ?? null,
          note: "RasoKart UPI Deposit",
        });
        const responseTimeMs = Date.now() - startedAt;

        if (gatewayResult.ok && gatewayResult.providerOrderId) {
          try {
            await db.insert(cashfreePaymentOrdersTable).values({
              merchantId,
              publicOrderId,
              providerKey: routingDecision.providerKey,
              cashfreeOrderId: gatewayResult.providerOrderId,
              paymentSessionId: gatewayResult.paymentUrl ?? gatewayResult.providerOrderId,
              amount: depositAmount.toFixed(2),
              currency: "INR",
              status: PAYIN_ORDER_STATUS.CREATED,
              paymentMethod: "upi",
              customerPhone,
              customerEmail: customerEmail ?? null,
              rawPayload: gatewayResult.raw ?? null,
            }).onConflictDoNothing();
          } catch (insertErr) {
            req.log.error({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "db_insert_failed" }, "payin_deposit_order_create_failed");
            await recordRoutingResult({ routingLogId: routingDecision.routingLogId, providerKey: routingDecision.providerKey, result: "failed", responseTimeMs, errorMessage: "db_insert_failed" });
            genericFailure();
            return;
          }

          await recordRoutingResult({
            routingLogId: routingDecision.routingLogId,
            providerKey: routingDecision.providerKey,
            result: "success",
            responseTimeMs,
            publicReferenceId: publicOrderId,
            providerReferenceId: gatewayResult.providerOrderId,
          });

          req.log.info({ event: "payin_deposit_order_created", merchantId, amount: depositAmount, routedVia: "custom_gateway" }, "payin_deposit_order_created");

          // Custom gateways are dispatched via arbitrary HTTP endpoints — only
          // treat the returned value as a checkout URL if it is actually an
          // absolute http(s) URL; a bare provider order id is never usable
          // as a checkout destination.
          const customCheckoutUrl =
            gatewayResult.paymentUrl && /^https?:\/\//i.test(gatewayResult.paymentUrl)
              ? gatewayResult.paymentUrl
              : null;

          {
            const safeToken = gatewayResult.paymentUrl ?? gatewayResult.providerOrderId;
            const safeMessage = "Deposit order created. Complete the payment via UPI to add funds to your wallet.";
            res.json({
              publicOrderId,
              paymentToken: safeToken,
              paymentSessionId: safeToken,
              checkoutUrl: customCheckoutUrl,
              amount: depositAmount,
              status: PAYIN_ORDER_STATUS.CREATED,
              checkoutLabel: "RasoKart Secure Checkout",
              message: safeMessage,
              safeMessage,
            });
          }
          return;
        }

        // Custom gateway attempt failed — record it and fall through to the
        // hardcoded Cashfree path below only when fallback is expected
        // (routing rules always allow a single hardcoded fallback attempt).
        req.log.warn({ event: "payin_custom_gateway_dispatch_failed", merchantId, providerKey: routingDecision.providerKey }, "payin_custom_gateway_dispatch_failed");
        await recordRoutingResult({
          routingLogId: routingDecision.routingLogId,
          providerKey: routingDecision.providerKey,
          result: "failed",
          responseTimeMs,
          errorMessage: gatewayResult.errorMessage ?? "Custom gateway order creation failed",
        });
      } else {
        req.log.warn({ event: "payin_custom_gateway_not_found", merchantId, providerKey: routingDecision.providerKey }, "payin_custom_gateway_not_found");
        await recordRoutingResult({ routingLogId: routingDecision.routingLogId, providerKey: routingDecision.providerKey, result: "skipped", errorMessage: "Integration not found or disabled" });
      }
    } else if (routingDecision) {
      // Routing selected the built-in Cashfree provider — record success once the
      // hardcoded flow below actually succeeds (handled after order creation).
    }

    if (!cfg.clientId || !cfg.rawClientSecret) {
      res.status(400).json({ error: "UPI deposits are not available right now. Please try again later." });
      return;
    }
    const decrypted = decryptSecret(cfg.rawClientSecret);
    if (!decrypted.ok || !decrypted.value.trim()) {
      req.log.warn({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "decrypt_failed" }, "payin_deposit_order_create_failed");
      genericFailure();
      return;
    }

    const publicOrderId = `RKPAYIN_${merchantId}_${Date.now()}`;

    let raw: string;
    let parsed: Awaited<ReturnType<typeof cashfreeCreateOrder>>["parsed"];
    req.log.info({ event: "payin_provider_create_order_started", merchantId }, "payin_provider_create_order_started");
    try {
      ({ raw, parsed } = await cashfreeCreateOrder(cfg.clientId, decrypted.value, cfg.env, {
        order_id: publicOrderId,
        order_amount: depositAmount,
        order_currency: "INR",
        customer_details: {
          customer_id: `merchant-${merchantId}`,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
        },
        order_note: "RasoKart UPI Deposit",
      }, { baseUrl: cfg.baseUrl, apiVersion: cfg.apiVersion }));
      req.log.info({ event: "payin_provider_create_order_success", merchantId }, "payin_provider_create_order_success");
    } catch (providerErr) {
      req.log.error({ event: "payin_provider_create_order_failed", merchantId, safeReason: "provider_request_error" }, "payin_provider_create_order_failed");
      req.log.error({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "provider_request_error" }, "payin_deposit_order_create_failed");
      genericFailure();
      return;
    }

    if (!parsed.payment_session_id) {
      req.log.warn({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "provider_no_session_id" }, "payin_deposit_order_create_failed");
      res.status(502).json({ error: "Unable to start deposit right now. Please try again." });
      return;
    }

    const insertResult = await insertPayinOrderWithFallback({
      merchantId,
      publicOrderId,
      cashfreeOrderId: parsed.order_id ?? publicOrderId,
      paymentSessionId: parsed.payment_session_id,
      amount: depositAmount.toFixed(2),
      customerPhone,
      customerEmail: customerEmail ?? null,
      rawPayload: raw,
    }, req.log);

    if (!insertResult.ok) {
      req.log.error({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "db_insert_failed" }, "payin_deposit_order_create_failed");
      genericFailure();
      return;
    }

    req.log.info({ event: "payin_deposit_order_created", merchantId, amount: depositAmount }, "payin_deposit_order_created");

    if (routingDecision && CASHFREE_PROVIDER_KEYS.has(routingDecision.providerKey)) {
      await recordRoutingResult({
        routingLogId: routingDecision.routingLogId,
        providerKey: routingDecision.providerKey,
        result: "success",
        publicReferenceId: publicOrderId,
        providerReferenceId: parsed.order_id ?? publicOrderId,
      });
    }

    // checkoutUrl / paymentToken point to our own branded checkout — never expose provider internals.
    const checkoutEnv = cfg.env === "live" ? "prod" : "sandbox";
    const checkoutUrl = `/checkout?token=${encodeURIComponent(parsed.payment_session_id)}&env=${checkoutEnv}&amount=${encodeURIComponent(depositAmount.toFixed(2))}`;

    const cashfreeSafeMessage = "Deposit order created. Complete the payment via UPI to add funds to your wallet.";
    res.json({
      publicOrderId,
      paymentToken: parsed.payment_session_id,
      paymentSessionId: parsed.payment_session_id,
      checkoutUrl,
      amount: depositAmount,
      status: PAYIN_ORDER_STATUS.CREATED,
      checkoutLabel: "RasoKart Secure Checkout",
      message: cashfreeSafeMessage,
      safeMessage: cashfreeSafeMessage,
    });
  } catch (err) {
    req.log.error({ event: "payin_deposit_order_create_failed", merchantId, safeReason: "unexpected_error" }, "payin_deposit_order_create_failed");
    genericFailure();
  }
});

/**
 * GET /api/merchant/payin/orders/:publicOrderId
 * White-label status check. UTR is only ever included once status is "paid".
 */
router.get("/payin/orders/:publicOrderId", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.role !== "merchant" || !user.merchantId) {
      res.status(403).json({ error: "Merchant access only" });
      return;
    }
    const publicOrderId = req.params["publicOrderId"] as string;

    const [order] = await db
      .select()
      .from(cashfreePaymentOrdersTable)
      .where(and(
        eq(cashfreePaymentOrdersTable.publicOrderId, publicOrderId),
        eq(cashfreePaymentOrdersTable.merchantId, user.merchantId),
      ))
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "Deposit order not found" });
      return;
    }

    // Optionally refresh status from provider if still pending (best-effort, never surfaces raw errors).
    if (order.status === PAYIN_ORDER_STATUS.CREATED || order.status === PAYIN_ORDER_STATUS.PENDING) {
      try {
        const cfg = await loadPayinConfig();
        if (cfg.clientId && cfg.rawClientSecret) {
          const decrypted = decryptSecret(cfg.rawClientSecret);
          if (decrypted.ok && decrypted.value.trim()) {
            const { parsed } = await cashfreeGetOrder(cfg.clientId, decrypted.value, cfg.env, order.cashfreeOrderId, { baseUrl: cfg.baseUrl, apiVersion: cfg.apiVersion });
            const providerStatus = (parsed.order_status ?? "").toUpperCase();
            if (providerStatus === "ACTIVE") {
              // still pending — no change
            } else if (providerStatus && providerStatus !== "PAID") {
              await db.update(cashfreePaymentOrdersTable)
                .set({ rawProviderStatus: providerStatus })
                .where(eq(cashfreePaymentOrdersTable.id, order.id));
            }
          }
        }
      } catch {
        // Best-effort refresh only; webhook remains source of truth for "paid".
      }
    }

    const [fresh] = await db
      .select()
      .from(cashfreePaymentOrdersTable)
      .where(eq(cashfreePaymentOrdersTable.id, order.id))
      .limit(1);

    const isPaid = fresh?.status === PAYIN_ORDER_STATUS.PAID;
    res.json({
      publicOrderId,
      amount: Number(fresh?.amount ?? order.amount),
      status: fresh?.status ?? order.status,
      utr: isPaid ? (fresh?.utr ?? null) : null,
      paidAt: isPaid ? fresh?.paidAt ?? null : null,
      createdAt: fresh?.createdAt ?? order.createdAt,
    });
  } catch (err) {
    req.log.error({ event: "payin_order_status_check_failed" }, "payin_order_status_check_failed");
    res.status(500).json({ error: "Unable to check deposit status. Please try again." });
  }
});

export default router;
