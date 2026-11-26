export interface ServerReadiness {
  account: { status: string; profileComplete: boolean; };
  contact: { emailVerified: boolean; mobileVerified: boolean; complete: boolean; };
  kyc: { status: "approved" | "rejected" | "pending" | "not_started"; documents: Array<{ docType: string; status: string }>; };
  plan: { assigned: boolean; status: string | null; planId: number | null; planName: string | null; expiresAt: string | null; isExpired: boolean; apiAccess: boolean; webhookAccess: boolean; providerAccess: boolean; };
  provider: { configured: boolean; active: boolean; connectionStatus: string | null; lastTestResult: string | null; lastTestedAt: string | null; capabilityPayin: boolean; };
  apiKey: { active: boolean; count: number; lastUsedAt: string | null; };
  callback: { configured: boolean; verificationStatus: "verified" | "unverified" | "not_configured"; lastVerifiedAt: string | null; required: boolean; apiKeyRequired: boolean; };
  collection: { enabled: boolean; live: boolean; state: "live" | "paused_historical_only" | "paused"; historicalDeposits: { count: number; totalAmount: string | number; }; };
  testPayment: { supported: boolean; status: "successful" | "incomplete" | "unsupported"; lastStatus: string | null; lastAt: string | null; };
  goLive: { eligible: boolean; blockers: string[]; nextStep: string | null; checkedAt: string; };
}

export interface ReadinessAction {
  id: string;
  label: string;
  description: string;
  href: string;
  cta: string;
}

export interface ReadinessStep {
  id: string;
  label: string;
  isCompleted: boolean;
  isOptional: boolean;
  statusText?: string;
}

export interface MerchantReadinessUI {
  isReady: boolean;
  priorityAction: ReadinessAction | null;
  summary: {
    completedSteps: number;
    totalSteps: number;
  };
  steps: ReadinessStep[];
  collectionState: "live" | "paused_historical_only" | "paused";
  canUseFeature: (feature: string) => { allowed: boolean; reason?: string; };
  serverData: ServerReadiness;
}

export function mapServerReadiness(serverData: ServerReadiness): MerchantReadinessUI {
  const kycSubmitted = serverData.kyc.status !== "not_started";
  const kycApproved = serverData.kyc.status === "approved";
  const planActive = serverData.plan.assigned && serverData.plan.status === "active" && !serverData.plan.isExpired;
  const providerActive = serverData.provider.active;
  const providerConfigured = serverData.provider.configured;
  const apiKeyRequired = serverData.callback.apiKeyRequired;
  const callbackRequired = serverData.callback.required;
  const callbackVerified = serverData.callback.verificationStatus === "verified";
  const testPaymentSuccessful = serverData.testPayment.status === "successful";
  const serviceLive = serverData.goLive.eligible && serverData.collection.live;
  const providerPrerequisitesMet = kycApproved && serverData.account.status === "approved"
    && serverData.contact.complete && planActive;
  const integrationPrerequisitesMet = providerPrerequisitesMet && providerActive;

  const steps: ReadinessStep[] = [
    {
      id: "account",
      label: "Account Created",
      isCompleted: serverData.account.profileComplete,
      isOptional: false,
      statusText: serverData.account.profileComplete ? undefined : "Profile incomplete",
    },
    {
      id: "contact",
      label: "Contact Verified",
      isCompleted: serverData.contact.complete,
      isOptional: false,
      statusText: serverData.contact.complete ? undefined : "Email and mobile verification required",
    },
    {
      id: "kyc_submission",
      label: "KYC Submitted",
      isCompleted: kycSubmitted,
      isOptional: false,
      statusText: serverData.kyc.status === "rejected" ? "Action required" : undefined,
    },
    {
      id: "kyc_approval",
      label: "KYC Approved",
      isCompleted: kycApproved,
      isOptional: false,
      statusText: kycSubmitted && !kycApproved && serverData.kyc.status !== "rejected" ? "Pending review" : undefined,
    },
    {
      id: "plan",
      label: "Plan Active",
      isCompleted: providerPrerequisitesMet,
      isOptional: false,
      statusText: serverData.plan.isExpired ? "Expired" : !serverData.plan.assigned ? "Not assigned" : undefined,
    },
    {
      id: "provider",
      label: "Provider Connected",
      isCompleted: integrationPrerequisitesMet,
      isOptional: false,
      statusText: providerConfigured && !providerPrerequisitesMet
        ? "Configured — inactive"
        : providerConfigured && !providerActive
          ? "Connection or test incomplete"
          : undefined,
    },
  ];

  if (apiKeyRequired) {
    steps.push({
      id: "api_key",
      label: "API Key Active",
      isCompleted: integrationPrerequisitesMet && serverData.apiKey.active,
      isOptional: false,
      statusText: serverData.apiKey.active && !integrationPrerequisitesMet ? "Configured — inactive" : undefined,
    });
  }

  if (callbackRequired) {
    steps.push({
      id: "callback",
      label: "Callback Verified",
      isCompleted: integrationPrerequisitesMet && (!apiKeyRequired || serverData.apiKey.active) && callbackVerified,
      isOptional: false,
      statusText: serverData.callback.configured && !integrationPrerequisitesMet
        ? "Configured — inactive"
        : serverData.callback.configured && !callbackVerified
          ? "Verification incomplete"
          : undefined,
    });
  }

  steps.push(
    {
      id: "test_payment",
      label: "Test Payment",
      isCompleted: integrationPrerequisitesMet
        && (!apiKeyRequired || serverData.apiKey.active)
        && (!callbackRequired || callbackVerified)
        && testPaymentSuccessful,
      isOptional: false,
      statusText: serverData.testPayment.supported ? undefined : "Evidence unavailable — not assumed complete",
    },
    {
      id: "service_live",
      label: "Service Live",
      isCompleted: serviceLive,
      isOptional: false,
      statusText: serverData.collection.state === "paused_historical_only" ? "Paused — historical data only" : undefined,
    },
  );

  const actions: Record<string, ReadinessAction> = {
    kyc_not_submitted: { id: "kyc_submit", label: "Submit KYC Documents", description: "Submit your verification documents to continue.", href: "/merchant/verification", cta: "Start KYC" },
    kyc_not_approved: serverData.kyc.status === "rejected"
      ? { id: "kyc_rejected", label: "KYC Action Required", description: "One or more KYC documents need to be resubmitted.", href: "/merchant/verification", cta: "Fix Now" }
      : { id: "kyc_pending", label: "KYC Review Pending", description: "Your submitted documents are still under review.", href: "/merchant/verification", cta: "View Status" },
    account_not_approved: { id: "account_pending", label: "Account Approval Pending", description: "Your merchant account is not approved yet.", href: "/merchant/profile", cta: "View Profile" },
    contact_not_verified: { id: "contact_verify", label: "Verify Contact Details", description: "Verify both your email and mobile number to continue.", href: "/merchant/verification", cta: "Verify Contact" },
    plan_expired: { id: "plan_expired", label: "Plan Expired", description: "Renew your plan to continue processing payments.", href: "/merchant/plan", cta: "View Plan" },
    plan_not_active: { id: "plan_missing", label: "Activate a Plan", description: "An active plan is required to continue.", href: "/merchant/products", cta: "View Plans" },
    provider_not_connected_or_tested: { id: "provider_missing", label: "Connect Payment Provider", description: "Connect and successfully test a pay-in provider.", href: "/merchant/connect", cta: "Connect Provider" },
    api_key_missing: { id: "api_key_missing", label: "Create an API Key", description: "Your plan requires an active API key.", href: "/merchant/api-keys", cta: "Create API Key" },
    callback_not_verified: { id: "callback_missing", label: "Verify Callback", description: "Configure and verify your callback before going live.", href: "/merchant/webhook", cta: "Configure Callback" },
    test_payment_not_successful: { id: "test_payment_missing", label: "Complete Test Payment", description: "A successful test payment is required before going live.", href: "/merchant/connect", cta: "Test Integration" },
    test_payment_evidence_unsupported: { id: "test_payment_unsupported", label: "Test Payment Evidence Unavailable", description: "RasoKart cannot confirm a successful test payment yet. Contact support for review.", href: "/merchant/support", cta: "Contact Support" },
    service_not_live: { id: "service_paused", label: "Service Paused", description: "Your collection service is not enabled.", href: "/merchant/support", cta: "Contact Support" },
  };
  const priorityAction = serverData.goLive.nextStep ? actions[serverData.goLive.nextStep] ?? null : null;
  const requiredSteps = steps.filter(step => step.id !== "account" && step.id !== "contact");

  return {
    isReady: serviceLive,
    priorityAction,
    summary: {
      completedSteps: requiredSteps.filter(s => s.isCompleted).length,
      totalSteps: requiredSteps.length
    },
    steps,
    collectionState: serverData.collection.state,
    canUseFeature: (feature: string) => {
      if (feature === "create_payment_link" || feature === "create_qr") {
        return { allowed: serviceLive, reason: serviceLive ? undefined : "Collection service is not live." };
      }
      if (feature === "connect_provider") {
        const allowed = providerPrerequisitesMet && serverData.plan.providerAccess;
        const reason = !kycApproved
          ? "KYC approval is required."
          : !serverData.contact.complete || serverData.account.status !== "approved"
            ? "Account and contact verification are required."
            : !planActive
              ? "An active plan is required."
              : !serverData.plan.providerAccess
                ? "Provider access is not included in your plan."
                : undefined;
        return { allowed, reason };
      }
      if (feature === "configure_callback") {
        const included = serverData.plan.apiAccess || serverData.plan.webhookAccess;
        return {
          allowed: planActive && included,
          reason: !planActive ? "An active plan is required." : !included ? "API or webhook access is not included in your plan." : undefined,
        };
      }
      if (feature === "initiate_payout") {
        return { allowed: planActive, reason: planActive ? undefined : "An active plan is required to initiate payouts." };
      }
      return { allowed: true };
    },
    serverData
  };
}
