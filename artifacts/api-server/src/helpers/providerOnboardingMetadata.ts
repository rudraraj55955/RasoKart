/**
 * Provider Onboarding Metadata — Phase A audit results and onboarding guidance.
 *
 * Classification:
 *   A  — READY (already live via official RasoKart API)
 *   D  — OFFICIAL API/PARTNER REQUIRED (merchant self-service after partnership)
 *   E  — UNSUPPORTED/UNSAFE (banking regulation or deprecated)
 *
 * For Category D providers: merchant must complete KYC/onboarding on the
 * provider's own portal, obtain API credentials, then return to RasoKart
 * to enter those credentials. RasoKart never automates login, OTP, CAPTCHA,
 * or KYC on the merchant's behalf.
 *
 * For Category E providers: no connection supported; kept disabled.
 *
 * For Category A (EKQR): admin-managed; no merchant self-service needed.
 */

export type ProviderCategory = "A" | "D" | "E";

export interface ProviderOnboardingInfo {
  /** Provider slug — matches providers.slug in the DB */
  slug: string;
  /** Audit classification */
  category: ProviderCategory;
  /** Human-readable reason for category assignment */
  categoryReason: string;
  /** Official merchant signup URL (Category D only) */
  signupUrl?: string;
  /** KYC documents required during provider onboarding */
  kycDocuments?: string[];
  /** Login methods supported on the provider portal */
  loginMethods?: string[];
  /** Estimated onboarding timeline */
  onboardingTimeline?: string;
  /** Whether merchant credentials can be self-submitted in RasoKart */
  supportsSelfSubmit: boolean;
  /** Phase D final status label */
  finalStatus: string;
}

/**
 * Canonical metadata for all 12 providers in scope.
 * Verified against official provider portal documentation (August 2026).
 */
export const PROVIDER_ONBOARDING_METADATA: Record<string, ProviderOnboardingInfo> = {
  phonepe: {
    slug: "phonepe",
    category: "D",
    categoryReason:
      "PhonePe Business portal uses mobile OTP with device-binding. Official PhonePe for Business API requires a PhonePe partnership agreement. Web-session automation is prohibited by PhonePe ToS.",
    signupUrl: "https://business.phonepe.com/signup",
    kycDocuments: [
      "GST Registration Certificate",
      "PAN Card (Business)",
      "Cancelled cheque / Bank statement",
      "Certificate of Incorporation (for Pvt Ltd / LLP)",
      "Aadhaar of Authorised Signatory",
    ],
    loginMethods: ["Mobile number + OTP"],
    onboardingTimeline: "3–7 business days after document submission",
    supportsSelfSubmit: true,
    finalStatus: "PROVIDER READY — MERCHANT KYC/OTP/CREDENTIALS REQUIRED",
  },

  paytm: {
    slug: "paytm",
    category: "D",
    categoryReason:
      "Paytm Business portal uses mobile OTP with CAPTCHA. Paytm Payment Gateway API requires Paytm Business onboarding agreement. Session scraping is prohibited by Paytm ToS.",
    signupUrl: "https://business.paytm.com/payment-gateway",
    kycDocuments: [
      "GST Registration Certificate",
      "PAN Card (Business)",
      "Cancelled cheque / Bank statement",
      "Aadhaar of Authorised Signatory",
      "Shop and Establishment Certificate (for proprietorships)",
    ],
    loginMethods: ["Mobile number + OTP"],
    onboardingTimeline: "3–5 business days",
    supportsSelfSubmit: true,
    finalStatus: "PROVIDER READY — MERCHANT KYC/OTP/CREDENTIALS REQUIRED",
  },

  bharatpe: {
    slug: "bharatpe",
    category: "D",
    categoryReason:
      "BharatPe merchant portal uses mobile OTP with CAPTCHA and device fingerprinting. BharatPe Enterprise API requires a direct agreement. No public transaction API without partnership.",
    signupUrl: "https://bharatpe.com/business",
    kycDocuments: [
      "GST Registration Certificate (optional for small merchants)",
      "PAN Card (Business/Individual)",
      "Aadhaar of Proprietor/Director",
      "Bank account details",
    ],
    loginMethods: ["Mobile number + OTP"],
    onboardingTimeline: "1–3 business days for basic QR; 7–14 days for API access",
    supportsSelfSubmit: true,
    finalStatus: "PROVIDER READY — MERCHANT KYC/OTP/CREDENTIALS REQUIRED",
  },

  freecharge: {
    slug: "freecharge",
    category: "E",
    categoryReason:
      "Freecharge Business merchant portal is no longer actively onboarding new merchants. The product is largely deprecated for new business registrations.",
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  amazon_pay: {
    slug: "amazon_pay",
    category: "D",
    categoryReason:
      "Amazon Pay for Business uses Amazon account authentication with 2FA. Official Amazon Pay India API requires an Amazon Pay merchant agreement and approval.",
    signupUrl: "https://pay.amazon.in/merchant",
    kycDocuments: [
      "GST Registration Certificate",
      "PAN Card (Business)",
      "Amazon Seller Account (existing or new)",
      "Bank account details",
      "Business registration documents",
    ],
    loginMethods: ["Amazon account (email + password + 2FA)"],
    onboardingTimeline: "5–10 business days",
    supportsSelfSubmit: true,
    finalStatus: "PROVIDER READY — MERCHANT KYC/OTP/CREDENTIALS REQUIRED",
  },

  mobikwik: {
    slug: "mobikwik",
    category: "D",
    categoryReason:
      "MobiKwik for Business uses mobile OTP. No public transaction API for third-party access without a MobiKwik partner agreement.",
    signupUrl: "https://business.mobikwik.com",
    kycDocuments: [
      "GST Registration Certificate",
      "PAN Card (Business)",
      "Cancelled cheque / Bank statement",
      "Business registration documents",
    ],
    loginMethods: ["Mobile number + OTP"],
    onboardingTimeline: "5–10 business days",
    supportsSelfSubmit: true,
    finalStatus: "PROVIDER READY — MERCHANT KYC/OTP/CREDENTIALS REQUIRED",
  },

  sbi_yono: {
    slug: "sbi_yono",
    category: "E",
    categoryReason:
      "SBI YONO Business is a regulated banking application. Automated login violates the RBI Circular on Cyber Security Framework for Banks, SBI ToS, and the IT Act 2000. Unsafe at any technical level.",
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  hdfc_smarthub: {
    slug: "hdfc_smarthub",
    category: "E",
    categoryReason:
      "HDFC SmartHub Vyapar is a regulated banking product. Same RBI regulatory constraint as SBI YONO. Device-bound OTP and hardware token requirement. Automated access is a financial regulation violation.",
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  icici_eazypay: {
    slug: "icici_eazypay",
    category: "E",
    categoryReason:
      "ICICI Eazypay is a regulated banking product. Automated login to banking portals is prohibited under the RBI Circular on Cyber Security Framework for Banks.",
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  axis_pay: {
    slug: "axis_pay",
    category: "E",
    categoryReason:
      "Axis Bank Pay is a regulated banking product. Same RBI regulatory constraint. Unsafe at any technical level.",
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  kotak_smart: {
    slug: "kotak_smart",
    category: "E",
    categoryReason:
      "Kotak Smart Collect is a regulated banking product. Same RBI regulatory constraint. Unsafe at any technical level.",
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  ekqr: {
    slug: "ekqr",
    category: "A",
    categoryReason:
      "RasoKart-controlled gateway. Full auto-deposit pipeline live: ekqrCredit.ts (idempotent credit), ekqrSyncScheduler.ts (5-min polling), paymentWebhook.ts (real-time webhook). No merchant login required — direct API integration.",
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER CONNECTED AND LIVE",
  },
};

/** Return metadata for a given slug, or a safe default for unknown slugs. */
export function getProviderOnboardingInfo(slug: string): ProviderOnboardingInfo | null {
  return PROVIDER_ONBOARDING_METADATA[slug] ?? null;
}

/** Safe public view — never exposes internal categoryReason in API responses. */
export function toPublicOnboardingInfo(info: ProviderOnboardingInfo) {
  return {
    slug: info.slug,
    category: info.category,
    signupUrl: info.signupUrl ?? null,
    kycDocuments: info.kycDocuments ?? [],
    loginMethods: info.loginMethods ?? [],
    onboardingTimeline: info.onboardingTimeline ?? null,
    supportsSelfSubmit: info.supportsSelfSubmit,
    finalStatus: info.finalStatus,
  };
}
