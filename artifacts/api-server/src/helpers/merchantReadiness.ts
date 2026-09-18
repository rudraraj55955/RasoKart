export type ReadinessStatus = "complete" | "incomplete" | "blocked" | "not_started" | "unsupported";

export interface MerchantReadinessInput {
  now?: Date;
  merchant: {
    id: number;
    businessName: string;
    contactName: string;
    phone: string;
    status: string;
    verificationStatus: string;
    forceApproved: boolean;
    payinServiceEnabled: boolean;
    collectionServiceEnabled: boolean;
    callbackSecretConfigured: boolean;
  };
  contact: { emailVerified: boolean; mobileVerified: boolean };
  kycDocuments: Array<{ docType: string; status: string }>;
  kycVerificationStatus?: string | null;
  requiredKycDocTypes: string[];
  plan: {
    assigned: boolean;
    status?: string | null;
    planId?: number | null;
    planName?: string | null;
    expiresAt?: Date | null;
    apiAccess?: boolean;
    webhookAccess?: boolean;
    providerAccess?: boolean;
  } | null;
  provider: {
    configured: boolean;
    active: boolean;
    connectionStatus: string | null;
    lastTestResult: string | null;
    lastTestedAt: Date | null;
    capabilityPayin: boolean;
  } | null;
  apiKey: { active: boolean; count: number; lastUsedAt: Date | null };
  callback: { configured: boolean; verified: boolean; lastVerifiedAt: Date | null };
  historicalDeposits: { count: number; totalAmount: string };
  testPayment: { supported: boolean; successful: boolean; lastStatus: string | null; lastAt: Date | null };
}

export interface MerchantProviderCandidate {
  configured: boolean;
  active: boolean;
  connectionStatus: string | null;
  lastTestResult: string | null;
  lastTestedAt: Date | null;
  capabilityPayin: boolean;
  updatedAt?: Date | null;
}

/** Select a usable provider without allowing a newer inactive connection to hide it. */
export function selectReadyProvider(candidates: MerchantProviderCandidate[]): MerchantProviderCandidate | null {
  const newest = [...candidates].sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
  return newest.find(candidate =>
    candidate.active
    && candidate.connectionStatus === "active"
    && candidate.lastTestResult === "pass"
    && candidate.capabilityPayin
  ) ?? newest[0] ?? null;
}

export function calculateMerchantReadiness(input: MerchantReadinessInput) {
  const now = input.now ?? new Date();
  const planExpired = !!input.plan?.expiresAt && input.plan.expiresAt.getTime() < now.getTime();
  const planActive = !!input.plan?.assigned && input.plan.status === "active" && !planExpired;
  const autoKycSubmitted = ["PENDING", "MANUAL_REVIEW", "CONTACT_PENDING", "PENDING_RETRY", "APPROVED", "REJECTED", "FAILED", "BLOCKED"]
    .includes(input.kycVerificationStatus ?? "");
  const kycSubmitted = input.kycDocuments.length > 0 || autoKycSubmitted || input.merchant.forceApproved;
  const hasPendingKyc = input.kycDocuments.some(d => d.status === "pending")
    || ["PENDING", "MANUAL_REVIEW", "CONTACT_PENDING", "PENDING_RETRY"].includes(input.kycVerificationStatus ?? "");
  const hasRejectedKyc = input.kycDocuments.some(d => d.status === "rejected")
    || ["REJECTED", "FAILED", "BLOCKED"].includes(input.kycVerificationStatus ?? "");
  const allRequiredDocumentsApproved = input.requiredKycDocTypes.every(docType =>
    input.kycDocuments.some(document => document.docType === docType && document.status === "approved")
  );
  // These are independent approval authorities. Historical pending/rejected
  // document rows cannot override an audited force approval, authoritative
  // auto-KYC approval, or a complete approved required-document set.
  const kycApproved = input.merchant.forceApproved
    || input.kycVerificationStatus === "APPROVED"
    || allRequiredDocumentsApproved;
  const providerLive = !!input.provider?.active
    && input.provider.connectionStatus === "active"
    && input.provider.lastTestResult === "pass"
    && input.provider.capabilityPayin;
  const apiKeyRequired = planActive && input.plan?.apiAccess === true;
  const callbackRequired = planActive && (!!input.plan?.apiAccess || !!input.plan?.webhookAccess || input.apiKey.active);
  const callbackConfigured = input.callback.configured && (!callbackRequired || input.callback.verified);
  const collectionEnabled = input.merchant.payinServiceEnabled && input.merchant.collectionServiceEnabled;
  const testPaymentComplete = input.testPayment.supported && input.testPayment.successful;

  const blockers: string[] = [];
  if (!kycSubmitted) blockers.push("kyc_not_submitted");
  else if (!kycApproved) blockers.push("kyc_not_approved");
  if (input.merchant.status !== "approved") blockers.push("account_not_approved");
  if (!input.contact.emailVerified || !input.contact.mobileVerified) blockers.push("contact_not_verified");
  if (!planActive) blockers.push(planExpired ? "plan_expired" : "plan_not_active");
  if (!providerLive) blockers.push("provider_not_connected_or_tested");
  if (apiKeyRequired && !input.apiKey.active) blockers.push("api_key_missing");
  if (callbackRequired && !callbackConfigured) blockers.push("callback_not_verified");
  if (!input.testPayment.supported) blockers.push("test_payment_evidence_unsupported");
  else if (!testPaymentComplete) blockers.push("test_payment_not_successful");
  if (!collectionEnabled) blockers.push("service_not_live");
  const collectionLive = collectionEnabled && blockers.length === 0;

  const nextStep = blockers[0] ?? null;
  return {
    account: {
      status: input.merchant.status,
      profileComplete: !!input.merchant.businessName && !!input.merchant.contactName && !!input.merchant.phone,
    },
    contact: {
      emailVerified: input.contact.emailVerified,
      mobileVerified: input.contact.mobileVerified,
      complete: input.contact.emailVerified && input.contact.mobileVerified,
    },
    kyc: {
      status: kycApproved ? "approved" : hasRejectedKyc ? "rejected" : kycSubmitted ? "pending" : "not_started",
      documents: input.kycDocuments,
    },
    plan: {
      assigned: !!input.plan?.assigned,
      status: input.plan?.status ?? null,
      planId: input.plan?.planId ?? null,
      planName: input.plan?.planName ?? null,
      expiresAt: input.plan?.expiresAt?.toISOString() ?? null,
      isExpired: planExpired,
      apiAccess: !!input.plan?.apiAccess && planActive,
      webhookAccess: !!input.plan?.webhookAccess && planActive,
      providerAccess: !!input.plan?.providerAccess && planActive,
    },
    provider: {
      configured: !!input.provider?.configured,
      active: providerLive,
      connectionStatus: input.provider?.connectionStatus ?? null,
      lastTestResult: input.provider?.lastTestResult ?? null,
      lastTestedAt: input.provider?.lastTestedAt?.toISOString() ?? null,
      capabilityPayin: !!input.provider?.capabilityPayin,
    },
    apiKey: input.apiKey,
    callback: {
      configured: input.callback.configured,
      verificationStatus: input.callback.verified ? "verified" : input.callback.configured ? "unverified" : "not_configured",
      lastVerifiedAt: input.callback.lastVerifiedAt?.toISOString() ?? null,
      required: callbackRequired,
      apiKeyRequired,
    },
    collection: {
      enabled: collectionEnabled,
      live: collectionLive,
      state: collectionLive ? "live" : input.historicalDeposits.count > 0 ? "paused_historical_only" : "paused",
      historicalDeposits: input.historicalDeposits,
    },
    testPayment: {
      supported: input.testPayment.supported,
      status: input.testPayment.supported ? input.testPayment.successful ? "successful" : "incomplete" : "unsupported",
      lastStatus: input.testPayment.lastStatus,
      lastAt: input.testPayment.lastAt?.toISOString() ?? null,
    },
    goLive: {
      eligible: blockers.length === 0,
      blockers,
      nextStep,
      checkedAt: now.toISOString(),
    },
  };
}