# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: settings-persistence.spec.ts >> SMTP host persists after page reload
- Location: e2e/settings-persistence.spec.ts:215:1

# Error details

```
Error: Admin login failed: 502
```

# Test source

```ts
  1   | /**
  2   |  * settings-persistence.spec.ts
  3   |  *
  4   |  * E2e regression suite for the admin settings page reload-persistence bug class.
  5   |  *
  6   |  * Each test follows the same flow:
  7   |  *   1. Reset the setting to a known baseline value via direct API call
  8   |  *   2. Navigate to /admin/settings with an admin JWT token already in localStorage
  9   |  *      (avoids the login page entirely and skips 9 sequential login-endpoint hits
  10  |  *      that would otherwise trigger the DB-backed rate limiter)
  11  |  *   3. Wait for the input to hydrate from the API (confirming React Query loaded)
  12  |  *   4. Enter a canary value in the input
  13  |  *   5. Click the card's Save button and wait for the success toast
  14  |  *   6. Do a full page.reload() (clears React state, forces fresh API fetch)
  15  |  *   7. Assert the input shows the saved canary value — not the useState default
  16  |  *
  17  |  * This permanently guards against the silent-reset bug where values reverted to
  18  |  * useState defaults on reload because the React Query v5 `query: { onSuccess }`
  19  |  * callback was a no-op and the useEffect hydration was broken.
  20  |  *
  21  |  * Settings covered:
  22  |  *   - SMTP host
  23  |  *   - QR cleanup retention days
  24  |  *   - VA cleanup retention days
  25  |  *   - Webhook retry max attempts
  26  |  *   - Webhook retry delay 1
  27  |  *   - Report delivery retry max attempts
  28  |  *   - Quiet hours flush interval
  29  |  *   - Audit log retention (API-set / UI-verified — avoids Radix Select interaction)
  30  |  *   - Finance report email
  31  |  *
  32  |  * Excluded: storage cleanup schedule — the backend only exposes run/runs sub-routes
  33  |  * for this card, not a standalone config GET/PUT endpoint, so reload-persistence
  34  |  * cannot be verified for it here.
  35  |  */
  36  | 
  37  | import { test, expect, type Page } from "@playwright/test";
  38  | 
  39  | const BASE = "http://localhost:80";
  40  | const API = `${BASE}/api`;
  41  | const ADMIN_EMAIL = "admin@rasokart.com";
  42  | const ADMIN_PASSWORD = "Admin@123456";
  43  | 
  44  | /** localStorage key used by the RasoKart frontend to store the JWT. */
  45  | const LS_TOKEN_KEY = "rasokart_token";
  46  | 
  47  | // ── HTTP helpers ──────────────────────────────────────────────────────────────
  48  | 
  49  | async function getAdminToken(): Promise<string> {
  50  |   const res = await fetch(`${API}/auth/login`, {
  51  |     method: "POST",
  52  |     headers: { "Content-Type": "application/json" },
  53  |     body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  54  |   });
> 55  |   if (!res.ok) throw new Error(`Admin login failed: ${res.status}`);
      |                      ^ Error: Admin login failed: 502
  56  |   const data = (await res.json()) as { token: string };
  57  |   return data.token;
  58  | }
  59  | 
  60  | function authHeaders(token: string): Record<string, string> {
  61  |   return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  62  | }
  63  | 
  64  | async function apiGet(token: string, path: string): Promise<any> {
  65  |   const res = await fetch(`${API}${path}`, { headers: authHeaders(token) });
  66  |   if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  67  |   return res.json();
  68  | }
  69  | 
  70  | async function apiPut(token: string, path: string, body: object): Promise<void> {
  71  |   const res = await fetch(`${API}${path}`, {
  72  |     method: "PUT",
  73  |     headers: authHeaders(token),
  74  |     body: JSON.stringify(body),
  75  |   });
  76  |   if (!res.ok) {
  77  |     const txt = await res.text();
  78  |     throw new Error(`PUT ${path} → ${res.status}: ${txt}`);
  79  |   }
  80  | }
  81  | 
  82  | // ── UI helpers ────────────────────────────────────────────────────────────────
  83  | 
  84  | /**
  85  |  * Inject the admin JWT into localStorage and navigate directly to the settings
  86  |  * page — skipping the login form entirely.  This avoids hitting the login
  87  |  * endpoint on every test which would otherwise trigger the rate limiter.
  88  |  *
  89  |  * The two-step goto is intentional:
  90  |  *   Step 1 – navigate to the root path to get a same-origin browser context so
  91  |  *             localStorage.setItem can run.  (Navigating directly to /admin/settings
  92  |  *             without a token triggers a wouter client-side redirect to /admin which
  93  |  *             changes the URL, so a subsequent page.reload() lands on the wrong page.)
  94  |  *   Step 2 – navigate to /admin/settings now that the token is in localStorage.
  95  |  */
  96  | async function goToSettings(page: Page, adminToken: string): Promise<void> {
  97  |   // Step 1: any same-origin page to establish localStorage context
  98  |   await page.goto("/admin");
  99  |   await page.evaluate(
  100 |     ([key, tok]) => { localStorage.setItem(key, tok); },
  101 |     [LS_TOKEN_KEY, adminToken],
  102 |   );
  103 |   // Step 2: now navigate to settings — the token is already in localStorage
  104 |   await page.goto("/admin/settings");
  105 |   await page.waitForLoadState("networkidle");
  106 | }
  107 | 
  108 | /**
  109 |  * Find the Save button inside the same Card section that contains the given
  110 |  * input id.  Uses xpath to walk up to the nearest Card-like ancestor (a div
  111 |  * whose class contains "border-border"), then scopes the button search to that
  112 |  * subtree.
  113 |  *
  114 |  * We use `.last()` (not `.first()`) because Playwright returns ancestor nodes
  115 |  * in document order (outermost first).  For inputs that live inside a nested
  116 |  * section div (e.g. the report-delivery-retry section is embedded inside the
  117 |  * SMTP card), the *outermost* ancestor is the wrong card and its first Save
  118 |  * button belongs to a different form.  `.last()` gives us the innermost
  119 |  * (closest) matching ancestor, which always contains exactly the right button.
  120 |  */
  121 | function cardSave(page: Page, inputId: string) {
  122 |   return page
  123 |     .locator(`#${inputId}`)
  124 |     .locator("xpath=ancestor::div[contains(@class,'border-border')]")
  125 |     .last()
  126 |     .getByRole("button", { name: /^save$/i })
  127 |     .first();
  128 | }
  129 | 
  130 | /** Triple-click to select all content, then fill with the new value. */
  131 | async function fillNumeric(page: Page, id: string, value: number): Promise<void> {
  132 |   const input = page.locator(`#${id}`);
  133 |   await input.click({ clickCount: 3 });
  134 |   await input.fill(String(value));
  135 | }
  136 | 
  137 | // ── Saved originals (restored in afterAll) ────────────────────────────────────
  138 | 
  139 | let token: string;
  140 | 
  141 | type Originals = {
  142 |   smtp: { host: string | null; port: string | null; user: string | null; from: string | null };
  143 |   qrRetention: number;
  144 |   vaRetention: number;
  145 |   webhookRetry: { maxAttempts: number; delay1: number; delay2: number; delay3: number };
  146 |   reportRetry: { maxAttempts: number; backoffBaseMs: number };
  147 |   quietHoursFlush: number;
  148 |   auditLogRetention: number;
  149 |   financeEmail: string | null;
  150 | };
  151 | 
  152 | let originals: Originals;
  153 | 
  154 | test.beforeAll(async () => {
  155 |   token = await getAdminToken();
```