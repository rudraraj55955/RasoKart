---
name: Playwright chromium on Replit NixOS
description: Why the playwright-downloaded chromium headless shell fails on Replit, and the correct resolution chain for finding a working Chromium binary.
---

## Rule
Never use the playwright-downloaded `chromium_headless_shell-*` binary directly on Replit NixOS without verifying system library availability. Use the system chromium from `pkgs.chromium` instead.

## Why
The playwright-downloaded headless shell binary at `.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell` fails at launch with:
```
error while loading shared libraries: libgbm.so.1: cannot open shared object file: No such file or directory
```
Even though `pkgs.mesa` is in `replit.nix` (which provides libgbm), the downloaded binary's dynamic linker does not know the nix store path for the library. The nix store path is only embedded in binaries built by nix itself.

The system chromium installed by `pkgs.chromium` has all its library RPATHs correctly pointing into the nix store and launches successfully.

## How to Apply
The `resolveChromiumExecutable()` function in `browserPool.ts` uses this priority chain:
1. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` env var (absolute path — for VPS/production)
2. `which chromium` / `which chromium-browser` / `which google-chrome` (system chromium — nix store binary, works on Replit dev)
3. Scan `PLAYWRIGHT_BROWSERS_PATH` or workspace `.cache/ms-playwright` for versioned dirs
4. `undefined` → playwright's own default detection

This means:
- **Replit dev**: system chromium auto-detected, no env vars needed
- **VPS production**: set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome` in `.env`
- **CI**: set `PLAYWRIGHT_BROWSERS_PATH` and run `npx playwright install chromium`

## Verification
`probeBrowserReady()` navigates to `about:blank` and evaluates `1 + 1`. Returns `{ ready: true, durationMs: N }`. Call this from `/api/merchant/portal-sessions/browser-health`.
On Replit with system chromium: confirmed `ready: true, durationMs: ~12000ms`.

## Do NOT
- Do not hardcode the nix store path (the hash changes between package versions).
- Do not add `LD_LIBRARY_PATH` hacks to point the headless shell at the mesa libraries — the system chromium approach is cleaner and more maintainable.
- Do not call `healthCheck()` to probe browser readiness — it visits the Paytm portal. Use `probeBrowserReady()` which only opens `about:blank`.
