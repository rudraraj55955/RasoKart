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

function captchaHtml(): string {
  return `<iframe src="https://www.google.com/recaptcha/api.js" title="recaptcha" id="captcha-frame"></iframe>`;
}

function manualActionHtml(): string {
  return `
<div id="qr-action" style="padding:20px;text-align:center">
  <h2>Verify your device</h2>
  <p>Scan the QR code with your registered device to continue.</p>
  <img src="data:image/png;base64,iVBORw0KGgo=" alt="QR Code" id="qr-code" style="width:200px;height:200px"/>
</div>`;
}

function identifierFormHtml(showCaptcha: boolean, showManualAction: boolean): string {
  if (showManualAction) {
    return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Login</title></head><body>
${manualActionHtml()}
</body></html>`;
  }
  return `<!DOCTYPE html><html><head><title>Pine Labs ONE - Sign In</title></head><body>
<div id="login-container">
  <h1>Sign In to Pine Labs ONE</h1>
  ${showCaptcha ? captchaHtml() : ""}
  <form action="/login/user" method="POST" id="login-form">
    <label for="mobile">Mobile Number or User ID</label>
    <input type="tel" id="mobile" name="mobile" placeholder="Enter mobile number or User ID" required />
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

    // ── GET /login/user — identifier entry
    if ((url.startsWith("/login/user") || url.startsWith("/authV2/sign-in/user-details")) && method === "GET") {
      if (isAuth) { res.writeHead(302, { Location: "/home" }); res.end(); return; }
      if (hasOtpSession) {
        res.writeHead(302, { Location: "/login/verify-otp" }); res.end(); return;
      }
      if (hasUserSession) {
        res.writeHead(302, { Location: "/login/password" }); res.end(); return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(identifierFormHtml(config.showCaptcha ?? false, config.showManualAction ?? false));
      return;
    }

    // ── POST /login/user — submit identifier
    if ((url === "/login/user" || url === "/authV2/sign-in/user-details") && method === "POST") {
      const body = await parseBody(req);
      const identifier = (body["mobile"] ?? body["userId"] ?? "").trim();
      if (!identifier || identifier.length < 4) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><p role="alert">Please enter a valid mobile number or user ID</p>
${identifierFormHtml(false, false)}</body></html>`);
        return;
      }
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
