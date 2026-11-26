/**
 * Mock Pine Labs ONE Portal HTTP Server for E2E testing.
 *
 * Simulates one.pinelabs.com login flow in a real local HTTP server.
 * The real Chromium browser navigates to this server via PINELABS_ONE_PORTAL_OVERRIDE.
 * No real Pine Labs ONE API calls, no real credentials, no real OTPs.
 *
 * STATE MACHINE (tracked via cookies):
 *   No cookie               → GET /login/user shows identifier entry form
 *   user_session=1 cookie   → GET /login/password shows password entry form
 *   otp_session=1 cookie    → GET /login/verify-otp shows OTP entry form
 *   auth_session=1 cookie   → GET /home shows dashboard
 *
 * CONFIGURABLE:
 *   validPassword     — password the server accepts (default "Password123!")
 *   validOtp          — OTP the server accepts for 2FA (default "123456")
 *   maskedIdentifier  — shown on /profile page for ownership check
 *   merchantId        — MID shown on /profile
 *   storeId           — store ID shown on /profile (optional)
 *   businessName      — business name shown on /profile
 *   noOwnershipData   — /profile has no identifiers (tests fail-closed)
 *   showCaptcha       — login page shows a CAPTCHA iframe
 *   showBlocked       — post-login shows account-blocked message
 *   showManualAction  — login page shows QR/device-approval prompt
 *   invalidPasswordMsg — error message returned for wrong password
 *   requireOtp        — password submit triggers OTP 2FA step
 *
 * USAGE:
 *   const srv = await startMockPineLabsOneServer({ validPassword: "Password123!" });
 *   process.env["PINELABS_ONE_PORTAL_OVERRIDE"] = srv.url;
 *   // ... run tests ...
 *   await srv.close();
 *   delete process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
 */

import * as http from "node:http";

export interface MockServerConfig {
  validPassword?:       string;
  validOtp?:            string;
  maskedIdentifier?:    string;
  merchantId?:          string;
  storeId?:             string;
  businessName?:        string;
  noOwnershipData?:     boolean;
  showCaptcha?:         boolean;
  showBlocked?:         boolean;
  showManualAction?:    boolean;
  invalidPasswordMsg?:  string;
  requireOtp?:          boolean;
  /**
   * Simulate the Pine Labs ONE /authV2 OTP-first flow.
   * When true: POST /login/user → redirect to /authV2/sign-in/verify-otp
   *            (no password step; OTP is the primary factor).
   * When false (default): POST /login/user → redirect to /login/password.
   */
  otpFirst?:            boolean;
  /**
   * Inject a HIDDEN CAPTCHA widget div (display:none, width=0, height=0).
   * Reproduces the real-world pattern where React SPAs pre-load CAPTCHA
   * scripts and insert invisible container divs into the DOM even when
   * no challenge is active. Used to regression-test the false-positive
   * guard in hasCaptcha() (requires visibility + non-zero bounding box).
   */
  hiddenCaptcha?:       boolean;
  /**
   * Simulate the Pine Labs ONE mandatory language-selection interstitial
   * (observed Aug 2026). When true, GET /login/user redirects to
   * /authV2/language which shows a language picker. Clicking Continue
   * redirects to /authV2/verify-user where the identifier form is shown.
   * Used to regression-test handleLanguageInterstitial() in the adapter.
   */
  languageInterstitial?: boolean;
  /**
   * Show a "Login with OTP" anchor on the password page.
   * When true: GET /login/password includes <a href="/login/otp-request" id="otp-login-link">
   * and GET /login/otp-request clears user_session, sets otp_session, and redirects to
   * GET /login/verify-otp.
   * Used to test the portal_otp and resend_otp submitStep branches.
   */
  otpLink?: boolean;
  /**
   * Show ONLY a "Forgot Password" link on the password page (no OTP login link).
   * Used to regression-test that SEL.OTP_LOGIN_LINK does NOT match Forgot-Password
   * controls — clicking them could trigger a destructive password-reset flow.
   * With this option the adapter must return OTP_NOT_AVAILABLE (never click the link).
   */
  forgotPasswordLinkOnly?: boolean;
  /**
   * Render the resend control the way the LIVE authV2 portal does
   * (verified 2026-08-18): a <div role="button" id="...-resend-timer-resend-link">
   * rather than a <button>/<a>. Used to regression-test that
   * SEL.RESEND_OTP_BTN matches the live div-based control.
   */
  liveResendControl?: boolean;
  /**
   * Simulate the live portal's resend cooldown state: instead of a clickable
   * resend control, the OTP page shows "Resend OTP in NN secs" countdown text.
   * The adapter must NOT match this text as a resend button (resend_otp must
   * return RESEND_NOT_AVAILABLE with the session preserved).
   */
  resendCooldownActive?: boolean;
  /**
   * Simulate the cooldown-then-active transition on the live portal:
   *   - First visit to the OTP page: shows "Resend OTP in NN secs" countdown
   *     (no clickable control) — resend_otp must return RESEND_NOT_AVAILABLE.
   *   - Second and subsequent visits: shows the active div[role="button"]
   *     resend control — resend_otp must click it and return AWAITING_OTP.
   *
   * Used to verify the full transition flow:
   *   resend_otp (cooldown) → RESEND_NOT_AVAILABLE (session preserved) →
   *   resend_otp (expired)  → AWAITING_OTP (button found and clicked).
   */
  resendCooldownThenActive?: boolean;
  /** Render the password control in a same-origin iframe. */
  passwordInIframe?: boolean;
  /** Render the OTP control in a same-origin iframe. */
  otpInIframe?: boolean;
  /** Delay rendering the password form after identifier submission, like React hydration. */
  delayedPasswordRenderMs?: number;
  /**
   * Deliberately unusual post-identifier screens used to verify classifier
   * ordering and fail-closed handling.
   */
  postIdentifierFixture?: "unknown" | "dashboard_with_otp" | "otp_with_password";
  /** Add blocked/error copy to the identifier page for classifier-priority tests. */
  showBlockedAndErrorAtLogin?: boolean;
}

export interface MockServer {
  url:   string;
  port:  number;
  close(): Promise<void>;
  getRequestCount(pathname: string): number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k && v) cookies[k.trim()] = v.trim();
  }
  return cookies;
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise(resolve => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const params: Record<string, string> = {};
      for (const part of body.split("&")) {
        const eq = part.indexOf("=");
        if (eq > 0) {
          const k = decodeURIComponent(part.slice(0, eq).replace(/\+/g, " "));
          const v = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "));
          params[k] = v;
        }
      }
      resolve(params);
    });
  });
}

// ── HTML templates ────────────────────────────────────────────────────────────

/**
 * Language selection interstitial page — mirrors one.pinelabs.com/authV2/language.
 * Shows 10 radio inputs (English first) and a Continue button.
 * Used to regression-test handleLanguageInterstitial() in the adapter.
 */
function languagePageHtml(): string {
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Select Language</title></head><body>
<div id="language-container" style="padding:40px">
  <h1>What's your preferred language?</h1>
  <p>You can change the language later from 'settings'.</p>
  <form action="/authV2/language" method="POST" id="language-form">
    <label><input type="radio" name="lang" value="en" id="lang-en" /> English</label><br/>
    <label><input type="radio" name="lang" value="hi" /> &#2361;&#2367;&#2306;&#2342;&#2368;</label><br/>
    <label><input type="radio" name="lang" value="te" /> &#3108;&#3142;&#3122;&#3137;&#3095;&#3137;</label><br/>
    <label><input type="radio" name="lang" value="ta" /> &#2980;&#2990;&#3007;&#2996;&#3021;</label><br/>
    <label><input type="radio" name="lang" value="mr" /> &#2350;&#2352;&#2366;&#2336;&#2368;</label><br/>
    <label><input type="radio" name="lang" value="kn" /> &#3221;&#3240;&#3277;&#3240;&#3233;</label><br/>
    <label><input type="radio" name="lang" value="gu" /> &#2711;&#2753;&#2716;&#2736;&#2750;&#2724;&#2752;</label><br/>
    <label><input type="radio" name="lang" value="ml" /> &#3374;&#3378;&#3375;&#3390;&#3379;&#3330;</label><br/>
    <label><input type="radio" name="lang" value="bn" /> &#2476;&#2494;&#2434;&#2482;&#2494;</label><br/>
    <label><input type="radio" name="lang" value="pa" /> &#2602;&#2672;&#2588;&#2622;&#2604;&#2624;</label><br/>
    <button type="submit" id="continue-btn">Continue</button>
  </form>
</div>
</body></html>`;
}

/**
 * Identifier form at /authV2/verify-user — mirrors the real portal page
 * that appears after language selection (Aug 2026 portal change).
 * Uses placeholder "Enter mobile number/ email ID/ user ID" and
 * button text "Sign in securely" (type=button, not type=submit).
 */
function verifyUserFormHtml(showCaptcha: boolean, showHiddenCaptcha?: boolean): string {
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Sign In</title></head><body>
<div id="login-container" style="padding:40px">
  <h1>Let's sign in to Pine Labs ONE</h1>
  <p>Sign in using mobile number or email ID or user ID</p>
  ${showCaptcha ? captchaHtml() : ""}
  ${showHiddenCaptcha ? hiddenCaptchaHtml() : ""}
  <form action="/authV2/verify-user" method="POST" id="verify-user-form">
    <input name="identifier" placeholder="Enter mobile number/ email ID/ user ID" id="identifier-input" />
    <button type="button" id="sign-in-btn" onclick="this.form.submit()">Sign in securely</button>
  </form>
</div>
</body></html>`;
}

/**
 * Password entry page at /authV2/password — mirrors the real portal page that
 * appears after identifier submission (Aug 2026).
 * Shows: "Could you please provide your password?", password input, "Verify" button,
 * and an optional "Want to sign in using OTP?" link.
 */
function authV2PasswordFormHtml(showCaptcha: boolean, invalidMsg?: string): string {
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Password</title></head><body>
<div id="password-container" style="padding:40px">
  <h1>Could you please provide your password?</h1>
  ${showCaptcha ? captchaHtml() : ""}
  ${invalidMsg ? `<p role="alert" id="error-msg" style="color:red">${invalidMsg}</p>` : ""}
  <form action="/authV2/password" method="POST" id="password-form">
    <input type="password" name="password" id="password" placeholder="Enter password" required />
    <a href="/authV2/sign-in/verify-otp" id="otp-link">Want to sign in using OTP? Click here to receive OTP</a>
    <button type="submit" id="verify-btn">Verify</button>
  </form>
  <p><a href="/login/user">Forgot password?</a></p>
</div>
</body></html>`;
}

function captchaHtml(): string {
  return `<iframe src="https://www.google.com/recaptcha/api.js" title="recaptcha" id="captcha-frame" style="width:300px;height:78px;border:0"></iframe>`;
}

/**
 * Hidden CAPTCHA widget — simulates the pre-loaded / inactive CAPTCHA
 * container that React SPAs inject into the DOM even when no challenge is
 * active. Must NOT trigger hasCaptcha() — the element is invisible and
 * zero-size, so the bounding-box guard should skip it.
 */
function hiddenCaptchaHtml(): string {
  return `
<div class="captcha-container" style="display:none;width:0;height:0;overflow:hidden" aria-hidden="true">
  <!-- pre-loaded CAPTCHA placeholder (not an active challenge) -->
  <div class="captcha-widget" id="captcha-placeholder"></div>
</div>`;
}

function manualActionHtml(): string {
  return `
<div id="qr-action" style="padding:20px;text-align:center">
  <h2>Verify your device</h2>
  <p>Scan the QR code with your registered device to continue.</p>
  <img src="data:image/png;base64,iVBORw0KGgo=" alt="QR Code" id="qr-code" style="width:200px;height:200px"/>
</div>`;
}

function identifierFormHtml(
  showCaptcha: boolean,
  showManualAction: boolean,
  showHiddenCaptcha?: boolean,
  showBlockedAndError?: boolean,
): string {
  if (showManualAction) {
    return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Login</title></head><body>
${manualActionHtml()}
${showCaptcha ? captchaHtml() : ""}
</body></html>`;
  }
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Sign In</title></head><body>
<div id="login-container">
  <h1>Sign In to Pine Labs ONE</h1>
  ${showCaptcha ? captchaHtml() : ""}
  ${showHiddenCaptcha ? hiddenCaptchaHtml() : ""}
  ${showBlockedAndError ? `<div class="blocked-container"><p>Account has been blocked</p></div><p role="alert">Unexpected sign-in error</p>` : ""}
  <form action="/login/user" method="POST" id="login-form">
    <label for="mobile">Registered Email ID or Mobile Number</label>
    <input type="text" id="mobile" name="mobile" placeholder="Registered email ID or 10-digit mobile" required />
    <button type="submit" id="next-btn">Next</button>
  </form>
</div>
</body></html>`;
}

function delayedPasswordPageHtml(delayMs: number): string {
  const form = passwordFormHtml(false).replace(/<\/?html[^>]*>|<\/?head[^>]*>|<\/?body[^>]*>/g, "");
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Loading</title></head><body>
<div id="react-root" aria-busy="true">Loading secure sign-in…</div>
<script>
  window.setTimeout(() => {
    document.getElementById("react-root").innerHTML = ${JSON.stringify(form)};
    document.getElementById("react-root").setAttribute("aria-busy", "false");
  }, ${delayMs});
</script>
</body></html>`;
}

function iframeShellHtml(src: string, title: string): string {
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - ${title}</title></head><body>
<div id="${title.toLowerCase()}-container"><iframe src="${src}" title="${title}" id="${title.toLowerCase()}-frame" style="width:500px;height:300px;border:0"></iframe></div>
</body></html>`;
}

function classifierFixtureHtml(kind: "unknown" | "otp_with_password"): string {
  if (kind === "unknown") {
    return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Continue</title></head><body>
<main id="unrecognised-post-submit"><h1>Continue securely</h1><p>Preparing your account.</p></main>
</body></html>`;
  }
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Verification</title></head><body>
<div id="otp-container"><p>An OTP has been sent.</p><form action="/login/verify-otp" method="POST">
<input name="otp" placeholder="Enter OTP" autocomplete="one-time-code" /><button type="submit">Verify</button></form></div>
<div id="password-container"><input type="password" name="password" placeholder="Enter your password" /></div>
</body></html>`;
}

function passwordFormHtml(
  showCaptcha: boolean,
  showOtpLink?: boolean,
  forgotPasswordLinkOnly?: boolean,
): string {
  // When forgotPasswordLinkOnly=true: show ONLY a "Forgot Password" link, no OTP login link.
  // This simulates portals that don't support OTP login but do have a reset flow.
  // The adapter must NOT treat a Forgot Password link as an OTP login link.
  const extraLinks = forgotPasswordLinkOnly
    ? `<a href="/login/forgot-password" id="forgot-password-link" style="display:inline-block;margin-top:12px">Forgot Password?</a>`
    : showOtpLink
      ? `<a href="/login/otp-request" id="otp-login-link" style="display:inline-block;margin-top:12px">Login with OTP</a>`
      : "";
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Enter Password</title></head><body>
<div id="password-container">
  <h1>Enter Password</h1>
  ${showCaptcha ? captchaHtml() : ""}
  <form action="/login/password" method="POST" id="password-form">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" placeholder="Enter your password" required />
    <button type="submit" id="sign-in-btn">Sign In</button>
  </form>
  ${extraLinks}
</div>
</body></html>`;
}

function passwordErrorFormHtml(errorMsg: string): string {
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Enter Password</title></head><body>
<div id="password-container">
  <h1>Enter Password</h1>
  <p role="alert" class="error-message" id="error-msg">${errorMsg}</p>
  <form action="/login/password" method="POST" id="password-form">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" placeholder="Enter your password" required />
    <button type="submit" id="sign-in-btn">Sign In</button>
  </form>
</div>
</body></html>`;
}

function otpFormHtml(
  showError?: string,
  showResend?: boolean,
  opts?: { liveResendControl?: boolean; resendCooldownActive?: boolean },
): string {
  // Resend control variants:
  //  - cooldown: live portal shows "Resend OTP in NN secs" countdown text
  //    (no clickable control) — adapter must NOT match this.
  //  - live div: <div role="button" id="...-resend-timer-resend-link"> — the
  //    exact structure observed on the live authV2 portal (2026-08-18).
  //  - legacy anchor: <a id="resend-otp-btn"> (pre-authV2 style).
  let resendHtml = "";
  if (showResend !== false) {
    if (opts?.resendCooldownActive) {
      resendHtml =
        `<div id="sign-in-verify-otp-resend-timer" style="margin-top:12px">` +
        `<span>Resend OTP in</span> <span>27 secs</span></div>`;
    } else if (opts?.liveResendControl) {
      resendHtml =
        `<div role="button" id="sign-in-verify-otp-resend-timer-resend-link" ` +
        `style="cursor:pointer;display:inline-block;margin-top:12px" ` +
        `onclick="window.location.href='/login/resend-otp'">Resend OTP</div>`;
    } else {
      resendHtml =
        `<a href="/login/resend-otp" id="resend-otp-btn" style="display:inline-block;margin-top:12px">Resend OTP</a>`;
    }
  }
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - OTP Verification</title></head><body>
<div id="otp-container">
  <h1>2-Step Verification</h1>
  <p>An OTP has been sent to your registered mobile number.</p>
  ${showError ? `<p role="alert" class="error-message">${showError}</p>` : ""}
  <form action="/login/verify-otp" method="POST" id="otp-form">
    <label for="otp">Enter OTP</label>
    <input type="text" id="otp" name="otp" placeholder="Enter OTP" autocomplete="one-time-code" maxlength="8" />
    <button type="submit" id="verify-btn">Verify</button>
  </form>
  ${resendHtml}
</div>
</body></html>`;
}

function dashboardHtml(): string {
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Home</title></head><body>
<nav id="sidebar" aria-label="merchant navigation">
  <a href="/home">Home</a>
  <a href="/transactions">Transactions</a>
  <a href="/stores">Stores</a>
  <a href="/reports">Reports</a>
  <a href="/settlements">Settlements</a>
  <a href="/profile" id="profile-link" aria-label="profile">My Account</a>
</nav>
<main id="dashboard" class="dashboard">
  <h1>Welcome to Pine Labs ONE</h1>
  <div class="summary">
    <div>Total Transactions</div>
    <div>Today's Sales: ₹25,000</div>
    <div>Settlement Pending: ₹18,000</div>
  </div>
</main>
</body></html>`;
}

function blockedHtml(): string {
  return `<!DOCTYPE html><html><head><title>Account Blocked</title></head><body>
<div class="blocked-container">
  <h1>Account has been blocked</h1>
  <p>Your Pine Labs ONE account has been temporarily suspended.</p>
  <p>Please contact Pine Labs support for assistance.</p>
</div>
</body></html>`;
}

function profileHtml(config: MockServerConfig): string {
  if (config.noOwnershipData) {
    return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Profile</title></head><body>
<div class="profile-container">
  <h1>My Account</h1>
  <p>Loading account details...</p>
</div>
</body></html>`;
  }
  const maskedIdentifier = config.maskedIdentifier ?? "**XXXXX890";
  const merchantId       = config.merchantId       ?? "PL123456789";
  const storeId          = config.storeId          ?? "";
  const businessName     = config.businessName     ?? "Test Merchant Pvt Ltd";
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Profile</title></head><body>
<div class="profile-container" data-testid="profile">
  <h1>My Account</h1>
  <div class="profile-details">
    <h2 class="business-name" data-testid="business-name">${businessName}</h2>
    <p data-testid="mid">Merchant ID: ${merchantId}</p>
    ${storeId ? `<p data-testid="store-id">Store ID: ${storeId}</p>` : ""}
    <p class="registered-mobile">Registered Mobile: ${maskedIdentifier}</p>
    <p>Status: Active</p>
  </div>
</div>
</body></html>`;
}

function transactionsHtml(): string {
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Transactions</title></head><body>
<nav aria-label="merchant navigation"><a href="/transactions">Transactions</a></nav>
<main>
  <h1>Total Transactions</h1>
  <table>
    <tbody>
      <tr class="transaction-row">
        <td>TXN001PINE123</td>
        <td>₹1,500</td>
        <td>SUCCESS</td>
        <td>01/08/2026</td>
        <td>PINE12345678901</td>
      </tr>
      <tr class="transaction-row">
        <td>TXN002PINE456</td>
        <td>₹750</td>
        <td>FAILED</td>
        <td>01/08/2026</td>
        <td></td>
      </tr>
    </tbody>
  </table>
</main>
</body></html>`;
}

// ── Server factory ────────────────────────────────────────────────────────────

export async function startMockPineLabsOneServer(
  config: MockServerConfig = {},
): Promise<MockServer> {
  const validPassword     = config.validPassword     ?? "Password123!";
  const validOtp          = config.validOtp          ?? "123456";
  const invalidPasswordMsg = config.invalidPasswordMsg ?? "Invalid username or password";

  // ── Cooldown-then-active transition state ────────────────────────────────────
  // Tracks how many times the OTP page has been fetched (per-server lifetime).
  // Used by resendCooldownThenActive: first visit → cooldown, later → active div.
  let otpPageVisitCount = 0;
  const requestCounts = new Map<string, number>();

  const server = http.createServer(async (req, res) => {
    const url    = req.url ?? "/";
    const method = req.method ?? "GET";
    const pathname = url.split("?")[0] ?? url;
    requestCounts.set(pathname, (requestCounts.get(pathname) ?? 0) + 1);
    const cookies = parseCookies(req.headers["cookie"]);

    const isAuth        = !!cookies["auth_session"];
    const hasUserSession = !!cookies["user_session"];
    const hasOtpSession  = !!cookies["otp_session"];

    // ── Root: redirect based on auth state
    if (url === "/" || url === "") {
      res.writeHead(302, { Location: isAuth ? "/home" : "/login/user" });
      res.end();
      return;
    }

    // ── Dashboard and app pages (protected)
    if (url === "/home" || url === "/dashboard" || url === "/overview") {
      if (!isAuth) {
        res.writeHead(302, { Location: "/login/user" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        config.postIdentifierFixture === "dashboard_with_otp"
          ? dashboardHtml().replace("</main>", `</main><iframe src="/fixture/otp-frame" title="OTP challenge" style="width:500px;height:180px;border:0"></iframe>`)
          : dashboardHtml(),
      );
      return;
    }

    if (url === "/transactions" || url.startsWith("/transactions")) {
      if (!isAuth) { res.writeHead(302, { Location: "/login/user" }); res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(transactionsHtml());
      return;
    }

    if (url === "/profile" || url === "/account" || url.startsWith("/settings")) {
      if (!isAuth) { res.writeHead(302, { Location: "/login/user" }); res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(profileHtml(config));
      return;
    }

    if (url.startsWith("/stores") || url.startsWith("/reports") || url.startsWith("/settlements")) {
      if (!isAuth) { res.writeHead(302, { Location: "/login/user" }); res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(dashboardHtml());
      return;
    }

    // ── Logout
    if (url.startsWith("/logout") || url.startsWith("/sign-out") || url.startsWith("/authV2/sign-out")) {
      res.writeHead(302, {
        Location: "/login/user",
        "Set-Cookie": [
          "auth_session=; Max-Age=0; Path=/",
          "user_session=; Max-Age=0; Path=/",
          "otp_session=; Max-Age=0; Path=/",
        ],
      });
      res.end();
      return;
    }

    // ── Language interstitial routes (languageInterstitial: true) ────────────
    // Simulates one.pinelabs.com/authV2/language — the mandatory language picker
    // that appears for fresh (cookie-less) sessions before the identifier form.
    if (url.startsWith("/authV2/language") && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(languagePageHtml());
      return;
    }
    if (url === "/authV2/language" && method === "POST") {
      // Language selected → redirect to /authV2/verify-user (identifier form)
      res.writeHead(302, {
        Location: "/authV2/verify-user",
        "Set-Cookie": "lang_selected=en; Path=/; SameSite=Lax",
      });
      res.end();
      return;
    }

    // ── GET /authV2/verify-user — identifier entry (post-language page) ──────
    if (url.startsWith("/authV2/verify-user") && method === "GET") {
      if (isAuth) { res.writeHead(302, { Location: "/home" }); res.end(); return; }
      if (hasOtpSession)  { res.writeHead(302, { Location: "/login/verify-otp" }); res.end(); return; }
      if (hasUserSession) { res.writeHead(302, { Location: "/login/password" });  res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(verifyUserFormHtml(config.showCaptcha ?? false, config.hiddenCaptcha ?? false));
      return;
    }

    // Same-origin frame documents. Forms target the top-level page so a real
    // browser follows the normal server redirects after iframe interaction.
    if (url === "/fixture/password-frame" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(passwordFormHtml(false).replace("<head>", "<head><base target=\"_top\">"));
      return;
    }
    if (url === "/fixture/otp-frame" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(otpFormHtml(undefined, undefined, config).replace("<head>", "<head><base target=\"_top\">"));
      return;
    }

    if (url === "/login/delayed-password" && method === "GET") {
      if (!hasUserSession) { res.writeHead(302, { Location: "/login/user" }); res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(delayedPasswordPageHtml(config.delayedPasswordRenderMs ?? 1_800));
      return;
    }
    if (url === "/login/post-submit-unknown" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(classifierFixtureHtml("unknown"));
      return;
    }

    // ── POST /authV2/verify-user — submit identifier ──────────────────────────
    if (url === "/authV2/verify-user" && method === "POST") {
      const body = await parseBody(req);
      const identifier = (
        body["identifier"] ?? body["mobile"] ?? body["email"] ?? ""
      ).trim();
      if (!identifier || identifier.length < 4) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><p role="alert">Please enter a valid registered email ID or mobile number</p>
${verifyUserFormHtml(false)}</body></html>`);
        return;
      }
      if (config.otpFirst) {
        res.writeHead(302, {
          Location: "/authV2/sign-in/verify-otp",
          "Set-Cookie": "otp_session=1; Path=/; HttpOnly; SameSite=Lax",
        });
        res.end();
        return;
      }
      // Non-OTP flow: redirect to /authV2/password (real portal flow, Aug 2026)
      res.writeHead(302, {
        Location: "/authV2/password",
        "Set-Cookie": "user_session=1; Path=/; HttpOnly; SameSite=Lax",
      });
      res.end();
      return;
    }

    // ── GET /authV2/password — password entry page ────────────────────────────
    // Mirrors the real portal page that appears after identifier submission.
    if (url.startsWith("/authV2/password") && method === "GET") {
      if (isAuth) { res.writeHead(302, { Location: "/home" }); res.end(); return; }
      if (!hasUserSession) { res.writeHead(302, { Location: "/login/user" }); res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(authV2PasswordFormHtml(config.showCaptcha ?? false));
      return;
    }

    // ── POST /authV2/password — submit password ───────────────────────────────
    if (url === "/authV2/password" && method === "POST") {
      const body = await parseBody(req);
      const password = (body["password"] ?? "").trim();

      if (config.showBlocked) {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Set-Cookie": "user_session=; Max-Age=0; Path=/",
        });
        res.end(blockedHtml());
        return;
      }

      if (password !== validPassword) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(authV2PasswordFormHtml(false, invalidPasswordMsg));
        return;
      }

      // Correct password → set auth cookie, redirect to dashboard
      res.writeHead(302, {
        Location: "/home",
        "Set-Cookie": [
          "user_session=; Max-Age=0; Path=/",
          "auth_session=1; Path=/; HttpOnly; SameSite=Lax",
        ],
      });
      res.end();
      return;
    }

    // ── GET /login/user — identifier entry
    if ((url.startsWith("/login/user") || url.startsWith("/authV2/sign-in/user-details")) && method === "GET") {
      if (isAuth) { res.writeHead(302, { Location: "/home" }); res.end(); return; }
      if (hasOtpSession) {
        res.writeHead(302, { Location: "/login/verify-otp" }); res.end(); return;
      }
      if (hasUserSession) {
        res.writeHead(302, { Location: "/login/password" }); res.end(); return;
      }
      // Simulate language interstitial — redirect to language picker first
      if (config.languageInterstitial) {
        const redirectTo = encodeURIComponent(url.split("?")[0] ?? "/login/user");
        res.writeHead(302, { Location: `/authV2/language?redirectTo=${redirectTo}` });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(identifierFormHtml(
        config.showCaptcha ?? false,
        config.showManualAction ?? false,
        config.hiddenCaptcha ?? false,
        config.showBlockedAndErrorAtLogin ?? false,
      ));
      return;
    }

    // ── POST /login/user — submit identifier
    if ((url === "/login/user" || url === "/authV2/sign-in/user-details") && method === "POST") {
      const body = await parseBody(req);
      // Accept mobile, email, or any identifier key the adapter may POST
      const identifier = (
        body["mobile"] ?? body["email"] ?? body["emailId"] ?? body["identifier"] ?? ""
      ).trim();
      if (!identifier || identifier.length < 4) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><p role="alert">Please enter a valid registered email ID or mobile number</p>
${identifierFormHtml(false, false)}</body></html>`);
        return;
      }

      if (config.otpFirst) {
        // ── OTP-first flow (Pine Labs ONE /authV2 production behaviour) ──
        // Skip the password step: redirect straight to the OTP page.
        res.writeHead(302, {
          Location: "/authV2/sign-in/verify-otp",
          "Set-Cookie": "otp_session=1; Path=/; HttpOnly; SameSite=Lax",
        });
        res.end();
        return;
      }

      if (config.postIdentifierFixture === "dashboard_with_otp") {
        res.writeHead(302, {
          Location: "/home",
          "Set-Cookie": "auth_session=1; Path=/; HttpOnly; SameSite=Lax",
        });
        res.end();
        return;
      }
      if (config.postIdentifierFixture === "otp_with_password") {
        res.writeHead(302, {
          Location: "/login/verify-otp",
          "Set-Cookie": "otp_session=1; Path=/; HttpOnly; SameSite=Lax",
        });
        res.end();
        return;
      }
      if (config.postIdentifierFixture === "unknown") {
        res.writeHead(302, {
          Location: "/login/post-submit-unknown",
          "Set-Cookie": "user_session=1; Path=/; HttpOnly; SameSite=Lax",
        });
        res.end();
        return;
      }

      // ── Legacy password-first flow ───────────────────────────────────────
      // Valid identifier → set user_session, redirect to password
      res.writeHead(302, {
        Location: config.delayedPasswordRenderMs ? "/login/delayed-password" : "/login/password",
        "Set-Cookie": "user_session=1; Path=/; HttpOnly; SameSite=Lax",
      });
      res.end();
      return;
    }

    // ── GET /login/password — password entry
    // NOTE: must explicitly exclude /authV2/sign-in/verify-otp so the OTP entry
    // handler below matches it first. Without this guard the broad prefix catches
    // /authV2/sign-in/verify-otp, sees no user_session cookie, and redirects to
    // /login/user → /login/verify-otp — silently incrementing otpPageVisitCount
    // before any explicit resend navigation and breaking resendCooldownThenActive.
    if ((url.startsWith("/login/password") ||
         (url.startsWith("/authV2/sign-in") && !url.startsWith("/authV2/sign-in/verify-otp"))) && method === "GET") {
      if (isAuth) { res.writeHead(302, { Location: "/home" }); res.end(); return; }
      if (!hasUserSession) { res.writeHead(302, { Location: "/login/user" }); res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(config.passwordInIframe
        ? iframeShellHtml("/fixture/password-frame", "Password")
        : passwordFormHtml(
          config.showCaptcha ?? false,
          config.otpLink ?? false,
          config.forgotPasswordLinkOnly ?? false,
        ));
      return;
    }

    // ── POST /login/password — submit password
    if ((url === "/login/password" || url === "/authV2/sign-in") && method === "POST") {
      const body = await parseBody(req);
      const password = (body["password"] ?? "").trim();

      if (config.showBlocked) {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Set-Cookie": "user_session=; Max-Age=0; Path=/",
        });
        res.end(blockedHtml());
        return;
      }

      if (password !== validPassword) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(passwordErrorFormHtml(invalidPasswordMsg));
        return;
      }

      // Correct password
      if (config.requireOtp) {
        // Trigger OTP 2FA
        res.writeHead(302, {
          Location: "/login/verify-otp",
          "Set-Cookie": [
            "user_session=; Max-Age=0; Path=/",
            "otp_session=1; Path=/; HttpOnly; SameSite=Lax",
          ],
        });
        res.end();
        return;
      }

      // No OTP required — go to dashboard
      res.writeHead(302, {
        Location: "/home",
        "Set-Cookie": [
          "user_session=; Max-Age=0; Path=/",
          "auth_session=1; Path=/; HttpOnly; SameSite=Lax",
        ],
      });
      res.end();
      return;
    }

    // ── GET /login/verify-otp — OTP entry
    if ((url.startsWith("/login/verify-otp") || url.startsWith("/authV2/sign-in/verify-otp")) && method === "GET") {
      if (isAuth) { res.writeHead(302, { Location: "/home" }); res.end(); return; }
      // ── Cooldown-then-active transition ──────────────────────────────────────
      // Tracks the adapter's explicit resend navigation to /login/verify-otp.
      // The initial OTP-first login redirect lands on /authV2/sign-in/verify-otp
      // and must NOT be counted as a resend attempt — only /login/verify-otp
      // visits (the URL the adapter navigates to in the resend_otp branch) count.
      if (config.resendCooldownThenActive) {
        // Only count the path the adapter navigates to for resend (not the
        // authV2 OTP-first redirect which the browser follows automatically).
        const isResendNavPath = url.startsWith("/login/verify-otp");
        if (isResendNavPath) {
          otpPageVisitCount += 1;
        }
        // During the initial authV2 OTP page load (not a resend attempt) or
        // the first explicit resend navigation → show cooldown countdown.
        // From the second resend navigation onwards → show active div control.
        const isStillCoolingDown = !isResendNavPath || otpPageVisitCount <= 1;
        const transitionConfig: MockServerConfig = {
          ...config,
          resendCooldownThenActive: false,          // prevent recursion
          resendCooldownActive:     isStillCoolingDown,
          liveResendControl:        !isStillCoolingDown,
        };
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(otpFormHtml(undefined, undefined, transitionConfig));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(config.otpInIframe
        ? iframeShellHtml("/fixture/otp-frame", "OTP")
        : config.postIdentifierFixture === "otp_with_password"
          ? classifierFixtureHtml("otp_with_password")
          : otpFormHtml(undefined, undefined, config));
      return;
    }

    // ── POST /login/verify-otp — verify OTP
    if ((url === "/login/verify-otp" || url === "/authV2/sign-in/verify-otp") && method === "POST") {
      const body = await parseBody(req);
      // Support single-field or digit-box reconstruction
      const otp = (body["otp"] ?? "") ||
        [body["d1"], body["d2"], body["d3"], body["d4"], body["d5"], body["d6"]]
          .filter(Boolean).join("");

      if (otp !== validOtp) {
        res.writeHead(200, { "Content-Type": "text/html" });
        const isExpired = otp === "EXPIRED";
        res.end(otpFormHtml(isExpired ? "OTP has expired. Please request a new one." : "Invalid OTP entered", undefined, config));
        return;
      }

      // Valid OTP
      res.writeHead(302, {
        Location: "/home",
        "Set-Cookie": [
          "otp_session=; Max-Age=0; Path=/",
          "auth_session=1; Path=/; HttpOnly; SameSite=Lax",
        ],
      });
      res.end();
      return;
    }

    // ── GET /login/otp-request — portal's "Login with OTP" link target
    // Clears user_session, sets otp_session, redirects to OTP entry page.
    // Only reachable when otpLink=true is configured; always shown in the route
    // table so the browser navigation doesn't 404.
    if (url === "/login/otp-request" && method === "GET") {
      if (!cookies["user_session"] && !cookies["otp_session"]) {
        // No session at all — redirect to identifier page
        res.writeHead(302, { Location: "/login/user" });
        res.end();
        return;
      }
      // Swap user_session → otp_session, then go to OTP entry
      res.writeHead(302, {
        Location: "/login/verify-otp",
        "Set-Cookie": [
          "user_session=; Max-Age=0; Path=/",
          "otp_session=1; Path=/; HttpOnly; SameSite=Lax",
        ],
      });
      res.end();
      return;
    }

    // ── GET /login/forgot-password — password reset entry point
    // Returns a simple reset-flow page. The adapter must NOT treat this as an
    // OTP login link; navigating here should NOT yield AWAITING_OTP.
    if (url === "/login/forgot-password" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><head><title>Pine Labs ONE - Reset Password</title></head><body>
<div id="forgot-password-container">
  <h1>Reset your password</h1>
  <p>Enter your registered email or mobile to receive a reset link.</p>
  <form action="/login/forgot-password" method="POST">
    <input type="text" id="reset-identifier" name="identifier" placeholder="Email or Mobile" />
    <button type="submit">Send Reset Link</button>
  </form>
</div>
</body></html>`);
      return;
    }

    // ── GET /login/resend-otp — resend OTP button target
    // Re-serves the OTP form (simulates portal resending OTP).
    if (url === "/login/resend-otp" && method === "GET") {
      if (!cookies["otp_session"]) {
        res.writeHead(302, { Location: "/login/user" }); res.end(); return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(otpFormHtml("", true, config));
      return;
    }

    // ── 404
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(`<html><body><h1>404 Not Found</h1><p>Path: ${url}</p></body></html>`);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock server address unavailable");
  const port = address.port;
  const url  = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    getRequestCount(pathname: string): number {
      return requestCounts.get(pathname) ?? 0;
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    },
  };
}
