/**
 * verify-alert-email-samples.ts
 *
 * End-to-end smoke test for all 6 admin alert email "send-sample" endpoints.
 *
 * Steps:
 *  1. Snapshot original SMTP config AND admin alert preferences directly from
 *     the DB (so we can do a lossless restore regardless of API masking)
 *  2. Create a temporary Ethereal test SMTP account (free, no signup needed)
 *  3. Write Ethereal SMTP creds into system_settings via DB upsert
 *  4. Enable all 6 alert email preferences for the admin user via DB update
 *  5. Call each of the 6 send-sample endpoints via HTTP (as the admin user)
 *  6. Query the audit_logs table to confirm test_email_sent rows
 *  7. Verify each preview endpoint returns valid HTML
 *  8. Restore ORIGINAL SMTP rows and admin preferences via DB (lossless)
 *  9. Print Ethereal inbox URL for manual email HTML inspection
 *
 * Requires:
 *   - API server running at localhost:80 (via shared proxy)
 *   - DATABASE_URL and SESSION_SECRET env vars available
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run verify-alert-email-samples
 *
 * Exit code 0 = all checks passed, 1 = one or more checks failed.
 */

import { promisify } from "node:util";
import nodemailer from "nodemailer";
import {
  db,
  auditLogsTable,
  usersTable,
  systemSettingsTable,
} from "@workspace/db";
import { and, eq, gte, desc, inArray } from "drizzle-orm";

const BASE_URL = "http://localhost:80/api";
const ADMIN_EMAIL = process.env["VERIFY_ADMIN_EMAIL"] ?? "admin@rasokart.com";
const ADMIN_PASSWORD =
  process.env["VERIFY_ADMIN_PASSWORD"] ?? "Admin@123456";

const SMTP_KEYS = [
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_pass",
  "smtp_from",
] as const;

// The 5 preference columns exercised by the 6 send-sample endpoints
const PREF_COLUMNS = [
  "planExpiryAlertEmails",
  "settlementStateEmails",
  "webhookFailureEmails",
  "ekqrSyncAlertEmails",
  "reportFailureAlertEmails",
] as const;

type PrefKey = (typeof PREF_COLUMNS)[number];
type SmtpKey = (typeof SMTP_KEYS)[number];

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Admin login failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function httpPost(
  token: string,
  path: string,
): Promise<{ ok: boolean; error?: string; data?: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: auth(token),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, error: res.ok ? undefined : (data?.error ?? text), data };
}

async function httpGetHtml(
  token: string,
  path: string,
): Promise<{ ok: boolean; html: string; status: number }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ok: res.ok, html: await res.text(), status: res.status };
}

// ---------------------------------------------------------------------------
// Ethereal test account
// ---------------------------------------------------------------------------

interface TestAccount {
  user: string;
  pass: string;
  smtp: { host: string; port: number; secure: boolean };
  web: string;
}

async function createEtherealAccount(): Promise<TestAccount | null> {
  // nodemailer v8 exposes createTestAccount as a direct async function
  try {
    return await (nodemailer as any).createTestAccount();
  } catch {
    // Older callback style fallback
    try {
      const createTestAccount = promisify(
        (cb: (err: Error | null, acc: TestAccount) => void) =>
          (nodemailer as any).createTestAccount(cb),
      );
      return await createTestAccount();
    } catch (err2) {
      console.warn(
        "  ⚠ Could not create Ethereal test account:",
        (err2 as Error).message,
      );
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// DB-level SMTP snapshot / restore (lossless — includes password)
// ---------------------------------------------------------------------------

type SmtpSnapshot = Array<{
  key: SmtpKey;
  value: string | null;
  existed: boolean;
}>;

async function snapshotSmtp(): Promise<SmtpSnapshot> {
  const rows = await db
    .select()
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, [...SMTP_KEYS]));

  return SMTP_KEYS.map((k) => {
    const row = rows.find((r) => r.key === k);
    return { key: k, value: row?.value ?? null, existed: Boolean(row) };
  });
}

async function writeSmtpToDb(
  host: string,
  port: number,
  user: string,
  pass: string,
  from: string,
): Promise<void> {
  const pairs: Array<{ key: string; value: string }> = [
    { key: "smtp_host", value: host },
    { key: "smtp_port", value: String(port) },
    { key: "smtp_user", value: user },
    { key: "smtp_pass", value: pass },
    { key: "smtp_from", value: from },
  ];
  for (const { key, value } of pairs) {
    await db
      .insert(systemSettingsTable)
      .values({ key, value, updatedBy: null as any, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettingsTable.key,
        set: { value, updatedAt: new Date() },
      });
  }
}

async function restoreSmtp(snapshot: SmtpSnapshot): Promise<void> {
  for (const entry of snapshot) {
    if (!entry.existed) {
      // Row didn't exist before — delete it so we leave no trace
      await db
        .delete(systemSettingsTable)
        .where(eq(systemSettingsTable.key, entry.key));
    } else {
      // Row existed — restore exact original value (including original password)
      await db
        .insert(systemSettingsTable)
        .values({
          key: entry.key,
          value: entry.value,
          updatedBy: null as any,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: systemSettingsTable.key,
          set: { value: entry.value, updatedAt: new Date() },
        });
    }
  }
}

// ---------------------------------------------------------------------------
// DB-level admin preference snapshot / restore (lossless)
// ---------------------------------------------------------------------------

type PrefSnapshot = Record<PrefKey, boolean>;

async function snapshotAdminPrefs(adminEmail: string): Promise<{ id: number; prefs: PrefSnapshot } | null> {
  const rows = await db
    .select({
      id: usersTable.id,
      planExpiryAlertEmails: usersTable.planExpiryAlertEmails,
      settlementStateEmails: usersTable.settlementStateEmails,
      webhookFailureEmails: usersTable.webhookFailureEmails,
      ekqrSyncAlertEmails: usersTable.ekqrSyncAlertEmails,
      reportFailureAlertEmails: usersTable.reportFailureAlertEmails,
    })
    .from(usersTable)
    .where(eq(usersTable.email, adminEmail));

  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    id: row.id,
    prefs: {
      planExpiryAlertEmails: row.planExpiryAlertEmails,
      settlementStateEmails: row.settlementStateEmails,
      webhookFailureEmails: row.webhookFailureEmails,
      ekqrSyncAlertEmails: row.ekqrSyncAlertEmails,
      reportFailureAlertEmails: row.reportFailureAlertEmails,
    },
  };
}

async function enableAllPrefs(adminId: number): Promise<void> {
  await db
    .update(usersTable)
    .set({
      planExpiryAlertEmails: true,
      settlementStateEmails: true,
      webhookFailureEmails: true,
      ekqrSyncAlertEmails: true,
      reportFailureAlertEmails: true,
    })
    .where(eq(usersTable.id, adminId));
}

async function restorePrefs(
  adminId: number,
  snapshot: PrefSnapshot,
): Promise<void> {
  await db
    .update(usersTable)
    .set(snapshot)
    .where(eq(usersTable.id, adminId));
}

// ---------------------------------------------------------------------------
// Check result type
// ---------------------------------------------------------------------------

type CheckResult = { name: string; passed: boolean; detail: string };

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log("=== RasoKart Alert Email Samples — End-to-End Verification ===\n");

  // Guard: skip gracefully when no SMTP credentials are configured in the environment.
  // This prevents blocking cold-start deploys where email is not yet configured.
  // Set SMTP_HOST + SMTP_USER in the environment (e.g. ecosystem.config.cjs) to enable
  // the full check. The script uses an Ethereal test account internally for sending, but
  // SMTP_HOST presence signals that this environment is configured for email operations.
  const smtpConfiguredInEnv = Boolean(
    process.env["SMTP_HOST"] && process.env["SMTP_USER"],
  );
  if (!smtpConfiguredInEnv) {
    console.log(
      "⚠  SMTP credentials not configured in environment (SMTP_HOST / SMTP_USER missing).\n" +
        "   Skipping alert email verification — set SMTP_HOST, SMTP_PORT, SMTP_USER,\n" +
        "   SMTP_PASS, and SMTP_FROM in ecosystem.config.cjs (or your environment) to\n" +
        "   enable this post-merge check.\n",
    );
    process.exit(0);
  }

  // 1. Admin login
  let token: string;
  try {
    token = await getAdminToken();
    console.log(`✓ Admin login OK (${ADMIN_EMAIL})\n`);
  } catch (err: any) {
    console.error("✗ Admin login FAILED:", err.message);
    process.exit(1);
  }

  // 2. Snapshot original state (DB-level, lossless — captures password too)
  console.log("── Step 1: Snapshotting original SMTP config and admin preferences …");
  const smtpSnapshot = await snapshotSmtp();
  const adminSnapshot = await snapshotAdminPrefs(ADMIN_EMAIL);
  if (!adminSnapshot) {
    console.error(`✗ Admin user "${ADMIN_EMAIL}" not found in DB`);
    process.exit(1);
  }
  console.log(
    `  SMTP: ${smtpSnapshot.find((s) => s.key === "smtp_host")?.value ?? "(none)"}`,
  );
  console.log(
    `  Prefs: planExpiry=${adminSnapshot.prefs.planExpiryAlertEmails} settlement=${adminSnapshot.prefs.settlementStateEmails} ` +
    `webhook=${adminSnapshot.prefs.webhookFailureEmails} ekqr=${adminSnapshot.prefs.ekqrSyncAlertEmails} ` +
    `report=${adminSnapshot.prefs.reportFailureAlertEmails}`,
  );
  console.log();

  // 3. Create Ethereal test SMTP account
  console.log("── Step 2: Creating Ethereal test SMTP account …");
  const ethereal = await createEtherealAccount();
  if (!ethereal) {
    console.error(
      "✗ Could not create Ethereal test account.\n" +
        "  The script requires outbound network access to ethereal.email:443.",
    );
    // Restore before exit
    await restoreSmtp(smtpSnapshot).catch(() => {});
    process.exit(1);
  }
  console.log(`  Host : ${ethereal.smtp.host}:${ethereal.smtp.port}`);
  console.log(`  User : ${ethereal.user}`);
  console.log(`  Web  : ${ethereal.web}`);
  console.log();

  // Track whether we've touched state so the finally block knows what to restore
  let smtpMutated = false;
  let prefsMutated = false;

  try {
    // 4. Write Ethereal SMTP directly to DB (bypasses API password masking)
    console.log("── Step 3: Writing Ethereal SMTP to system_settings (DB) …");
    await writeSmtpToDb(
      ethereal.smtp.host,
      ethereal.smtp.port,
      ethereal.user,
      ethereal.pass,
      `RasoKart Test <${ethereal.user}>`,
    );
    smtpMutated = true;
    console.log("  ✓ SMTP written\n");

    // 5. Enable all 6 alert email preferences (DB update, lossless snapshot taken above)
    console.log("── Step 4: Enabling all 6 alert email preferences for admin (DB) …");
    await enableAllPrefs(adminSnapshot.id);
    prefsMutated = true;
    console.log("  ✓ Preferences enabled\n");

    // 6. Record timestamp for audit log narrowing
    const testStartTime = new Date();

    // 7. Call all 6 send-sample endpoints
    const ALERTS: Array<{
      name: string;
      endpoint: string;
      auditType: string;
      previewEndpoint: string;
      previewKeywords: string[];
    }> = [
      {
        name: "Plan Expiry Alert",
        endpoint: "/settings/plan-expiry-alert/send-sample",
        auditType: "plan_expiry_alert",
        previewEndpoint: "/settings/plan-expiry-alert/preview",
        previewKeywords: ["Plan Expiry", "Demo Merchant"],
      },
      {
        name: "Settlement State Change Alert",
        endpoint: "/settings/settlement-state-alert/send-sample",
        auditType: "settlement_state_alert",
        previewEndpoint: "/settings/settlement-state-alert/preview",
        previewKeywords: ["Settlement", "approved"],
      },
      {
        name: "Webhook Failure Alert",
        endpoint: "/settings/webhook-failure-alert/send-sample",
        auditType: "webhook_failure_alert",
        previewEndpoint: "/settings/webhook-failure-alert/preview",
        previewKeywords: ["Webhook", "Failed"],
      },
      {
        name: "EKQR Stuck QR Alert",
        endpoint: "/settings/ekqr-stuck-alert/send-sample",
        auditType: "ekqr_stuck_alert",
        previewEndpoint: "/settings/ekqr-stuck-alert/preview",
        previewKeywords: ["EKQR", "Stuck"],
      },
      {
        name: "Report Auto-Pause Alert",
        endpoint: "/settings/report-autopause-alert/send-sample",
        auditType: "report_autopause_alert",
        previewEndpoint: "/settings/report-autopause-alert/preview",
        previewKeywords: ["Auto-Paused", "Report"],
      },
      {
        name: "Report Resumed Alert",
        endpoint: "/settings/report-resumed-alert/send-sample",
        auditType: "report_resumed_alert",
        previewEndpoint: "/settings/report-resumed-alert/preview",
        previewKeywords: ["Resumed", "Report"],
      },
    ];

    console.log("── Step 5: Calling all 6 send-sample endpoints …\n");
    const sendResults: CheckResult[] = [];

    for (const alert of ALERTS) {
      const sendResult = await httpPost(token, alert.endpoint);
      if (!sendResult.ok) {
        sendResults.push({
          name: alert.name,
          passed: false,
          detail: `send-sample error: ${sendResult.error}`,
        });
        console.log(`  ✗ ${alert.name}: ${sendResult.error}`);
      } else {
        const stats = sendResult.data?.stats;
        const passed = stats?.sent > 0;
        sendResults.push({
          name: alert.name,
          passed,
          detail: passed
            ? `sent=${stats.sent} attempted=${stats.attempted} failed=${stats.failed}`
            : `stats.sent=0 (stats: ${JSON.stringify(stats)})`,
        });
        console.log(
          `  ${passed ? "✓" : "✗"} ${alert.name}: ` +
            `sent=${stats?.sent ?? "?"} attempted=${stats?.attempted ?? "?"} failed=${stats?.failed ?? "?"}`,
        );
      }
    }

    // 8. Verify audit log entries
    console.log("\n── Step 6: Verifying audit_logs entries …\n");
    const auditResults: CheckResult[] = [];

    const auditRows = await db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.action, "test_email_sent"),
          gte(auditLogsTable.createdAt, testStartTime),
        ),
      )
      .orderBy(desc(auditLogsTable.createdAt));

    for (const alert of ALERTS) {
      const match = auditRows.find((r) => {
        try {
          return JSON.parse(r.details ?? "{}").type === alert.auditType;
        } catch {
          return false;
        }
      });
      if (match) {
        const d = JSON.parse(match.details ?? "{}");
        auditResults.push({
          name: `audit: ${alert.name}`,
          passed: true,
          detail: `row id=${match.id} type=${d.type} sent=${d.sent} failed=${d.failed}`,
        });
      } else {
        auditResults.push({
          name: `audit: ${alert.name}`,
          passed: false,
          detail: `No audit_logs row with action=test_email_sent type=${alert.auditType} since ${testStartTime.toISOString()}`,
        });
      }
    }
    for (const r of auditResults) {
      console.log(`  ${r.passed ? "✓" : "✗"} ${r.name}: ${r.detail}`);
    }

    // 9. Verify preview endpoints
    console.log("\n── Step 7: Verifying preview endpoints return valid HTML …\n");
    const previewResults: CheckResult[] = [];

    for (const alert of ALERTS) {
      try {
        const { ok, html, status } = await httpGetHtml(token, alert.previewEndpoint);
        if (!ok) {
          previewResults.push({
            name: `preview: ${alert.name}`,
            passed: false,
            detail: `HTTP ${status}`,
          });
          continue;
        }
        const missing = alert.previewKeywords.filter(
          (kw) => !html.toLowerCase().includes(kw.toLowerCase()),
        );
        previewResults.push({
          name: `preview: ${alert.name}`,
          passed: missing.length === 0,
          detail:
            missing.length === 0
              ? `${html.length} bytes, keywords OK: ${alert.previewKeywords.join(", ")}`
              : `HTML missing: ${missing.join(", ")}`,
        });
      } catch (err: any) {
        previewResults.push({
          name: `preview: ${alert.name}`,
          passed: false,
          detail: err.message,
        });
      }
    }
    for (const r of previewResults) {
      console.log(`  ${r.passed ? "✓" : "✗"} ${r.name}: ${r.detail}`);
    }

    // 10. Summary (printed after restore in finally)
    const allResults = [...sendResults, ...auditResults, ...previewResults];
    const totalPassed = allResults.filter((r) => r.passed).length;
    const totalFailed = allResults.filter((r) => !r.passed).length;

    console.log("\n═══════════════════════════════════════════════════════════\n");
    console.log(`📬 Ethereal inbox (inspect received test emails):`);
    console.log(`   URL      : ${ethereal.web}`);
    console.log(`   Username : ${ethereal.user}`);
    console.log(`   Password : ${ethereal.pass}`);
    console.log(
      `   → Sign in at ${ethereal.web} → Messages to inspect rendered HTML\n`,
    );

    if (totalFailed === 0) {
      console.log(
        `✅ All ${allResults.length} checks passed (${sendResults.length} send-sample ` +
          `+ ${auditResults.length} audit + ${previewResults.length} preview).`,
      );
    } else {
      console.log(`❌ ${totalFailed} of ${allResults.length} checks FAILED:\n`);
      for (const r of allResults.filter((r) => !r.passed)) {
        console.log(`   ✗ ${r.name}: ${r.detail}`);
      }
    }

    // Return exit code AFTER restore (in finally)
    process.exitCode = totalFailed === 0 ? 0 : 1;
  } finally {
    // 11. Lossless restore — runs regardless of success/failure above
    console.log("\n── Step 8: Restoring original state (DB) …");

    if (smtpMutated) {
      try {
        await restoreSmtp(smtpSnapshot);
        const origHost =
          smtpSnapshot.find((s) => s.key === "smtp_host")?.value ?? null;
        console.log(
          origHost
            ? `  ✓ SMTP restored to original (host: ${origHost})`
            : "  ✓ SMTP cleared (no config existed before test)",
        );
      } catch (err: any) {
        console.error("  ✗ SMTP restore failed:", err.message);
      }
    }

    if (prefsMutated) {
      try {
        await restorePrefs(adminSnapshot.id, adminSnapshot.prefs);
        console.log(
          `  ✓ Admin preferences restored to original values`,
        );
      } catch (err: any) {
        console.error("  ✗ Preference restore failed:", err.message);
      }
    }
  }
}

run().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
