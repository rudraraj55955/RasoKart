---
name: Chromium --single-process browser pool keepalive
description: --single-process flag causes Chromium to exit between adapter calls; fix with keepalive context + remove --single-process.
---

## Rule
Never use `--single-process` or `--no-zygote` in the Connector Engine browser pool launch args.
After launch, immediately open a background keepalive `BrowserContext` that is never closed during normal operation (only in `closeBrowserPool()`).

## Why
Chromium exits when all browser contexts are released. With `--single-process`, this happens even when a keepalive context is nominally open — the flag disables the multi-process supervisor that would normally keep the browser alive. Result: `initiateSession` releases its context → Chromium exits → `submitStep` calls `browser.newContext()` on a dying browser → immediate BROWSER_ERROR in ~79ms.

Confirmed on Replit NixOS with system Chromium (pkgs.chromium, 138.x). The disconnect fires ~0ms after context release.

## How to apply
- `CHROMIUM_LAUNCH_ARGS` in `browserPool.ts`: remove `--single-process` and `--no-zygote`.
- In `getOrCreateBrowser().then()`, after `browserSingleton = browser`, open:
  ```typescript
  keepaliveCtx = await browser.newContext({ permissions: [], serviceWorkers: "block" });
  ```
- On `browser.on("disconnected")`, set `keepaliveCtx = null`.
- In `closeBrowserPool()`, close `keepaliveCtx` BEFORE calling `browserSingleton.close()`.

## Validation
With this fix, the diagnostic script `run-critical-e2e.mts` completes the full
`initiateSession → AWAITING_OTP → submitStep → CONNECTED` cycle without the browser
disconnecting between calls. Previous symptom: `browser_pool_disconnected` logged
immediately after `initiateSession` released its context.
