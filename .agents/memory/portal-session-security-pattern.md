---
name: Portal session OTP security pattern
description: The four-gate security model enforced on the submit-step route for portal session OTP submission. Must be applied before any adapter call.
---

## Rule
The `POST /api/merchant/portal-sessions/:provider/submit-step` route enforces four security gates IN ORDER before calling the adapter. All four must pass. None can be skipped.

## The Four Gates (in order)

### Gate 1: Status guard
Session `status` must be in `["AWAITING_OTP", "AWAITING_PASSWORD", "AWAITING_MPIN"]`.
- Rejection: 400 `WRONG_SESSION_STATE`
- Guards against submitting OTP to an already-connected or disconnected session.

### Gate 2: Max attempt limit
`session.stepFailureCount >= MAX_OTP_ATTEMPTS` (= 3) → hard reject.
- Rejection: 429 `MAX_ATTEMPTS_REACHED`
- Requires full re-initiate (new OTP request) to continue.
- `stepFailureCount` is reset to 0 on every `/initiate` call.
- Incremented by 1 on each FAILED submitStep result.

### Gate 3: OTP session expiry
`now - session.updatedAt > 10 minutes` → reject and set session status to EXPIRED.
- Rejection: 400 `OTP_SESSION_EXPIRED`
- `updatedAt` is written at initiate time, so it captures when the OTP was sent.
- Clears `encryptedSession` and sets status to EXPIRED.
- Forces the merchant to call `/initiate` again to receive a new OTP.

### Gate 4: In-flight guard
An in-memory `Set<string>` keyed by `${merchantId}:${providerSlug}` prevents concurrent OTP submissions.
- Rejection: 409 `An OTP submission is already in progress`
- Cleared in `finally` block — always released even if adapter throws.
- Guards against double-tap, network retry races.

## OTP encryption contract
Raw OTP is encrypted (`encryptSecret`) immediately on arrival, before any gate checks.
The `encryptedOtp` variable is passed to the adapter.
The raw `otp` / `password` variable is NEVER logged, stored, or returned.
After the adapter call, `encryptedOtp` goes out of scope.

## Constants
```typescript
const MAX_OTP_ATTEMPTS = 3;
const OTP_SESSION_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const inFlightSubmits = new Set<string>();       // module-level, lives for process lifetime
```

**Why:** OTP brute-force, replay attacks, and race conditions are the three primary threats on the submit-step endpoint. The rate limiter (10 per 10 min per IP+merchant) is a layer of network-level defense; these four gates are the authoritative session-level defense.
