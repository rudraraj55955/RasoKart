/**
 * Mock Paytm Business Portal HTTP Server for E2E testing.
 *
 * Simulates business.paytm.com login flow in a real local HTTP server.
 * The real Chromium browser navigates to this server via PAYTM_PORTAL_ROOT_OVERRIDE.
 * No real Paytm API calls, no real OTPs, no real credentials are used.
 *
 * STATE MACHINE (tracked via cookies):
 *   No cookie               → GET /user/login shows mobile entry form
 *   otp_session cookie      → GET /user/login shows OTP entry form
 *   auth_session cookie     → GET /home shows dashboard; redirect from root
 *
 * CONFIGURABLE:
 *   validOtp        — OTP string the server accepts (default "123456")
 *   maskedMobile    — displayed on /profile page for ownership check
 *   mid             — MID shown on profile (optional)
 *   noOwnershipData — if true, /profile has no mobile/MID (tests fail-closed)
 *   showCaptcha     — if true, OTP page includes a captcha iframe
 *   showBlocked     — if true, post-OTP page shows blocked message
 *   invalidOtpMsg   — error message returned for wrong OTP
 *
 * USAGE:
 *   const srv = await startMockPaytmServer({ validOtp: "123456", maskedMobile: "**XXXXXX890" });
 *   process.env["PAYTM_PORTAL_ROOT_OVERRIDE"] = srv.url;
 *   // ... run tests ...
 *   await srv.close();
 *   delete process.env["PAYTM_PORTAL_ROOT_OVERRIDE"];
 */

import * as http from "node:http";

export interface MockServerConfig {
  /** OTP value the server accepts as valid. */
  validOtp?: string;
  /** Masked mobile shown on the /profile page (e.g. "**XXXXXX890"). */
  maskedMobile?: string;
  /** MID shown on /profile (optional). */
  mid?: string;
  /** Business name shown on /profile (optional). */
  businessName?: string;
  /** If true, /profile has no phone/MID data → tests ownership-unverifiable path. */
  noOwnershipData?: boolean;
  /** If true, OTP form includes a captcha iframe → tests CAPTCHA detection. */
  showCaptcha?: boolean;
  /** If true, post-submit page shows "account has been blocked" → tests BLOCKED. */
  showBlocked?: boolean;
  /** Error message on wrong OTP. Default: "Invalid OTP entered" */
  invalidOtpMsg?: string;
}

export interface MockServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k && v) cookies[k] = v;
  }
  return cookies;
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
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

// ── HTML templates ─────────────────────────────────────────────────────────────

function loginPageHtml(): string {
  return `<!DOCTYPE html><html><head><title>Paytm Business - Login</title></head><body>
<div id="login-container">
  <h1>Login to Paytm Business</h1>
  <form action="/user/send-otp" method="POST" id="login-form">
    <label for="phone">Mobile Number</label>
    <input type="tel" id="phone" name="phone" placeholder="Enter mobile number" required />
    <button type="submit" id="get-otp-btn">Get OTP</button>
  </form>
</div>
</body></html>`;
}

function otpPageHtml(showCaptcha: boolean): string {
  return `<!DOCTYPE html><html><head><title>Paytm Business - Verify OTP</title></head><body>
<div id="otp-container">
  <h1>Enter OTP</h1>
  <p>OTP has been sent to your registered mobile number.</p>
  ${showCaptcha ? '<iframe src="https://www.google.com/recaptcha/api.js" title="recaptcha"></iframe>' : ""}
  <form action="/user/verify-otp" method="POST" id="otp-form">
    <div id="otp-inputs">
      <input type="text" maxlength="1" name="d1" autocomplete="off" />
      <input type="text" maxlength="1" name="d2" autocomplete="off" />
      <input type="text" maxlength="1" name="d3" autocomplete="off" />
      <input type="text" maxlength="1" name="d4" autocomplete="off" />
      <input type="text" maxlength="1" name="d5" autocomplete="off" />
      <input type="text" maxlength="1" name="d6" autocomplete="off" />
    </div>
    <button type="submit" id="verify-btn">Verify</button>
  </form>
</div>
</body></html>`;
}

function otpErrorPageHtml(errorMsg: string): string {
  return `<!DOCTYPE html><html><head><title>Paytm Business - Verify OTP</title></head><body>
<div id="otp-container">
  <h1>Enter OTP</h1>
  <p role="alert" class="error-message">${errorMsg}</p>
  <form action="/user/verify-otp" method="POST" id="otp-form">
    <div id="otp-inputs">
      <input type="text" maxlength="1" name="d1" autocomplete="off" />
      <input type="text" maxlength="1" name="d2" autocomplete="off" />
      <input type="text" maxlength="1" name="d3" autocomplete="off" />
      <input type="text" maxlength="1" name="d4" autocomplete="off" />
      <input type="text" maxlength="1" name="d5" autocomplete="off" />
      <input type="text" maxlength="1" name="d6" autocomplete="off" />
    </div>
    <button type="submit" id="verify-btn">Verify</button>
  </form>
</div>
</body></html>`;
}

function dashboardHtml(): string {
  return `<!DOCTYPE html><html><head><title>Paytm Business - Dashboard</title></head><body>
<nav id="sidebar" aria-label="merchant navigation">
  <a href="/transactions">Transactions</a>
  <a href="/settlement">Settlement</a>
  <a href="/reports">Reports</a>
  <a href="/profile" id="profile-link" aria-label="profile">My Account</a>
</nav>
<main id="dashboard">
  <h1>Dashboard</h1>
  <div class="stats">
    <div>Total Transactions</div>
    <div>Gross Sales: ₹50,000</div>
    <div>Settlement Amount: ₹48,000</div>
    <div>Success Rate: 97%</div>
  </div>
</main>
</body></html>`;
}

function blockedPageHtml(): string {
  return `<!DOCTYPE html><html><head><title>Account Blocked</title></head><body>
<div class="blocked-container">
  <h1>account has been blocked</h1>
  <p>Your account has been temporarily blocked due to suspicious activity.</p>
</div>
</body></html>`;
}

function profileHtml(config: MockServerConfig): string {
  if (config.noOwnershipData) {
    return `<!DOCTYPE html><html><head><title>Paytm Business - Profile</title></head><body>
<div class="profile-container">
  <h1>My Account</h1>
  <p>Loading account details...</p>
</div>
</body></html>`;
  }
  const maskedMobile = config.maskedMobile ?? "**XXXXXX890";
  const mid = config.mid ?? "123456789012";
  const businessName = config.businessName ?? "Test Business Pvt Ltd";
  return `<!DOCTYPE html><html><head><title>Paytm Business - Profile</title></head><body>
<div class="profile-container" data-testid="profile">
  <h1>My Account</h1>
  <div class="profile-details">
    <p class="business-name">Business Name: ${businessName}</p>
    <p data-testid="mid">Merchant ID: ${mid}</p>
    <p class="registered-mobile">Registered Mobile: ${maskedMobile}</p>
    <p>Email: test@business.com</p>
  </div>
</div>
</body></html>`;
}

function transactionsHtml(): string {
  return `<!DOCTYPE html><html><head><title>Paytm Business - Transactions</title></head><body>
<nav><a href="/transactions">Transactions</a></nav>
<main>
  <h1>Total Transactions</h1>
  <table>
    <tbody>
      <tr class="transaction-row">
        <td>₹500</td>
        <td>SUCCESS</td>
        <td>01/01/2025</td>
        <td>PAYTM123456</td>
      </tr>
      <tr class="transaction-row">
        <td>₹250</td>
        <td>FAILED</td>
        <td>01/01/2025</td>
        <td>PAYTM789012</td>
      </tr>
    </tbody>
  </table>
</main>
</body></html>`;
}

// ── Server ─────────────────────────────────────────────────────────────────────

export async function startMockPaytmServer(
  config: MockServerConfig = {},
): Promise<MockServer> {
  const validOtp = config.validOtp ?? "123456";
  const invalidOtpMsg = config.invalidOtpMsg ?? "Invalid OTP entered";

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    const cookies = parseCookies(req.headers["cookie"]);
    const isAuth = !!cookies["auth_session"];
    const hasOtpPending = !!cookies["otp_session"];

    // ── Routing ──────────────────────────────────────────────────────────────

    // Root — redirect based on auth state
    if (url === "/" || url === "") {
      if (isAuth) {
        res.writeHead(302, { Location: "/home" });
        res.end();
      } else {
        res.writeHead(302, { Location: "/user/login" });
        res.end();
      }
      return;
    }

    // Login page — serve mobile form or OTP form based on cookie
    if (url.startsWith("/user/login") || url.startsWith("/login")) {
      if (isAuth) {
        // Already authenticated → go to dashboard
        res.writeHead(302, { Location: "/home" });
        res.end();
        return;
      }
      if (hasOtpPending) {
        // Pending OTP session → show OTP form
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(otpPageHtml(config.showCaptcha ?? false));
      } else {
        // Fresh session → show mobile entry form
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(loginPageHtml());
      }
      return;
    }

    // Send OTP (form POST from mobile entry)
    if (url === "/user/send-otp" && method === "POST") {
      const body = await parseBody(req);
      const phone = body["phone"] ?? "";
      if (!phone || phone.replace(/\D/g, "").length < 10) {
        // Invalid phone → show error on login page
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><p role="alert">Invalid mobile number</p>${loginPageHtml()}</body></html>`);
        return;
      }
      // Set OTP pending cookie, show OTP page
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Set-Cookie": "otp_session=1; Path=/; HttpOnly; SameSite=Lax",
      });
      res.end(otpPageHtml(config.showCaptcha ?? false));
      return;
    }

    // Verify OTP (form POST from OTP entry)
    if (url === "/user/verify-otp" && method === "POST") {
      const body = await parseBody(req);
      // Reconstruct OTP from digit fields or direct 'otp' field
      const otp = (body["otp"] ?? "")
        || [body["d1"], body["d2"], body["d3"], body["d4"], body["d5"], body["d6"]]
          .filter(Boolean)
          .join("");

      if (config.showBlocked) {
        // Show blocked page
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Set-Cookie": "otp_session=; Max-Age=0; Path=/",
        });
        res.end(blockedPageHtml());
        return;
      }

      if (otp === validOtp) {
        // Correct OTP → set auth cookie, redirect to dashboard
        res.writeHead(302, {
          Location: "/home",
          "Set-Cookie": [
            "otp_session=; Max-Age=0; Path=/",
            "auth_session=valid; Path=/; HttpOnly; SameSite=Lax",
          ],
        });
        res.end();
      } else {
        // Wrong OTP → show error, keep OTP pending cookie
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(otpErrorPageHtml(invalidOtpMsg));
      }
      return;
    }

    // Dashboard / home
    if (url.startsWith("/home") || url.startsWith("/dashboard") || url.startsWith("/overview")) {
      if (!isAuth) {
        res.writeHead(302, { Location: "/user/login" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(dashboardHtml());
      return;
    }

    // Profile / account pages
    if (PROFILE_PATHS_STATIC.some((p) => url.startsWith(p))) {
      if (!isAuth) {
        res.writeHead(302, { Location: "/user/login" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(profileHtml(config));
      return;
    }

    // Transactions page
    if (url.startsWith("/transactions")) {
      if (!isAuth) {
        res.writeHead(302, { Location: "/user/login" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(transactionsHtml());
      return;
    }

    // Logout
    if (url.startsWith("/user/logout")) {
      res.writeHead(302, {
        Location: "/user/login",
        "Set-Cookie": [
          "otp_session=; Max-Age=0; Path=/",
          "auth_session=; Max-Age=0; Path=/",
        ],
      });
      res.end();
      return;
    }

    // Settlement / reports (protected pages that serve dashboard-like content)
    if (url.startsWith("/settlement") || url.startsWith("/reports")) {
      if (!isAuth) {
        res.writeHead(302, { Location: "/user/login" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(dashboardHtml());
      return;
    }

    // 404 fallback
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`Not found: ${url}`);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  const port = addr.port;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

// Keep a static copy for the server's own use (profile paths that the server handles)
const PROFILE_PATHS_STATIC = ["/profile", "/account", "/user/profile", "/settings/profile", "/merchant-profile"];
