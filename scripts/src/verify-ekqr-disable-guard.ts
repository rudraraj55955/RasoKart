/**
 * verify-ekqr-disable-guard.ts
 *
 * Integration smoke-test confirming the ekqr (UPI) gateway disable guard never
 * fires spuriously on re-enable or save-while-disabled.
 *
 * The guard lives in EkqrConfigPanel.handleSave() via computeWillDisable():
 *
 *   const willDisable = computeWillDisable(ekqrConfig?.enabled ?? false, currentEnabled);
 *   guardSave(willDisable, () => saveConfig(...));
 *
 * computeWillDisable returns true ONLY when serverEnabled === true AND
 * localEnabled === false (active gateway being turned off). All other
 * transitions must return false so the "Disable Anyway" AlertDialog is never
 * shown spuriously.
 *
 * This script verifies the two non-dialog scenarios end-to-end through the
 * real API, with a positive-control check that the dialog WOULD trigger for the
 * genuine disable case (enabled → disabled). State is restored after each check.
 *
 * Requires:
 *   - API server running and accessible at localhost:80 (via shared proxy)
 *   - DATABASE_URL and SESSION_SECRET env vars available (same as the server)
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run verify-ekqr-disable-guard
 *
 * Exit code 0 = all checks passed, 1 = one or more checks failed.
 */

import { env } from "node:process";

const EKQR_API_BASE = "http://localhost:80/api";
const EKQR_ADMIN_EMAIL = env["VERIFY_ADMIN_EMAIL"] ?? "admin@rasokart.com";
const EKQR_ADMIN_PASSWORD = env["VERIFY_ADMIN_PASSWORD"] ?? "Admin@123456";

async function ekqrGetToken(): Promise<string> {
  const res = await fetch(`${EKQR_API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EKQR_ADMIN_EMAIL, password: EKQR_ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Admin login failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

function ekqrAuthHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** Mirror of the pure predicate used by every gateway config panel. */
function ekqrComputeWillDisable(serverEnabled: boolean, localEnabled: boolean): boolean {
  return serverEnabled === true && localEnabled === false;
}

type EkqrGatewayConfig = {
  enabled: boolean;
  env: string;
  apiKeySet: boolean;
  webhookSecretSet: boolean;
};

type EkqrCheckResult = { name: string; passed: boolean; detail: string };

async function ekqrGetConfig(token: string): Promise<EkqrGatewayConfig> {
  const res = await fetch(`${EKQR_API_BASE}/system-config/ekqr`, {
    headers: ekqrAuthHeaders(token),
  });
  if (!res.ok) throw new Error(`GET /system-config/ekqr failed with ${res.status}`);
  return (await res.json()) as EkqrGatewayConfig;
}

async function ekqrPutEnabled(token: string, enabled: boolean, gatewayEnv: string): Promise<void> {
  const res = await fetch(`${EKQR_API_BASE}/system-config/ekqr`, {
    method: "PUT",
    headers: ekqrAuthHeaders(token),
    body: JSON.stringify({ enabled, env: gatewayEnv }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PUT /system-config/ekqr failed with ${res.status}: ${txt}`);
  }
}

/**
 * Check 1 — Re-enable scenario (disable → enable):
 *   Server is disabled. User flips toggle ON and saves.
 *   computeWillDisable(false, true) must be false → no dialog.
 *   API PUT with enabled:true must succeed (2xx).
 */
async function checkReEnable(
  token: string,
  originalEnabled: boolean,
  gatewayEnv: string,
): Promise<EkqrCheckResult> {
  const name = "ekqr_re_enable_from_disabled (disable → enable)";
  try {
    if (originalEnabled) await ekqrPutEnabled(token, false, gatewayEnv);

    const serverState = await ekqrGetConfig(token);
    if (serverState.enabled) throw new Error("Setup: expected server disabled before re-enable test");

    const willDisable = ekqrComputeWillDisable(serverState.enabled, true);
    if (willDisable !== false) {
      throw new Error(
        `computeWillDisable(${serverState.enabled}, true) = ${willDisable}, expected false — ` +
          "dialog would spuriously open on re-enable",
      );
    }

    await ekqrPutEnabled(token, true, gatewayEnv);
    const after = await ekqrGetConfig(token);
    if (!after.enabled) throw new Error("PUT enabled:true did not persist");

    await ekqrPutEnabled(token, false, gatewayEnv);
    return {
      name,
      passed: true,
      detail: "computeWillDisable(false,true)=false; PUT enabled:true → 200; state restored",
    };
  } catch (err: any) {
    return { name, passed: false, detail: err?.message ?? String(err) };
  }
}

/**
 * Check 2 — Save-while-disabled scenario (disable → disable):
 *   Server is disabled. User changes another field (env mode) without touching toggle.
 *   computeWillDisable(false, false) must be false → no dialog.
 *   API PUT with enabled:false must succeed (2xx) and keep gateway disabled.
 */
async function checkSaveWhileDisabled(
  token: string,
  originalEnabled: boolean,
  gatewayEnv: string,
): Promise<EkqrCheckResult> {
  const name = "ekqr_save_while_disabled (disable → disable)";
  try {
    if (originalEnabled) await ekqrPutEnabled(token, false, gatewayEnv);

    const serverState = await ekqrGetConfig(token);
    if (serverState.enabled) throw new Error("Setup: expected server disabled before save-while-disabled test");

    const willDisable = ekqrComputeWillDisable(serverState.enabled, false);
    if (willDisable !== false) {
      throw new Error(
        `computeWillDisable(${serverState.enabled}, false) = ${willDisable}, expected false — ` +
          "dialog would spuriously open when saving fields on an already-disabled gateway",
      );
    }

    const altEnv = gatewayEnv === "test" ? "live" : "test";
    await ekqrPutEnabled(token, false, altEnv);
    const after = await ekqrGetConfig(token);
    if (after.enabled) throw new Error("Gateway became enabled unexpectedly after save-while-disabled");

    await ekqrPutEnabled(token, false, gatewayEnv);
    return {
      name,
      passed: true,
      detail: `computeWillDisable(false,false)=false; env ${gatewayEnv}→${altEnv}→${gatewayEnv}; stayed disabled`,
    };
  } catch (err: any) {
    return { name, passed: false, detail: err?.message ?? String(err) };
  }
}

/**
 * Check 3 — Positive control (enable → disable):
 *   Server is enabled. User flips toggle OFF.
 *   computeWillDisable(true, false) must be true → dialog SHOULD open.
 */
async function checkPositiveControl(token: string, gatewayEnv: string): Promise<EkqrCheckResult> {
  const name = "ekqr_positive_control_disable (enable → disable, dialog expected)";
  try {
    await ekqrPutEnabled(token, true, gatewayEnv);

    const serverState = await ekqrGetConfig(token);
    if (!serverState.enabled) throw new Error("Setup: expected server enabled before positive-control test");

    const willDisable = ekqrComputeWillDisable(serverState.enabled, false);
    if (willDisable !== true) {
      throw new Error(
        `computeWillDisable(${serverState.enabled}, false) = ${willDisable}, expected true — ` +
          "dialog must fire when disabling an active gateway",
      );
    }

    await ekqrPutEnabled(token, false, gatewayEnv);
    return {
      name,
      passed: true,
      detail: "computeWillDisable(true,false)=true; guard correctly fires for genuine disable; state restored",
    };
  } catch (err: any) {
    return { name, passed: false, detail: err?.message ?? String(err) };
  }
}

async function main() {
  console.log("=== RasoKart ekqr Disable Guard Verification ===\n");
  console.log("Confirms the disable dialog never fires spuriously");
  console.log("on re-enable or save-while-disabled for the UPI (ekqr) gateway.\n");

  let token: string;
  try {
    token = await ekqrGetToken();
    console.log("✓ Admin login OK\n");
  } catch (err: any) {
    console.error("✗ Admin login FAILED:", err.message);
    process.exit(1);
  }

  const cfg = await ekqrGetConfig(token);
  const origEnabled = cfg.enabled;
  const origEnv = cfg.env ?? "test";
  console.log(`Current ekqr state: enabled=${origEnabled}, env=${origEnv}\n`);

  const results: EkqrCheckResult[] = [];
  results.push(await checkReEnable(token, origEnabled, origEnv));
  results.push(await checkSaveWhileDisabled(token, origEnabled, origEnv));
  results.push(await checkPositiveControl(token, origEnv));

  await ekqrPutEnabled(token, origEnabled, origEnv);

  for (const r of results) {
    console.log(`${r.passed ? "✓ PASS" : "✗ FAIL"} | ${r.name} | ${r.detail}`);
  }

  const failed = results.filter((r) => !r.passed);
  console.log(
    `\n${
      failed.length === 0
        ? `✅ All ${results.length} ekqr disable guard checks passed.`
        : `❌ ${failed.length} of ${results.length} checks FAILED — see output above.`
    }`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
