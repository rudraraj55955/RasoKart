import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import merchantsRouter from "./merchants";
import transactionsRouter from "./transactions";
import withdrawalsRouter from "./withdrawals";
import payoutBeneficiariesRouter from "./payoutBeneficiaries";
import apiKeysRouter from "./apiKeys";
import webhooksRouter from "./webhooks";
import callbacksRouter from "./callbacks";
import settlementsRouter from "./settlements";
import usersRouter from "./users";
import productsRouter from "./products";
import connectionsRouter from "./connections";
import plansRouter from "./plans";
import qrCodesRouter from "./qrCodes";
import virtualAccountsRouter from "./virtualAccounts";
import apiMonitoringRouter from "./apiMonitoring";
import auditLogsRouter from "./auditLogs";
import featureControlRouter from "./featureControl";
import accountDetailsRouter from "./accountDetails";
import invoicesRouter from "./invoices";
import ledgerRouter from "./ledger";
import providersRouter from "./providers";
import notificationsRouter from "./notifications";
import reconciliationRouter from "./reconciliation";
import paymentLinksRouter from "./paymentLinks";
import systemConfigRouter from "./systemConfig";
import companySettingsRouter from "./companySettings";
import settingsRouter from "./settings";
import storageRouter from "./storage";
import savedFiltersRouter from "./savedFilters";
import merchantSavedFiltersRouter from "./merchantSavedFilters";
import githubSyncRouter from "./githubSync";
import securityRouter from "./security";
import paymentWebhookRouter from "./paymentWebhook";
import ekqrRouter from "./ekqr";
import cashfreeWebhookRouter from "./cashfreeWebhook";
import cashfreeOrdersRouter from "./cashfreeOrders";
import cashfreePayoutRouter from "./cashfreePayout";
import cashfreePayoutWebhookRouter from "./cashfreePayoutWebhook";
import payinOrdersRouter from "./payinOrders";
import payinWebhookRouter from "./payinWebhook";
import payinCustomWebhookRouter from "./payinCustomWebhook";
import adminPayinOrdersRouter from "./adminPayinOrders";
import adminPayinGatewayDebugRouter from "./adminPayinGatewayDebug";
import providerIntegrationsRouter from "./providerIntegrations";
import upiGatewaysRouter from "./upiGateways";
import rasokartServicesRouter from "./rasokartServices";
import otpSettingsRouter from "./otpSettings";
import otpEmailSettingsRouter from "./otpEmailSettings";
import smsLogsRouter from "./smsLogs";
import onboardingRouter from "./onboarding";
import adminOnboardingRouter from "./adminOnboarding";
import secureIdSettingsRouter from "./secureIdSettings";
import merchantKycRouter from "./merchantKyc";
import adminMerchantKycRouter from "./adminMerchantKyc";
import merchantKycSettingsRouter from "./merchantKycSettings";
import payoutMerchantRouter from "./payoutMerchant";
import payoutMerchantKycRouter from "./payoutMerchantKyc";
import adminPayoutMerchantsRouter from "./adminPayoutMerchants";
import adminPayoutSettingsRouter from "./adminPayoutSettings";
import payoutAdminRouter from "./payoutAdmin";
import agentRoutesRouter from "./agentRoutes";
import payoutWalletLoadRouter from "./payoutWalletLoad";
import adminPayoutWalletLoadsRouter from "./adminPayoutWalletLoads";
import adminPayoutAdminsRouter from "./adminPayoutAdmins";
import smartRoutingRouter from "./smartRouting";
import moduleControlRouter from "./moduleControl";
import merchantModuleStatusRouter from "./merchantModuleStatus";
import walletsRouter from "./wallets";
import kycRouter from "./kyc";
import reportsRouter from "./reports";
import supportRouter from "./support";
import verificationRouter from "./verification";
import upigatewaySettingsRouter from "./upigatewaySettings";
import upigatewayWebhookRouter from "./upigatewayWebhook";
import utrVerificationsRouter from "./utrVerifications";
import payinChargesRouter from "./payinCharges";
import platformProfitRouter from "./platformProfit";
import publicPayoutSlipRouter from "./publicPayoutSlip";
import dummyDataCleanupRouter from "./dummyDataCleanup";
import accountStatementRouter from "./accountStatement";
import tryItPresetsRouter from "./tryItPresets";
import adminTryItPresetsRouter from "./adminTryItPresets";
import razorpayOrdersRouter from "./razorpayOrders";
import razorpayWebhookRouter from "./razorpayWebhook";
import adminRazorpayRouter from "./adminRazorpay";
import payoutMerchantSignupRouter from "./payoutMerchantSignup";
import socialProvidersRouter from "./socialProviders";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
// Top-level alias: some deploy configs / older frontend builds call
// `/api/merchant/login` directly. Mounts the same authRouter so
// `/api/merchant/login` and `/api/merchant/merchant/login` both resolve —
// the canonical path remains `/api/auth/login` (see routes/auth.ts).
router.use("/merchant", authRouter);
router.use("/dashboard", dashboardRouter);
router.use("/merchants", merchantsRouter);
router.use("/transactions", transactionsRouter);
router.use("/withdrawals", withdrawalsRouter);
router.use("/payout-beneficiaries", payoutBeneficiariesRouter);
router.use("/api-keys", apiKeysRouter);
// Public payout webhook alias — must come BEFORE /webhooks (which has global requireAuth)
router.use("/webhooks/payouts/cashfree", cashfreePayoutWebhookRouter);
// Public payin webhook — must come BEFORE /webhooks (which has global requireAuth)
router.use("/webhooks/payin", payinWebhookRouter);
// Public generic custom-gateway payin webhook — same reason as above.
router.use("/webhooks/payin/custom", payinCustomWebhookRouter);
// Public UPIGateway payin webhook — must come BEFORE /webhooks (which has global requireAuth)
router.use("/webhooks/upigateway", upigatewayWebhookRouter);
// Public Razorpay payin webhook — must come BEFORE /webhooks (which has global requireAuth)
router.use("/webhooks", razorpayWebhookRouter);
router.use("/webhooks", webhooksRouter);
router.use("/callbacks", callbacksRouter);
router.use("/settlements", settlementsRouter);
router.use("/users", usersRouter);
router.use("/products", productsRouter);
router.use("/connections", connectionsRouter);
router.use("/plans", plansRouter);
router.use("/qr-codes", qrCodesRouter);
router.use("/virtual-accounts", virtualAccountsRouter);
router.use("/api-monitoring", apiMonitoringRouter);
router.use("/audit-logs", auditLogsRouter);
router.use("/feature-control", featureControlRouter);
router.use("/account-details", accountDetailsRouter);
router.use("/invoices", invoicesRouter);
router.use("/ledger", ledgerRouter);
router.use("/providers", providersRouter);
router.use("/notifications", notificationsRouter);
router.use("/reconciliation", reconciliationRouter);
router.use("/payment-links", paymentLinksRouter);
router.use("/system-config", systemConfigRouter);
router.use(companySettingsRouter);
router.use("/settings", settingsRouter);
router.use(storageRouter);
router.use("/saved-filters", savedFiltersRouter);
router.use("/merchant/saved-filters", merchantSavedFiltersRouter);
router.use("/github-sync", githubSyncRouter);
router.use("/security", securityRouter);
router.use("/payment", paymentWebhookRouter);
router.use("/payment", cashfreeWebhookRouter);
router.use("/ekqr", ekqrRouter);
router.use("/merchant", cashfreeOrdersRouter);
router.use("/merchant", payinOrdersRouter);
router.use("/admin/payin", adminPayinOrdersRouter);
router.use("/admin/payin-gateway", adminPayinGatewayDebugRouter);
// Payout webhook — public, no auth — must be mounted BEFORE the auth-guarded cashfree-payout router
router.use("/cashfree-payout/webhook", cashfreePayoutWebhookRouter);
router.use("/cashfree-payout", cashfreePayoutRouter);
router.use("/provider-integrations", providerIntegrationsRouter);
router.use("/admin/upi-gateways", upiGatewaysRouter);
router.use("/admin/upigateway", upigatewaySettingsRouter);
router.use("/merchant", rasokartServicesRouter);
router.use("/smart-routing", smartRoutingRouter);
router.use("/module-control", moduleControlRouter);
router.use("/merchant", merchantModuleStatusRouter);
router.use("/wallets", walletsRouter);
router.use("/kyc", kycRouter);
router.use("/reports", reportsRouter);
router.use("/support", supportRouter);
router.use("/verification", verificationRouter);
router.use("/admin/utr-verifications", utrVerificationsRouter);
router.use("/admin/payin-charges", payinChargesRouter);
router.use("/admin/platform-profit", platformProfitRouter);
// Account statement — merchant own + admin any-merchant
router.use("/account-statement", accountStatementRouter);
router.use("/merchant/tryit-presets", tryItPresetsRouter);
router.use("/admin/tryit-presets", adminTryItPresetsRouter);
// Admin OTP/SMS settings, Email OTP settings, and SMS delivery logs
router.use("/admin/otp-settings", otpSettingsRouter);
router.use("/admin/otp-email-settings", otpEmailSettingsRouter);
router.use("/admin/sms-logs", smsLogsRouter);
// Merchant automated onboarding (Secure ID flow)
router.use("/onboarding", onboardingRouter);
router.use("/admin/onboarding", adminOnboardingRouter);
router.use("/admin/secure-id-settings", secureIdSettingsRouter);
router.use("/merchant-kyc", merchantKycRouter);
router.use("/admin/merchant-kyc-settings", merchantKycSettingsRouter);
router.use("/admin/merchant-kyc", adminMerchantKycRouter);

// Payout merchant module — merchant-facing config, payouts + KYC + admin management
// Public self-registration — must be mounted BEFORE the auth-guarded payout-merchant router
router.use("/payout-merchant", payoutMerchantSignupRouter);
router.use("/payout-merchant/kyc", payoutMerchantKycRouter);
router.use("/payout-merchant", payoutMerchantRouter);
router.use("/admin/payout-merchants", adminPayoutMerchantsRouter);
router.use("/admin/payout-settings", adminPayoutSettingsRouter);

// Payout admin portal — payout admins managing payout ops
router.use("/payout-admin", payoutAdminRouter);

// Agent portal — agents managing their referred payout merchants
router.use("/agent", agentRoutesRouter);

// Admin CRUD for payout admins and agents
router.use("/admin/payout-admins", adminPayoutAdminsRouter);

// Payout wallet load — merchant-facing + admin management
router.use("/payout-merchant", payoutWalletLoadRouter);
router.use("/admin/payout-wallet-loads", adminPayoutWalletLoadsRouter);

// Public payout slip — token-authenticated, no session required; mount last to avoid path conflicts
router.use("/public/payout-slip", publicPayoutSlipRouter);

// Data Hygiene — Super Admin only dummy/demo data detection + cleanup
router.use("/admin/dummy-data-cleanup", dummyDataCleanupRouter);

// Merchant-facing Razorpay routes (create-order, verify-payment, status)
router.use("/merchant", razorpayOrdersRouter);
// Admin Razorpay config, orders, webhook-logs — Super Admin only
router.use("/admin/razorpay", adminRazorpayRouter);

// Social provider admin toggles (Super Admin CRUD)
router.use("/auth/social-providers", socialProvidersRouter);

export default router;
