export const TOKEN_KEY = "rasokart_token";
export const USER_KEY = "rasokart_user";

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(TOKEN_KEY, token);
  }
}

export function removeToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(USER_KEY);
  }
}

export function setStoredUser(user: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    const json = JSON.stringify(user);
    localStorage.setItem(USER_KEY, json);
    sessionStorage.setItem(USER_KEY, json);
  }
}

/**
 * Writes the token/user to the legacy/alias key names ("token", "authToken",
 * "user", "authUser") in BOTH localStorage and sessionStorage, in addition to
 * the app's real rasokart_* keys above. Some older/duplicate guard code paths
 * or third-party embeds may still probe these generic names — writing them
 * defensively costs nothing and guarantees no guard reading a different key
 * name ever sees an empty session right after login.
 */
export function setLegacyAuthKeys(token: string, user: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const json = JSON.stringify(user);
  for (const store of [localStorage, sessionStorage]) {
    store.setItem("token", token);
    store.setItem("authToken", token);
    store.setItem("user", json);
    store.setItem("authUser", json);
  }
}

/**
 * Single entry point called directly from a login success branch (never from
 * a useEffect, never gated on auth-context state). Persists the token/user
 * under every key any guard in the app might read (both the real
 * rasokart_* keys and the generic token/authToken/user/authUser aliases, in
 * both localStorage and sessionStorage), then forces navigation using three
 * independent methods staggered over time (marker: live-login-debug-hardredirect-v4):
 *   1. window.location.assign(targetPath) — immediately
 *   2. window.location.href = targetPath — after 100ms (in case assign was
 *      intercepted/no-opped by an extension or proxy quirk)
 *   3. window.location.replace(targetPath) — after 300ms (final fallback)
 * Once the first navigation actually takes effect the page unloads and the
 * later timeouts never fire, so this is safe to call unconditionally.
 */
export function saveAuthAndRedirect(
  token: string,
  user: Record<string, unknown>,
  targetPath: string,
  onDebug?: (state: {
    apiSuccess: boolean;
    tokenPresent: boolean;
    role: string;
    merchantType: string;
    targetPath: string;
    redirectCalled: boolean;
  }) => void
) {
  if (typeof window === "undefined") return;
  const tokenPresent = !!token;
  const role = typeof user["role"] === "string" ? (user["role"] as string) : "";
  const merchantType = typeof user["merchantType"] === "string" ? (user["merchantType"] as string) : "";

  setToken(token);
  setStoredUser(user);
  setLegacyAuthKeys(token, user);

  // eslint-disable-next-line no-console
  console.log("LOGIN_SUCCESS_DEBUG", { tokenPresent, user, targetPath });

  onDebug?.({ apiSuccess: true, tokenPresent, role, merchantType, targetPath, redirectCalled: true });

  window.location.assign(targetPath);
  setTimeout(() => {
    window.location.href = targetPath;
  }, 100);
  setTimeout(() => {
    window.location.replace(targetPath);
  }, 300);
}

export function getStoredUser(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY) ?? sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
