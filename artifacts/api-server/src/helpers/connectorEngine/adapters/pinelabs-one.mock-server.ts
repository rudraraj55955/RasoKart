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
}

export interface MockServer {
  url:   string;
  port:  number;
  close(): Promise<void>;
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

function identifierFormHtml(showCaptcha: boolean, showManualAction: boolean, showHiddenCaptcha?: boolean): string {
  if (showManualAction) {
    return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Login</title></head><body>
${manualActionHtml()}
</body></html>`;
  }
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Sign In</title></head><body>
<div id="login-container">
  <h1>Sign In to Pine Labs ONE</h1>
  ${showCaptcha ? captchaHtml() : ""}
  ${showHiddenCaptcha ? hiddenCaptchaHtml() : ""}
  <form action="/login/user" method="POST" id="login-form">
    <label for="mobile">Registered Email ID or Mobile Number</label>
    <input type="text" id="mobile" name="mobile" placeholder="Registered email ID or 10-digit mobile" required />
    <button type="submit" id="next-btn">Next</button>
  </form>
</div>
</body></html>`;
}

function passwordFormHtml(showCaptcha: boolean): string {
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Enter Password</title></head><body>
<div id="password-container">
  <h1>Enter Password</h1>
  ${showCaptcha ? captchaHtml() : ""}
  <form action="/login/password" method="POST" id="password-form">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" placeholder="Enter your password" required />
    <button type="submit" id="sign-in-btn">Sign In</button>
  </form>
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

function otpFormHtml(showError?: string): string {
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

  const server = http.createServer(async (req, res) => {
    const url    = req.url ?? "/";
    const method = req.method ?? "GET";
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
      res.end(dashboardHtml());
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
      res.writeHead(302, {
        Location: "/login/password",
        "Set-Cookie": "user_session=1; Path=/; HttpOnly; SameSite=Lax",
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
      res.end(identifierFormHtml(config.showCaptcha ?? false, config.showManualAction ?? false, config.hiddenCaptcha ?? false));
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

      // ── Legacy password-first flow ───────────────────────────────────────
      // Valid identifier → set user_session, redirect to password
      res.writeHead(302, {
        Location: "/login/password",
        "Set-Cookie": "user_session=1; Path=/; HttpOnly; SameSite=Lax",
      });
      res.end();
      return;
    }

    // ── GET /login/password — password entry
    if ((url.startsWith("/login/password") || url.startsWith("/authV2/sign-in")) && method === "GET") {
      if (isAuth) { res.writeHead(302, { Location: "/home" }); res.end(); return; }
      if (!hasUserSession) { res.writeHead(302, { Location: "/login/user" }); res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(passwordFormHtml(config.showCaptcha ?? false));
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
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(otpFormHtml());
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
        res.end(otpFormHtml(isExpired ? "OTP has expired. Please request a new one." : "Invalid OTP entered"));
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
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    },
  };
}
