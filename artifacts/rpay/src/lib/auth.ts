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
    for (const store of [localStorage, sessionStorage]) {
      store.removeItem("token");
      store.removeItem("authToken");
      store.removeItem("user");
      store.removeItem("authUser");
    }
  }
}

export function setStoredUser(user: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    const json = JSON.stringify(user);
    localStorage.setItem(USER_KEY, json);
    sessionStorage.setItem(USER_KEY, json);
  }
}

function setLegacyAuthKeys(token: string, user: Record<string, unknown>) {
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
 * Persists the new token/user to every storage key any guard might read,
 * then forces immediate full-page navigation via window.location.replace so
 * the new page always starts with a clean React tree and a fresh React Query
 * cache — no stale auth state from a previous session can bleed over.
 *
 * Call queryClient.clear() BEFORE this function so no cached /me data from
 * a prior session is serialised into the new session's query cache.
 */
export function saveAuthAndRedirect(
  token: string,
  user: Record<string, unknown>,
  targetPath: string,
) {
  if (typeof window === "undefined") return;
  setToken(token);
  setStoredUser(user);
  setLegacyAuthKeys(token, user);
  window.location.replace(targetPath);
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
