/**
 * Provider Onboarding Metadata — Phase A audit results and onboarding guidance.
 *
 * Classification:
 *   A  — READY (already live via official RasoKart API)
 *   D  — OFFICIAL API/PARTNER REQUIRED (merchant self-service after partnership)
 *   E  — UNSUPPORTED/UNSAFE (banking regulation or deprecated)
 *
 * Connection model for Category D providers
 * ─────────────────────────────────────────
 * NONE of these providers offer OAuth or any API-level mechanism that lets a
 * third-party platform connect to an existing merchant's account on their behalf.
 * "Connecting an existing account" always means:
 *   1. Merchant independently logs into the provider's business portal.
 *   2. Merchant locates their API credentials (MID, keys, secrets) in the portal.
 *   3. Merchant submits those credentials to RasoKart via this form.
 *
 * RasoKart never automates login, OTP, CAPTCHA, or KYC on the merchant's behalf.
 * OTP is always entered directly by the merchant on the provider's own page.
 *
 * For Category E providers: no connection supported; kept disabled.
 * For Category A (EKQR): admin-managed; no merchant self-service needed.
 */

export type ProviderCategory = "A" | "D" | "E";

/** Credential field definition — maps to one of the 3 stored slots */
export interface CredentialField {
  /** Storage slot */
  slot: "merchantId" | "apiKey" | "apiSecret" | "webhookSecret";
  /** Human label shown in the form */
  label: string;
  /** Where/how to find this value in the provider portal */
  hint: string;
  /** Whether the form blocks submission without this field */
  required: boolean;
  /** Whether the field is a shared/public identifier (not a secret) */
  isIdentifier?: boolean;
}

export interface ProviderOnboardingInfo {
  /** Provider slug — matches providers.slug in the DB */
  slug: string;
  /** Audit classification */
  category: ProviderCategory;
  /** Human-readable reason for category assignment */
  categoryReason: string;

  // ── Existing-merchant connection ──────────────────────────────────────────
  /**
   * Whether "connect existing merchant account" is a viable path.
   * Always false for banking-regulated Category E providers.
   * For Category D: true — but connection is via credential submission only,
   * not OAuth (directOAuthSupported is always false).
   */
  existingConnectionSupported: boolean;
  /**
   * Clear explanation shown under "Connect Existing Account":
   * what the merchant needs to do and what happens.
   */
  existingConnectionNote?: string;

  // ── Mobile Number + OTP connection ───────────────────────────────────────
  /**
   * Whether this provider exposes an official, publicly documented API that
   * allows a third-party platform to authenticate a merchant via mobile
   * number + OTP and receive back an authorized, reusable session/token.
   *
   * Currently false for every listed provider — none of PhonePe, Paytm,
   * BharatPe, Amazon Pay, or MobiKwik publish such an API endpoint. Their
   * mobile+OTP portals are internal merchant-facing UIs, not third-party APIs.
   *
   * Rule: set to true ONLY when a provider's official developer documentation
   * explicitly describes a merchant authentication API (initiate-OTP endpoint
   * + verify-OTP endpoint + session token response) approved for use by
   * third-party payment platforms. Anything less is not sufficient.
   */
  mobileOtpSupported?: boolean;
  /**
   * Shown to merchants when they select "Connect with Mobile Number + OTP".
   * Must explain exactly why the method is unavailable and what to use instead.
   * Kept null/absent when mobileOtpSupported is true (future use).
   */
  mobileOtpNote?: string;
  /**
   * Whether this provider's portal supports Email ID + OTP as a login method.
   * This is purely documentary — it does NOT mean email+OTP can be used to
   * create a reusable RasoKart session. Set to true only when the provider's
   * merchant portal explicitly offers email+OTP as a sign-in option.
   * Currently only Pine Labs uses email+OTP (in addition to mobile+OTP).
   */
  emailOtpLoginAvailable?: boolean;
  /**
   * Shown to merchants when they select "Connect with Email ID + OTP".
   * Required when emailOtpLoginAvailable is true. Must explain whether
   * email+OTP creates a usable RasoKart session, and what to use instead
   * if it does not.
   */
  emailOtpNote?: string;
  /** The login methods a merchant uses when signing in to the provider portal */
  loginMethods?: string[];
  /** URL of the existing-merchant business dashboard / API-keys page */
  merchantPortalUrl?: string;
  /** Friendly name for the portal link, e.g. "Paytm Business Dashboard" */
  portalDisplayName?: string;
  /** Named credential fields the merchant must retrieve and submit */
  credentialFields?: CredentialField[];

  // ── New-merchant onboarding ───────────────────────────────────────────────
  /** Official merchant signup URL (Category D only) */
  signupUrl?: string;
  /** KYC documents required during provider onboarding */
  kycDocuments?: string[];
  /** Estimated onboarding timeline */
  onboardingTimeline?: string;

  // ── Misc ──────────────────────────────────────────────────────────────────
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

    existingConnectionSupported: true,
    existingConnectionNote:
      "PhonePe does not offer OAuth or third-party API access to merchant accounts. " +
      "To connect, log into your PhonePe for Business portal using your registered mobile number and OTP, " +
      "then navigate to Settings → Integration to copy your Merchant ID, Salt Key, and Salt Index.",
    loginMethods: [
      "Mobile number + OTP (on the PhonePe for Business portal — not intercepted by RasoKart)",
    ],
    merchantPortalUrl: "https://business.phonepe.com/login",
    portalDisplayName: "PhonePe for Business Dashboard",
    credentialFields: [
      {
        slot: "merchantId",
        label: "Merchant ID",
        hint: "Settings → Integration → Merchant ID in your PhonePe Business portal",
        required: true,
        isIdentifier: true,
      },
      {
        slot: "apiKey",
        label: "Salt Key",
        hint: "Settings → Integration → Salt Key (keep this secret)",
        required: true,
      },
      {
        slot: "apiSecret",
        label: "Salt Index",
        hint: "Settings → Integration → Salt Index (usually '1')",
        required: true,
      },
    ],

    // Mobile + OTP — audit result: NOT SUPPORTED
    // PhonePe Business portal uses mobile+OTP internally for portal login, but
    // PhonePe does NOT publish an API that lets a third-party platform initiate
    // that OTP flow or receive an authorized merchant session/token. Only
    // provider-issued API keys (Salt Key + Salt Index) can be used for third-party
    // payment integrations — those are retrieved from the portal after manual login.
    mobileOtpSupported: false,
    mobileOtpNote:
      "PhonePe Business does not provide a public API for third-party mobile+OTP merchant authentication. " +
      "Their merchant portal login (mobile number + OTP) is an internal security mechanism and is not " +
      "accessible to external platforms. To connect PhonePe, log into the PhonePe for Business portal " +
      "manually and retrieve your Salt Key and Salt Index from the Integration Settings section.",

    signupUrl: "https://business.phonepe.com/signup",
    kycDocuments: [
      "GST Registration Certificate",
      "PAN Card (Business)",
      "Cancelled cheque / Bank statement",
      "Certificate of Incorporation (for Pvt Ltd / LLP)",
      "Aadhaar of Authorised Signatory",
    ],
    onboardingTimeline: "3–7 business days after document submission",
    supportsSelfSubmit: true,
    finalStatus: "PROVIDER READY — MERCHANT KYC/OTP/CREDENTIALS REQUIRED",
  },

  paytm: {
    slug: "paytm",
    category: "D",
    categoryReason:
      "Paytm Business portal uses mobile OTP with CAPTCHA. Paytm Payment Gateway API requires Paytm Business onboarding agreement. Session scraping is prohibited by Paytm ToS.",

    existingConnectionSupported: true,
    existingConnectionNote:
      "Paytm does not offer OAuth or third-party API access to merchant accounts. " +
      "To connect, log into your Paytm Business portal using your registered mobile number and OTP, " +
      "then go to API Keys to copy your Merchant ID (MID), Client ID, and Client Secret.",
    loginMethods: [
      "Mobile number + OTP (on the Paytm Business portal — not intercepted by RasoKart)",
    ],
    merchantPortalUrl: "https://business.paytm.com",
    portalDisplayName: "Paytm Business Portal",
    credentialFields: [
      {
        slot: "merchantId",
        label: "Merchant ID (MID)",
        hint: "Visible in the Paytm Business dashboard header or Account → Profile",
        required: true,
        isIdentifier: true,
      },
      {
        slot: "apiKey",
        label: "Client ID",
        hint: "API Keys section in your Paytm Business dashboard",
        required: true,
      },
      {
        slot: "apiSecret",
        label: "Client Secret",
        hint: "API Keys section in your Paytm Business dashboard (keep this secret)",
        required: true,
      },
      {
        slot: "webhookSecret",
        label: "Webhook Secret",
        hint: "Webhooks section → signing secret (optional, set if you use Paytm callbacks)",
        required: false,
      },
    ],

    // Mobile + OTP — audit result: NOT SUPPORTED
    // Paytm Business portal uses mobile+OTP+CAPTCHA for its own merchant portal
    // login, but Paytm does not publish a public API for third-party platforms to
    // initiate that OTP flow or receive a merchant session token. Only
    // provider-issued API keys retrieved manually from the portal are usable.
    mobileOtpSupported: false,
    mobileOtpNote:
      "Paytm Business does not provide a public API for third-party mobile+OTP merchant authentication. " +
      "The Paytm Business portal login (mobile number + OTP + CAPTCHA) is an internal security flow and " +
      "cannot be initiated by external platforms. To connect Paytm, log into the Paytm Business portal " +
      "manually and retrieve your MID, Client ID, and Client Secret from the API Keys section.",

    signupUrl: "https://business.paytm.com/payment-gateway",
    kycDocuments: [
      "GST Registration Certificate",
      "PAN Card (Business)",
      "Cancelled cheque / Bank statement",
      "Aadhaar of Authorised Signatory",
      "Shop and Establishment Certificate (for proprietorships)",
    ],
    onboardingTimeline: "3–5 business days",
    supportsSelfSubmit: true,
    finalStatus: "PROVIDER READY — MERCHANT KYC/OTP/CREDENTIALS REQUIRED",
  },

  bharatpe: {
    slug: "bharatpe",
    category: "D",
    categoryReason:
      "BharatPe merchant portal uses mobile OTP with CAPTCHA and device fingerprinting. BharatPe Enterprise API requires a direct agreement. No public transaction API without partnership.",

    existingConnectionSupported: false,
    existingConnectionNote:
      "Direct merchant login connection is not supported for BharatPe. " +
      "BharatPe does not provide a payment gateway API for third-party platforms — " +
      "it operates exclusively as a QR-based UPI settlement platform for its own ecosystem. " +
      "Integration requires a direct BharatPe Enterprise partnership agreement, " +
      "which is arranged by the RasoKart team. Contact support to initiate a partnership inquiry.",
    loginMethods: [
      "Mobile number + OTP (BharatPe Business app — not intercepted by RasoKart)",
    ],
    merchantPortalUrl: "https://bharatpe.com/business",
    portalDisplayName: "BharatPe for Business",

    signupUrl: "https://bharatpe.com/business",
    kycDocuments: [
      "GST Registration Certificate (optional for small merchants)",
      "PAN Card (Business/Individual)",
      "Aadhaar of Proprietor/Director",
      "Bank account details",
    ],
    // Mobile + OTP — audit result: NOT SUPPORTED
    // BharatPe's merchant portal (mobile+OTP+CAPTCHA+device fingerprinting) is
    // internal to BharatPe and does not expose an API for third-party platforms.
    // Enterprise API access requires a direct BharatPe partnership — even with a
    // partnership, authentication is API-key based, not mobile+OTP.
    mobileOtpSupported: false,
    mobileOtpNote:
      "BharatPe does not provide a public mobile+OTP authentication API for third-party platforms. " +
      "BharatPe's merchant app login is internal and device-bound. Integration with BharatPe requires " +
      "an enterprise partnership agreement — contact RasoKart support to initiate a partnership inquiry.",

    onboardingTimeline: "1–3 business days for basic QR; 7–14 days for API access",
    supportsSelfSubmit: false,
    finalStatus: "ENTERPRISE PARTNERSHIP REQUIRED — CONTACT RASOKART SUPPORT",
  },

  freecharge: {
    slug: "freecharge",
    category: "E",
    categoryReason:
      "Freecharge Business merchant portal is no longer actively onboarding new merchants. The product is largely deprecated for new business registrations.",
    existingConnectionSupported: false,
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  amazon_pay: {
    slug: "amazon_pay",
    category: "D",
    categoryReason:
      "Amazon Pay for Business uses Amazon account authentication with 2FA. Official Amazon Pay India API requires an Amazon Pay merchant agreement and approval.",

    existingConnectionSupported: true,
    existingConnectionNote:
      "Amazon Pay does not offer OAuth that allows RasoKart to connect to your merchant account on your behalf. " +
      "To connect, log into Amazon Seller Central using your Amazon account (email + password + 2FA), " +
      "then navigate to Apps & Services → Manage Your Apps → Amazon Pay to retrieve your integration credentials.",
    loginMethods: [
      "Amazon account — email + password + 2FA (on Amazon Seller Central — not intercepted by RasoKart)",
    ],
    merchantPortalUrl: "https://sellercentral.amazon.in/apps/manage",
    portalDisplayName: "Amazon Seller Central",
    credentialFields: [
      {
        slot: "merchantId",
        label: "Seller ID (Merchant ID)",
        hint: "Amazon Seller Central → Settings → Account Info → Merchant Token",
        required: true,
        isIdentifier: true,
      },
      {
        slot: "apiKey",
        label: "Client ID",
        hint: "Amazon Pay → Integration → Keys → Client ID (starts with amzn1.application-oa2-client…)",
        required: true,
      },
      {
        slot: "apiSecret",
        label: "Client Secret",
        hint: "Amazon Pay → Integration → Keys → Client Secret (keep this secret)",
        required: true,
      },
    ],

    // Mobile + OTP — audit result: NOT SUPPORTED
    // Amazon Pay uses Amazon account authentication (email+password+2FA) — not a
    // mobile+OTP flow. Amazon does not publish any API that lets a third-party
    // platform initiate Amazon authentication on a merchant's behalf or receive
    // back an Amazon session token. Only provider-issued OAuth credentials
    // retrieved manually from Amazon Seller Central are usable for integration.
    mobileOtpSupported: false,
    mobileOtpNote:
      "Amazon Pay uses Amazon account authentication (email + password + 2FA), not a mobile+OTP flow. " +
      "Amazon does not provide a public API for third-party platforms to initiate merchant authentication " +
      "or receive Amazon session tokens. To connect Amazon Pay, log into Amazon Seller Central manually " +
      "and retrieve your Seller ID, Client ID, and Client Secret from the Amazon Pay integration section.",

    signupUrl: "https://pay.amazon.in/merchant",
    kycDocuments: [
      "GST Registration Certificate",
      "PAN Card (Business)",
      "Amazon Seller Account (existing or new)",
      "Bank account details",
      "Business registration documents",
    ],
    onboardingTimeline: "5–10 business days",
    supportsSelfSubmit: true,
    finalStatus: "PROVIDER READY — MERCHANT KYC/OTP/CREDENTIALS REQUIRED",
  },

  mobikwik: {
    slug: "mobikwik",
    category: "D",
    categoryReason:
      "MobiKwik for Business uses mobile OTP. No public transaction API for third-party access without a MobiKwik partner agreement.",

    existingConnectionSupported: true,
    existingConnectionNote:
      "MobiKwik does not offer OAuth or third-party API access to merchant accounts. " +
      "To connect, log into your MobiKwik for Business portal using your registered mobile number and OTP, " +
      "then navigate to Integration → API Keys to copy your Merchant ID and Secret Key.",
    loginMethods: [
      "Mobile number + OTP (on the MobiKwik for Business portal — not intercepted by RasoKart)",
    ],
    merchantPortalUrl: "https://business.mobikwik.com/login",
    portalDisplayName: "MobiKwik for Business Dashboard",
    credentialFields: [
      {
        slot: "merchantId",
        label: "Merchant ID",
        hint: "Integration → API Keys → Merchant ID in your MobiKwik Business portal",
        required: true,
        isIdentifier: true,
      },
      {
        slot: "apiKey",
        label: "Secret Key",
        hint: "Integration → API Keys → Secret Key (keep this secret)",
        required: true,
      },
    ],

    // Mobile + OTP — audit result: NOT SUPPORTED
    // MobiKwik for Business uses mobile+OTP for its own merchant portal login
    // but does not publish a third-party API for initiating that OTP flow or
    // receiving merchant session tokens. Only API keys retrieved manually from
    // the MobiKwik Business portal are usable for payment integration.
    mobileOtpSupported: false,
    mobileOtpNote:
      "MobiKwik for Business does not provide a public API for third-party mobile+OTP merchant authentication. " +
      "The MobiKwik Business portal login (mobile number + OTP) is internal and not accessible to external " +
      "platforms. To connect MobiKwik, log into the MobiKwik for Business portal manually and retrieve " +
      "your Merchant ID and Secret Key from the Integration → API Keys section.",

    signupUrl: "https://business.mobikwik.com",
    kycDocuments: [
      "GST Registration Certificate",
      "PAN Card (Business)",
      "Cancelled cheque / Bank statement",
      "Business registration documents",
    ],
    onboardingTimeline: "5–10 business days",
    supportsSelfSubmit: true,
    finalStatus: "PROVIDER READY — MERCHANT KYC/OTP/CREDENTIALS REQUIRED",
  },

  sbi_yono: {
    slug: "sbi_yono",
    category: "E",
    categoryReason:
      "SBI YONO Business is a regulated banking application. Automated login violates the RBI Circular on Cyber Security Framework for Banks, SBI ToS, and the IT Act 2000. Unsafe at any technical level.",
    existingConnectionSupported: false,
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  hdfc_smarthub: {
    slug: "hdfc_smarthub",
    category: "E",
    categoryReason:
      "HDFC SmartHub Vyapar is a regulated banking product. Same RBI regulatory constraint as SBI YONO. Device-bound OTP and hardware token requirement. Automated access is a financial regulation violation.",
    existingConnectionSupported: false,
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  icici_eazypay: {
    slug: "icici_eazypay",
    category: "E",
    categoryReason:
      "ICICI Eazypay is a regulated banking product. Automated login to banking portals is prohibited under the RBI Circular on Cyber Security Framework for Banks.",
    existingConnectionSupported: false,
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  axis_pay: {
    slug: "axis_pay",
    category: "E",
    categoryReason:
      "Axis Bank Pay is a regulated banking product. Same RBI regulatory constraint. Unsafe at any technical level.",
    existingConnectionSupported: false,
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  kotak_smart: {
    slug: "kotak_smart",
    category: "E",
    categoryReason:
      "Kotak Smart Collect is a regulated banking product. Same RBI regulatory constraint. Unsafe at any technical level.",
    existingConnectionSupported: false,
    supportsSelfSubmit: false,
    finalStatus: "PROVIDER UNSUPPORTED — SAFELY DISABLED",
  },

  pinelabs: {
    slug: "pinelabs",
    category: "D",
    categoryReason:
      "Pine Labs merchant portal uses both mobile OTP and email OTP for login. Pine Labs Plural " +
      "payment gateway API is credentials-based (Merchant ID + Secret Key). Pine Labs does not " +
      "expose a public API allowing a third-party to initiate OTP flows and receive a reusable " +
      "merchant session/token. Category D: credential submission is the correct integration path.",

    existingConnectionSupported: true,
    existingConnectionNote:
      "Pine Labs does not provide a third-party API for initiating merchant portal login or " +
      "receiving authorized session tokens. To connect, log into the Pine Labs merchant portal, " +
      "navigate to Integration Settings, and copy your Merchant ID, Access Code, and Secret Key.",
    loginMethods: [
      "Mobile number + OTP (Pine Labs portal — not intercepted by RasoKart)",
      "Email ID + OTP (Pine Labs portal — not intercepted by RasoKart)",
    ],
    merchantPortalUrl: "https://merchant.pinelabs.com",
    portalDisplayName: "Pine Labs Merchant Portal",
    credentialFields: [
      {
        slot: "merchantId",
        label: "Merchant ID (MID)",
        hint: "Pine Labs merchant portal → Integration Settings → Merchant ID",
        required: true,
        isIdentifier: true,
      },
      {
        slot: "apiKey",
        label: "Access Code",
        hint: "Pine Labs merchant portal → Integration Settings → Access Code",
        required: true,
      },
      {
        slot: "apiSecret",
        label: "Secret Key",
        hint: "Pine Labs merchant portal → Integration Settings → Secret Key / Encryption Key (keep this secret)",
        required: true,
      },
    ],

    // Mobile + OTP — audit result: NOT SUPPORTED FOR SESSION CONNECTION
    // Pine Labs portal uses mobile+OTP for merchant login, but does not expose
    // a public API that lets a third-party initiate OTP or receive a session token.
    mobileOtpSupported: false,
    mobileOtpNote:
      "Email/Mobile OTP is available for Pine Labs portal login, but direct RasoKart session " +
      "connection is not officially supported. Use Pine Labs-issued API credentials.",

    // Email + OTP — audit result: NOT SUPPORTED FOR SESSION CONNECTION
    // Pine Labs portal also supports email+OTP login, but same constraint applies:
    // no public API for third-party session creation via email+OTP.
    emailOtpLoginAvailable: true,
    emailOtpNote:
      "Email/Mobile OTP is available for Pine Labs portal login, but direct RasoKart session " +
      "connection is not officially supported. Use Pine Labs-issued API credentials.",

    signupUrl: "https://www.pinelabs.com/payment-gateway",
    kycDocuments: [
      "GST Registration Certificate",
      "PAN Card (Business)",
      "Cancelled cheque / Bank statement",
      "Certificate of Incorporation or Partnership Deed",
      "Aadhaar of Authorised Signatory",
    ],
    onboardingTimeline: "3–7 business days after document submission",
    supportsSelfSubmit: true,
    finalStatus: "PROVIDER READY — MERCHANT KYC/CREDENTIALS REQUIRED",
  },

  ekqr: {
    slug: "ekqr",
    category: "A",
    categoryReason:
      "RasoKart-controlled gateway. Full auto-deposit pipeline live: ekqrCredit.ts (idempotent credit), ekqrSyncScheduler.ts (5-min polling), paymentWebhook.ts (real-time webhook). No merchant login required — direct API integration.",
    existingConnectionSupported: false,
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
    existingConnectionSupported: info.existingConnectionSupported,
    existingConnectionNote: info.existingConnectionNote ?? null,
    loginMethods: info.loginMethods ?? [],
    merchantPortalUrl: info.merchantPortalUrl ?? null,
    portalDisplayName: info.portalDisplayName ?? null,
    credentialFields: info.credentialFields ?? [],
    signupUrl: info.signupUrl ?? null,
    kycDocuments: info.kycDocuments ?? [],
    onboardingTimeline: info.onboardingTimeline ?? null,
    supportsSelfSubmit: info.supportsSelfSubmit,
    finalStatus: info.finalStatus,
    // Mobile OTP support status — false for all current providers
    mobileOtpSupported: info.mobileOtpSupported ?? false,
    mobileOtpNote: info.mobileOtpNote ?? null,
    // Email OTP login availability (portal login only; does not mean session connection is supported)
    emailOtpLoginAvailable: info.emailOtpLoginAvailable ?? false,
    emailOtpNote: info.emailOtpNote ?? null,
  };
}
