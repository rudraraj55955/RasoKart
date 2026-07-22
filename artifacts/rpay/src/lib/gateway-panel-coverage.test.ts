/**
 * Gateway Panel Coverage Test
 *
 * Automated enforcement: every component file that calls a gateway save
 * mutation (useUpdateEkqrConfig, useUpdateProviderIntegration, …) MUST also
 * call `useDisableGatewayGuard`, unless it is explicitly listed in
 * GATEWAY_PANEL_KNOWN_GAPS with a documented reason.
 *
 * Detection uses call-site regex patterns (\bhookName\s*\() so that import
 * statements and comments are NOT treated as usages — only actual invocations
 * in component code trigger the enforcement.
 *
 * This test replaces the hand-written "CALL-SITE REGISTRY" comment in
 * disable-gateway-guard.test.ts with a filesystem scan so gaps cannot sneak
 * past code review.
 *
 * Run:
 *   cd artifacts/rpay && node --import tsx/esm --test src/lib/gateway-panel-coverage.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GATEWAY_SAVE_MUTATIONS,
  GATEWAY_PANEL_FILES,
  GATEWAY_PANEL_KNOWN_GAPS,
} from "./gateway-panels-registry.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const rpayRoot = resolve(__dirname, "../..");
const adminPagesDir = resolve(rpayRoot, "src/pages/admin");

function relativeToRpay(absolutePath: string): string {
  return relative(rpayRoot, absolutePath);
}

function readSource(absolutePath: string): string {
  return readFileSync(absolutePath, "utf8");
}

/**
 * Returns true only when the hook is actually *called* in source —
 * i.e. `hookName(` or `hookName (` appear in the file.
 * Import lines (`import { hookName }`) do NOT produce a call-site match.
 */
function isCallSite(source: string, hookName: string): boolean {
  return new RegExp(`\\b${hookName}\\s*\\(`).test(source);
}

function usedMutations(source: string): string[] {
  return GATEWAY_SAVE_MUTATIONS.filter((hook) => isCallSite(source, hook));
}

/**
 * Returns true when `useDisableGatewayGuard(` appears in the file —
 * a call-site match, not an import or comment.
 */
function callsGuard(source: string): boolean {
  return /\buseDisableGatewayGuard\s*\(/.test(source);
}

function listAdminTsx(): string[] {
  return readdirSync(adminPagesDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join(adminPagesDir, f));
}

describe("Gateway panel coverage — useDisableGatewayGuard call-site enforcement", () => {
  describe("every registered GATEWAY_PANEL_FILE calls useDisableGatewayGuard", () => {
    for (const relPath of GATEWAY_PANEL_FILES) {
      it(`${relPath} calls useDisableGatewayGuard`, () => {
        const absolutePath = resolve(rpayRoot, relPath);
        const source = readSource(absolutePath);
        assert.ok(
          callsGuard(source),
          `${relPath} is listed in GATEWAY_PANEL_FILES but does NOT call ` +
            `useDisableGatewayGuard. Add the hook to the component, or remove ` +
            `it from the registry if it is no longer a gateway config panel.`,
        );
      });
    }
  });

  describe("every admin page file that calls a gateway save mutation is accounted for", () => {
    const adminFiles = listAdminTsx();

    for (const absolutePath of adminFiles) {
      const relPath = relativeToRpay(absolutePath);
      const source = readSource(absolutePath);
      const mutations = usedMutations(source);

      if (mutations.length === 0) {
        continue;
      }

      const mutationList = mutations.join(", ");
      const isRegisteredPanel = (GATEWAY_PANEL_FILES as readonly string[]).includes(relPath);
      const isKnownGap = relPath in GATEWAY_PANEL_KNOWN_GAPS;

      it(`${relPath} (calls: ${mutationList})`, () => {
        if (isRegisteredPanel) {
          assert.ok(
            callsGuard(source),
            `${relPath} is in GATEWAY_PANEL_FILES and calls ${mutationList}, ` +
              `but does NOT call useDisableGatewayGuard. ` +
              `Add the hook to the panel component, or remove it from the registry.`,
          );
        } else if (isKnownGap) {
          assert.ok(
            true,
            `${relPath} is in KNOWN_GAPS: ${GATEWAY_PANEL_KNOWN_GAPS[relPath]}`,
          );
        } else {
          assert.fail(
            `NEW UNGUARDED GATEWAY PANEL DETECTED:\n` +
              `  File    : ${relPath}\n` +
              `  Calls   : ${mutationList}\n` +
              `  Has guard: ${callsGuard(source)}\n\n` +
              `This file calls a gateway save mutation but is not in the registry.\n` +
              `You MUST do one of the following:\n` +
              `  A) Add useDisableGatewayGuard to the component, then add\n` +
              `     "${relPath}"\n` +
              `     to GATEWAY_PANEL_FILES in src/lib/gateway-panels-registry.ts\n` +
              `  B) If the file genuinely does not need the guard (non-panel usage),\n` +
              `     add it to GATEWAY_PANEL_KNOWN_GAPS with a clear reason.\n`,
          );
        }
      });
    }
  });
});
